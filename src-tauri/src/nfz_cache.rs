use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm,
    Nonce,
};
use reqwest::header::{ACCEPT, USER_AGENT};
use serde_json::Value;
use std::{path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};

const NFZ_API_URL: &str =
    "http://127.0.0.1:8888/api/no-fly-zones";

// b “字节字符串”   32 字节
const DEV_AES_KEY: &[u8; 32] =
    b"0123456789abcdef0123456789abcdef";
// 文件标识 判断是否是有效的禁飞区缓存文件
const MAGIC: &[u8; 4] = b"NFZ1";
// nonce 的长度是 12 字节： 
// 加密专用的一次性随机值 
const NONCE_SIZE: usize = 12;
//常量
const TAG_SIZE: usize = 16;

/// 获取缓存路径
async fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    // 获取应用数据目录
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?
        .join("nfz-cache");
    //创建一个文件夹
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("创建缓存目录失败: {error}"))?;

    Ok(directory.join("zones.enc"))
}

/// 请求服务器禁飞区数据
async fn request_nfz_data() -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败: {error}"))?;

    let response = client
        .get(NFZ_API_URL)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "gcsgui-dev/0.1")
        .send()
        .await
        .map_err(|error| format!("请求禁飞区数据失败: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "服务器返回错误状态: {}",
            response.status()
        ));
    }

    let body = response
        .bytes()
        .await
        .map_err(|error| format!("读取响应失败: {error}"))?
        .to_vec();

    // 校验 JSON 是否有效
    let json: Value = serde_json::from_slice(&body)
        .map_err(|error| format!("响应不是有效 JSON: {error}"))?;

    // 当前禁飞区数据要求顶层是数组
    if !json.is_array() {
        return Err("禁飞区 JSON 顶层必须是数组".to_string());
    }

    Ok(body)
}

/// AES-GCM 加密
fn encrypt_data(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    // 根据密钥创建 AES-256-GCM 加密器
    let cipher = Aes256Gcm::new_from_slice(DEV_AES_KEY)
        .map_err(|error| format!("创建加密器失败: {error}"))?;

    // 每次加密都随机生成 nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    //加密文本
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|_| "AES-GCM 加密失败".to_string())?;

    // 文件格式：
    // MAGIC + nonce + ciphertext + authentication tag
    let mut result = Vec::with_capacity(
        MAGIC.len() + NONCE_SIZE + ciphertext.len(),
    );

    result.extend_from_slice(MAGIC);
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// AES-GCM 解密
fn decrypt_data(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    let header_size = MAGIC.len() + NONCE_SIZE;

    if encrypted.len() < header_size + TAG_SIZE {
        return Err("加密缓存格式无效".to_string());
    }

    if &encrypted[..MAGIC.len()] != MAGIC {
        return Err("不是有效的禁飞区缓存文件".to_string());
    }

    let nonce_start = MAGIC.len();
    let nonce_end = nonce_start + NONCE_SIZE;

    let nonce = Nonce::from_slice(&encrypted[nonce_start..nonce_end]);
    let ciphertext = &encrypted[nonce_end..];

    let cipher = Aes256Gcm::new_from_slice(DEV_AES_KEY)
        .map_err(|error| format!("创建解密器失败: {error}"))?;

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "解密失败，密钥错误或文件已被篡改".to_string())
}

/// 保存加密文件
async fn save_encrypted_cache(
    app: &AppHandle,
    encrypted: &[u8],
) -> Result<(), String> {
    let path = cache_path(app).await?;
    let temporary_path = path.with_extension("tmp");

    tokio::fs::write(&temporary_path, encrypted)
        .await
        .map_err(|error| format!("写入临时文件失败: {error}"))?;

    if tokio::fs::try_exists(&path)
        .await
        .map_err(|error| format!("检查旧缓存失败: {error}"))?
    {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|error| format!("删除旧缓存失败: {error}"))?;
    }

    tokio::fs::rename(&temporary_path, &path)
        .await
        .map_err(|error| format!("保存加密缓存失败: {error}"))?;

    Ok(())
}

/// 请求、加密、保存，然后解密返回前端
#[tauri::command]
pub async fn fetch_and_cache_nfz(
    app: AppHandle,
) -> Result<Value, String> {
    // 1. 请求服务器
    let plaintext = request_nfz_data().await?;

    // 2. 加密
    let encrypted = encrypt_data(&plaintext)?;

    // 3. 保存密文
    save_encrypted_cache(&app, &encrypted).await?;

    // 4. 从密文解密
    let decrypted = decrypt_data(&encrypted)?;

    // 5. 解析并返回给前端
    serde_json::from_slice(&decrypted)
        .map_err(|error| format!("解密后的 JSON 解析失败: {error}"))
}

/// 从本地缓存读取
#[tauri::command]
pub async fn load_cached_nfz(
    app: AppHandle,
) -> Result<Value, String> {
    let path = cache_path(&app).await?;

    let encrypted = tokio::fs::read(&path)
        .await
        .map_err(|error| format!("读取禁飞区缓存失败: {error}"))?;

    let decrypted = decrypt_data(&encrypted)?;

    serde_json::from_slice(&decrypted)
        .map_err(|error| format!("缓存 JSON 解析失败: {error}"))
}
