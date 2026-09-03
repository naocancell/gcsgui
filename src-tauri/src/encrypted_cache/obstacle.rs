use reqwest::header::ACCEPT;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use super::crypto::{decrypt_data, encrypt_data};
use super::storage;

// 障碍物服务的基础地址
const API_BASE: &str = "http://172.10.0.183:8890";
// 本地缓存目录名，机场障碍物都放在这里
const CACHE_DIRECTORY: &str = "obstacles-cache";
// 本地缓存加密密钥，和加密模块保持一致。
const AES_KEY: &[u8; 32] = b"0123456789abcdef0123456789abcdef";
// 加密文件头，用于区分不同类型缓存数据。
const MAGIC: &[u8; 4] = b"OBS2";

// 前端选择机场时传过来的结构
// 其中 version / updated_at / obstacle_count 用于判断缓存是否过期。
// Serde 的属性注解，用在 Rust 结构体字段上，作用是：
// 当 JSON 里字段名叫 updated_at 时，把它映射到当前 Rust 字段
// 如果 JSON 里没有这个字段，给它一个默认值
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")] //驼峰对应下划线
pub struct AirportSelection {
    pub id: i64,      //机场id
    pub code: String, //机场编号
    pub name: String, //机场名字
    #[serde(alias = "updated_at", default)]
    pub updated_at: String,
    #[serde(alias = "obstacle_count", default)]
    pub obstacle_count: i64,
    #[serde(default)]
    pub version: Option<String>,
}

// 缓存文件的实际内容结构：
// 机场标识
// 缓存版本
// 加密前的障碍物 JSON 数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEnvelope {
    airport_id: i64,
    code: String,
    name: String,
    version: String,
    data: Value,
}

// 每个机场加载的返回结果。
// source 表示数据来源：cache / updated / remote
// stale 表示此数据是否来自旧缓存回退。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AirportLoadResult {
    pub airport: AirportSelection,
    pub data: Value,
    pub source: String,
    pub stale: bool,
}

// 验证障碍物 JSON 是否为数组，并且顶层是合法的障碍物列表。
fn validate_json(data: &[u8]) -> Result<Value, String> {
    let value: Value =
        serde_json::from_slice(data).map_err(|error| format!("障碍物 JSON 解析失败: {error}"))?;
    if !value.is_array() {
        return Err("障碍物 JSON 顶层必须是数组".to_string());
    }
    Ok(value)
}

// 把机场名称转换成安全的文件名，避免 Windows / 路径非法字符导致缓存文件名异常。
fn cache_file_name(name: &str) -> String {
    let mut result: String = name
        .trim()
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect();
    while result.ends_with('.') || result.ends_with(' ') {
        result.pop();
    }
    if result.is_empty() {
        result.push_str("机场");
    }
    format!("{result}.enc")
}

// 从远端机场信息中抽出版本字符串 （参数是一个机场对象）
// 优先级：data_version > version > updated_at:obstacle_count
fn version_from_airport(value: &Value) -> String {
    
    if let Some(version) = value.get("data_version").and_then(Value::as_str) {
        return version.to_string();
    }
    
    if let Some(version) = value.get("version").and_then(Value::as_str) {
        return version.to_string();
    }
    let updated = value
        .get("updated_at")
        .or_else(|| value.get("updatedAt"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let count = value
        .get("obstacle_count")
        .or_else(|| value.get("obstacleCount"))
        .and_then(Value::as_i64)
        .unwrap_or_default();
        //获取到更新时间 和数量拼接到一起
    format!("{updated}:{count}")
}

// 取当前机场选择对象的版本，若没有单独版本字段，则回退成 updated_at + obstacle_count。
fn selection_version(selection: &AirportSelection) -> String {
    selection
        .version
        .clone()
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| format!("{}:{}", selection.updated_at, selection.obstacle_count))
}

// 获取应用本地数据目录下的障碍物缓存目录。
fn cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join(CACHE_DIRECTORY))
        .map_err(|error| format!("获取应用数据目录失败: {error}"))
}

// 判断当前机场的缓存文件是否存在。
async fn cache_exists(app: &AppHandle, airport_name: &str) -> Result<bool, String> {
    let path = cache_directory(app)?.join(cache_file_name(airport_name));
    tokio::fs::try_exists(path)
        .await
        .map_err(|error| format!("检查机场缓存失败: {error}"))
}

