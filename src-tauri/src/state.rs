use dashmap::DashMap;
use serde::Serialize;
use std::sync::Arc;
use std::sync::{Mutex, RwLock};
use std::time::Instant;

use crate::comms::ProtocolType;
use crate::protocol::uav_info::UAVInfo;

#[derive(Clone)]
struct TimedFP95Aggregate {
    aggregate: crate::protocol::fp95::FP95Aggregate,
    last_seen: Instant,
    frame94_sequence: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FP95EventPayload {
    #[serde(flatten)]
    aggregate: crate::protocol::fp95::FP95Aggregate,
    frame94_sequence: u64,
}

/// 代表一条处于活动状态的物理链路句柄
pub struct ActiveLink {
    /// 链路类型，如 "Serial", "UDP"
    pub link_type: String,
    /// 链路名称（作为主键标识）
    pub name: String,
    /// 链路实例代数，重启同名链路时递增
    pub generation: u64,
    /// 物理端点参数摘要（用于热重载判断物理配置是否变更）
    pub endpoint_info: String,
    /// 该链路绑定的协议类型
    pub protocol: ProtocolType,
    /// 底层真实多态物理传输链路句柄
    pub transport: Arc<dyn comms_core::TransportLink>,
    /// 健康度：最后一次成功收到合法数据包的时间戳 (用于动态选主)
    pub last_raw_rx: Arc<Mutex<Instant>>,
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
    pub stale_frame: AtomicU64,
    pub conflict_frame: AtomicU64,
    pub recovery_buffered: AtomicU64,
    pub all_links_missing: AtomicU64,
}

impl LinkMetrics {
    pub fn inc_ok(&self) {
        self.frames_ok.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_crc_fail(&self) {
        self.frames_crc_fail.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_dedup(&self) {
        self.dedup_hit.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_overflow(&self) {
        self.buffer_overflow.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_parse_err(&self) {
        self.parse_err.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_stale(&self) {
        self.stale_frame.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_conflict(&self) {
        self.conflict_frame.fetch_add(1, Ordering::Relaxed);
    }
    pub fn inc_recovery_buffered(&self) {
        self.recovery_buffered.fetch_add(1, Ordering::Relaxed);
    }
    pub fn add_all_links_missing(&self, count: u8) {
        self.all_links_missing
            .fetch_add(u64::from(count), Ordering::Relaxed);
    }
}

#[derive(Clone)]
pub struct AppState {
    /// RX 层：无人机实时状态池（UAVInfo 原始协议）
    /// Key 为 无人机ID (u8)
    pub uav_pool: Arc<DashMap<u8, UAVInfo>>,

    /// RX 层：FP981C 协议聚合状态池
    pub fp981c_pool: Arc<DashMap<u8, crate::protocol::fp981c::FP981CAggregate>>,

    /// RX 层：FP95 协议单机聚合状态
    fp95_state: Arc<Mutex<Option<TimedFP95Aggregate>>>,

    /// RX 层：心跳追踪记录池 (用于死链路超时剔除)
    pub uav_seen: Arc<DashMap<u8, Instant>>,
    pub fp981c_seen: Arc<DashMap<u8, Instant>>,

    /// TX 层：当前已打开的所有物理链路集合 (Key 为 链路名称/ID)
    pub active_links: Arc<DashMap<String, ActiveLink>>,

    /// 为每次物理链路实例分配单调递增的代数
    pub next_link_generation: Arc<AtomicU64>,

    /// 全链路遥测指标埋点统计器
    pub metrics: Arc<LinkMetrics>,

    /// RX 层：多物理链路仲裁器发布的最新健康快照。
    pub rx_health: Arc<RwLock<crate::router::rx_arbiter::RxHealthSnapshot>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            uav_pool: Arc::new(DashMap::new()),
            fp981c_pool: Arc::new(DashMap::new()),
            fp95_state: Arc::new(Mutex::new(None)),
            uav_seen: Arc::new(DashMap::new()),
            fp981c_seen: Arc::new(DashMap::new()),
            active_links: Arc::new(DashMap::new()),
            next_link_generation: Arc::new(AtomicU64::new(0)),
            metrics: Arc::new(LinkMetrics::default()),
            rx_health: Arc::new(RwLock::new(Default::default())),
        }
    }

    pub fn allocate_link_generation(&self) -> u64 {
        self.next_link_generation.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn merge_fp95(
        &self,
        uav_id: u8,
        parsed: crate::protocol::fp95::ParsedSubFrame,
        received_at: Instant,
    ) {
        let mut guard = self.fp95_state.lock().expect("FP95 state mutex poisoned");
        let state = guard.get_or_insert_with(|| TimedFP95Aggregate {
            aggregate: Default::default(),
            last_seen: received_at,
            frame94_sequence: 0,
        });
        state.aggregate.uav_id = uav_id;
        if matches!(
            &parsed,
            crate::protocol::fp95::ParsedSubFrame::Frame94(
                crate::protocol::fp95::FP95Frame94::Sub1(_)
            )
        ) {
            state.frame94_sequence = state.frame94_sequence.wrapping_add(1);
        }

        state.aggregate.merge(parsed);
        state.last_seen = received_at;
    }

    pub fn fp95_snapshot(
        &self,
        now: Instant,
        timeout: std::time::Duration,
    ) -> Option<FP95EventPayload> {
        let mut guard = self.fp95_state.lock().expect("FP95 state mutex poisoned");
        if guard
            .as_ref()
            .is_some_and(|state| now.duration_since(state.last_seen) > timeout)
        {
            *guard = None;
        }
        guard.as_ref().map(|state| FP95EventPayload {
            aggregate: state.aggregate.clone(),
            frame94_sequence: state.frame94_sequence,
        })
    }

    pub fn replace_rx_health(&self, snapshot: crate::router::rx_arbiter::RxHealthSnapshot) {
        let mut guard = self
            .rx_health
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = snapshot;
    }

    pub fn rx_health_snapshot(&self) -> crate::router::rx_arbiter::RxHealthSnapshot {
        self.rx_health
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}
