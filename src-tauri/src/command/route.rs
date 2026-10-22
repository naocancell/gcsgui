use std::time::Duration;

use crate::protocol;
use crate::state;

/// 单个航点下发超时：串口阻塞或 UDP 发送卡死时及时失败，而不是无限期挂起前端
const ROUTE_POINT_SEND_TIMEOUT: Duration = Duration::from_millis(500);

/// 航线下发前的基本合法性校验：至少一个航点，经纬度/高度/速度均为有限值且经纬度在合法范围内
fn validate_route(route: &protocol::route_info::RouteUpload) -> Result<(), String> {
    if route.points.is_empty() {
        return Err("航线没有航点，已取消下发".to_string());
    }
    for (idx, pt) in route.points.iter().enumerate() {
        let finite =
            pt.lon.is_finite() && pt.lat.is_finite() && pt.alt.is_finite() && pt.speed.is_finite();
        if !finite {
            return Err(format!("第 {} 个航点包含非法数值，已取消下发", idx + 1));
        }
        if !(-180.0..=180.0).contains(&pt.lon) || !(-90.0..=90.0).contains(&pt.lat) {
            return Err(format!(
                "第 {} 个航点经纬度超出范围（经度 {}，纬度 {}），已取消下发",
                idx + 1,
                pt.lon,
                pt.lat
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn upload_route(
    state: tauri::State<'_, state::AppState>,
    link_name: String,
    route: protocol::route_info::RouteUpload,
) -> Result<String, String> {
    // 回放安全围栏：回放期间禁止向真实设备下发航线
    if state.replay_active() {
        return Err("回放进行中，已禁止下发航线".to_string());
    }
    validate_route(&route)?;

    // 先克隆 transport 再释放 DashMap 读锁，避免跨 await 持有分片锁阻塞链路增删
    let transport = state
        .active_links
        .get(&link_name)
        .map(|link| link.transport.clone())
        .ok_or_else(|| format!("找不到指定的通信链路 [{}] 进行下发", link_name))?;

    let total = route.points.len();
    log::info!(
        "[操作] 下发航线 code={} 航点数={} 链路={}",
        route.code,
        total,
        link_name
    );

    for (idx, pt) in route.points.iter().enumerate() {
        let bytes = pt.to_bytes(route.code);
        let result = tokio::time::timeout(ROUTE_POINT_SEND_TIMEOUT, transport.send(&bytes)).await;
        let error = match result {
            Ok(Ok(_)) => continue,
            Ok(Err(e)) => e.to_string(),
            Err(_) => "发送超时".to_string(),
        };
        log::warn!(
            "[操作] 航线 code={} 第 {} 个航点下发失败: {}",
            route.code,
            idx + 1,
            error
        );
        return Err(format!(
            "第 {}/{} 个航点下发失败（{}），已成功下发 {} 个",
            idx + 1,
            total,
            error,
            idx
        ));
    }

    Ok(format!("航线数据下发成功：{}", total))
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol::route_info::RouteUpload;

    fn route_with(points: Vec<(f64, f64)>) -> RouteUpload {
        serde_json::from_value(serde_json::json!({
            "code": 1,
            "points": points
                .iter()
                .enumerate()
                .map(|(i, (lon, lat))| serde_json::json!({
                    "nPt": i as i32 + 1,
                    "speed": 20.0,
                    "alt": 100.0,
                    "lon": lon,
                    "lat": lat,
                }))
                .collect::<Vec<_>>(),
        }))
        .expect("构造航线失败")
    }

    #[test]
    fn rejects_empty_and_out_of_range_routes() {
        assert!(validate_route(&route_with(vec![])).is_err());
        assert!(validate_route(&route_with(vec![(181.0, 30.0)])).is_err());
        assert!(validate_route(&route_with(vec![(120.0, -91.0)])).is_err());
        assert!(validate_route(&route_with(vec![(120.0, 30.0), (121.0, 31.0)])).is_ok());
    }
}
