use reqwest::Url;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
//存放缓存模型的件夹
const CACHE_DIR: &str = "model-cache";
//成功时返回 PathBuf（文件系统路径），专门存放缓存模型的文件夹。
//失败时返回错误信息。
fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("获取应用目录失败: {e}"))?
        .join(CACHE_DIR))
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
    //返回系统全路径地址
    Ok(target.to_string_lossy().to_string())
}