// 判断旧版共享缓存文件是否存在，兼容历史版本数据。
// 创建统一的 HTTP 客户端，统一控制超时时间，避免远端服务卡住。
async fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("创建障碍物 HTTP 客户端失败: {error}"))
}

// 调用机场服务获取机场列表，用于前端展示可选择机场
async fn request_airports() -> Result<Vec<Value>, String> {
    // 创建现有包含建筑物的机场请求客户端
    let response = http_client()
        .await?
        .get(format!("{API_BASE}/api/airports"))
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("查询机场列表失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("机场服务返回错误状态: {}", response.status()));
    }
    // 这个响应体当作 JSON 解析 解析成 Vec<Value> 这种类型
    response
        .json::<Vec<Value>>()
        .await
        .map_err(|error| format!("解析机场列表失败: {error}"))
}

// 请求指定机场的障碍物数据。
// 远端接口返回 { metadata, obstacles }，这里会整理成 [metadata, obstacle1, obstacle2, ...] 的数组格式，
// 方便前端统一按第 0 项 metadata 解析坐标类型（relative_bearing / absolute_coord）。
async fn request_obstacles(selection: &AirportSelection) -> Result<Value, String> {
    let response = http_client()
        .await?
        .get(format!(
            "{API_BASE}/api/airports/{}/obstacles",
            selection.id
        ))
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("请求机场 {} 障碍物失败: {error}", selection.name))?;
    if !response.status().is_success() {
        return Err(format!(
            "机场 {} 返回错误状态: {}",
            selection.name,
            response.status()
        ));
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("解析机场 {} 障碍物失败: {error}", selection.name))?;
    let data = if let Some(items) = payload.get("obstacles").and_then(Value::as_array) {
        let metadata = payload
            .get("metadata")
            .cloned()
            .unwrap_or_else(|| json!({"type": "absolute_coord"}));
        let mut data = Vec::with_capacity(items.len() + 1);
        data.push(metadata);
        data.extend(items.iter().cloned());
        Value::Array(data)
    } else {
        payload
    };
    let raw = serde_json::to_vec(&data).map_err(|error| format!("序列化障碍物失败: {error}"))?;
    validate_json(&raw)
}

// 从缓存中读取一个机场的 CacheEnvelope（解密 + 反序列化）。
async fn load_envelope(app: &AppHandle, airport_name: &str) -> Result<CacheEnvelope, String> {
    // 读取加密内容
    let encrypted = storage::load(app, CACHE_DIRECTORY, &cache_file_name(airport_name)).await?;
    // 解密
    let decrypted = decrypt_data(&encrypted, AES_KEY, MAGIC)?;
    // 反序列化
    serde_json::from_slice(&decrypted).map_err(|error| format!("机场缓存格式无效: {error}"))
}

// 把一个机场的障碍物数据加密并写入本地缓存文件。
async fn save_envelope(app: &AppHandle, envelope: &CacheEnvelope) -> Result<(), String> {
    let plaintext =
        serde_json::to_vec(envelope).map_err(|error| format!("序列化机场缓存失败: {error}"))?;
    let encrypted = encrypt_data(&plaintext, AES_KEY, MAGIC)?;
    storage::save(
        app,
        CACHE_DIRECTORY,
        &cache_file_name(&envelope.name),
        &encrypted,
    )
    .await
}

// 拉取最新机场列表，并为每个机场标记是否已有缓存
pub(crate) async fn list_airports(app: &AppHandle) -> Result<Value, String> {
    // 返回的是可变长度Vec<Value> 是数据库所有机场数据信息
    let airports = match request_airports().await {
        Ok(airports) => airports,
        Err(error) => {
            let cached = list_cached_airports(app).await?;
            if !cached.is_empty() {
                return Ok(Value::Array(cached));
            }
            return Err(error);
        }
    };
    // 提前准备一个机场长度 的可变向量
    let mut result = Vec::with_capacity(airports.len());
    //  airport是一个Value 也就是json 具有get方法
    for mut airport in airports {
        //机场名字
        let name = airport
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("机场")
            .to_string();
        // 获取机场障碍物版本信息
        let version = version_from_airport(&airport);
        // 把变量 version 这个 Rust 的 String，写进这个 JSON 对象里，
        // 键名叫 version，并且它的 JSON 类型是字符串
        airport["version"] = Value::String(version);
        //判断缓存文件是否存在
        airport["cached"] = Value::Bool(cache_exists(app, &name).await?);
        result.push(airport);
    }
    Ok(Value::Array(result))
}

