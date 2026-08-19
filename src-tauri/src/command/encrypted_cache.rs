use serde_json::Value;
use tauri::AppHandle;

use crate::encrypted_cache::nfz;
use crate::encrypted_cache::obstacle;

// 获取可用的障碍物机场列表
// 供前端展示“机场选择”弹窗，返回机场元数据和是否已缓存等信息
#[tauri::command]
pub async fn list_obstacle_airports(app: AppHandle) -> Result<Value, String> {
    obstacle::list_airports(&app).await
}

// 根据用户已选择的机场列表，批量加载对应的障碍物数据
// 参数 airports 是前端筛选出来的机场集合；返回值会被序列化成 JSON 发送回前端（两种格式）
#[tauri::command]
pub async fn load_selected_obstacles(
    app: AppHandle,
    airports: Vec<obstacle::AirportSelection>,
) -> Result<Value, String> {
    serde_json::to_value(obstacle::load_selected(&app, airports).await?)
        .map_err(|error| format!("序列化机场障碍物结果失败: {error}"))
}

// 获取 NFZ 数据并写入缓存
#[tauri::command]
pub async fn fetch_and_cache_nfz(app: AppHandle) -> Result<Value, String> {
    nfz::fetch_and_cache(&app).await
}

// 从本地缓存中读取 NFZ 数据
#[tauri::command]
pub async fn load_cached_nfz(app: AppHandle) -> Result<Value, String> {
    nfz::load_cached(&app).await
}
