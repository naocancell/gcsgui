use serde_json::Value;
use tauri::AppHandle;

use crate::encrypted_cache::nfz;

#[tauri::command]
pub async fn fetch_and_cache_nfz(
    app: AppHandle,
) -> Result<Value, String> {
    nfz::fetch_and_cache(&app).await
}

#[tauri::command]
pub async fn load_cached_nfz(
    app: AppHandle,
) -> Result<Value, String> {
    nfz::load_cached(&app).await
}