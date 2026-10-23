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

        let (speed_tx, speed_rx) = watch::channel(speed.max(0.0));
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
            speed,
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

        let _ = old_join.await;
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

        // 阶段 3：拉起新 pacing（快进至目标点后按原速继续）
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
            speed,
            is_finished.clone(),
            start_wall_ms,
        ));

        let file_name = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
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
        let _ = session.join.await;
        Self::unregister_virtual_links(app_state, &session.virtual_links);

        *app_state
            .replay_status
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        log::info!("[Replay] 回放已停止: {:?}", session.file);
        Ok(())
    }
}

/// pacing 主循环：按记录时间轴驱动注入。
///
/// - `resume_position_ns > 0` 时为 seek 快进模式：从头读到该点全部注入（MAX 倍速），
///   到达后按用户倍速继续；
/// - 倍速/暂停通过 watch 通道实时生效；
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
    initial_speed: f32,
    finished_flag: Arc<AtomicBool>,
    start_wall_ms: i64,
) {
    let _finish_guard = FinishedGuard(finished_flag);

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

    let mut speed = initial_speed.max(0.0);
    let mut paused = false;
    let mut prev_ts: Option<u64> = None;
    let mut finished_naturally = false;

    // seek 快进段的逻辑时刻：基准取“现在 − 目标位置”，快进记录按录制时间戳落在过去、
    // 间隔与录制一致，快进到位那一刻恰好对齐当前时刻，之后切回真实时钟（单调不回退）。
    // 这样仲裁器观察窗/断链重同步与子帧超时在快进段内仍按录制时间判定。
    let fast_forward_base = if resume_position_ns > 0 {
        Instant::now().checked_sub(Duration::from_nanos(resume_position_ns))
    } else {
        None
    };
    let mut fast_forwarding = fast_forward_base.is_some();
    let _clock_guard = ReplayClockGuard(app_state.clone());

    loop {
        // 控制信号实时生效
        while speed_rx.has_changed().unwrap_or(false) {
            speed = (*speed_rx.borrow()).max(0.0);
        }
        while pause_rx.has_changed().unwrap_or(false) {
            paused = *pause_rx.borrow();
        }

        // 暂停：等待恢复或取消（快进段不暂停，尽快到位）
        if paused && prev_ts.map_or(false, |t| t >= resume_position_ns) {
            tokio::select! {
                _ = pause_rx.changed() => continue,
                _ = cancel.cancelled() => break,
            }
        }

        // peek 下一条（出错视为终止，但不标记自然播完）
        match cursor.peek() {
            Ok(Some(_)) => {}
            Ok(None) => {
                finished_naturally = true;
                break;
            }
            Err(e) => {
                log::error!("[Replay] 读取记录失败: {e}");
                break;
            }
        }
        let rec = cursor.peek().ok().flatten().cloned().expect("peek 已确认有记录");

        // 到期时间：相邻记录时间差 ÷ 倍速；快进段（ts < resume 点）恒为 MAX
        let effective_speed = if rec.timestamp_ns < resume_position_ns {
            0.0
        } else {
            speed
        };
        if let Some(prev) = prev_ts {
            let delta = rec.timestamp_ns.saturating_sub(prev);
            if delta > 0 && effective_speed > 0.0 {
                let wait = Duration::from_nanos((delta as f64 / effective_speed as f64) as u64);
                if !wait.is_zero() {
                    tokio::select! {
                        _ = tokio::time::sleep(wait) => {}
                        _ = cancel.cancelled() => break,
                        _ = pause_rx.changed() => continue,
                        _ = speed_rx.changed() => continue,
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
                let received_at = match fast_forward_base {
                    Some(base) if rec.timestamp_ns < resume_position_ns => {
                        let at = base + Duration::from_nanos(rec.timestamp_ns);
                        app_state.set_replay_clock(Some(at));
                        at
                    }
                    _ => Instant::now(),
                };
                let raw = RawData {
                    source_link: virtual_name.clone(),
                    link_generation: *generation,
                    data: rec.payload.clone(),
                    received_at,
                };
                if router_tx.send(raw).await.is_err() {
                    log::warn!("[Replay] RouterTx 已关闭，回放终止");
                    break;
                }
            }
            record_type::LINK_ANNOUNCE => {
                match format::decode_link_announce_payload(&rec.payload) {
                    Ok(entry) => {
                        if let Some((name, generation)) =
                            ReplayEngine::register_virtual_link(&app_state, &entry)
                        {
                            links.insert(entry.link_id, (name, generation));
                        }
                    }
                    Err(e) => log::warn!("[Replay] LinkAnnounce 解析失败: {e}"),
                }
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
        if fast_forwarding && rec.timestamp_ns >= resume_position_ns {
            // 快进到位：超时判定切回真实时钟
            fast_forwarding = false;
            app_state.set_replay_clock(None);
        }
        if rec.timestamp_ns >= resume_position_ns {
            let mut guard = app_state
                .replay_status
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(status) = guard.as_mut() {
                status.position_ns = rec.timestamp_ns;
            }
        }
    }

    // 自然播完：标记终态并注销虚拟链路（用户 seek 时会自动重新按需注册）
    if finished_naturally {
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
        // 先注销虚拟链路再置 Stopped：观察到 replay_active() == false 时虚拟链路必已移除
        let virtual_names: Vec<String> = links.values().map(|(n, _)| n.clone()).collect();
        ReplayEngine::unregister_virtual_links(&app_state, &virtual_names);
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
