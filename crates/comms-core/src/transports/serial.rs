use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc::Sender, Mutex};
use tokio_serial::SerialPortBuilderExt;
use tokio_util::sync::CancellationToken;

use crate::error::CommsError;
use crate::event::{LinkEvent, LinkStatus};
use crate::transport::TransportLink;

#[derive(Debug, Clone)]
pub struct SerialConfig {
    pub name: String,
    pub port_name: String,
    pub baud_rate: u32,
    pub buffer_size: usize,
}

/// 获取当前系统中所有可用物理串口列表
pub fn list_available_ports() -> Result<Vec<tokio_serial::SerialPortInfo>, CommsError> {
    tokio_serial::available_ports().map_err(CommsError::Serial)
}

pub struct SerialLink {
    name: String,
    writer: Arc<Mutex<tokio::io::WriteHalf<tokio_serial::SerialStream>>>,
    cancel_token: CancellationToken,
}

impl SerialLink {
    pub async fn start(
        config: SerialConfig,
        event_tx: Sender<LinkEvent>,
    ) -> Result<Arc<Self>, CommsError> {
        let port = tokio_serial::new(&config.port_name, config.baud_rate)
            .open_native_async()
            .map_err(CommsError::Serial)?;

        #[cfg(unix)]
        port.set_exclusive(false).map_err(CommsError::Serial)?;

        let (mut reader, writer) = tokio::io::split(port);
        let writer = Arc::new(Mutex::new(writer));
        let cancel_token = CancellationToken::new();
        let link_name = config.name.clone();

        let link = Arc::new(Self {
            name: config.name.clone(),
            writer,
            cancel_token: cancel_token.clone(),
        });

        let rx_tx = event_tx.clone();
        let rx_name = link_name.clone();
        let buf_size = if config.buffer_size == 0 {
            4096
        } else {
            config.buffer_size
        };

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
                    res = reader.read(&mut buf) => {
                        match res {
                            Ok(0) => {
                                log::warn!("串口链路 {} 读取到 0 字节 (EOF)", rx_name);
                                let _ = rx_tx.send(LinkEvent::StatusChanged {
                                    link_name: rx_name.clone(),
                                    status: LinkStatus::Faulted("读取EOF，端口已关闭".to_string()),
                                }).await;
                                break;
                            }
                            Ok(n) => {
                                let _ = rx_tx.send(LinkEvent::Data {
                                    link_name: rx_name.clone(),
                                    payload: buf[..n].to_vec(),
                                    received_at: Instant::now(),
                                }).await;
                            }
                            Err(e) => {
                                log::error!("串口链路 {} 读取异常: {}", rx_name, e);
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
impl TransportLink for SerialLink {
    fn name(&self) -> &str {
        &self.name
    }

    fn link_type(&self) -> &str {
        "Serial"
    }

    async fn send(&self, payload: &[u8]) -> Result<usize, CommsError> {
        let mut w = self.writer.lock().await;
        w.write_all(payload).await.map_err(CommsError::Io)?;
        Ok(payload.len())
    }

    fn stop(&self) {
        self.cancel_token.cancel();
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
