use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Instant;
use tokio::net::UdpSocket;
use tokio::sync::mpsc::Sender;
use tokio_util::sync::CancellationToken;

use crate::error::CommsError;
use crate::event::{LinkEvent, LinkStatus};
use crate::transport::TransportLink;

#[derive(Debug, Clone)]
pub struct UdpConfig {
    pub name: String,
    pub bind_addr: SocketAddr,
    pub target_addr: SocketAddr,
    pub multicast_ip: Option<Ipv4Addr>,
    pub interface_ip: Option<Ipv4Addr>,
    pub buffer_size: usize,
}

pub struct UdpLink {
    name: String,
    socket: Arc<UdpSocket>,
    target_addr: SocketAddr,
    cancel_token: CancellationToken,
}

impl UdpLink {
    pub async fn start(
        config: UdpConfig,
        event_tx: Sender<LinkEvent>,
    ) -> Result<Arc<Self>, CommsError> {
        let socket = UdpSocket::bind(config.bind_addr)
            .await
            .map_err(CommsError::Io)?;

        // 加入组播支持
        if let Some(multicast_ip) = config.multicast_ip {
            let iface = config.interface_ip.unwrap_or(Ipv4Addr::UNSPECIFIED);
            socket
                .join_multicast_v4(multicast_ip, iface)
                .map_err(CommsError::Io)?;
        }

        let socket = Arc::new(socket);
        let cancel_token = CancellationToken::new();
        let link_name = config.name.clone();

        let link = Arc::new(Self {
            name: config.name.clone(),
            socket: socket.clone(),
            target_addr: config.target_addr,
            cancel_token: cancel_token.clone(),
        });

        let rx_socket = socket.clone();
        let rx_tx = event_tx.clone();
        let rx_name = link_name.clone();
        let buf_size = if config.buffer_size == 0 {
            65535
        } else {
            config.buffer_size
        };

        // 报告启动状态
        let _ = event_tx
            .send(LinkEvent::StatusChanged {
                link_name: link_name.clone(),
                status: LinkStatus::Running,
            })
            .await;

        let cancel_clone = cancel_token.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; buf_size];
            loop {
                tokio::select! {
                    _ = cancel_clone.cancelled() => {
                        let _ = rx_tx.send(LinkEvent::StatusChanged {
                            link_name: rx_name.clone(),
                            status: LinkStatus::Stopped,
                        }).await;
                        break;
                    }
                    res = rx_socket.recv_from(&mut buf) => {
                        match res {
                            Ok((len, _src)) => {
                                let _ = rx_tx.send(LinkEvent::Data {
                                    link_name: rx_name.clone(),
                                    payload: buf[..len].to_vec(),
                                    received_at: Instant::now(),
                                }).await;
                            }
                            Err(e) => {
                                // Windows 平台下如果先前发包目标端口未开放返回 ICMP Port Unreachable，后续 recv_from 会收到 10054 (ConnectionReset)
                                // 这属于非致命临时错误，忽略并继续监听
                                if e.kind() == std::io::ErrorKind::ConnectionReset {
                                    continue;
                                }
                                log::error!("UDP链路 {} 读取异常: {}", rx_name, e);
                                let _ = rx_tx.send(LinkEvent::StatusChanged {
                                    link_name: rx_name.clone(),
                                    status: LinkStatus::Faulted(e.to_string()),
                                }).await;
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(link)
    }
}

#[async_trait::async_trait]
impl TransportLink for UdpLink {
    fn name(&self) -> &str {
        &self.name
    }

    fn link_type(&self) -> &str {
        "UDP"
    }

    async fn send(&self, payload: &[u8]) -> Result<usize, CommsError> {
        let n = self
            .socket
            .send_to(payload, self.target_addr)
            .await
            .map_err(CommsError::Io)?;
        Ok(n)
    }

    fn stop(&self) {
        self.cancel_token.cancel();
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
