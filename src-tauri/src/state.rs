use dashmap::DashMap;
use serde::{Deserialize, Serialize};
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
    /// 防除冰子帧（94/子帧2 或 0xC6 载荷）最近一次刷新时间
    deice_seen: Option<Instant>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FP95EventPayload {
    #[serde(flatten)]
    aggregate: crate::protocol::fp95::FP95Aggregate,
    frame94_sequence: u64,
    /// 防除冰控制器数据已超时（控制器单独掉线），前端应按离线处理
    deice_stale: bool,
}

/// 防除冰控制器数据超过该时长未刷新即视为掉线
pub const FP95_DEICE_STALE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

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

/// 链路质量与解析指标只读快照（支持 IPC 传输与日志打印）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkMetricsSnapshot {
    pub frames_ok: u64,
    pub frames_crc_fail: u64,
    pub dedup_hit: u64,
    pub buffer_overflow: u64,
    pub parse_err: u64,
    pub stale_frame: u64,
    pub conflict_frame: u64,
    pub recovery_buffered: u64,
    pub all_links_missing: u64,
}

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

    /// 获取当前全链路埋点指标的原子瞬时快照
    pub fn snapshot(&self) -> LinkMetricsSnapshot {
        LinkMetricsSnapshot {
            frames_ok: self.frames_ok.load(Ordering::Relaxed),
            frames_crc_fail: self.frames_crc_fail.load(Ordering::Relaxed),
            dedup_hit: self.dedup_hit.load(Ordering::Relaxed),
            buffer_overflow: self.buffer_overflow.load(Ordering::Relaxed),
            parse_err: self.parse_err.load(Ordering::Relaxed),
            stale_frame: self.stale_frame.load(Ordering::Relaxed),
            conflict_frame: self.conflict_frame.load(Ordering::Relaxed),
            recovery_buffered: self.recovery_buffered.load(Ordering::Relaxed),
            all_links_missing: self.all_links_missing.load(Ordering::Relaxed),
        }
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

    /// RX 层：任管载荷全状态聚合池 (Key 为 无人机ID u8)
    pub mission_payload_pool: Arc<DashMap<u8, crate::protocol::payload::MissionPayloadAggregate>>,

    /// RX 层：心跳追踪记录池 (用于死链路超时剔除)
    pub uav_seen: Arc<DashMap<u8, Instant>>,
    pub fp981c_seen: Arc<DashMap<u8, Instant>>,
    pub mission_payload_seen: Arc<DashMap<u8, Instant>>,

    /// TX 层：当前已打开的所有物理链路集合 (Key 为 链路名称/ID)
    pub active_links: Arc<DashMap<String, ActiveLink>>,

    /// 为每次物理链路实例分配单调递增的代数
    pub next_link_generation: Arc<AtomicU64>,

    /// 全链路遥测指标埋点统计器
    pub metrics: Arc<LinkMetrics>,

    /// RX 层：多物理链路仲裁器发布的最新健康快照。
    pub rx_health: Arc<RwLock<crate::router::rx_arbiter::RxHealthSnapshot>>,

    /// 记录回放子系统：原始数据记录器（tap 由路由器主循环调用）
    pub recorder: Arc<crate::recorder::RecorderService>,

    /// 回放子系统引擎
    pub replay: Arc<crate::recorder::replay::ReplayEngine>,

    /// 回放会话公共状态（pacing 循环写，emitter / command 读）
    pub replay_status: Arc<RwLock<Option<crate::recorder::replay::ReplayStatus>>>,

    /// TX 层：继电器写线圈串行锁 + 已下发未确认的期望掩码（防读-改-写互相覆盖）
    pub relay_pending: Arc<tokio::sync::Mutex<Option<crate::protocol::payload::PendingRelayMask>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            uav_pool: Arc::new(DashMap::new()),
            fp981c_pool: Arc::new(DashMap::new()),
            fp95_state: Arc::new(Mutex::new(None)),
            mission_payload_pool: Arc::new(DashMap::new()),
            uav_seen: Arc::new(DashMap::new()),
            fp981c_seen: Arc::new(DashMap::new()),
            mission_payload_seen: Arc::new(DashMap::new()),
            active_links: Arc::new(DashMap::new()),
            next_link_generation: Arc::new(AtomicU64::new(0)),
            metrics: Arc::new(LinkMetrics::default()),
            rx_health: Arc::new(RwLock::new(Default::default())),
            recorder: Arc::new(crate::recorder::RecorderService::new()),
            replay: Arc::new(crate::recorder::replay::ReplayEngine::new()),
            replay_status: Arc::new(RwLock::new(None)),
            relay_pending: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    /// 清空全部 RX 状态池（回放启动/跳转前调用，保证状态从零重演）
    pub fn reset_rx_pools(&self) {
        self.uav_pool.clear();
        self.fp981c_pool.clear();
        self.mission_payload_pool.clear();
        self.uav_seen.clear();
        self.fp981c_seen.clear();
        self.mission_payload_seen.clear();
        *self.fp95_state.lock().expect("FP95 state mutex poisoned") = None;
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
            deice_seen: None,
        });
        state.aggregate.uav_id = uav_id;
        match &parsed {
            crate::protocol::fp95::ParsedSubFrame::Frame94(
                crate::protocol::fp95::FP95Frame94::Sub1(_),
            ) => {
                state.frame94_sequence = state.frame94_sequence.wrapping_add(1);
            }
            crate::protocol::fp95::ParsedSubFrame::Frame94(
                crate::protocol::fp95::FP95Frame94::Sub2(_),
            ) => {
                state.deice_seen = Some(received_at);
            }
            _ => {}
        }

        state.aggregate.merge(parsed);
        state.last_seen = received_at;
    }

    /// 合入 0xC6 载荷透传的防除冰控制器数据。
    ///
    /// 载荷外层协议不带机号：已有 FP95 聚合时保留 FP95 帧上报的真实机号，
    /// 仅在尚无 FP95 数据时用 `fallback_uav_id` 建立聚合。
    pub fn merge_fp95_deice(
        &self,
        fallback_uav_id: u8,
        deice: crate::protocol::fp95::FP95Frame94Sub2,
        received_at: Instant,
    ) {
        let mut guard = self.fp95_state.lock().expect("FP95 state mutex poisoned");
        let state = guard.get_or_insert_with(|| TimedFP95Aggregate {
            aggregate: crate::protocol::fp95::FP95Aggregate {
                uav_id: fallback_uav_id,
                ..Default::default()
            },
            last_seen: received_at,
            frame94_sequence: 0,
            deice_seen: None,
        });
        state
            .aggregate
            .merge(crate::protocol::fp95::ParsedSubFrame::Frame94(
                crate::protocol::fp95::FP95Frame94::Sub2(deice),
            ));
        state.deice_seen = Some(received_at);
        state.last_seen = received_at;
    }

    pub fn fp95_snapshot(
        &self,
        now: Instant,
        timeout: std::time::Duration,
    ) -> Option<FP95EventPayload> {
        let mut guard = self.fp95_state.lock().expect("FP95 state mutex poisoned");
        // 回放存在（播放、暂停或播完留存）时跳过超时剔除，保住画面
        let keep_replay = self.replay_retained();
        if !keep_replay
            && guard
                .as_ref()
                .is_some_and(|state| now.duration_since(state.last_seen) > timeout)
        {
            *guard = None;
        }
        let state = guard.as_mut()?;
        // 防除冰控制器单独掉线：清空子帧2，避免继续显示最后一次的值
        let deice_stale = !keep_replay
            && state
                .deice_seen
                .is_some_and(|seen| now.duration_since(seen) > FP95_DEICE_STALE_TIMEOUT);
        if deice_stale {
            if let Some(frame94) = state.aggregate.frame94.as_mut() {
                frame94.sub2 = None;
            }
        }
        Some(FP95EventPayload {
            aggregate: state.aggregate.clone(),
            frame94_sequence: state.frame94_sequence,
            deice_stale,
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

    /// 回放会话是否激活（Playing 或 Paused；Stopped/无会话为 false）。
    /// 用于安全围栏：回放期间抑制一切对外副作用（伺服转发/继电器轮询/上行发送）。
    pub fn replay_active(&self) -> bool {
        let guard = self
            .replay_status
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        matches!(
            guard.as_ref().map(|s| s.state),
            Some(crate::recorder::replay::ReplayState::Playing)
                | Some(crate::recorder::replay::ReplayState::Paused)
        )
    }

    /// 回放是否处于暂停态（暂停时 emitter 跳过 10s 死链剔除，保住画面）
    pub fn replay_paused(&self) -> bool {
        let guard = self
            .replay_status
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        matches!(
            guard.as_ref().map(|s| s.state),
            Some(crate::recorder::replay::ReplayState::Paused)
        )
    }

    /// 回放会话是否存在（Playing/Paused/Stopped，控制条可见期间保住复盘画面）
    pub fn replay_retained(&self) -> bool {
        let guard = self
            .replay_status
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.is_some()
    }

    /// 回放状态快照（emitter 推送 / command 查询）
    pub fn replay_status_snapshot(&self) -> Option<crate::recorder::replay::ReplayStatus> {
        self.replay_status
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}
