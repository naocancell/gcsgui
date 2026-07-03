use crate::parse_protocol;
use crate::state;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc;

pub async fn start_serial_internal(
    state: &state::AppState,
    router_tx: &crate::comms::RouterTx,
    name: String,
    port_name: String,
    baud_rate: u32,
    protocol_type: crate::comms::ProtocolType,
) -> Result<String, String> {
    let link_name = name.clone();

    if state.active_links.contains_key(&link_name) {
        return Err(format!("该串口链路 [{}] 已存在", link_name));
    }

    let config = comms_core::SerialConfig {
        name: link_name.clone(),
        port_name: port_name.clone(),
        baud_rate,
        buffer_size: 4096,
    };

    let (event_tx, mut event_rx) = mpsc::channel::<comms_core::LinkEvent>(100);

    let transport = comms_core::SerialLink::start(config, event_tx)
        .await
        .map_err(|e| format!("启动串口内核失败: {}", e))?;

    let endpoint_info = format!("{}:{}", port_name, baud_rate);

    let active_link = state::ActiveLink {
        link_type: "SERIAL".to_string(),
        name: link_name.clone(),
        endpoint_info,
        protocol: protocol_type,
        transport,
        last_heartbeat: Arc::new(Mutex::new(Instant::now())),
    };

    state.active_links.insert(link_name.clone(), active_link);

    let router_tx_clone = router_tx.clone();
    let ln_clone = link_name.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            match event {
                comms_core::LinkEvent::Data {
                    payload,
                    received_at,
                    ..
                } => {
                    let _ = router_tx_clone
                        .send(crate::comms::RawData {
                            source_link: ln_clone.clone(),
                            data: payload,
                            received_at,
                        })
                        .await;
                }
                comms_core::LinkEvent::StatusChanged { status, .. } => {
                    log::info!("串口链路 {} 底层状态变化: {:?}", ln_clone, status);
                }
            }
        }
        log::info!("串口链路 {} 接收监听已结束", ln_clone);
    });

    Ok("串口监听服务启动成功".to_string())
}

#[tauri::command]
pub async fn start_serial_listener(
    state: tauri::State<'_, state::AppState>,
    router_tx: tauri::State<'_, crate::comms::RouterTx>,
    name: String,
    port_name: String,
    baud_rate: u32,
    protocol: String,
) -> Result<String, String> {
    let protocol_type = parse_protocol(&protocol)?;
    start_serial_internal(
        &state,
        &router_tx,
        name,
        port_name,
        baud_rate,
        protocol_type,
    )
    .await
}

#[tauri::command]
pub fn stop_serial_listener(
    state: tauri::State<'_, state::AppState>,
    name: String,
) -> Result<String, String> {
    if let Some((_, link)) = state.active_links.remove(&name) {
        link.transport.stop();
        Ok(format!("已停止串口链路 [{}]", name))
    } else {
        Err(format!("找不到指定的串口链路 [{}]", name))
    }
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

                if current_ports != last_ports {
                    last_ports = current_ports.clone();
                    let _ = app.emit("ports-changed", current_ports);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });
}
