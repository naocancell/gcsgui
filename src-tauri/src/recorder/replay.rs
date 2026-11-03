//! 回放引擎：dat 文件 → 虚拟链路 → 复用 RouterTx 注入，重演完整数据链路。

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use crate::comms::{ProtocolType, RawData, RouterTx};
use crate::state::AppState;

use super::format::{self, decode_protocol, record_type, LinkEntry};

/// 虚拟链路命名空间前缀（避免与同名实时链路冲突，UI 亦可辨识回放数据）
pub const REPLAY_LINK_PREFIX: &str = "@replay:";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplayState {
    Playing,
    Paused,
    Stopped,
}

/// 回放会话公共状态：pacing 循环写，emitter / command 读
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayStatus {
    pub state: ReplayState,
    pub position_ns: u64,
    pub duration_ns: u64,
    /// 倍速；0 = MAX（全速，受 RouterTx 背压限速）
    pub speed: f32,
    pub file_name: String,
    pub start_wall_ms: i64,
}

/// start_replay 返回的会话信息
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayInfo {
    pub duration_ns: u64,
    pub link_count: usize,
    pub start_wall_ms: i64,
    pub file_name: String,
}

/// 回放虚拟链路句柄：只进不出，上行一律拒绝
struct ReplayTransport {
    name: String,
}

#[async_trait::async_trait]
impl comms_core::TransportLink for ReplayTransport {
    fn name(&self) -> &str {
        &self.name
    }

    fn link_type(&self) -> &str {
        "Replay"
    }

    async fn send(&self, _payload: &[u8]) -> Result<usize, comms_core::CommsError> {
        Err(comms_core::CommsError::LinkFaulted(
            "回放虚拟链路禁止上行发送".into(),
        ))
    }

    fn stop(&self) {}

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

/// pacing 循环以任何方式退出时清除快进逻辑时钟
struct ReplayClockGuard(AppState);
impl Drop for ReplayClockGuard {
    fn drop(&mut self) {
        self.0.set_replay_clock(None);
    }
}

struct FinishedGuard(Arc<AtomicBool>);
impl Drop for FinishedGuard {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

struct ReplaySession {
    cancel: CancellationToken,
    join: tauri::async_runtime::JoinHandle<()>,
    is_finished: Arc<AtomicBool>,
    virtual_links: Vec<String>,
    /// link_id → (虚拟链路名, 代数)：seek 重启 pacing 时原样传递
    link_map: HashMap<u16, (String, u64)>,
    link_entries: Vec<LinkEntry>,
    file: PathBuf,
    duration_ns: u64,
    speed_tx: watch::Sender<f32>,
    pause_tx: watch::Sender<bool>,
    start_wall_ms: i64,
}

#[derive(Clone)]
pub struct ReplayEngine {
    inner: Arc<RwLock<Option<ReplaySession>>>,
    lifecycle: Arc<tokio::sync::Mutex<()>>,
}

impl Default for ReplayEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl ReplayEngine {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(None)),
            lifecycle: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// 读会话（容忍锁中毒：某次回放任务 panic 不应让后续所有回放命令连锁 panic）
    fn read_inner(&self) -> std::sync::RwLockReadGuard<'_, Option<ReplaySession>> {
        self.inner
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write_inner(&self) -> std::sync::RwLockWriteGuard<'_, Option<ReplaySession>> {
        self.inner
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn is_active(&self) -> bool {
        let guard = self.read_inner();
        guard.as_ref().map_or(false, |s| !s.is_finished.load(Ordering::SeqCst))
    }

    /// 打开 dat 文件并校验，返回 (文件头, 总时长, 虚拟链路注册数)
    fn prepare_file(path: &Path) -> Result<(format::FileHeader, u64), String> {
        let file = File::open(path)
            .map_err(|e| format!("打开回放文件失败: {e}"))?;
        let mut reader = BufReader::new(file);
        let header = format::read_header(&mut reader).map_err(|e| format!("解析回放文件头失败: {e}"))?;

        // 扫描总时长（最后一条记录的 timestamp_ns）
        let mut cursor = format::RecordReader::new(reader);
        let mut duration_ns = 0u64;
        let mut records = 0u64;
        while let Some(rec) = cursor.next_record().map_err(|e| format!("扫描回放文件失败: {e}"))? {
            duration_ns = rec.timestamp_ns;
            records += 1;
        }
        if cursor.was_truncated() {
            log::warn!(
                "[Replay] 文件尾部损坏，截断于 {} 条记录之后，仍可回放此前内容",
                records
            );
        }
        log::info!("[Replay] 文件扫描: {records} 条记录，时长 {:.1}s", duration_ns as f64 / 1e9);
        Ok((header, duration_ns))
    }

