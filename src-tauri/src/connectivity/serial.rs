use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_serial::SerialPortBuilderExt;
use tokio_util::sync::CancellationToken;

use crate::connectivity::{RawData, RouterTx};

/// 纯传输层：只负责从串口读取字节并转发，不关心协议和切帧
pub async fn start_serial_link(
    router_tx: RouterTx,
    mut tx_rx: mpsc::Receiver<Vec<u8>>,
    cancel_token: CancellationToken,
    port_name: String,
    baud_rate: u32,
    link_name: String,
) -> Result<(), String> {
    let port = tokio_serial::new(&port_name, baud_rate)
        .open_native_async()
        .map_err(|e| format!("打开串口失败: {}", e))?;

    #[cfg(unix)]
    port.set_exclusive(false)
        .map_err(|e| format!("设置独占失败: {}", e))?;

    let (mut rx_port, mut tx_port) = tokio::io::split(port);

    log::info!(
        "串口链路 {} 已启动，监听 {} (Baud: {})",
        link_name,
        port_name,
        baud_rate
    );

    let link_name_clone = link_name.clone();
    let cancel_token_clone = cancel_token.clone();

    // RX 任务：读取字节并原样转发到路由层
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        loop {
            tokio::select! {
                _ = cancel_token_clone.cancelled() => {
                    break;
                }
                res = rx_port.read(&mut buf) => {
                    match res {
                        Ok(n) if n > 0 => {
                            let _ = router_tx.send(RawData {
                                source_link: link_name_clone.clone(),
                                data: buf[..n].to_vec(),
                                received_at: Instant::now(),
                            }).await;
                        }
                        Ok(_) => {
                            log::warn!("串口 {} 读取到 0 字节，可能已断开", link_name_clone);
                            break;
                        }
                        Err(e) => {
                            log::error!("串口读取异常: {}", e);
                            break;
                        }
                    }
                }
            }
        }
        log::info!("串口接收服务 {} 安全停止", link_name_clone);
    });

    // TX 任务
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    break;
                }
                msg = tx_rx.recv() => {
                    if let Some(bytes) = msg {
                        if let Err(e) = tx_port.write_all(&bytes).await {
                            log::error!("串口发送失败: {}", e);
                        }
                    } else {
                        break;
                    }
                }
            }
        }
    });

    Ok(())
}

pub fn list_ports() -> Result<Vec<String>, String> {
    let mut serial_ports: Vec<String> = vec![];

    if let Ok(ports) = tokio_serial::available_ports() {
        for port in ports {
            serial_ports.push(port.port_name);
        }
    }

    Ok(serial_ports)
}

/// 由于实现系统事件驱动过于繁琐, 启动一个后台任务，定期轮询串口列表
pub fn start_port_monitor(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_ports: Vec<String> = vec![];
        loop {
            if let Ok(current_ports) = list_ports() {
                if current_ports != last_ports {
                    last_ports = current_ports.clone();
                    use tauri::Emitter;
                    let _ = app_handle.emit("serial-ports-changed", current_ports);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    });
}
