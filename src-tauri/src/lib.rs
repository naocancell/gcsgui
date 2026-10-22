use command::*;
use once_cell::sync::OnceCell;
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::mpsc;

use crate::comms::RawData;

pub mod command;
pub mod comms;
pub mod config;
pub mod protocol;
pub mod recorder;
pub mod router;
pub mod state;
pub mod uplink;
pub mod encrypted_cache;
pub mod error;

pub static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

use tauri_plugin_dialog::DialogExt;

/// 将前端传入的协议字符串映射为枚举
pub(crate) fn parse_protocol(protocol: &str) -> Result<comms::ProtocolType, String> {
    match protocol {
        "FP981C" => Ok(comms::ProtocolType::FP981C),
        "UAVInfo" => Ok(comms::ProtocolType::UAVInfo),
        "FP95" => Ok(comms::ProtocolType::FP95),
        "ServoTurntable" => Ok(comms::ProtocolType::ServoTurntable),
        "PassthroughC0" => Ok(comms::ProtocolType::PassthroughC0),
        "PassthroughC1" => Ok(comms::ProtocolType::PassthroughC1),
        "PassthroughC2" => Ok(comms::ProtocolType::PassthroughC2),
        _ => Err(format!("未知的协议类型: {}", protocol)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            app.dialog()
                .message("GCS GUI 地面站软件已运行")
                .title("系统提醒")
                .show(|_| {});
        }))
        .setup(|app| {
            let _ = APP_HANDLE.set(app.handle().clone());

            // 最先初始化日志插件（强行创建目录并落盘），确保后续各子系统启动日志不丢失
            use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
            let log_dir = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("./logs"));

            let _ = std::fs::create_dir_all(&log_dir);

            match app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .targets([
                        Target::new(TargetKind::Stdout),
                        Target::new(TargetKind::Folder {
                            path: log_dir.clone(),
                            file_name: Some("gcsgui".to_string()),
                        }),
                        Target::new(TargetKind::Webview),
                    ])
                    .max_file_size(20 * 1024 * 1024)
                    .rotation_strategy(RotationStrategy::KeepSome(14))
                    .timezone_strategy(TimezoneStrategy::UseLocal)
                    .level(if cfg!(debug_assertions) {
                        log::LevelFilter::Debug
                    } else {
                        log::LevelFilter::Info
                    })
                    .level_for("tao", log::LevelFilter::Warn)
                    .level_for("wry", log::LevelFilter::Warn)
                    .build(),
            ) {
                Err(e) => {
                    eprintln!("初始化日志插件失败: {}", e);
                }
                _ => {
                    log::info!("=== GCSGUI 地面站日志系统初始化成功 ===");
                    log::info!("日志持久化保存路径: {:?}", log_dir);
                }
            }

            let app_state = state::AppState::new();
            app.manage(app_state.clone());

            let response_coordinator = uplink::FP95ResponseCoordinator::default();
            app.manage(response_coordinator.clone());

            // 上行机号来自通信配置文件，启动即生效（不再等前端保存配置后才下发机号）
            let uplink_aircraft_id =
                config::comms::CommsConfig::load(app.handle()).effective_uplink_aircraft_id();
            let uplink_handle = uplink::start(app_state.clone(), uplink_aircraft_id);
            app.manage(uplink_handle);

            let (router_tx, router_rx) = mpsc::channel::<RawData>(1000);
            app.manage(router_tx.clone());

            let app_state_clone = app_state.clone();
            let response_coordinator_clone = response_coordinator.clone();
            tauri::async_runtime::spawn(async move {
                router::link_manager::start_router(
                    router_rx,
                    app_state_clone,
                    response_coordinator_clone,
                )
                .await;
            });

            // 启动 10Hz 状态推送分发器
            let app_handle_emitter = app.handle().clone();
            let app_state_emitter = app_state.clone();
            tauri::async_runtime::spawn(async move {
                router::emitter::supervise_emitter(app_handle_emitter, app_state_emitter).await;
            });

            // 启动串口热插拔监测后台任务
            crate::command::serial::start_port_monitor(app.handle().clone());

            // 启动 0xC3 继电器 0.5Hz 自主轮询上行任务（开始通信后自主轮询）
            crate::command::payload::start_relay_status_poller(app_state.clone());

            // 初始化记录回放子系统数据存放目录
            let rec_dir = app
                .path()
                .app_data_dir()
                .or_else(|_| app.path().app_config_dir())
                .unwrap_or_else(|_| std::path::PathBuf::from("./recordings"))
                .join("recordings");
            let _ = std::fs::create_dir_all(&rec_dir);
            app_state.recorder.init_dir(rec_dir.clone());
            log::info!("原始链路数据自动录制保存路径: {:?}", rec_dir);

            // 软件开启时，把本地配置中的 enabled 全部重置为 false，避免前后端状态不一致
            let mut comms_config = config::comms::CommsConfig::load(app.handle());
            for udp in &mut comms_config.udp {
                if udp.enabled {
                    udp.enabled = false;
                }
            }
            for serial in &mut comms_config.serial {
                if serial.enabled {
                    serial.enabled = false;
                }
            }

            if let Err(e) = comms_config.save(app.handle()) {
                log::error!("软件启动时重置配置 enabled 状态失败: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_udp_listener,
            stop_udp_listener,
            start_serial_listener,
            stop_serial_listener,
            get_available_ports,
            get_network_interfaces,
            upload_route,
            close_app,
            start_window_drag,
            move_window_by,
            finish_window_drag,
            switch_to_next_monitor,
            get_comms_config,
            save_comms_config,
            get_uplink_aircraft_id,
            update_uplink_control,
            update_uplink_periodic,
            submit_uplink_command,
            submit_flight_switch_command,
            bind_transponder_switches,
            query_transponder_switches,
            bind_air_traffic_params,
            query_air_traffic_params,
            bind_weight_params,
            query_weight_params,
            clear_uplink_command,
            get_uplink_status,
            send_pod_command,
            stop_pod_command,
            submit_vmc_command,
            fetch_and_cache_nfz,
            load_cached_nfz,
            list_obstacle_airports,
            load_selected_obstacles,
            ensure_model_cached,
            resolve_cached_model,
            pick_3d_tiles_file,
            send_relay_control,
            send_relay_batch,
            query_relay_status,
            get_mission_payload_snapshot,
            send_propeller_deice_command,
            recorder::command::start_recording,
            recorder::command::stop_recording,
            recorder::command::get_recorder_status,
            recorder::command::start_replay,
            recorder::command::pause_replay,
            recorder::command::resume_replay,
            recorder::command::stop_replay,
            recorder::command::set_replay_speed,
            recorder::command::seek_replay,
            recorder::command::get_replay_status,
            get_link_metrics,
            export_diagnostic_bundle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
