use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::Manager;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::connectivity::RawData;

pub mod connectivity;
pub mod protocol;
pub mod state;
pub mod router;

/// 将前端传入的协议字符串映射为枚举
fn parse_protocol(protocol: &str) -> Result<connectivity::ProtocolType, String> {
    match protocol {
        "FP981C" => Ok(connectivity::ProtocolType::FP981C),
        "UAVInfo" => Ok(connectivity::ProtocolType::UAVInfo),
        "FP95" => Ok(connectivity::ProtocolType::FP95),
        _ => Err(format!("未知的协议类型: {}", protocol)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_state = state::AppState::new();
            app.manage(app_state.clone());
            
            let (router_tx, router_rx) = mpsc::channel::<RawData>(1000);
            app.manage(router_tx.clone());

            let app_state_clone = app_state.clone();
            tauri::async_runtime::spawn(async move {
                router::link_manager::start_router(router_rx, app_state_clone).await;
            });

            // 启动 10Hz 状态推送分发器
            let app_handle_emitter = app.handle().clone();
            let app_state_emitter = app_state.clone();
            tauri::async_runtime::spawn(async move {
                router::emitter::start_emitter(app_handle_emitter, app_state_emitter).await;
            });

            // 启动串口热插拔监测后台任务
            crate::connectivity::serial::start_port_monitor(app.handle().clone());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_udp_listener,
            stop_udp_listener,
            start_serial_listener,
            stop_serial_listener,
            get_network_interfaces,
            upload_route,
            close_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn start_udp_listener(
    state: tauri::State<'_, state::AppState>,
    router_tx: tauri::State<'_, crate::connectivity::RouterTx>,
    ip: String,
    port: u16,
    interface_ip: String,
    protocol: String,
) -> Result<String, String> {
    let protocol_type = parse_protocol(&protocol)?;
    let link_name = format!("UDP_{}:{}", ip, port);
    println!("[后端启动 UDP] 链路名称: {}, 协议入参: {}, 解析结果: {:?}", link_name, protocol, protocol_type);

    if state.active_links.contains_key(&link_name) {
        return Err("该 UDP 链路已存在".to_string());
    }

    let cancel_token = CancellationToken::new();
    let (tx_sender, tx_rx) = mpsc::channel::<Vec<u8>>(100);

    let active_link = state::ActiveLink {
        link_type: "UDP".to_string(),
        name: link_name.clone(),
        protocol: protocol_type,
        tx_channel: tx_sender,
        cancel_token: cancel_token.clone(),
        last_heartbeat: Arc::new(Mutex::new(Instant::now())),
    };

    state.active_links.insert(link_name.clone(), active_link);

    let router_tx_clone = (*router_tx).clone();

    // 传输层不接收协议参数，纯收发
    tauri::async_runtime::spawn(async move {
        if let Err(e) = connectivity::udp::start_udp_link(
            router_tx_clone,
            tx_rx,
            cancel_token,
            ip,
            port,
            interface_ip,
            link_name.clone(),
        ).await {
            log::error!("UDP 链路启动异常：{}", e);
        }
    });

    Ok("UDP 监听服务启动成功".to_string())
}

#[tauri::command]
fn stop_udp_listener(
    state: tauri::State<'_, state::AppState>,
    ip: String,
    port: u16,
) -> Result<String, String> {
    let link_name = format!("UDP_{}:{}", ip, port);
    if let Some((_, link)) = state.active_links.remove(&link_name) {
        link.cancel_token.cancel();
        Ok(format!("UDP 监听服务 ({}:{}) 已停止", ip, port))
    } else {
        Err(format!("未找到指定的 UDP 链路 ({}:{})", ip, port))
    }
}

#[tauri::command]
async fn start_serial_listener(
    state: tauri::State<'_, state::AppState>,
    router_tx: tauri::State<'_, crate::connectivity::RouterTx>,
    port_name: String,
    baud_rate: u32,
    protocol: String,
) -> Result<String, String> {
    let protocol_type = parse_protocol(&protocol)?;
    let link_name = format!("SERIAL_{}", port_name);

    if state.active_links.contains_key(&link_name) {
        return Err("该串口链路已存在".to_string());
    }

    let cancel_token = CancellationToken::new();
    let (tx_sender, tx_rx) = mpsc::channel::<Vec<u8>>(100);

    let active_link = state::ActiveLink {
        link_type: "SERIAL".to_string(),
        name: link_name.clone(),
        protocol: protocol_type,
        tx_channel: tx_sender,
        cancel_token: cancel_token.clone(),
        last_heartbeat: Arc::new(Mutex::new(Instant::now())),
    };

    state.active_links.insert(link_name.clone(), active_link);

    let router_tx_clone = (*router_tx).clone();

    // 传输层不接收协议参数，纯收发
    tauri::async_runtime::spawn(async move {
        if let Err(e) = connectivity::serial::start_serial_link(
            router_tx_clone,
            tx_rx,
            cancel_token,
            port_name,
            baud_rate,
            link_name.clone(),
        ).await {
            log::error!("串口链路启动异常：{}", e);
        }
    });

    Ok("串口监听服务启动成功".to_string())
}

#[tauri::command]
fn stop_serial_listener(
    state: tauri::State<'_, state::AppState>,
    port_name: String,
) -> Result<String, String> {
    let link_name = format!("SERIAL_{}", port_name);
    
    if let Some((_, link)) = state.active_links.remove(&link_name) {
        link.cancel_token.cancel();
        Ok(format!("已停止串口链路 {}", link_name))
    } else {
        Err("找不到指定的串口链路".to_string())
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NetworkInterfaceInfo {
    name: String,
    ip: String,
}

#[tauri::command]
fn get_network_interfaces() -> Result<Vec<NetworkInterfaceInfo>, String> {
    let mut interfaces = Vec::new();
    match get_if_addrs::get_if_addrs() {
        Ok(if_addrs) => {
            for iface in if_addrs {
                if let std::net::IpAddr::V4(ipv4) = iface.addr.ip() {
                    interfaces.push(NetworkInterfaceInfo {
                        name: iface.name,
                        ip: ipv4.to_string(),
                    });
                }
            }
            Ok(interfaces)
        }
        Err(e) => Err(format!("获取网卡列表失败：{}", e)),
    }
}

#[tauri::command]
async fn upload_route(
    state: tauri::State<'_, state::AppState>,
    ip: String,
    port: u16,
    route: protocol::route_info::RouteUpload,
) -> Result<String, String> {
    let link_name = format!("UDP_{}:{}", ip, port);
    if let Some(link) = state.active_links.get(&link_name) {
        let mut success_count = 0;
        for pt in &route.points {
            let bytes = pt.to_bytes(route.code);
            let _ = link.tx_channel.send(bytes.to_vec()).await;
            success_count += 1;
        }
        Ok(format!("航线数据下发成功：{}", success_count))
    } else {
        Err("找不到指定的 UDP 链路进行下发".to_string())
    }
}

#[tauri::command]
fn close_app() {
    std::process::exit(0);
}
