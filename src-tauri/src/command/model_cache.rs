use reqwest::Url;
use serde::{Deserialize, Serialize};
use once_cell::sync::Lazy;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
//存放缓存模型的件夹
const CACHE_DIR: &str = "model-cache";
const INDEX_FILE: &str = "index.json";
static INDEX_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelCacheEntry {
    obstacle_type: String,
    model_id: i64,
    version: String,
    local_path: String,
}
//成功时返回 PathBuf（文件系统路径），专门存放缓存模型的文件夹。
//失败时返回错误信息。
fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("获取应用目录失败: {e}"))?
        .join(CACHE_DIR))
}

async fn read_index(directory: &PathBuf) -> Result<Vec<ModelCacheEntry>, String> {
    let index_path = directory.join(INDEX_FILE);
    if !tokio::fs::try_exists(&index_path)
        .await
        .map_err(|e| format!("检查模型缓存索引失败: {e}"))?
    {
        return Ok(Vec::new());
    }

    let bytes = tokio::fs::read(index_path)
        .await
        .map_err(|e| format!("读取模型缓存索引失败: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("解析模型缓存索引失败: {e}"))
}

async fn write_index(directory: &PathBuf, entries: &[ModelCacheEntry]) -> Result<(), String> {
    let index_path = directory.join(INDEX_FILE);
    let temporary = directory.join("index.tmp");
    let bytes = serde_json::to_vec_pretty(entries)
        .map_err(|e| format!("序列化模型缓存索引失败: {e}"))?;
    tokio::fs::write(&temporary, bytes)
        .await
        .map_err(|e| format!("写入模型缓存索引失败: {e}"))?;
    tokio::fs::rename(temporary, index_path)
        .await
        .map_err(|e| format!("保存模型缓存索引失败: {e}"))
}

async fn upsert_index_entry(
    directory: &PathBuf,
    entry: ModelCacheEntry,
) -> Result<(), String> {
    let _guard = INDEX_LOCK.lock().await;
    let mut entries = read_index(directory).await?;
    entries.retain(|item| item.obstacle_type != entry.obstacle_type);
    entries.push(entry);
    write_index(directory, &entries).await
}
//名字安全处理 字符串“净化”函数
//任意字符串，转换成一个只包含安全 ASCII 字符的新字符串，保留字母、数字、- 和 _，其他字符统替换成下划线 _
fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
// 把一个版本号字符串，再截取前 12 个字符，返回
fn version_tag(version: &str) -> String {
    safe_name(version).chars().take(12).collect()
}

#[tauri::command]
pub async fn ensure_model_cached(
    app: AppHandle,
    model_id: i64, //模型id
    obstacle_type: String, //模型类型
    version: String, // 模型版本
    download_url: String, //请求下载模型的url
) -> Result<String, String> {
    // 检验模型下载地址是否正确 
    let url = Url::parse(&download_url)
        .map_err(|e| format!("模型地址无效: {e}"))?;

    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || !url.path().starts_with("/api/models/")
    {
        return Err("不允许的模型地址".to_string());
    }
    // 模型存放的文件夹
    let directory = cache_dir(&app)?;
    //创建文件夹
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|e| format!("创建模型缓存目录失败: {e}"))?;
    //下载的模型名称
    let file_name = format!(
        "{}-{}-{}.glb",
        safe_name(&obstacle_type),
        model_id,
        version_tag(&version),
    );
    //全路径
    let target = directory.join(&file_name);
    // 异步检查文件是否已存在
    // 如果存在，直接返回路径，不走下载流程
    if tokio::fs::try_exists(&target)
        .await
        .map_err(|e| format!("检查模型缓存失败: {e}"))?
    {
        upsert_index_entry(
            &directory,
            ModelCacheEntry {
                obstacle_type: obstacle_type.clone(),
                model_id,
                version: version.clone(),
                local_path: target.to_string_lossy().to_string(),
            },
        )
        .await?;
        //存在这个文件就直接返回路径
        return Ok(target.to_string_lossy().to_string());
    }

    //建立请求客户端
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载模型失败: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("模型服务返回错误: {}", response.status()));
    }
    //字节流  模型二进制数据模型的二进制原始数据
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取模型失败: {e}"))?;

    if bytes.is_empty() {
        return Err("模型文件为空".to_string());
    }
    // 目标路径的扩展名从 .glb 临时改成 .tmp，生成一个临时文件路径。 
    let temporary = target.with_extension("tmp");
    //直接写入到临时文件中
    tokio::fs::write(&temporary, &bytes)
        .await
        .map_err(|e| format!("写入模型缓存失败: {e}"))?;
    //重新命名覆盖掉旧版本
    tokio::fs::rename(&temporary, &target)
        .await
        .map_err(|e| format!("保存模型缓存失败: {e}"))?;
    upsert_index_entry(
        &directory,
        ModelCacheEntry {
            obstacle_type,
            model_id,
            version,
            local_path: target.to_string_lossy().to_string(),
        },
    )
    .await?;
    //返回系统全路径地址
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn resolve_cached_model(
    app: AppHandle,
    obstacle_type: String,
) -> Result<Option<String>, String> {
    let directory = cache_dir(&app)?;
    if !tokio::fs::try_exists(&directory)
        .await
        .map_err(|e| format!("检查模型缓存目录失败: {e}"))?
    {
        return Ok(None);
    }

    let entries = read_index(&directory).await?;
    if let Some(entry) = entries
        .iter()
        .find(|entry| entry.obstacle_type == obstacle_type)
    {
        let path = PathBuf::from(&entry.local_path);
        if tokio::fs::try_exists(&path)
            .await
            .map_err(|e| format!("检查本地模型失败: {e}"))?
        {
            return Ok(Some(path.to_string_lossy().to_string()));
        }
    }

    // 兼容索引功能上线前已经存在的模型文件。旧文件名包含障碍物类型，
    // 但没有可靠的 model_id/version，因此仅作为离线回退，不写入新索引。
    let prefix = format!("{}-", safe_name(&obstacle_type));
    let mut directory_entries = tokio::fs::read_dir(&directory)
        .await
        .map_err(|e| format!("读取模型缓存目录失败: {e}"))?;
    let mut candidates = Vec::new();
    while let Some(entry) = directory_entries
        .next_entry()
        .await
        .map_err(|e| format!("读取模型缓存文件失败: {e}"))?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(&prefix) && name.ends_with(".glb") {
            let modified = entry
                .metadata()
                .await
                .ok()
                .and_then(|metadata| metadata.modified().ok());
            candidates.push((modified, entry.path()));
        }
    }

    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    Ok(candidates
        .into_iter()
        .next()
        .map(|(_, path)| path.to_string_lossy().to_string()))
}
