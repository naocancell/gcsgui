//! 外部数据服务地址（禁飞区服务、障碍物/模型服务）与共享 HTTP 客户端。
//!
//! 缺省地址见 [`ServiceConfig::default`]；现场部署可在应用配置目录（与 comms.json 同目录）
//! 放置 `services.json` 覆盖，缺省字段沿用默认值：
//!
//! ```json
//! { "nfz_base": "http://172.10.0.183:8888", "obstacle_base": "http://172.10.0.183:8890" }
//! ```

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const SERVICES_FILE: &str = "services.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ServiceConfig {
    /// 禁飞区服务根地址（接口 /api/no-fly-zones）
    pub nfz_base: String,
    /// 障碍物与模型服务根地址（接口 /api/airports、/api/models）
    pub obstacle_base: String,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            nfz_base: "http://172.10.0.183:8888".to_string(),
            obstacle_base: "http://172.10.0.183:8890".to_string(),
        }
    }
}

impl ServiceConfig {
    fn normalized(mut self) -> Self {
        let defaults = Self::default();
        for (value, fallback) in [
            (&mut self.nfz_base, defaults.nfz_base),
            (&mut self.obstacle_base, defaults.obstacle_base),
        ] {
            let trimmed = value.trim().trim_end_matches('/').to_string();
            *value = match reqwest::Url::parse(&trimmed) {
                Ok(url) if matches!(url.scheme(), "http" | "https") && url.host_str().is_some() => {
                    trimmed
                }
                _ => {
                    log::warn!("services.json 中的服务地址 {value:?} 无效，改用默认值 {fallback}");
                    fallback
                }
            };
        }
        self
    }

    fn load(app: &AppHandle) -> Self {
        let Ok(dir) = app.path().app_config_dir() else {
            return Self::default();
        };
        let path = dir.join(SERVICES_FILE);
        if !path.exists() {
            return Self::default();
        }
        match std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|content| serde_json::from_str::<Self>(&content).map_err(|e| e.to_string()))
        {
            Ok(config) => {
                let config = config.normalized();
                log::info!(
                    "[服务地址] 已加载 {}：禁飞区 {}，障碍物/模型 {}",
                    path.display(),
                    config.nfz_base,
                    config.obstacle_base
                );
                config
            }
            Err(error) => {
                log::warn!("解析 {} 失败，使用默认服务地址: {error}", path.display());
                Self::default()
            }
        }
    }
}

static SERVICES: OnceLock<ServiceConfig> = OnceLock::new();

/// 启动时加载一次服务地址配置
pub fn init(app: &AppHandle) {
    let _ = SERVICES.set(ServiceConfig::load(app));
}

/// 当前服务地址配置（未初始化时为默认值）
pub fn services() -> &'static ServiceConfig {
    SERVICES.get_or_init(ServiceConfig::default)
}

/// 全局共享的 HTTP 客户端：复用连接池，超时由各请求单独设置
pub fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default()
    })
}

/// 前端读取的服务地址（模型目录也由前端直接请求）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceEndpoints {
    pub nfz_base: String,
    pub obstacle_base: String,
}

#[tauri::command]
pub fn get_service_endpoints() -> ServiceEndpoints {
    let services = services();
    ServiceEndpoints {
        nfz_base: services.nfz_base.clone(),
        obstacle_base: services.obstacle_base.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_file_keeps_default_for_missing_fields() {
        let config: ServiceConfig =
            serde_json::from_str(r#"{ "obstacle_base": "http://10.0.0.5:8890/" }"#).unwrap();
        let config = config.normalized();
        assert_eq!(config.obstacle_base, "http://10.0.0.5:8890");
        assert_eq!(config.nfz_base, ServiceConfig::default().nfz_base);
    }

    #[test]
    fn invalid_address_falls_back_to_default() {
        let config = ServiceConfig {
            nfz_base: "not a url".to_string(),
            obstacle_base: "ftp://10.0.0.5".to_string(),
        }
        .normalized();
        assert_eq!(config, ServiceConfig::default());
    }
}
