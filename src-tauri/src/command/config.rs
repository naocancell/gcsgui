use crate::config::comms::CommsConfig;
use crate::state;

/// 核心热重载逻辑
async fn apply_comms_hot_reload(
    _app: &tauri::AppHandle,
    state: &tauri::State<'_, state::AppState>,
    router_tx: &tauri::State<'_, crate::comms::RouterTx>,
    new_config: &CommsConfig,
) {
    // 1. 检查现存 UDP 链路：如果不满足新配置要求（配置被删除、被禁用或参数变化），先停止并移除
    let existing_udp_names: Vec<String> = state
        .active_links
        .iter()
        .filter(|entry| entry.value().link_type == "UDP")
        .map(|entry| entry.key().clone())
        .collect();

    for name in existing_udp_names {
        let matching_config = new_config.udp.iter().find(|cfg| cfg.name == name);
        let should_remove = match matching_config {
            Some(cfg) if cfg.enabled => {
                let expected_endpoint = format!("{}:{}:{}", cfg.ip, cfg.port, cfg.interface_ip);
                if let Some(link) = state.active_links.get(&name) {
                    link.endpoint_info != expected_endpoint || link.protocol != cfg.protocol
                } else {
                    true
                }
            }
            _ => true,
        };

        if should_remove {
            log::info!("[热重载] 停止变更或禁用的 UDP 链路: {}", name);
            if let Some((_, link)) = state.active_links.remove(&name) {
                link.transport.stop();
            }
        }
    }

    // 2. 遍历新配置启动所需的 UDP 链路
    for udp in &new_config.udp {
        if udp.enabled && !state.active_links.contains_key(&udp.name) {
            log::info!("[热重载] 正在启动新增/启用 UDP 链路: {}", udp.name);
            match crate::command::udp::start_udp_internal(
                state,
                router_tx,
                udp.name.clone(),
                udp.ip.clone(),
                udp.port,
                udp.interface_ip.clone(),
                udp.protocol,
            )
            .await
            {
                Ok(msg) => log::info!("[热重载] 启动 UDP 成功: {}", msg),
                Err(e) => log::error!("[热重载] 启动 UDP [{}] 失败: {}", udp.name, e),
            }
        }
    }

    // 3. 检查现存 Serial 链路：如果不满足新配置要求，先停止并移除
    let existing_serial_names: Vec<String> = state
        .active_links
        .iter()
        .filter(|entry| entry.value().link_type == "SERIAL")
        .map(|entry| entry.key().clone())
        .collect();

    for name in existing_serial_names {
        let matching_config = new_config.serial.iter().find(|cfg| cfg.name == name);
        let should_remove = match matching_config {
            Some(cfg) if cfg.enabled => {
                let expected_endpoint = format!("{}:{}", cfg.port_name, cfg.baud_rate);
                if let Some(link) = state.active_links.get(&name) {
                    link.endpoint_info != expected_endpoint || link.protocol != cfg.protocol
                } else {
                    true
                }
            }
            _ => true,
        };

        if should_remove {
            log::info!("[热重载] 停止变更或禁用的串口链路: {}", name);
            if let Some((_, link)) = state.active_links.remove(&name) {
                link.transport.stop();
            }
        }
    }

    // 4. 遍历新配置启动所需的 Serial 链路
    for serial in &new_config.serial {
        if serial.enabled && !state.active_links.contains_key(&serial.name) {
            log::info!("[热重载] 正在启动新增/启用串口链路: {}", serial.name);
            match crate::command::serial::start_serial_internal(
                state,
                router_tx,
                serial.name.clone(),
                serial.port_name.clone(),
                serial.baud_rate,
                serial.protocol,
            )
            .await
            {
                Ok(msg) => log::info!("[热重载] 启动串口成功: {}", msg),
                Err(e) => log::error!("[热重载] 启动串口 [{}] 失败: {}", serial.name, e),
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
