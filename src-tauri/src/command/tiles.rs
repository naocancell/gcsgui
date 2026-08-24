use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTilesetInfo {
    pub url: String,
    pub name: String,
}

#[allow(dead_code)]
// 目录选择模式下可以用它找入口文件，当前界面直接选择 tileset.json
fn find_tileset_file(directory: &Path) -> Result<PathBuf, String> {
    let mut stack = vec![directory.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = fs::read_dir(&current).map_err(|e| format!("无法读取 3D Tiles 目录：{e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("扫描 3D Tiles 目录失败：{e}"))?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("tileset.json"))
                .unwrap_or(false)
            {
                return Ok(path);
            }
        }
    }
    Err("所选目录中未找到 tileset.json".to_string())
}

fn percent_decode(value: &str) -> Option<String> {
    // URL 里的中文和空格会先被编码，这里还原成本地路径
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let high = (bytes[index + 1] as char).to_digit(16)? as u8;
            let low = (bytes[index + 2] as char).to_digit(16)? as u8;
            output.push((high << 4) | low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).ok()
}

fn percent_encode_path(path: &Path) -> String {
    // Windows 路径不能直接拼到 URL 里，按字节做一次编码
    let value = path.to_string_lossy().replace('\\', "/");
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'/' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn content_type(path: &Path) -> &'static str {
    // Cesium 主要关心响应内容，常见格式的类型还是标出来更稳妥
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "json" | "gltf" => "application/json",
        "b3dm" => "application/octet-stream",
        "i3dm" => "application/octet-stream",
        "cmpt" => "application/octet-stream",
        "pnts" => "application/octet-stream",
        "glb" => "model/gltf-binary",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ktx2" => "image/ktx2",
        _ => "application/octet-stream",
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    head_only: bool,
) {
    // WebView 的页面来源不是 127.0.0.1，需要允许跨域读取瓦片
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(headers.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
}

fn serve_request(mut stream: TcpStream, root: &Path) {
    // 这个服务只给 Cesium 读文件，不做复杂的 HTTP 处理
    let mut request = [0_u8; 16 * 1024];
    let Ok(size) = stream.read(&mut request) else {
        return;
    };
    let Ok(request) = std::str::from_utf8(&request[..size]) else {
        return;
    };
    let Some(request_line) = request.lines().next() else {
        return;
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let head_only = method == "HEAD";
    if method != "GET" && !head_only {
        write_response(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain",
            b"method not allowed",
            false,
        );
        return;
    }

    let path_part = target.split(['?', '#']).next().unwrap_or("");
    let relative = match percent_decode(path_part.trim_start_matches('/')) {
        Some(value) if !value.is_empty() => value,
        _ => {
            write_response(
                &mut stream,
                "400 Bad Request",
                "text/plain",
                b"bad request",
                head_only,
            );
            return;
        }
    };
    if relative.split('/').any(|part| part == "..") {
        // 先拦截路径穿越，再做 canonicalize
        write_response(
            &mut stream,
            "403 Forbidden",
            "text/plain",
            b"forbidden",
            head_only,
        );
        return;
    }
    let candidate = root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    let Ok(canonical) = fs::canonicalize(&candidate) else {
        write_response(
            &mut stream,
            "404 Not Found",
            "text/plain",
            b"not found",
            head_only,
        );
        return;
    };
    if !canonical.starts_with(root) || !canonical.is_file() {
        write_response(
            &mut stream,
            "404 Not Found",
            "text/plain",
            b"not found",
            head_only,
        );
        return;
    }
    let Ok(body) = fs::read(&canonical) else {
        write_response(
            &mut stream,
            "500 Internal Server Error",
            "text/plain",
            b"read failed",
            head_only,
        );
        return;
    };
    write_response(
        &mut stream,
        "200 OK",
        content_type(&canonical),
        &body,
        head_only,
    );
}

fn start_static_server(root: PathBuf) -> Result<u16, String> {
    // 端口交给系统分配，避免和本机已有服务冲突
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("启动 3D Tiles 静态服务失败：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("获取静态服务端口失败：{e}"))?
        .port();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let root = root.clone();
            thread::spawn(move || serve_request(stream, &root));
        }
    });
    Ok(port)
}

#[tauri::command]
//前端调用
pub fn pick_3d_tiles_file(app: AppHandle) -> Result<Option<LocalTilesetInfo>, String> {
    // 原生选择器只选入口文件，资源从它所在目录继续读取
    let selected = app
        .dialog()
        .file()
        .set_title("选择 tileset.json")
        .add_filter("3D Tiles", &["json"])
        .blocking_pick_file();
    let Some(file_path) = selected else {
        return Ok(None);
    };
    let file = file_path
        .into_path()
        .map_err(|e| format!("无法读取所选文件路径：{e}"))?;
    if !file
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("tileset.json"))
        .unwrap_or(false)
    {
        return Err("请选择名称为 tileset.json 的文件".to_string());
    }
    let root = file
        .parent()
        .ok_or_else(|| "无法确定 tileset.json 所在目录".to_string())?
        .canonicalize()
        .map_err(|e| format!("无法访问 tileset.json 所在目录：{e}"))?;
    // 先读 JSON 做最基本的格式检查，错误尽早返回给前端
    let tileset = file
        .canonicalize()
        .map_err(|e| format!("无法访问所选 tileset.json：{e}"))?;
    let json = fs::read_to_string(&tileset).map_err(|e| format!("无法读取 tileset.json：{e}"))?;
    let document: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("tileset.json 格式无效：{e}"))?;
    if document.get("asset").is_none() && document.get("root").is_none() {
        return Err("所选 JSON 不是有效的 3D Tiles tileset.json".to_string());
    }
    let relative = tileset
        .strip_prefix(&root)
        .map_err(|e| format!("计算 tileset 路径失败：{e}"))?;
    // 静态服务的根目录就是 tileset.json 的父目录
    let port = start_static_server(root)?;
    let relative_url = percent_encode_path(relative);
    let name = file
        .parent()
        .and_then(|path| path.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("3D Tiles")
        .to_string();
    Ok(Some(LocalTilesetInfo {
        url: format!("http://127.0.0.1:{port}/{relative_url}"),
        name,
    }))
}
