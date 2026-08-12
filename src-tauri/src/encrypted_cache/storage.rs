use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// 根据应用、本地缓存目录名和文件名生成完整缓存路径
// `%LOCALAPPDATA%\com.gcsgui.app\nfz-cache\zones.enc`
async fn cache_path(
    app: &AppHandle,
    directory_name: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    // 获取应用数据目录，拼接缓存子目录
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?
        .join(directory_name);

    // 创建缺失目录
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("创建缓存目录失败: {error}"))?;

    // 返回全路径
    Ok(directory.join(file_name))
}

/// 将字节数据保存到应用的本地缓存目录
pub(super) async fn save(
    app: &AppHandle,
    directory_name: &str,
    file_name: &str,
    data: &[u8],
) -> Result<(), String> {
    // 获取正式缓存路径 nfz-cache/zones.enc。
    let path = cache_path(app, directory_name, file_name).await?;
    // 把正式文件扩展名替换为 tmp，zones.enc 变为 zones.tmp
    let temporary_path = path.with_extension("tmp");

    // 自动创建临时文件 然后写入临时文件，写入失败时不会破坏现有缓存。
    tokio::fs::write(&temporary_path, data)
        .await
        .map_err(|error| format!("写入临时缓存失败: {error}"))?;

    // 先检查并删除旧缓存 旧的正式文件
    if tokio::fs::try_exists(&path)
        .await
        .map_err(|error| format!("检查旧缓存失败: {error}"))?
    {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|error| format!("删除旧缓存失败: {error}"))?;
    }

    // 把已经完整写入的临时文件重命名为正式缓存文件。
    tokio::fs::rename(&temporary_path, &path)
        .await
        .map_err(|error| format!("保存缓存失败: {error}"))?;

    Ok(())
}

/// 从应用本地缓存目录读取指定文件，并返回文件的全部原始字节
pub(super) async fn load(
    app: &AppHandle,
    directory_name: &str,
    file_name: &str,
) -> Result<Vec<u8>, String> {
    // 使用与保存时完全相同的规则生成缓存路径
    let path = cache_path(app, directory_name, file_name).await?;

    // 异步读取整个文件；文件不存在或没有权限时返回错误信息
    tokio::fs::read(path)
        .await
        .map_err(|error| format!("读取缓存失败: {error}"))
}