    /// 注册一条虚拟回放链路，返回 (虚拟链路名, 代数)
    fn register_virtual_link(
        app_state: &AppState,
        entry: &LinkEntry,
    ) -> Option<(String, u64)> {
        let protocol = decode_protocol(entry.protocol).unwrap_or(ProtocolType::FP981C);
        let virtual_name = format!("{REPLAY_LINK_PREFIX}{}", entry.name);
        let generation = app_state.allocate_link_generation();

        let link = crate::state::ActiveLink {
            link_type: "Replay".to_string(),
            name: virtual_name.clone(),
            generation,
            endpoint_info: format!("replay:{}", entry.name),
            protocol,
            transport: Arc::new(ReplayTransport { name: virtual_name.clone() }),
            last_raw_rx: Arc::new(Mutex::new(Instant::now())),
        };
        app_state.active_links.insert(virtual_name.clone(), link);
        log::info!("[Replay] 注册虚拟链路 {virtual_name}（协议 {protocol:?}, 代数 {generation}）");
        Some((virtual_name, generation))
    }

    fn unregister_virtual_links(app_state: &AppState, names: &[String]) {
        for name in names {
            app_state.active_links.remove(name);
            log::info!("[Replay] 注销虚拟链路 {name}");
        }
    }

    /// 只注销代数一致的虚拟链路：旧任务收尾时不会误删新会话刚注册的同名链路
    fn unregister_owned_links(app_state: &AppState, links: &[(String, u64)]) {
        for (name, generation) in links {
            if app_state
                .active_links
                .remove_if(name, |_, link| link.generation == *generation)
                .is_some()
            {
                log::info!("[Replay] 注销虚拟链路 {name}");
            }
        }
    }

    /// 等待已取消的 pacing 任务退出；超时则强制中止，保证跳转/停止不会无限等待
    async fn join_pacing(mut join: tauri::async_runtime::JoinHandle<()>) {
        if tokio::time::timeout(PACING_JOIN_TIMEOUT, &mut join).await.is_err() {
            log::error!("[Replay] 旧回放任务 {PACING_JOIN_TIMEOUT:?} 内未退出，强制中止");
            join.abort();
        }
    }

    fn set_status(app_state: &AppState, status: ReplayStatus) {
        *app_state
            .replay_status
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(status);
    }

    /// 启动回放会话
    pub fn start(
        &self,
        app_state: &AppState,
        router_tx: &RouterTx,
        path: PathBuf,
        speed: f32,
    ) -> Result<ReplayInfo, String> {
        // 若已有旧会话（播完或进行中），先释放并注销旧虚拟链路，避免会话死锁
        if let Some(old) = self.write_inner().take() {
            old.cancel.cancel();
            Self::unregister_virtual_links(app_state, &old.virtual_links);
        }

        let (header, duration_ns) = Self::prepare_file(&path)?;
        app_state.reset_rx_pools();

        // 文件头链路表 → 虚拟链路
        let mut virtual_links = Vec::new();
        let mut link_map = HashMap::new();
        for entry in &header.links {
            if let Some((name, generation)) = Self::register_virtual_link(app_state, entry) {
                virtual_links.push(name.clone());
                link_map.insert(entry.link_id, (name, generation));
            }
        }

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());

        let speed = speed.max(0.0);
        // 先发布初始状态再启动任务：短文件可能瞬间播完，后发布会覆盖 Stopped 终态
        Self::set_status(
            app_state,
            ReplayStatus {
                state: ReplayState::Playing,
                position_ns: 0,
                duration_ns,
                speed,
                file_name: file_name.clone(),
                start_wall_ms: header.start_wall_ms,
            },
        );

        let (speed_tx, speed_rx) = watch::channel(speed);
        let (pause_tx, pause_rx) = watch::channel(false);
        let cancel = CancellationToken::new();
        let is_finished = Arc::new(AtomicBool::new(false));

        let join = tauri::async_runtime::spawn(pacing_loop(
            path.clone(),
            app_state.clone(),
            router_tx.clone(),
            cancel.clone(),
            speed_rx,
            pause_rx,
            link_map.clone(),
            0, // 从头播放
            is_finished.clone(),
            header.start_wall_ms,
        ));

        *self.write_inner() = Some(ReplaySession {
            cancel: cancel.clone(),
            join,
            is_finished,
            virtual_links,
            link_map,
            link_entries: header.links.clone(),
            file: path.clone(),
            duration_ns,
            speed_tx,
            pause_tx,
            start_wall_ms: header.start_wall_ms,
        });

        log::info!("[Replay] 回放开始: {path:?}");
        Ok(ReplayInfo {
            duration_ns,
            link_count: header.links.len(),
            start_wall_ms: header.start_wall_ms,
            file_name,
        })
    }

