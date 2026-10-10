use crate::error::{AppError, AppResult};
use crate::state::{AppState, LinkMetricsSnapshot};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

/// 即时获取当前测控站全链路埋点指标快照
#[tauri::command]
pub fn get_link_metrics(state: State<'_, AppState>) -> LinkMetricsSnapshot {
    state.metrics.snapshot()
}

/// 导出外场一键诊断包摘要
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSummary {
    pub generated_at: String,
    pub os: String,
    pub active_interfaces: Vec<String>,
    pub serial_ports: Vec<String>,
    pub metrics: LinkMetricsSnapshot,
    pub active_links: Vec<String>,
}

/// 一键收集并打包外场全量诊断信息（日志 + 崩溃报告 + 链路指标 + 环境信息 + 通信配置）
#[tauri::command]
pub async fn export_diagnostic_bundle(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let now = chrono::Local::now();
    let timestamp_str = now.format("%Y%m%d_%H%M%S").to_string();
    let bundle_dir_name = format!("GCS_Diagnostic_{}", timestamp_str);

    let base_export_dir = dirs_next_export_path(&app)?;
    let export_dir = base_export_dir.join(&bundle_dir_name);
    fs::create_dir_all(&export_dir)
        .map_err(|e| AppError::system(10010, format!("创建日志导出目录失败: {}", e)))?;

    // 收集系统环境与指标（非阻塞数据收集）
    let mut active_ips = Vec::new();
    if let Ok(ifaddrs) = get_if_addrs::get_if_addrs() {
        for iface in ifaddrs {
            active_ips.push(format!("{}: {}", iface.name, iface.ip()));
        }
    }

    let mut available_ports = Vec::new();
    if let Ok(ports) = tokio_serial::available_ports() {
        for p in ports {
            available_ports.push(p.port_name);
        }
    }

    let active_links: Vec<String> = state
        .active_links
        .iter()
        .map(|entry| format!("{}: {:?}", entry.name, entry.protocol))
        .collect();

    let metrics_snapshot = state.metrics.snapshot();

    let summary = DiagnosticSummary {
        generated_at: now.to_rfc3339(),
        os: format!("{} ({})", std::env::consts::OS, std::env::consts::ARCH),
        active_interfaces: active_ips,
        serial_ports: available_ports,
        metrics: metrics_snapshot,
        active_links,
    };

    let log_dir_opt = app.path().app_log_dir().ok();
    let config_dir_opt = app.path().app_config_dir().ok();

    // 将耗时的文件拷贝和压缩操作交给 blocking 线程池处理，避免阻塞异步执行器
    tauri::async_runtime::spawn_blocking(move || -> Result<String, AppError> {
        // 1. 抓取日志目录中的所有文本日志与崩溃报告
        let mut copied_logs_count = 0usize;
        if let Some(ref log_dir) = log_dir_opt {
            if log_dir.exists() {
                let logs_target = export_dir.join("logs");
                fs::create_dir_all(&logs_target).map_err(|e| {
                    AppError::system(10015, format!("创建日志 logs 子目录失败: {}", e))
                })?;
                let entries = fs::read_dir(log_dir).map_err(|e| {
                    AppError::system(10016, format!("读取日志目录 {:?} 失败: {}", log_dir, e))
                })?;
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if fs::copy(&path, logs_target.join(entry.file_name())).is_ok() {
                            copied_logs_count += 1;
                        }
                    }
                }
            }
        }

        // 校验日志拷贝结果，若未能收集任何日志则拒绝假报成功
        if copied_logs_count == 0 {
            let _ = fs::remove_dir_all(&export_dir);
            return Err(AppError::system(
                10017,
                "未能在日志目录中找到有效的运行日志，无法生成完整日志".to_string(),
            ));
        }

        // 2. 抓取工作目录遗留的崩溃文件（作为备选补充）
        let local_crash = Path::new("crash_report.log");
        if local_crash.exists() {
            let _ = fs::copy(local_crash, export_dir.join("local_crash_report.log"));
        }

        // 3. 生成综合诊断摘要
        let summary_json = serde_json::to_string_pretty(&summary)
            .map_err(|e| AppError::system(10011, format!("序列化日志摘要失败: {}", e)))?;
        fs::write(export_dir.join("diagnostic_summary.json"), summary_json).map_err(|e| {
            AppError::system(10013, format!("写入日志摘要文件失败: {}", e))
        })?;

        // 4. 拷贝当前运行的通信配置文件
        let comms_config_path = config_dir_opt
            .map(|p| p.join("comms.json"))
            .unwrap_or_else(|| PathBuf::from("./comms.json"));
        if comms_config_path.exists() {
            if let Err(e) = fs::copy(&comms_config_path, export_dir.join("comms_config.json")) {
                log::warn!("复制通信配置文件失败: {}", e);
            }
        }

        // 5. 使用 PowerShell 将目录压缩为 Zip 文件
        // 采用子进程环境变量传递路径，彻底杜绝单引号注入与参数绑定失败问题
        let zip_file_name = format!("{}.zip", bundle_dir_name);
        let zip_file_path = base_export_dir.join(&zip_file_name);

        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            let export_dir_str = export_dir.to_string_lossy().to_string();
            let zip_path_str = zip_file_path.to_string_lossy().to_string();

            let output = Command::new("powershell")
                .env("ZIP_SRC", &export_dir_str)
                .env("ZIP_DST", &zip_path_str)
                .args([
                    "-NoProfile",
                    "-Command",
                    "Compress-Archive -LiteralPath $env:ZIP_SRC -DestinationPath $env:ZIP_DST -Force",
                ])
                .output();

            match output {
                Ok(out) if out.status.success() && zip_file_path.exists() => {
                    let _ = fs::remove_dir_all(&export_dir);
                    log::info!("日志已成功生成并压缩为 Zip: {}", zip_path_str);
                    return Ok(zip_path_str);
                }
                Ok(out) => {
                    let stderr_msg = String::from_utf8_lossy(&out.stderr);
                    log::error!(
                        "PowerShell 压缩日志失败 [exit code: {:?}]: {}",
                        out.status.code(),
                        stderr_msg
                    );
                    return Err(AppError::system(
                        10018,
                        format!("压缩日志失败 (exit code: {:?}): {}", out.status.code(), stderr_msg),
                    ));
                }
                Err(e) => {
                    log::error!("执行 PowerShell 压缩命令异常: {}", e);
                    return Err(AppError::system(10019, format!("启动压缩进程失败: {}", e)));
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let final_dir_path = export_dir.to_string_lossy().to_string();
            log::info!("日志已生成至目录: {}", final_dir_path);
            Ok(final_dir_path)
        }
    })
    .await
    .map_err(|e| AppError::system(10014, format!("日志导出异步任务执行失败: {}", e)))?
}

fn dirs_next_export_path(app: &AppHandle) -> AppResult<PathBuf> {
    if let Ok(desktop) = app.path().desktop_dir() {
        if desktop.exists() {
            return Ok(desktop);
        }
    }
    if let Ok(download) = app.path().download_dir() {
        if download.exists() {
            return Ok(download);
        }
    }
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::system(10012, format!("获取导出基准目录失败: {}", e)))
}
