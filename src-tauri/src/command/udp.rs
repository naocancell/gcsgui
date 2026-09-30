use crate::config::comms::UdpMode;
use crate::parse_protocol;
use crate::state;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc;

fn resolve_udp_target(ip: &str, mode: UdpMode) -> Result<Option<std::net::Ipv4Addr>, String> {
    let target_ip: std::net::Ipv4Addr = ip
        .parse()
        .map_err(|e| format!("UDP 目标 IPv4 地址解析失败: {}", e))?;

    if mode == UdpMode::Multicast && !target_ip.is_multicast() {
        return Err(format!("UDP 组播地址必须位于组播地址范围: {}", ip));
    }
    if mode == UdpMode::Unicast && target_ip.is_multicast() {
        return Err(format!("UDP 点播地址不能使用组播地址: {}", ip));
    }

    Ok((mode == UdpMode::Multicast).then_some(target_ip))
}
pub async fn start_udp_internal(
    state: &state::AppState,
    router_tx: &crate::comms::RouterTx,
    name: String,
    ip: String,
    port: u16,
    target_port: u16,
    interface_ip: String,
    mode: UdpMode,
    protocol_type: crate::comms::ProtocolType,
) -> Result<String, String> {
    let link_name = name.clone();

    if state.active_links.contains_key(&link_name) {
        return Err(format!("该 UDP 链路 [{}] 已存在", link_name));
    }

    let generation = state.allocate_link_generation();
    let target_port = if target_port == 0 { port } else { target_port };
    let multicast_ip = resolve_udp_target(&ip, mode)?;

    let bind_addr = format!("0.0.0.0:{}", port)
        .parse()
        .map_err(|e: std::net::AddrParseError| format!("本地绑定地址解析失败: {}", e))?;
    let target_addr = format!("{}:{}", ip, target_port)
        .parse()
        .map_err(|e: std::net::AddrParseError| format!("目标地址解析失败: {}", e))?;

    let config = comms_core::UdpConfig {
        name: link_name.clone(),
        bind_addr,
        target_addr,
        multicast_ip,
        interface_ip: interface_ip.parse().ok(),
        buffer_size: 65535,
    };

    let (event_tx, mut event_rx) = mpsc::channel::<comms_core::LinkEvent>(100);

    let transport = comms_core::UdpLink::start(config, event_tx)
        .await
        .map_err(|e| format!("启动 UDP 内核失败: {}", e))?;

    let endpoint_info = format!(
        "{:?}:{}:{}:{}:{}",
        mode, ip, port, target_port, interface_ip
    );

    let active_link = state::ActiveLink {
        link_type: "UDP".to_string(),
        name: link_name.clone(),
        generation,
        endpoint_info,
        protocol: protocol_type,
        transport,
        last_raw_rx: Arc::new(Mutex::new(Instant::now())),
    };

    state.active_links.insert(link_name.clone(), active_link);
    let _ = state.recorder.start_link(&link_name, protocol_type, "UDP");

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
                            link_generation: generation,
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
    target_port: Option<u16>,
    interface_ip: String,
    mode: Option<UdpMode>,
    protocol: String,
) -> Result<String, String> {
    let protocol_type = parse_protocol(&protocol)?;
    start_udp_internal(
        &state,
        &router_tx,
        name,
        ip,
        port,
        target_port.unwrap_or(port),
        interface_ip,
        mode.unwrap_or_default(),
        protocol_type,
    )
    .await
}

#[tauri::command]
pub fn stop_udp_listener(
    state: tauri::State<'_, state::AppState>,
    name: String,
) -> Result<String, String> {
    match state.active_links.remove(&name) { Some((_, link)) => {
        link.transport.stop();
        let recorder = state.recorder.clone();
        let n = name.clone();
        tauri::async_runtime::spawn(async move {
            let _ = recorder.stop_link(&n).await;
        });
        Ok(format!("UDP 监听服务 [{}] 已停止", name))
    } _ => {
        Err(format!("未找到指定的 UDP 链路 [{}]", name))
    }}
}