    /// 暂停（幂等：重复暂停无副作用）
    pub fn pause(&self, app_state: &AppState) -> Result<(), String> {
        let session = self.read_inner();
        let Some(session) = session.as_ref() else {
            return Err("当前无回放会话".into());
        };
        let _ = session.pause_tx.send(true);

        let mut guard = app_state
            .replay_status
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(status) = guard.as_mut() {
            status.state = ReplayState::Paused;
        }
        Ok(())
    }

    /// 恢复播放
    pub fn resume(&self, app_state: &AppState) -> Result<(), String> {
        let session = self.read_inner();
        let Some(session) = session.as_ref() else {
            return Err("当前无回放会话".into());
        };
        let _ = session.pause_tx.send(false);

        let mut guard = app_state
            .replay_status
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(status) = guard.as_mut() {
            status.state = ReplayState::Playing;
        }
        Ok(())
    }

    /// 调整倍速（0 = MAX 全速）
    pub fn set_speed(&self, app_state: &AppState, speed: f32) -> Result<(), String> {
        let session = self.read_inner();
        let Some(session) = session.as_ref() else {
            return Err("当前无回放会话".into());
        };
        let speed = speed.max(0.0);
        let _ = session.speed_tx.send(speed);

        let mut guard = app_state
            .replay_status
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(status) = guard.as_mut() {
            status.speed = speed;
        }
        Ok(())
    }

    /// 跳转：终止当前 pacing → 清空状态池 → 以 MAX 倍速重放至目标点后按原速继续
    pub async fn seek(
        &self,
        app_state: &AppState,
        router_tx: &RouterTx,
        position_ns: u64,
    ) -> Result<(), String> {
        let _guard = self.lifecycle.lock().await;

        // 阶段 1：写锁内完成同步操作（取消旧任务、摘字段），不跨 await
        let (file, duration_ns, mut virtual_links, mut link_map, link_entries, speed, old_join, position_ns, start_wall_ms) = {
            let mut session = self
                .inner
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(old) = session.as_mut() else {
                return Err("当前无回放会话".into());
            };

            let position_ns = position_ns.min(old.duration_ns);
            let speed = *old.speed_tx.borrow();
            let file = old.file.clone();
            let duration_ns = old.duration_ns;
            let virtual_links = old.virtual_links.clone();
            let link_map = old.link_map.clone();
            let link_entries = old.link_entries.clone();
            let start_wall_ms = old.start_wall_ms;

            // 停掉旧 pacing
            old.cancel.cancel();
            let old_join = std::mem::replace(
                &mut old.join,
                tauri::async_runtime::spawn(async {}),
            );
            (file, duration_ns, virtual_links, link_map, link_entries, speed, old_join, position_ns, start_wall_ms)
        };

        Self::join_pacing(old_join).await;
        app_state.reset_rx_pools();

        // 阶段 2：若此前自然播完已注销虚拟链路，seek 时确保重新注册到 app_state
        for entry in &link_entries {
            let virtual_name = format!("{REPLAY_LINK_PREFIX}{}", entry.name);
            if !app_state.active_links.contains_key(&virtual_name) {
                if let Some((name, generation)) = Self::register_virtual_link(app_state, entry) {
                    if !virtual_links.contains(&name) {
                        virtual_links.push(name.clone());
                    }
                    link_map.insert(entry.link_id, (name, generation));
                }
            }
        }

        // 阶段 3：先发布目标位置状态，再拉起新 pacing（快进至目标点后按原速继续）
        let file_name = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Self::set_status(
            app_state,
            ReplayStatus {
                state: ReplayState::Playing,
                position_ns,
                duration_ns,
                speed,
                file_name,
                start_wall_ms,
            },
        );

        let (speed_tx, speed_rx) = watch::channel(speed);
        let (pause_tx, pause_rx) = watch::channel(false);
        let cancel = CancellationToken::new();
        let is_finished = Arc::new(AtomicBool::new(false));
        let join = tauri::async_runtime::spawn(pacing_loop(
            file.clone(),
            app_state.clone(),
            router_tx.clone(),
            cancel.clone(),
            speed_rx,
            pause_rx,
            link_map.clone(),
            position_ns,
            is_finished.clone(),
            start_wall_ms,
        ));

        *self.write_inner() = Some(ReplaySession {
            cancel,
            join,
            is_finished,
            virtual_links,
            link_map,
            link_entries,
            file,
            duration_ns,
            speed_tx,
            pause_tx,
            start_wall_ms,
        });

        log::info!("[Replay] 跳转至 {position_ns} ns");
        Ok(())
    }

