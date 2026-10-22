use std::time::Instant;

/// 协议类型枚举，决定路由层如何切帧和解析
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default,
)]
pub enum ProtocolType {
    /// 32 字节帧，EB90 包头
    #[default]
    FP981C,
    /// 75 字节帧，无帧头帧尾，整包即帧
    UAVInfo,
    /// 32 字节帧，EB90 / 2323 包头（与任管载荷 AA55 帧混合同一链路）
    FP95,
    /// 伺服天线转台转发，32 字节帧，EB90 包头，单播发送
    ServoTurntable,
    /// 人影大气数据测量 (HY-AIMS24-W, 0xC0) 透传链路
    PassthroughC0,
    /// 人影焰条 (BF-05, 0xC1) 透传链路
    PassthroughC1,
    /// 人影云滴探测分析系统 (SCDP-200, 0xC2) 透传链路
    PassthroughC2,
}

/// 传输层产出的原始数据，不含任何协议信息
/// 对串口来说是一次 read() 的字节块，对 UDP 来说是一个完整数据报
#[derive(Debug, Clone)]
pub struct RawData {
    /// 来源链路名称，路由层据此查找绑定的协议类型
    pub source_link: String,
    /// 链路实例代数，链路重启后递增，用于丢弃旧队列数据
    pub link_generation: u64,
    /// 原始字节
    pub data: Vec<u8>,
    /// 到达时间戳
    pub received_at: Instant,
}

/// 全局数据汇聚通道
pub type RouterTx = tokio::sync::mpsc::Sender<RawData>;

/// 链路运行状态变化事件（Tauri 事件名 `link-status-changed`），供前端提示断线/恢复
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatusEvent {
    pub link_name: String,
    /// "SERIAL" / "UDP"
    pub link_type: &'static str,
    /// "faulted"（异常断开；串口会自动重连，UDP 需手动重启）/ "recovered"（串口已自动恢复）
    pub status: &'static str,
    pub reason: Option<String>,
}

pub const LINK_STATUS_EVENT: &str = "link-status-changed";

/// 推送链路状态变化事件；应用句柄尚未就绪（如单元测试）时静默跳过
pub fn emit_link_status(event: LinkStatusEvent) {
    let Some(app) = crate::APP_HANDLE.get() else {
        return;
    };
    use tauri::Emitter;
    if let Err(error) = app.emit(LINK_STATUS_EVENT, event) {
        log::warn!("推送链路状态事件失败: {error}");
    }
}
