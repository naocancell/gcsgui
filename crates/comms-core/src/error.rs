use std::io;

#[derive(Debug, thiserror::Error)]
pub enum CommsError {
    #[error("IO读写失败: {0}")]
    Io(#[from] io::Error),

    #[error("串口错误: {0}")]
    Serial(#[from] tokio_serial::Error),

    #[error("无效的配置参数: {0}")]
    InvalidConfig(String),

    #[error("链路异常中断: {0}")]
    LinkFaulted(String),

    #[error("发包通道封闭或链路已关闭")]
    LinkClosed,
}