    /// 停止回放：终止 pacing → 注销虚拟链路 → 保留状态池（可继续查看最后画面）
    pub async fn stop(&self, app_state: &AppState) -> Result<(), String> {
        let _guard = self.lifecycle.lock().await;

        let session = { self.write_inner().take() };
        let Some(session) = session else {
            // 幂等：会话已结束，仅清理终态标记
            *app_state
                .replay_status
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
            return Ok(());
        };

        session.cancel.cancel();
        Self::join_pacing(session.join).await;
        Self::unregister_virtual_links(app_state, &session.virtual_links);

        *app_state
            .replay_status
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        log::info!("[Replay] 回放已停止: {:?}", session.file);
        Ok(())
    }
}

/// 跳转时只重演目标点之前这段时间的数据来重建状态。
///
/// 实时显示的死链剔除阈值为 10s，各类周期帧在 60s 内都会多次出现；
/// 从文件开头整段重演在长文件上要几十秒，期间暂停、再拖动、停止都要排队等待，界面表现为“卡死”。
const SEEK_WARMUP_NS: u64 = 60_000_000_000;

/// 等待旧 pacing 任务退出的上限；超时则强制中止，保证跳转/停止命令永不挂死
const PACING_JOIN_TIMEOUT: Duration = Duration::from_secs(2);

/// 跳过预热窗口之前的记录时，每读这么多条主动让出一次执行权
const SKIP_YIELD_EVERY: u32 = 4096;

