use crate::comms::{emit_link_status, LinkStatusEvent};
use crate::config::comms::ParityConfig;
use crate::parse_protocol;
use crate::state;
use comms_core::TransportLink;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// 串口异常断开后的自动重连间隔
const SERIAL_RECONNECT_INTERVAL: Duration = Duration::from_secs(2);

/// 链路仍是同名同代数的那一条（未被用户停止或重建）
fn is_current_link(state: &state::AppState, name: &str, generation: u64) -> bool {
    state
        .active_links
        .get(name)
        .is_some_and(|link| link.generation == generation)
}

/// 串口链路事件循环：转发数据给路由；设备拔出等异常断开时通知前端并每 2s 自动重连，
/// 重连成功后原地替换 transport（链路名/代数/录制会话不变）；用户停止链路后退出。
async fn supervise_serial_link(
    state: state::AppState,
    router_tx: crate::comms::RouterTx,
    config: comms_core::SerialConfig,
    generation: u64,
    mut event_rx: mpsc::Receiver<comms_core::LinkEvent>,
) {
    let link_name = config.name.clone();
    loop {
        let mut fault_reason = None;
        while let Some(event) = event_rx.recv().await {
            match event {
                comms_core::LinkEvent::Data {
                    payload,
                    received_at,
                    ..
                } => {
                    let _ = router_tx
                        .send(crate::comms::RawData {
                            source_link: link_name.clone(),
                            link_generation: generation,
                            data: payload,
                            received_at,
                        })
                        .await;
                }
                comms_core::LinkEvent::StatusChanged { status, .. } => {
                    log::info!("串口链路 {} 底层状态变化: {:?}", link_name, status);
                    match status {
                        comms_core::LinkStatus::Faulted(reason) => {
                            fault_reason = Some(reason);
                            break;
                        }
                        comms_core::LinkStatus::Stopped => break,
                        _ => {}
                    }
                }
            }
        }

        let Some(reason) = fault_reason else { break };
        if !is_current_link(&state, &link_name, generation) {
            break;
        }
        log::warn!(
            "[链路] 串口 {} 异常断开（{}），每 {}s 自动重连",
            link_name,
            reason,
            SERIAL_RECONNECT_INTERVAL.as_secs()
        );
        emit_link_status(LinkStatusEvent {
            link_name: link_name.clone(),
            link_type: "SERIAL",
            status: "faulted",
            reason: Some(reason),
        });

        let mut attempts: u32 = 0;
        loop {
            tokio::time::sleep(SERIAL_RECONNECT_INTERVAL).await;
            if !is_current_link(&state, &link_name, generation) {
                log::info!("串口链路 {} 已被停止或重建，放弃自动重连", link_name);
                return;
            }
            attempts += 1;
            let (event_tx, next_rx) = mpsc::channel::<comms_core::LinkEvent>(100);
            match comms_core::SerialLink::start(config.clone(), event_tx).await {
                Ok(transport) => {
                    let replaced = match state.active_links.get_mut(&link_name) {
                        Some(mut link) if link.generation == generation => {
                            link.transport = transport.clone();
                            true
                        }
                        _ => false,
                    };
                    if !replaced {
                        transport.stop();
                        return;
                    }
                    log::info!(
                        "[链路] 串口 {} 已自动重连（第 {} 次尝试）",
                        link_name,
                        attempts
                    );
                    emit_link_status(LinkStatusEvent {
                        link_name: link_name.clone(),
                        link_type: "SERIAL",
                        status: "recovered",
                        reason: None,
                    });
                    event_rx = next_rx;
                    break;
                }
                Err(error) => {
                    log::debug!("串口 {} 第 {} 次重连失败: {}", link_name, attempts, error);
                }
            }
        }
    }
    log::info!("串口链路 {} 接收监听已结束", link_name);
}

/// 串口打开失败时的重试次数与间隔：热重载停旧启新时旧句柄可能尚未被系统完全回收
const SERIAL_OPEN_RETRIES: u32 = 3;
const SERIAL_OPEN_RETRY_INTERVAL: Duration = Duration::from_millis(300);

