use reqwest::header::{ACCEPT, USER_AGENT};
use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;

use super::crypto::{decrypt_data, encrypt_data};
use super::storage;
/// 禁飞区 API 地址
const API_URL: &str =
    "http://172.10.0.183:8888/api/no-fly-zones";
// AES-256-GCM 加密密钥，32 字节 暂时使用固定密钥，后续改为动态生成
const AES_KEY: &[u8; 32] =
    b"0123456789abcdef0123456789abcdef";
// 文件标识，判断是否是有效的禁飞区缓存文件
const MAGIC: &[u8; 4] = b"NFZ1";
// 文件夹名称
const CACHE_DIRECTORY: &str = "nfz-cache";
// 缓存文件名
const CACHE_FILE: &str = "zones.enc";
// 检验 JSON 数据是否为合法的禁飞区数据，顶层必须是数组
fn validate_json(data: &[u8]) -> Result<Value, String> {
    // 解析 JSON 数据
    let value: Value = serde_json::from_slice(data)
        .map_err(|error| format!("禁飞区 JSON 解析失败: {error}"))?;

    if !value.is_array() {
        return Err("禁飞区 JSON 顶层必须是数组".to_string());
    }
    Ok(value)
}
// 请求禁飞区数据，返回原始字节
async fn request_data() -> Result<Vec<u8>, String> {
    //创建请求客户端，设置超时时间 5 秒
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败: {error}"))?;
    // 发送 GET 请求，设置请求头
    let response = client
        .get(API_URL)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("请求禁飞区失败: {error}"))?;
    //请求是否成功
    if !response.status().is_success() {
        return Err(format!(
            "禁飞区服务器返回错误状态: {}",
            response.status()
        ));
    }
    // bytes()读取传递过来的二进制 .to_vec()转换为 Vec<u8>
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("读取禁飞区响应失败: {error}"))?
        .to_vec();

    validate_json(&body)?;
    Ok(body)
}

pub(crate) async fn fetch_and_cache(
    app: &AppHandle,
) -> Result<Value, String> {
    //请求禁飞区数据，返回原始字节
    let plaintext = request_data().await?;
    // 加密数据，返回加密后的字节
    let encrypted = encrypt_data(&plaintext, AES_KEY, MAGIC)?;

    storage::save(
        app,
        CACHE_DIRECTORY,
        CACHE_FILE,
        &encrypted,
    )
    .await?;

    let decrypted = decrypt_data(&encrypted, AES_KEY, MAGIC)?;
    //检验 JSON 数据是否为合法的禁飞区数据
    validate_json(&decrypted)
}
// 从缓存中加载禁飞区数据，返回 JSON 值
pub(crate) async fn load_cached(
    app: &AppHandle,
) -> Result<Value, String> {
    // 从缓存中加载加密数据
    let encrypted =
        storage::load(app, CACHE_DIRECTORY, CACHE_FILE).await?;
    // 解密
    let decrypted = decrypt_data(&encrypted, AES_KEY, MAGIC)?;
    //检验 JSON 数据是否为合法的禁飞区数据
    validate_json(&decrypted)
}