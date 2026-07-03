#[tauri::command]
pub fn close_app() {
    std::process::exit(0);
}