/// 串口物理参数（端口、波特率、数据位、停止位、校验位）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SerialSettings {
    pub port_name: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: ParityConfig,
}

impl SerialSettings {
    pub fn from_config(config: &crate::config::comms::SerialConfig) -> Self {
        Self {
            port_name: config.port_name.clone(),
            baud_rate: config.baud_rate,
            data_bits: config.data_bits,
            stop_bits: config.stop_bits,
            parity: config.parity,
        }
    }

    /// 链路端点描述（如 `COM3:115200:8N1`），热重载据此判断串口参数是否变化
    pub fn endpoint_info(&self) -> String {
        let parity = match self.parity {
            ParityConfig::None => 'N',
            ParityConfig::Odd => 'O',
            ParityConfig::Even => 'E',
        };
        format!(
            "{}:{}:{}{}{}",
            self.port_name, self.baud_rate, self.data_bits, parity, self.stop_bits
        )
    }

    fn to_core_config(&self, name: &str) -> Result<comms_core::SerialConfig, String> {
        let data_bits = match self.data_bits {
            5 => comms_core::DataBits::Five,
            6 => comms_core::DataBits::Six,
            7 => comms_core::DataBits::Seven,
            8 => comms_core::DataBits::Eight,
            other => return Err(format!("串口 [{name}] 数据位 {other} 无效（仅支持 5~8）")),
        };
        let stop_bits = match self.stop_bits {
            1 => comms_core::StopBits::One,
            2 => comms_core::StopBits::Two,
            other => return Err(format!("串口 [{name}] 停止位 {other} 无效（仅支持 1 或 2）")),
        };
        let parity = match self.parity {
            ParityConfig::None => comms_core::Parity::None,
            ParityConfig::Odd => comms_core::Parity::Odd,
            ParityConfig::Even => comms_core::Parity::Even,
        };
        Ok(comms_core::SerialConfig {
            name: name.to_string(),
            port_name: self.port_name.clone(),
            baud_rate: self.baud_rate,
            data_bits,
            stop_bits,
            parity,
            buffer_size: 4096,
        })
    }
}

/// 打开串口，失败时短暂重试（旧句柄释放与系统回收之间可能有短暂窗口，Windows 下表现为 OS error 5）
async fn open_serial_with_retry(
    config: &comms_core::SerialConfig,
    event_tx: mpsc::Sender<comms_core::LinkEvent>,
) -> Result<Arc<comms_core::SerialLink>, comms_core::CommsError> {
    let mut attempt = 0;
    loop {
        match comms_core::SerialLink::start(config.clone(), event_tx.clone()).await {
            Ok(link) => return Ok(link),
            Err(error) if attempt < SERIAL_OPEN_RETRIES => {
                attempt += 1;
                log::debug!(
                    "串口 {} 打开失败（{}），{}ms 后第 {} 次重试",
                    config.port_name,
                    error,
                    SERIAL_OPEN_RETRY_INTERVAL.as_millis(),
                    attempt
                );
                tokio::time::sleep(SERIAL_OPEN_RETRY_INTERVAL).await;
            }
            Err(error) => return Err(error),
        }
    }
}

