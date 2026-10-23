use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

/// 静态服务的固定工作线程数：Cesium 会并发请求大量瓦片，用固定线程池代替“每个请求一个 OS 线程”
const TILE_WORKERS: usize = 6;
/// 单个连接的读写超时，避免异常客户端长期占住工作线程
const TILE_IO_TIMEOUT: Duration = Duration::from_secs(10);
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

fn write_headers(stream: &mut TcpStream, status: &str, content_type: &str, length: u64) -> bool {
    // WebView 的页面来源不是 127.0.0.1，需要允许跨域读取瓦片
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(headers.as_bytes()).is_ok()
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    head_only: bool,
) {
    if write_headers(stream, status, content_type, body.len() as u64) && !head_only {
        let _ = stream.write_all(body);
    }
}

/// 全局唯一的 3D Tiles 静态服务：一个端口 + 固定线程池，按挂载编号区分多个 tileset 根目录。
/// 重复选择文件只新增/复用挂载点，不再每次新开端口和常驻线程。
struct TileServer {
    port: u16,
    /// 挂载编号（下标）→ 根目录；同一目录复用编号，已加载的 tileset 继续可用
    mounts: RwLock<Vec<PathBuf>>,
}

impl TileServer {
    fn mount(&self, root: PathBuf) -> usize {
        let mut mounts = self
            .mounts
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(index) = mounts.iter().position(|existing| existing == &root) {
            return index;
        }
        mounts.push(root);
        mounts.len() - 1
    }

    fn root(&self, mount: usize) -> Option<PathBuf> {
        self.mounts
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(mount)
            .cloned()
    }
}

fn tile_server() -> Result<Arc<TileServer>, String> {
    static SERVER: Mutex<Option<Arc<TileServer>>> = Mutex::new(None);
    let mut guard = SERVER.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(server) = guard.as_ref() {
        return Ok(server.clone());
    }

    // 端口交给系统分配，避免和本机已有服务冲突
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("启动 3D Tiles 静态服务失败：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("获取静态服务端口失败：{e}"))?
        .port();
    let server = Arc::new(TileServer {
        port,
        mounts: RwLock::new(Vec::new()),
    });

    let (connection_tx, connection_rx) = mpsc::channel::<TcpStream>();
    let connection_rx = Arc::new(Mutex::new(connection_rx));
    for index in 0..TILE_WORKERS {
        let connection_rx = connection_rx.clone();
        let worker_server = server.clone();
        thread::Builder::new()
            .name(format!("tiles_http_{index}"))
            .spawn(move || loop {
                let next = connection_rx
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .recv();
                let Ok(stream) = next else { break };
                serve_request(stream, &worker_server);
            })
            .map_err(|e| format!("启动 3D Tiles 工作线程失败：{e}"))?;
    }
    thread::Builder::new()
        .name("tiles_http_accept".to_string())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                if connection_tx.send(stream).is_err() {
                    break;
                }
            }
        })
        .map_err(|e| format!("启动 3D Tiles 监听线程失败：{e}"))?;

    *guard = Some(server.clone());
    Ok(server)
}

fn serve_request(mut stream: TcpStream, server: &TileServer) {
    let _ = stream.set_read_timeout(Some(TILE_IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(TILE_IO_TIMEOUT));
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
    // 路径格式：/{挂载编号}/{tileset 目录内的相对路径}
    let (mount, rest) = path_part
        .trim_start_matches('/')
        .split_once('/')
        .unwrap_or(("", ""));
    let Some(root) = mount.parse::<usize>().ok().and_then(|mount| server.root(mount)) else {
        write_response(&mut stream, "404 Not Found", "text/plain", b"not found", head_only);
        return;
    };
    let relative = match percent_decode(rest) {
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
    if !canonical.starts_with(&root) || !canonical.is_file() {
        write_response(
            &mut stream,
            "404 Not Found",
            "text/plain",
            b"not found",
            head_only,
        );
        return;
    }
    let Ok(mut file) = fs::File::open(&canonical) else {
        write_response(
            &mut stream,
            "500 Internal Server Error",
            "text/plain",
            b"read failed",
            head_only,
        );
        return;
    };
    let length = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    // 流式发送文件内容，不再把整个瓦片一次性读入内存
    if write_headers(&mut stream, "200 OK", content_type(&canonical), length) && !head_only {
        let _ = std::io::copy(&mut file, &mut stream);
    }
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
    // 静态服务的挂载根目录就是 tileset.json 的父目录
    let server = tile_server()?;
    let mount = server.mount(root.clone());
    let relative_url = percent_encode_path(relative);
    let name = file
        .parent()
        .and_then(|path| path.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("3D Tiles")
        .to_string();
    Ok(Some(LocalTilesetInfo {
        url: format!("http://127.0.0.1:{}/{mount}/{relative_url}", server.port),
        name,
    }))
}
