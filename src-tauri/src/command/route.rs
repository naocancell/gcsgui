use crate::protocol;
use crate::state;

#[tauri::command]
pub async fn upload_route(
    state: tauri::State<'_, state::AppState>,
    link_name: String,
    route: protocol::route_info::RouteUpload,
) -> Result<String, String> {
    if let Some(link) = state.active_links.get(&link_name) {
        let mut success_count = 0;
        for pt in &route.points {
            let bytes = pt.to_bytes(route.code);
            let _ = link.transport.send(&bytes).await;
            success_count += 1;
        }
        Ok(format!("航线数据下发成功：{}", success_count))
    } else {
        Err(format!("找不到指定的通信链路 [{}] 进行下发", link_name))
    }
}