pub async fn start_serial_internal(
    state: &state::AppState,
    router_tx: &crate::comms::RouterTx,
    name: String,
    settings: SerialSettings,
    protocol_type: crate::comms::ProtocolType,
) -> Result<String, String> {
    let link_name = name.clone();

    if state.active_links.contains_key(&link_name) {
        return Err(format!("该串口链路 [{}] 已存在", link_name));
    }

    let config = settings.to_core_config(&link_name)?;
    let generation = state.allocate_link_generation();

    let (event_tx, event_rx) = mpsc::channel::<comms_core::LinkEvent>(100);

    let transport = open_serial_with_retry(&config, event_tx)
        .await
        .map_err(|e| format!("启动串口内核失败: {}", e))?;

    let active_link = state::ActiveLink {
        link_type: "SERIAL".to_string(),
        name: link_name.clone(),
        generation,
        endpoint_info: settings.endpoint_info(),
        protocol: protocol_type,
        transport,
        last_raw_rx: Arc::new(Mutex::new(Instant::now())),
    };

    state.active_links.insert(link_name.clone(), active_link);
    let _ = state.recorder.start_link(&link_name, protocol_type, "Serial");

    tauri::async_runtime::spawn(supervise_serial_link(
        state.clone(),
        router_tx.clone(),
        config,
        generation,
        event_rx,
    ));

    Ok("串口监听服务启动成功".to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_serial_listener(
    state: tauri::State<'_, state::AppState>,
    router_tx: tauri::State<'_, crate::comms::RouterTx>,
    name: String,
    port_name: String,
    baud_rate: u32,
    protocol: String,
    data_bits: Option<u8>,
    stop_bits: Option<u8>,
    parity: Option<ParityConfig>,
) -> Result<String, String> {
    let protocol_type = parse_protocol(&protocol)?;
    let settings = SerialSettings {
        port_name,
        baud_rate,
        data_bits: data_bits.unwrap_or(8),
        stop_bits: stop_bits.unwrap_or(1),
        parity: parity.unwrap_or_default(),
    };
    start_serial_internal(&state, &router_tx, name, settings, protocol_type).await
}

#[tauri::command]
pub fn stop_serial_listener(
    state: tauri::State<'_, state::AppState>,
    name: String,
) -> Result<String, String> {
    match state.active_links.remove(&name) { Some((_, link)) => {
        link.transport.stop();
        let recorder = state.recorder.clone();
        let active_links = state.active_links.clone();
        let n = name.clone();
        tauri::async_runtime::spawn(async move {
            let _ = recorder.stop_link(&n).await;
            recorder.close_validated_if_comms_stopped(&active_links).await;
        });
        Ok(format!("已停止串口链路 [{}]", name))
    } _ => {
        Err(format!("找不到指定的串口链路 [{}]", name))
    }}
}

/// 启动串口热插拔监测后台任务 (每秒轮询一次系统串口并推送变更)
pub fn start_port_monitor(app: tauri::AppHandle) {
    use tauri::Emitter;
    tauri::async_runtime::spawn(async move {
        let mut last_ports: Vec<String> = Vec::new();
        loop {
            if let Ok(ports) = comms_core::list_available_ports() {
                let mut current_ports: Vec<String> =
                    ports.into_iter().map(|p| p.port_name).collect();
                current_ports.sort();

                // println!("{:?}", current_ports);

                if current_ports != last_ports {
                    last_ports = current_ports.clone();
                    let _ = app.emit("ports-changed", current_ports);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
}

#[tauri::command]
pub fn get_available_ports() -> Result<Vec<String>, String> {
    comms_core::list_available_ports()
        .map(|ports| {
            let mut p: Vec<String> = ports.into_iter().map(|p| p.port_name).collect();
            p.sort();
            p
        })
        .map_err(|e| format!("获取串口列表失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(data_bits: u8, stop_bits: u8, parity: ParityConfig) -> SerialSettings {
        SerialSettings {
            port_name: "COM3".to_string(),
            baud_rate: 115200,
            data_bits,
            stop_bits,
            parity,
        }
    }

    #[test]
    fn endpoint_info_encodes_frame_format() {
        assert_eq!(settings(8, 1, ParityConfig::None).endpoint_info(), "COM3:115200:8N1");
        assert_eq!(settings(7, 2, ParityConfig::Even).endpoint_info(), "COM3:115200:7E2");
    }

    #[test]
    fn to_core_config_validates_frame_format() {
        let config = settings(7, 2, ParityConfig::Odd)
            .to_core_config("链路1")
            .expect("7O2 应合法");
        assert_eq!(config.data_bits, comms_core::DataBits::Seven);
        assert_eq!(config.stop_bits, comms_core::StopBits::Two);
        assert_eq!(config.parity, comms_core::Parity::Odd);
        assert!(settings(9, 1, ParityConfig::None).to_core_config("链路1").is_err());
        assert!(settings(8, 3, ParityConfig::None).to_core_config("链路1").is_err());
    }
}
