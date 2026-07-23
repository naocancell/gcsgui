use crate::parse_protocol;
use crate::state;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc;

pub async fn start_udp_internal(
    state: &state::AppState,
    router_tx: &crate::comms::RouterTx,
    name: String,
    ip: String,
    port: u16,
    interface_ip: String,
    protocol_type: crate::comms::ProtocolType,
) -> Result<String, String> {
    let link_name = name.clone();

    if state.active_links.contains_key(&link_name) {
        return Err(format!("该 UDP 链路 [{}] 已存在", link_name));
    }

    let bind_addr = format!("0.0.0.0:{}", port)
        .parse()
        .map_err(|e: std::net::AddrParseError| format!("本地绑定地址解析失败: {}", e))?;
    let target_addr = format!("{}:{}", ip, port)
        .parse()
        .map_err(|e: std::net::AddrParseError| format!("目标地址解析失败: {}", e))?;

    let config = comms_core::UdpConfig {
        name: link_name.clone(),
        bind_addr,
        target_addr,
        multicast_ip: ip.parse().ok(),
        interface_ip: interface_ip.parse().ok(),
        buffer_size: 65535,
    };

    let (event_tx, mut event_rx) = mpsc::channel::<comms_core::LinkEvent>(100);

    let transport = comms_core::UdpLink::start(config, event_tx)
        .await
        .map_err(|e| format!("启动 UDP 内核失败: {}", e))?;

    let endpoint_info = format!("{}:{}:{}", ip, port, interface_ip);

    let active_link = state::ActiveLink {
        link_type: "UDP".to_string(),
        name: link_name.clone(),
        endpoint_info,
        protocol: protocol_type,
        transport,
        last_raw_rx: Arc::new(Mutex::new(Instant::now())),
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
                    log::info!("UDP 链路 {} 底层状态变化: {:?}", ln_clone, status);
                }
            }
        }
        log::info!("UDP 链路 {} 接收监听已结束", ln_clone);
    });

    Ok("UDP 监听服务启动成功".to_string())
}

#[tauri::command]
pub async fn start_udp_listener(
    state: tauri::State<'_, state::AppState>,
    router_tx: tauri::State<'_, crate::comms::RouterTx>,
    name: String,
    ip: String,
    port: u16,
    interface_ip: String,
    protocol: String,
) -> Result<String, String> {
    let protocol_type = parse_protocol(&protocol)?;
    start_udp_internal(
        &state,
        &router_tx,
        name,
        ip,
        port,
        interface_ip,
        protocol_type,
    )
    .await
}

#[tauri::command]
pub fn stop_udp_listener(
    state: tauri::State<'_, state::AppState>,
    name: String,
) -> Result<String, String> {
    if let Some((_, link)) = state.active_links.remove(&name) {
        link.transport.stop();
        Ok(format!("UDP 监听服务 [{}] 已停止", name))
    } else {
        Err(format!("未找到指定的 UDP 链路 [{}]", name))
    }
}
