// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 注册全局未捕获 Panic 拦截钩子
    std::panic::set_hook(Box::new(|panic_info| {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
        let location = panic_info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "未知位置".to_string());

        let payload = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "未知 Panic 原因".to_string()
        };

        // 强制捕获调用栈，避免因未显式配置 RUST_BACKTRACE 环境变量导致捕获结果为 Disabled
        let backtrace = std::backtrace::Backtrace::force_capture();

        let report = format!(
            "=================== GCSGUI 致命崩溃报告 (Fatal Crash) ===================\n\
            崩溃时间: {}\n\
            代码位置: {}\n\
            错误详情: {}\n\
            调用栈追踪:\n\
            {}\n\
            ========================================================================\n",
            timestamp, location, payload, backtrace
        );

        // 优先写入与 Tauri 2 app_log_dir 一致的持久化日志目录 (%LOCALAPPDATA%\com.gcsgui.app\logs)
        let log_dir = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("APPDATA"))
            .map(|base| std::path::PathBuf::from(base).join("com.gcsgui.app").join("logs"))
            .unwrap_or_else(|_| std::path::PathBuf::from("./logs"));

        let _ = std::fs::create_dir_all(&log_dir);
        let crash_file = log_dir.join("crash_report.log");
        let write_ok = std::fs::write(&crash_file, &report).is_ok();

        // 尝试在当前工作目录也同步保留一份（若工作目录只读则静默忽略）
        let _ = std::fs::write("crash_report.log", &report);

        // Windows 系统弹出原生置顶模态错误提示框
        #[cfg(target_os = "windows")]
        unsafe {
            #[link(name = "user32")]
            unsafe extern "system" {
                fn MessageBoxW(
                    hwnd: isize,
                    lpText: *const u16,
                    lpCaption: *const u16,
                    uType: u32,
                ) -> i32;
            }
            use std::os::windows::ffi::OsStrExt;
            let title: Vec<u16> = std::ffi::OsStr::new("地面测控站致命异常 (Crash)")
                .encode_wide()
                .chain(Some(0))
                .collect();
            let saved_path_display = if write_ok {
                crash_file.to_string_lossy().to_string()
            } else {
                "未能写入磁盘日志目录（请排查磁盘空间或系统权限）".to_string()
            };
            let alert_text = format!(
                "地面测控站核心服务遭遇严重未捕获异常即将退出！\n\n\
                错误位置: {}\n\
                错误信息: {}\n\n\
                详细崩溃堆栈已保存至:\n{}\n\n\
                请联系现场保障工程师排查。",
                location, payload, saved_path_display
            );
            let msg: Vec<u16> = std::ffi::OsStr::new(&alert_text)
                .encode_wide()
                .chain(Some(0))
                .collect();
            const MB_ICONERROR: u32 = 0x00000010;
            const MB_SYSTEMMODAL: u32 = 0x00001000;
            MessageBoxW(0, msg.as_ptr(), title.as_ptr(), MB_ICONERROR | MB_SYSTEMMODAL);
        }
    }));

    app_lib::run();
}