/// pacing 主循环：按记录时间轴驱动注入。
///
/// - `resume_position_ns > 0` 时为 seek 快进模式：预热窗口之前的记录只读取跳过（链路公告照常处理），
///   窗口内的记录以 MAX 倍速注入，到达目标点后按用户倍速继续；
/// - 倍速/暂停通过 watch 通道实时生效；取消信号在每条记录、每次等待和每次发送时都会检查；
/// - MAX 倍速（speed=0）注入速率由 RouterTx 容量背压自然限制。
#[allow(clippy::too_many_arguments)]
async fn pacing_loop(
    file: PathBuf,
    app_state: AppState,
    router_tx: RouterTx,
    cancel: CancellationToken,
    mut speed_rx: watch::Receiver<f32>,
    mut pause_rx: watch::Receiver<bool>,
    mut links: HashMap<u16, (String, u64)>,
    resume_position_ns: u64,
    finished_flag: Arc<AtomicBool>,
    start_wall_ms: i64,
) {
    let _finish_guard = FinishedGuard(finished_flag);
    let _clock_guard = ReplayClockGuard(app_state.clone());

    let fd = match File::open(&file) {
        Ok(f) => f,
        Err(e) => {
            log::error!("[Replay] 重新打开回放文件失败: {e}");
            return;
        }
    };
    let mut reader = BufReader::new(fd);
    if let Err(e) = format::read_header(&mut reader) {
        log::error!("[Replay] 重读文件头失败: {e}");
        return;
    }
    let mut cursor = Cursor::new(reader);

    // 本任务按 LinkAnnounce 注册的虚拟链路：任务退出时注销（跳转后的新任务读到公告会重新注册）
    let mut announced: Vec<(String, u64)> = Vec::new();
    let mut prev_ts: Option<u64> = None;
    let mut finished_naturally = false;

    // 快进段：仅注入 [resume − 预热窗口, resume) 的记录。逻辑时刻取“快进开始时刻 − (目标位置 − 记录时间戳)”，
    // 记录间隔与录制一致、快进到位时恰好对齐当前时刻，之后切回真实时钟（单调不回退），
    // 仲裁器观察窗/断链重同步与子帧超时在快进段内仍按录制时间判定。
    let warmup_start_ns = resume_position_ns.saturating_sub(SEEK_WARMUP_NS);
    let fast_forward_origin = Instant::now();
    let mut fast_forwarding = resume_position_ns > 0;
    let mut skipped_since_yield = 0u32;

    loop {
        if cancel.is_cancelled() {
            break;
        }

        // 控制信号实时生效。必须用 borrow_and_update 标记已读：
        // 只用 borrow() 不会清除 has_changed，控制命令到达后会陷入不让出线程的死循环。
        let speed = (*speed_rx.borrow_and_update()).max(0.0);
        let paused = *pause_rx.borrow_and_update();

        // 暂停：等待恢复、变速或取消（快进段不暂停，尽快到位）
        if paused && !fast_forwarding {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break,
                Ok(()) = pause_rx.changed() => continue,
                Ok(()) = speed_rx.changed() => continue,
            }
        }

        // peek 下一条（出错视为终止，但不标记自然播完）
        let rec = match cursor.peek() {
            Ok(Some(rec)) => rec.clone(),
            Ok(None) => {
                finished_naturally = true;
                break;
            }
            Err(e) => {
                log::error!("[Replay] 读取记录失败: {e}");
                break;
            }
        };

        if fast_forwarding && rec.timestamp_ns >= resume_position_ns {
            // 快进到位：超时判定切回真实时钟。乱序的旧时间戳记录不会再把逻辑时钟拨回过去。
            fast_forwarding = false;
            app_state.set_replay_clock(None);
        }

        // 预热窗口之前的记录：只处理链路公告，不注入、不等待
        if fast_forwarding && rec.timestamp_ns < warmup_start_ns {
            if rec.record_type == record_type::LINK_ANNOUNCE {
                apply_link_announce(&app_state, &rec.payload, &mut links, &mut announced);
            }
            prev_ts = Some(rec.timestamp_ns);
            cursor.advance();
            skipped_since_yield += 1;
            if skipped_since_yield >= SKIP_YIELD_EVERY {
                skipped_since_yield = 0;
                tokio::task::yield_now().await;
            }
            continue;
        }

        // 到期时间：相邻记录时间差 ÷ 倍速；快进段恒为 MAX
        if !fast_forwarding && speed > 0.0 {
            if let Some(prev) = prev_ts {
                let delta = rec.timestamp_ns.saturating_sub(prev);
                let wait = Duration::from_nanos((delta as f64 / speed as f64) as u64);
                if !wait.is_zero() {
                    tokio::select! {
                        biased;
                        _ = cancel.cancelled() => break,
                        Ok(()) = pause_rx.changed() => continue,
                        Ok(()) = speed_rx.changed() => continue,
                        _ = tokio::time::sleep(wait) => {}
                    }
                }
            }
        }

        // 处理记录
        match rec.record_type {
            record_type::RX_RAW => {
                let Some((virtual_name, generation)) = links.get(&rec.link_id) else {
                    log::warn!("[Replay] 未知 link_id {}，跳过", rec.link_id);
                    cursor.advance();
                    prev_ts = Some(rec.timestamp_ns);
                    continue;
                };
                let received_at = if fast_forwarding {
                    let behind = Duration::from_nanos(resume_position_ns.saturating_sub(rec.timestamp_ns));
                    let at = fast_forward_origin
                        .checked_sub(behind)
                        .unwrap_or(fast_forward_origin);
                    app_state.set_replay_clock(Some(at));
                    at
                } else {
                    Instant::now()
                };
                let raw = RawData {
                    source_link: virtual_name.clone(),
                    link_generation: *generation,
                    data: rec.payload,
                    received_at,
                };
                // RouterTx 背压时也要能被 seek/stop 立即取消
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break,
                    sent = router_tx.send(raw) => {
                        if sent.is_err() {
                            log::warn!("[Replay] RouterTx 已关闭，回放终止");
                            break;
                        }
                    }
                }
            }
            record_type::LINK_ANNOUNCE => {
                apply_link_announce(&app_state, &rec.payload, &mut links, &mut announced);
            }
            record_type::LINK_RESTART => {
                // V1：仅作流切分标记，流式找包头会自动重同步
                log::trace!("[Replay] link_id {} 在 {} ns 处发生链路重启（记录时点）", rec.link_id, rec.timestamp_ns);
            }
            other => {
                log::trace!("[Replay] 忽略记录类型 {other}");
            }
        }

        // 更新进度：快进段（恢复内部状态）不暴露中间进度，避免向前端推送 0~resume 之间的瞬态导致进度条乱跳
        prev_ts = Some(rec.timestamp_ns);
        cursor.advance();
        if !fast_forwarding {
            let mut guard = app_state
                .replay_status
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(status) = guard.as_mut() {
                status.position_ns = rec.timestamp_ns;
            }
        }
    }

    // 被取消（跳转/停止/重新开始）时只注销本任务公告注册的链路；文件头链路由会话管理
    if !finished_naturally || cancel.is_cancelled() {
        ReplayEngine::unregister_owned_links(&app_state, &announced);
        return;
    }

    // 自然播完：标记终态并注销虚拟链路（用户 seek 时会自动重新按需注册）
    let file_name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let duration_ns = {
        let guard = app_state
            .replay_status
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.as_ref().map_or(0, |s| s.duration_ns)
    };
    // 先注销虚拟链路再置 Stopped：观察到 replay_active() == false 时虚拟链路必已移除。
    // 只移除代数一致的链路，避免误删新会话刚注册的同名链路。
    let owned: Vec<(String, u64)> = links.values().cloned().collect();
    ReplayEngine::unregister_owned_links(&app_state, &owned);
    ReplayEngine::set_status(
        &app_state,
        ReplayStatus {
            state: ReplayState::Stopped,
            position_ns: duration_ns,
            duration_ns,
            speed: 0.0,
            file_name,
            start_wall_ms,
        },
    );
    log::info!("[Replay] 回放播完，标记为 Stopped 状态并自动收尾虚拟链路");
}

