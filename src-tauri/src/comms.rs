use std::time::Instant;

/// 协议类型枚举，决定路由层如何切帧和解析
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub enum ProtocolType {
    /// 32 字节帧，EB90 包头
    #[default]
    FP981C,
    /// 75 字节帧，无帧头帧尾，整包即帧
    UAVInfo,
    /// 256 字节帧，有固定帧头帧尾
    FP95,
}

/// 传输层产出的原始数据，不含任何协议信息
/// 对串口来说是一次 read() 的字节块，对 UDP 来说是一个完整数据报
#[derive(Debug, Clone)]
pub struct RawData {
    /// 来源链路名称，路由层据此查找绑定的协议类型
    pub source_link: String,
    /// 原始字节
    pub data: Vec<u8>,
    /// 到达时间戳
    pub received_at: Instant,
}

/// 全局数据汇聚通道
pub type RouterTx = tokio::sync::mpsc::Sender<RawData>;