// 扫描本地缓存目录，恢复出离线可用的机场列表
// 这一步用于无网络状态下仍可以看到并加载历史缓存
async fn list_cached_airports(app: &AppHandle) -> Result<Vec<Value>, String> {
    let directory = cache_directory(app)?;
    if !tokio::fs::try_exists(&directory)
        .await
        .map_err(|error| format!("检查机场缓存目录失败: {error}"))?
    {
        return Ok(Vec::new());
    }
    let mut entries = tokio::fs::read_dir(directory)
        .await
        .map_err(|error| format!("读取机场缓存目录失败: {error}"))?;
    let mut airports = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("读取机场缓存文件失败: {error}"))?
    {
        if entry.path().extension().and_then(|value| value.to_str()) != Some("enc") {
            continue;
        }
        let encrypted = match tokio::fs::read(entry.path()).await {
            Ok(value) => value,
            Err(_) => continue,
        };
        let decrypted = match decrypt_data(&encrypted, AES_KEY, MAGIC) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let envelope: CacheEnvelope = match serde_json::from_slice(&decrypted) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let obstacle_count = envelope
            .data
            .as_array()
            .map(|items| items.len().saturating_sub(1) as i64)
            .unwrap_or_default();
        airports.push(json!({
            "id": envelope.airport_id,
            "code": envelope.code,
            "name": envelope.name,
            "updated_at": "",
            "obstacle_count": obstacle_count,
            "version": envelope.version,
            "cached": true,
            "offline": true,
        }));
    }
    airports.sort_by(|left, right| left["name"].as_str().cmp(&right["name"].as_str()));
    Ok(airports)
}

// 核心逻辑：
// 读取本地缓存
// 若缓存版本和当前机场版本一致，则直接使用
// 若不一致则请求远端最新数据并覆盖缓存
// 若远端请求失败且已有缓存，则回退到旧缓存并标记 stale = true
pub(crate) async fn load_selected(
    app: &AppHandle,
    selections: Vec<AirportSelection>,
) -> Result<Vec<AirportLoadResult>, String> {
    if selections.is_empty() {
        return Err("请至少选择一个机场".to_string());
    }
    // 先创建一个可变长度的Vec 返回结果
    let mut results = Vec::with_capacity(selections.len());
    // 遍历用户选择的
    for selection in selections {
        let expected_version = selection_version(&selection);
        //从缓存中读取一个机场的 CacheEnvelope（解密 + 反序列化）
        let cached = load_envelope(app, &selection.name).await.ok(); 
        //如果存在（as_ref：借用访问）
        if let Some(envelope) = cached.as_ref() {
            if envelope.airport_id == selection.id && envelope.version == expected_version {
                results.push(AirportLoadResult {
                    airport: selection,
                    data: envelope.data.clone(),
                    source: "cache".to_string(),
                    stale: false,
                });
                continue;
            }
        }

        match request_obstacles(&selection).await {
            Ok(data) => {
                let envelope = CacheEnvelope {
                    airport_id: selection.id,
                    code: selection.code.clone(),
                    name: selection.name.clone(),
                    version: expected_version,
                    data: data.clone(),
                };
                save_envelope(app, &envelope).await?;
                results.push(AirportLoadResult {
                    airport: selection,
                    data,
                    source: if cached.is_some() {
                        "updated"
                    } else {
                        "remote"
                    }
                    .to_string(),
                    stale: false,
                });
            }
            Err(error) if cached.is_some() => {
                let envelope = cached.expect("checked above");
                results.push(AirportLoadResult {
                    airport: selection,
                    data: envelope.data,
                    source: "cache".to_string(),
                    stale: true,
                });
                log::warn!("机场障碍物远端版本检查失败，使用旧缓存: {error}");
            }
            Err(error) => return Err(error),
        }
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{cache_file_name, version_from_airport};
    use serde_json::json;

    #[test]
    fn cache_names_keep_chinese_and_remove_path_separators() {
        assert_eq!(cache_file_name("北京/首都机场"), "北京_首都机场.enc");
    }

    #[test]
    fn versions_prefer_server_data_version() {
        assert_eq!(
            version_from_airport(&json!({"data_version": "abc", "updated_at": "old"})),
            "abc"
        );
        assert_eq!(
            version_from_airport(&json!({"updated_at": "t", "obstacle_count": 3})),
            "t:3"
        );
    }
}
