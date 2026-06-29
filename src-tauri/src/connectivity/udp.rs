use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Instant;
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::connectivity::{RawData, RouterTx};

/// 纯传输层：只负责从 UDP 接收数据报并转发，不关心协议和切帧
pub async fn start_udp_link(
    router_tx: RouterTx,
    mut tx_rx: mpsc::Receiver<Vec<u8>>,
    cancel_token: CancellationToken,
    ip: String,
    port: u16,
    interface_ip: String,
    link_name: String,
) -> Result<(), String> {
    let multicast_ip: Ipv4Addr = ip.parse().map_err(|_| "组播IP地址格式错误")?;
    let local_port = port;
    let local_interface: Ipv4Addr = interface_ip.parse().map_err(|_| "网卡IP地址格式错误")?;

    let socket = UdpSocket::bind(format!("0.0.0.0:{}", local_port))
        .await
        .map_err(|e| format!("绑定本地端口失败：{}", e))?;

    socket
        .join_multicast_v4(multicast_ip, local_interface)
        .map_err(|e| format!("加入组播失败：{}", e))?;

    let socket = Arc::new(socket);
    let rx_socket = socket.clone();
    let tx_socket = socket.clone();
    let dest_addr = format!("{}:{}", ip, port);

    log::info!(
        "UDP 链路 {} 已启动，监听 {}:{}",
        link_name,
        multicast_ip,
        local_port
    );

    let link_name_clone = link_name.clone();
    let cancel_token_clone = cancel_token.clone();

    // RX 任务：原样转发整个数据报到路由层
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        loop {
            tokio::select! {
                _ = cancel_token_clone.cancelled() => {
                    break;
                }
                res = rx_socket.recv_from(&mut buf) => {
                    if let Ok((len, _src_addr)) = res {
                        // 过滤掉自发自收的 48 字节航线数据包
                        if len == 48 {
                            continue;
                        }
                        // println!("[传输层 RX] 收到来自链路 {} 的 UDP 数据包，长度: {} 字节", link_name_clone, len);

                        let _ = router_tx.send(RawData {
                            source_link: link_name_clone.clone(),
                            data: buf[..len].to_vec(),
                            received_at: Instant::now(),
                        }).await;
                    }
                }
            }
        }
        log::info!("UDP 接收服务 {} 安全停止", link_name_clone);
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
                        if let Err(e) = tx_socket.send_to(&bytes, &dest_addr).await {
                            log::error!("UDP 发送失败: {}", e);
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