/// 处理 LinkAnnounce：注册虚拟链路并记入本任务的链路表
fn apply_link_announce(
    app_state: &AppState,
    payload: &[u8],
    links: &mut HashMap<u16, (String, u64)>,
    announced: &mut Vec<(String, u64)>,
) {
    match format::decode_link_announce_payload(payload) {
        Ok(entry) => {
            if let Some((name, generation)) = ReplayEngine::register_virtual_link(app_state, &entry) {
                announced.retain(|(existing, _)| existing != &name);
                announced.push((name.clone(), generation));
                links.insert(entry.link_id, (name, generation));
            }
        }
        Err(e) => log::warn!("[Replay] LinkAnnounce 解析失败: {e}"),
    }
}

/// 预读式游标：peek 一条 + advance 推进
struct Cursor<R: Read> {
    reader: format::RecordReader<R>,
    peeked: Option<format::OwnedRecord>,
}

impl<R: Read> Cursor<R> {
    fn new(reader: R) -> Self {
        Self { reader: format::RecordReader::new(reader), peeked: None }
    }

    fn peek(&mut self) -> Result<Option<&format::OwnedRecord>, format::DatError> {
        if self.peeked.is_none() {
            self.peeked = self.reader.next_record()?;
        }
        Ok(self.peeked.as_ref())
    }

    fn advance(&mut self) {
        self.peeked = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use comms_core::TransportLink;

    #[test]
    fn test_replay_transport_rejects_send() {
        let t = ReplayTransport { name: "@replay:test".into() };
        assert_eq!(t.name(), "@replay:test");
        assert_eq!(t.link_type(), "Replay");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(t.send(&[1, 2, 3]));
        assert!(result.is_err());
    }

    #[test]
    fn test_replay_state_serde() {
        assert_eq!(serde_json::to_string(&ReplayState::Playing).unwrap(), "\"playing\"");
        assert_eq!(serde_json::to_string(&ReplayState::Paused).unwrap(), "\"paused\"");
        assert_eq!(serde_json::to_string(&ReplayState::Stopped).unwrap(), "\"stopped\"");
    }

    /// 端到端：手工构造 dat → 回放 → 验证 RawData 经虚拟链路注入
    #[tokio::test]
    async fn test_replay_injects_raw_data_via_virtual_links() {
        use super::super::format::{
            encode_header, encode_record_into, FileHeader, LinkEntry, Record,
        };
        use std::io::Write;

        // 1. 构造 dat 文件：文件头 1 条链路 + 10 条 RxRaw
        let mut path = std::env::temp_dir();
        path.push(format!("gcsgui_test_replay_{}.dat", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let mut f = File::create(&path).unwrap();
            f.write_all(&encode_header(&FileHeader {
                start_wall_ms: 0,
                links: vec![LinkEntry {
                    link_id: 0,
                    protocol: 2, // FP95
                    link_type: 0,
                    name: "FP95-UDP".into(),
                }],
            }))
            .unwrap();
            let mut buf = Vec::new();
            for i in 0..10u64 {
                encode_record_into(
                    &mut buf,
                    &Record {
                        record_type: record_type::RX_RAW,
                        timestamp_ns: i * 1_000_000,
                        link_id: 0,
                        payload: &[0xEB, 0x90, i as u8, 0, 0],
                    },
                );
            }
            f.write_all(&buf).unwrap();
            f.flush().unwrap();
        }

        // 2. 启动回放（MAX 倍速，尽快注入）
        let app_state = AppState::new();
        let (router_tx, mut router_rx) = tokio::sync::mpsc::channel(64);
        let engine = ReplayEngine::new();
        let info = engine
            .start(&app_state, &router_tx, path.clone(), 0.0)
            .unwrap();
        assert_eq!(info.duration_ns, 9_000_000);
        assert_eq!(info.link_count, 1);

        // 虚拟链路已注册，generation 与注入数据匹配
        let virtual_name = format!("{REPLAY_LINK_PREFIX}FP95-UDP");
        let registered_generation = app_state
            .active_links
            .get(&virtual_name)
            .map(|l| l.generation)
            .expect("虚拟链路应已注册");
        assert!(app_state.replay_active());

        // 3. 收 10 条 RawData
        let mut received = 0;
        let deadline = tokio::time::sleep(Duration::from_secs(5));
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                Some(raw) = router_rx.recv() => {
                    assert_eq!(raw.source_link, virtual_name);
                    assert_eq!(raw.link_generation, registered_generation);
                    received += 1;
                    if received == 10 { break; }
                }
                _ = &mut deadline => panic!("回放注入超时（收到 {received}/10）"),
            }
        }

        // 4. 等待自然播完 → 终态 Stopped、虚拟链路自动注销
        for _ in 0..50 {
            if !app_state.replay_active() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!app_state.replay_active(), "播完应自动收尾");
        assert!(!app_state.active_links.contains_key(&virtual_name));

        // 5. stop 幂等清理
        engine.stop(&app_state).await.unwrap();
        assert!(app_state.replay_status_snapshot().is_none());

        let _ = std::fs::remove_file(&path);
    }

