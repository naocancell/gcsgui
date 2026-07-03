use serde::{Deserialize, Serialize};
use std::time::Instant;

/// 链路运行状态
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LinkStatus {
    Starting,
    Running,
    Stopped,
    Faulted(String),
}

/// 统一通信链路事件流
#[derive(Debug, Clone)]
pub enum LinkEvent {
    /// 纯粹的底层原始数据切片（分片/整帧），不含任何应用层协议和解包假设
    Data {
        link_name: String,
        payload: Vec<u8>,
        received_at: Instant,
    },
    /// 链路运行健康状态变更通知
    StatusChanged {
        link_name: String,
        status: LinkStatus,
    },
}
