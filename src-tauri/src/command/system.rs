use std::time::Duration;

use tauri::{PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow};

/// 退出前等待录制文件落盘的最长时间，避免异常时卡住退出
const RECORDER_FLUSH_TIMEOUT: Duration = Duration::from_secs(2);

/// 关闭应用程序：先停止全部链路并收尾录制文件（最多等待 2s），再正常退出，
/// 避免直接 process::exit 导致录制文件尾部未刷盘、串口句柄未释放
#[tauri::command]
pub async fn close_app(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    log::info!("[操作] 退出应用：停止全部链路并保存录制文件");
    let links: Vec<_> = state
        .active_links
        .iter()
        .map(|link| link.transport.clone())
        .collect();
    for transport in links {
        transport.stop();
    }

    let recorder = state.recorder.clone();
    match tokio::time::timeout(RECORDER_FLUSH_TIMEOUT, recorder.stop_all()).await {
        Ok(summaries) => log::info!("退出前已保存 {} 个录制文件", summaries.len()),
        Err(_) => log::warn!("退出前保存录制文件超时，强制退出"),
    }

    // 兜底：若事件循环未能及时退出（窗口阻塞等），3s 后强制结束进程
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(3));
        std::process::exit(0);
    });
    app.exit(0);
    Ok(())
}

/// 准备窗口拖拽：如果是全屏模式，先安全退出全屏并将窗口稳定在当前屏幕以便平滑移动
#[tauri::command]
pub fn start_window_drag(window: WebviewWindow) -> Result<bool, String> {
    let is_fullscreen = window.is_fullscreen().map_err(|e| format!("查询全屏状态失败: {}", e))?;
    if is_fullscreen {
        // 记录当前屏幕原点，确保退出全屏后窗口留在当前屏幕对应位置
        let monitor = window.current_monitor().map_err(|e| format!("获取当前显示器失败: {}", e))?;
        let (mon_x, mon_y) = if let Some(m) = monitor {
            let pos = m.position();
            (pos.x, pos.y)
        } else {
            let pos = window.outer_position().unwrap_or(PhysicalPosition::new(0, 0));
            (pos.x, pos.y)
        };

        // 先设为窗口化
        window.set_fullscreen(false).map_err(|e| format!("退出全屏失败: {}", e))?;
        // 保持适中的窗口尺寸并稳定在当前屏幕位置
        let _ = window.set_size(Size::Physical(PhysicalSize::new(1280, 720)));
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(mon_x + 50, mon_y + 50)));
    }
    Ok(is_fullscreen)
}

/// 增量移动窗口物理坐标（支持跨显示器）
#[tauri::command]
pub fn move_window_by(window: WebviewWindow, delta_x: i32, delta_y: i32) -> Result<(), String> {
    let current_pos = window.outer_position().map_err(|e| format!("获取窗口位置失败: {}", e))?;
    let new_pos = PhysicalPosition::new(current_pos.x + delta_x, current_pos.y + delta_y);
    window
        .set_position(Position::Physical(new_pos))
        .map_err(|e| format!("设置窗口位置失败: {}", e))?;
    Ok(())
}

/// 结束窗口拖拽：在当前落点的屏幕上重新铺满全屏
#[tauri::command]
pub fn finish_window_drag(window: WebviewWindow, restore_fullscreen: bool) -> Result<(), String> {
    if restore_fullscreen {
        // Windows 系统会在当前窗口所在的 Monitor 上铺满全屏
        window.set_fullscreen(true).map_err(|e| format!("恢复全屏失败: {}", e))?;
    }
    Ok(())
}

/// 快速将主窗口切换至下一个屏幕并恢复全屏
#[tauri::command]
pub fn switch_to_next_monitor(window: WebviewWindow) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|e| format!("获取显示器列表失败: {}", e))?;
    if monitors.len() <= 1 {
        // 只有单屏幕，确保全屏即可
        let _ = window.set_fullscreen(true);
        return Ok(());
    }

    let current_monitor = window.current_monitor().map_err(|e| format!("获取当前显示器失败: {}", e))?;
    let current_name = current_monitor.as_ref().and_then(|m| m.name().cloned());

    // 寻找当前屏幕在列表里的索引
    let current_idx = monitors
        .iter()
        .position(|m| m.name().cloned() == current_name)
        .unwrap_or(0);

    let next_idx = (current_idx + 1) % monitors.len();
    let next_monitor = &monitors[next_idx];
    let pos = next_monitor.position();

    // 先退出全屏再移动到目标屏幕原点，随后在目标屏幕上重新全屏
    let _ = window.set_fullscreen(false);
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(pos.x + 100, pos.y + 100)));
    let _ = window.set_fullscreen(true);

    Ok(())
}