    /// 测试用：写一个回放文件，records = (类型, 时间戳, link_id, 载荷)
    fn write_replay_file(
        tag: &str,
        links: Vec<super::super::format::LinkEntry>,
        records: &[(u8, u64, u16, Vec<u8>)],
    ) -> PathBuf {
        use super::super::format::{encode_header, encode_record_into, FileHeader, Record};
        use std::io::Write;

        let path = std::env::temp_dir().join(format!(
            "gcsgui_replay_{tag}_{}.dat",
            std::process::id()
        ));
        let mut file = File::create(&path).unwrap();
        file.write_all(&encode_header(&FileHeader { start_wall_ms: 0, links }))
            .unwrap();
        let mut buf = Vec::new();
        for (record_type, timestamp_ns, link_id, payload) in records {
            encode_record_into(
                &mut buf,
                &Record {
                    record_type: *record_type,
                    timestamp_ns: *timestamp_ns,
                    link_id: *link_id,
                    payload,
                },
            );
        }
        file.write_all(&buf).unwrap();
        path
    }

    fn test_link(link_id: u16, name: &str) -> super::super::format::LinkEntry {
        super::super::format::LinkEntry {
            link_id,
            protocol: 2,
            link_type: 0,
            name: name.into(),
        }
    }

    fn index_of(raw: &RawData) -> u32 {
        u32::from_le_bytes(raw.data[..4].try_into().unwrap())
    }

