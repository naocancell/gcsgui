use dashmap::DashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::connectivity::ProtocolType;
use crate::protocol::uav_info::UAVInfo;

/// 代表一条处于活动状态的物理链路句柄
pub struct ActiveLink {
    /// 链路类型，如 "Serial", "UDP"
    pub link_type: String,
    /// 链路名称，如 "COM3", "224.0.0.1:14550"
    pub name: String,
    /// 该链路绑定的协议类型
    pub protocol: ProtocolType,
    /// 用于向这条物理链路的发送任务(TX Task)发送数据的通道
    pub tx_channel: mpsc::Sender<Vec<u8>>,
    /// 用于关闭该链路后台任务的令牌
    pub cancel_token: CancellationToken,
    /// 健康度：最后一次成功收到合法数据包的时间戳 (用于动态选主)
    pub last_heartbeat: Arc<Mutex<Instant>>,
}

use std::sync::atomic::{AtomicU64, Ordering};

/// 后端全链路遥测监控统计指标埋点
#[derive(Debug, Default)]
pub struct LinkMetrics {
    pub frames_ok: AtomicU64,
    pub frames_crc_fail: AtomicU64,
    pub dedup_hit: AtomicU64,
    pub buffer_overflow: AtomicU64,
    pub parse_err: AtomicU64,
}

impl LinkMetrics {
    pub fn inc_ok(&self) { self.frames_ok.fetch_add(1, Ordering::Relaxed); }
    pub fn inc_crc_fail(&self) { self.frames_crc_fail.fetch_add(1, Ordering::Relaxed); }
    pub fn inc_dedup(&self) { self.dedup_hit.fetch_add(1, Ordering::Relaxed); }
    pub fn inc_overflow(&self) { self.buffer_overflow.fetch_add(1, Ordering::Relaxed); }
    pub fn inc_parse_err(&self) { self.parse_err.fetch_add(1, Ordering::Relaxed); }
}

#[derive(Clone)]
pub struct AppState {
    /// RX 层：无人机实时状态池（UAVInfo 原始协议）
    /// Key 为 无人机ID (u8)
    pub uav_pool: Arc<DashMap<u8, UAVInfo>>,

    /// RX 层：FP981C 协议聚合状态池
    pub fp981c_pool: Arc<DashMap<u8, crate::protocol::fp981c::FP981CAggregate>>,

    /// RX 层：FP95 协议状态池
    pub fp95_pool: Arc<DashMap<[u8; 3], crate::protocol::fp95::FP95Frame94Sub1>>,

    /// RX 层：心跳追踪记录池 (用于死链路超时剔除)
    pub uav_seen: Arc<DashMap<u8, Instant>>,
    pub fp981c_seen: Arc<DashMap<u8, Instant>>,
    pub fp95_seen: Arc<DashMap<[u8; 3], Instant>>,

    /// TX 层：当前已打开的所有物理链路集合 (Key 为 链路名称/ID)
    pub active_links: Arc<DashMap<String, ActiveLink>>,

    /// 全链路遥测指标埋点统计器
    pub metrics: Arc<LinkMetrics>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            uav_pool: Arc::new(DashMap::new()),
            fp981c_pool: Arc::new(DashMap::new()),
            fp95_pool: Arc::new(DashMap::new()),
            uav_seen: Arc::new(DashMap::new()),
            fp981c_seen: Arc::new(DashMap::new()),
            fp95_seen: Arc::new(DashMap::new()),
            active_links: Arc::new(DashMap::new()),
            metrics: Arc::new(LinkMetrics::default()),
        }
    }
}
