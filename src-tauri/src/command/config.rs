use crate::config::comms::CommsConfig;
use crate::state;

/// 核心热重载逻辑
async fn apply_comms_hot_reload(
    _app: &tauri::AppHandle,
    state: &tauri::State<'_, state::AppState>,
    router_tx: &tauri::State<'_, crate::comms::RouterTx>,
    new_config: &CommsConfig,
) {
    for udp in &new_config.udp {
        let link_name = format!("UDP_{}:{}", udp.ip, udp.port);
        let is_running = state.active_links.contains_key(&link_name);

        if udp.enabled && !is_running {
            log::info!("[热重载] 正在启动新增/启用 UDP 链路: {}", link_name);
            match crate::command::udp::start_udp_internal(
                state,
                router_tx,
                udp.ip.clone(),
                udp.port,
                udp.interface_ip.clone(),
                udp.protocol,
            )
            .await
            {
                Ok(msg) => log::info!("[热重载] 启动 UDP 成功: {}", msg),
                Err(e) => log::error!("[热重载] 启动 UDP {} 失败: {}", link_name, e),
            }
        } else if !udp.enabled && is_running {
            log::info!("[热重载] 关闭禁用的 UDP 链路: {}", link_name);
            if let Some((_, link)) = state.active_links.remove(&link_name) {
                link.transport.stop();
            }
        }
    }

    for serial in &new_config.serial {
        let link_name = format!("SERIAL_{}", serial.port_name);
        let is_running = state.active_links.contains_key(&link_name);

        if serial.enabled && !is_running {
            log::info!("[热重载] 正在启动新增/启用串口链路: {}", link_name);
            match crate::command::serial::start_serial_internal(
                state,
                router_tx,
                serial.port_name.clone(),
                serial.baud_rate,
                serial.protocol,
            )
            .await
            {
                Ok(msg) => log::info!("[热重载] 启动串口成功: {}", msg),
                Err(e) => log::error!("[热重载] 启动串口 {} 失败: {}", link_name, e),
            }
        } else if !serial.enabled && is_running {
            log::info!("[热重载] 关闭禁用的串口链路: {}", link_name);
            if let Some((_, link)) = state.active_links.remove(&link_name) {
                link.transport.stop();
            }
        }
    }
}

#[tauri::command]
pub fn get_comms_config(app: tauri::AppHandle) -> CommsConfig {
    CommsConfig::load(&app)
}

#[tauri::command]
pub async fn save_comms_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, state::AppState>,
    router_tx: tauri::State<'_, crate::comms::RouterTx>,
    config: CommsConfig,
) -> Result<String, String> {
    config.save(&app)?;
    apply_comms_hot_reload(&app, &state, &router_tx, &config).await;
    Ok("配置保存并成功应用热重载！".to_string())
}