    /// 长文件拖到末尾：跳转立即返回，只重演目标点前的预热窗口，且晚注册的链路照常可用
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn seek_far_into_long_file_replays_only_warmup_window() {
        const STEP_NS: u64 = 100_000_000; // 10 Hz
        const COUNT: u32 = 6_000; // 600 s
        let mut records = vec![(
            record_type::LINK_ANNOUNCE,
            0,
            0,
            super::super::format::encode_link_announce_payload(&test_link(1, "late")),
        )];
        for i in 0..COUNT {
            records.push((record_type::RX_RAW, u64::from(i) * STEP_NS, 0, i.to_le_bytes().to_vec()));
        }
        records.push((record_type::RX_RAW, 580 * 1_000_000_000 + 1, 1, u32::MAX.to_le_bytes().to_vec()));
        records.sort_by_key(|r| r.1);
        let path = write_replay_file("warmup", vec![test_link(0, "main")], &records);

        let app_state = AppState::new();
        let (tx, mut rx) = tokio::sync::mpsc::channel(16);
        let engine = ReplayEngine::new();
        engine.start(&app_state, &tx, path.clone(), 1.0).unwrap();
        let first = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await.unwrap().unwrap();
        assert_eq!(index_of(&first), 0);

        let target = 590 * 1_000_000_000;
        tokio::time::timeout(Duration::from_secs(2), engine.seek(&app_state, &tx, target))
            .await
            .expect("跳转不应等待")
            .unwrap();
        assert_eq!(app_state.replay_status_snapshot().unwrap().position_ns, target);

        // 预热窗口 [530 s, 590 s) 以 MAX 注入，之后按 1× 继续
        let mut indices = Vec::new();
        let mut late_link_seen = false;
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let raw = rx.recv().await.unwrap();
                if raw.source_link == format!("{REPLAY_LINK_PREFIX}late") {
                    late_link_seen = true;
                    continue;
                }
                let index = index_of(&raw);
                indices.push(index);
                if index >= 5_900 {
                    break;
                }
            }
        })
        .await
        .expect("预热窗口应快速注入完毕");
        let first_after_seek = indices.iter().copied().find(|&i| i != 0 && i != 1).unwrap();
        assert!(first_after_seek >= 5_300, "不应从文件开头重演: {first_after_seek}");
        assert!(late_link_seen, "预热窗口之前公告的链路应可接收数据");
        assert!(
            Instant::now().saturating_duration_since(app_state.clock_now()) < Duration::from_millis(200),
            "快进结束后应切回真实时钟"
        );

        tokio::time::timeout(Duration::from_secs(2), engine.stop(&app_state))
            .await
            .unwrap()
            .unwrap();
        assert!(!app_state.active_links.contains_key(&format!("{REPLAY_LINK_PREFIX}late")));
        assert!(!app_state.active_links.contains_key(&format!("{REPLAY_LINK_PREFIX}main")));
        let _ = std::fs::remove_file(path);
    }

    /// 暂停中改倍速再恢复：控制信号不能让 pacing 陷入死循环，之后跳转与停止仍立即生效
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pause_speed_resume_then_seek_and_stop() {
        let records: Vec<_> = (0..400u32)
            .map(|i| (record_type::RX_RAW, u64::from(i) * 50_000_000, 0, i.to_le_bytes().to_vec()))
            .collect();
        let path = write_replay_file("controls", vec![test_link(0, "controls")], &records);

        let app_state = AppState::new();
        let (tx, mut rx) = tokio::sync::mpsc::channel(16);
        let engine = ReplayEngine::new();
        engine.start(&app_state, &tx, path.clone(), 1.0).unwrap();
        tokio::time::timeout(Duration::from_secs(2), rx.recv()).await.unwrap().unwrap();

        engine.pause(&app_state).unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        while rx.try_recv().is_ok() {}
        engine.set_speed(&app_state, 4.0).unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(200), rx.recv()).await.is_err(),
            "暂停后不应继续注入"
        );
        assert_eq!(app_state.replay_status_snapshot().unwrap().state, ReplayState::Paused);

        engine.resume(&app_state).unwrap();
        tokio::time::timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("变速并恢复后应继续注入")
            .unwrap();

        tokio::time::timeout(Duration::from_secs(2), engine.seek(&app_state, &tx, 10_000_000_000))
            .await
            .expect("跳转不应卡住")
            .unwrap();
        let raw = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let raw = rx.recv().await.unwrap();
                if index_of(&raw) >= 200 {
                    return raw;
                }
            }
        })
        .await
        .expect("跳转后应从目标点继续");
        assert!(index_of(&raw) <= 210);
        assert_eq!(app_state.replay_status_snapshot().unwrap().speed, 4.0);

        tokio::time::timeout(Duration::from_secs(2), engine.stop(&app_state))
            .await
            .expect("停止不应卡住")
            .unwrap();
        assert!(app_state.replay_status_snapshot().is_none());
        let _ = std::fs::remove_file(path);
    }

    /// 路由队列已满（下游处理不过来）时，连续跳转与停止都不能卡在发送上
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn repeated_seek_and_stop_cancel_when_router_is_full() {
        let records: Vec<_> = (0..20_000u32)
            .map(|i| (record_type::RX_RAW, u64::from(i) * 1_000_000, 0, i.to_le_bytes().to_vec()))
            .collect();
        let path = write_replay_file("backpressure", vec![test_link(0, "backpressure")], &records);

        let app_state = AppState::new();
        let (tx, _rx) = tokio::sync::mpsc::channel(1);
        let engine = ReplayEngine::new();
        engine.start(&app_state, &tx, path.clone(), 0.0).unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while tx.capacity() != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        for target_s in [15u64, 3, 19, 8] {
            tokio::time::timeout(
                Duration::from_secs(1),
                engine.seek(&app_state, &tx, target_s * 1_000_000_000),
            )
            .await
            .expect("队列满时跳转不应卡住")
            .unwrap();
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        tokio::time::timeout(Duration::from_secs(1), engine.stop(&app_state))
            .await
            .expect("队列满时停止不应卡住")
            .unwrap();
        assert!(app_state.replay_status_snapshot().is_none());
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn test_probe_user_file() {
        let path = PathBuf::from(r"C:\Users\WALLCE\AppData\Roaming\com.gcsgui.app\recordings\FP95_Serial_FP95_20260930_160926.dat");
        if !path.exists() {
            return;
        }
        let (header, duration_ns) = ReplayEngine::prepare_file(&path).unwrap();
        println!("Header links: {:?}", header.links);
        println!("Duration: {} ms", duration_ns / 1_000_000);

        let mut file = File::open(&path).unwrap();
        format::read_header(&mut file).unwrap();
        let mut reader = format::RecordReader::new(BufReader::new(file));
        let mut count = 0;
        let mut min_ts = u64::MAX;
        let mut max_ts = 0;
        while let Some(rec) = reader.next_record().unwrap() {
            count += 1;
            min_ts = min_ts.min(rec.timestamp_ns);
            max_ts = max_ts.max(rec.timestamp_ns);
            if count <= 5 {
                println!("Record {}: len={}, ts={}", count, rec.payload.len(), rec.timestamp_ns);
            }
        }
        println!("Total records: {}, min_ts: {} ms, max_ts: {} ms", count, min_ts / 1_000_000, max_ts / 1_000_000);
    }
}
