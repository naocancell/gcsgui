//! 按飞机号划分的校验数据记录（简称“校验记录”）。
//!
//! 与按物理链路记录原始字节的 [`super::writer`] 并行工作：
//! - 只记录通过校验、被系统采纳的完整帧，不区分来自哪条链路；
//! - 按飞机号一机一文件，存放在录制目录的 `validated/` 子目录，
//!   文件名 `UAV{机号:03}_VALID_{YYYYMMDD_HHMMSS}.dat`；
//! - 沿用 GCSREC v1 格式，可直接用现有回放功能打开。文件头固定 3 条链路表条目：
//!
//! ```text
//! link_id 0  UAV{n}-FP981C   FP981C   CRC 通过、仲裁采纳且解析成功的 32 字节帧
//! link_id 1  UAV{n}-FP95     FP95     同上的 FP95 帧，以及和校验通过、解包成功的 AA55 载荷帧
//! link_id 2  UAV{n}-UAVInfo  UAVInfo  解析成功且机号在 0~255 的 75 字节帧
//! ```
//!
//!   每条 RxRaw 记录恰好是一帧完整数据，时间戳单调不减。
//!
//! 合法性口径：
//! - FP981C / FP95：帧 CRC 通过 + 多链路仲裁判定为采纳（冗余链路的重复帧只记一次）+ 子帧解析成功；
//! - AA55 载荷：帧头合理 + 和校验通过 + 外层解包成功。外层协议不带机号，按同一链路最近一帧
//!   FP95 的机号归属；该链路尚未收到 FP95 帧时归入 [`MISSION_PAYLOAD_UAV_ID`]；
//! - UAVInfo：75 字节解析成功且机号在 0~255；
//! - AA55 与 UAVInfo 没有可供仲裁的帧序号：同一飞机 500ms 内从另一条链路收到字节完全相同的帧
//!   视为冗余重复，只记一次（同一链路上的重复帧照常记录）。
//!
//! 生命周期：开始通信后，某飞机首帧合法数据到达时自动建文件，此后该飞机的合法数据一直写入
//! 同一个文件（中途断数、串口重连、修改链路参数热重载都不切分），直到停止通信（保存配置后已无
//! 任何启用的 FP981C / FP95 / UAVInfo 接收链路）或退出程序时才收尾落盘。回放注入的数据永不记录。
//!
//! [`MISSION_PAYLOAD_UAV_ID`]: crate::protocol::payload::MISSION_PAYLOAD_UAV_ID

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use dashmap::mapref::entry::Entry;
use dashmap::DashMap;
use serde::Serialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::comms::ProtocolType;
use crate::protocol::payload::MISSION_PAYLOAD_UAV_ID;
use crate::state::ActiveLink;

use super::format::{self, encode_header, encode_protocol, FileHeader, LinkEntry};
use super::replay::REPLAY_LINK_PREFIX;
use super::writer::{
    single_link_writer_task, RecorderService, RecorderSummary, TapRecordEvent, WriterResult,
};

/// 校验记录文件所在的录制目录子目录名
pub const VALIDATED_SUBDIR: &str = "validated";

/// 无序号帧（AA55 / UAVInfo）的冗余链路去重窗口
const CROSS_LINK_DEDUP_WINDOW: Duration = Duration::from_millis(500);

/// 去重表超过此条目数时清理过期条目
const DEDUP_CLEANUP_THRESHOLD: usize = 256;

/// 回放虚拟链路的 link_type（见 recorder::replay::register_virtual_link）
const REPLAY_LINK_TYPE: &str = "Replay";

/// 校验记录中的帧类别
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidatedKind {
    Fp981c,
    Fp95,
    /// AA55 任管载荷帧（与 FP95 同一链路，回放时由 FP95 混合切帧器解析）
    Payload,
    UavInfo,
}

impl ValidatedKind {
    const ALL: [ValidatedKind; 4] = [
        ValidatedKind::Fp981c,
        ValidatedKind::Fp95,
        ValidatedKind::Payload,
        ValidatedKind::UavInfo,
    ];

    /// 文件内链路表编号
    pub fn link_id(self) -> u16 {
        match self {
            ValidatedKind::Fp981c => 0,
            ValidatedKind::Fp95 | ValidatedKind::Payload => 1,
            ValidatedKind::UavInfo => 2,
        }
    }

    fn bit(self) -> u8 {
        match self {
            ValidatedKind::Fp981c => 1,
            ValidatedKind::Fp95 => 1 << 1,
            ValidatedKind::Payload => 1 << 2,
            ValidatedKind::UavInfo => 1 << 3,
        }
    }

    fn label(self) -> &'static str {
        match self {
            ValidatedKind::Fp981c => "FP981C",
            ValidatedKind::Fp95 => "FP95",
            ValidatedKind::Payload => "载荷",
            ValidatedKind::UavInfo => "UAVInfo",
        }
    }

    /// 没有帧序号、未经多链路仲裁的帧需要做冗余链路去重
    fn needs_cross_link_dedup(self) -> bool {
        matches!(self, ValidatedKind::Payload | ValidatedKind::UavInfo)
    }
}

/// 校验记录的会话表与链路机号归属表（由 [`RecorderService`] 持有）
#[derive(Clone, Default)]
pub struct ValidatedRecorder {
    sessions: Arc<DashMap<u8, Arc<AircraftSession>>>,
    /// 链路名 → 该链路最近一帧 FP95 的机号（用于 AA55 载荷帧归属）
    link_aircraft: Arc<DashMap<String, u8>>,
    /// 建文件失败只报一次警告，避免逐帧刷屏
    start_error_logged: Arc<AtomicBool>,
}

/// 单架飞机的校验记录会话
struct AircraftSession {
    uav_id: u8,
    path: PathBuf,
    start_instant: Instant,
    start_wall_ms: i64,
    /// 最近一条记录的时间戳（相对 start_instant），保证时间戳单调不减
    last_ts_ns: AtomicU64,
    /// 已记录过的帧类别位图
    kinds: AtomicU8,
    /// (CRC32, 长度) → (首个送达链路, 最近送达时间)
    dedup: Mutex<HashMap<(u32, usize), (String, Instant)>>,
    tx: mpsc::Sender<TapRecordEvent>,
    cancel: CancellationToken,
    join: Mutex<Option<tauri::async_runtime::JoinHandle<WriterResult>>>,
    records_count: Arc<AtomicU64>,
    bytes_count: Arc<AtomicU64>,
    dropped_count: Arc<AtomicU64>,
}

impl AircraftSession {
    fn sources(&self) -> Vec<String> {
        let kinds = self.kinds.load(Ordering::Relaxed);
        ValidatedKind::ALL
            .iter()
            .filter(|kind| kinds & kind.bit() != 0)
            .map(|kind| kind.label().to_string())
            .collect()
    }

    /// 冗余链路去重：同一帧已在窗口内由另一条链路送达时返回 true（应丢弃）
    fn is_cross_link_duplicate(&self, source_link: &str, frame: &[u8], now: Instant) -> bool {
        let key = (crc32fast::hash(frame), frame.len());
        let mut dedup = self.dedup.lock().unwrap_or_else(|p| p.into_inner());
        if dedup.len() > DEDUP_CLEANUP_THRESHOLD {
            dedup.retain(|_, (_, seen)| {
                now.saturating_duration_since(*seen) <= CROSS_LINK_DEDUP_WINDOW
            });
        }
        if let Some((link, seen)) = dedup.get(&key) {
            if link != source_link
                && now.saturating_duration_since(*seen) <= CROSS_LINK_DEDUP_WINDOW
            {
                return true;
            }
        }
        dedup.insert(key, (source_link.to_string(), now));
        false
    }
}

/// 校验记录会话状态（供前端展示）
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AircraftRecordStatus {
    pub uav_id: u8,
    pub file: String,
    pub started_at_ms: i64,
    pub bytes: u64,
    pub records: u64,
    pub dropped: u64,
    /// 已记录的数据类别，如 ["FP95", "载荷"]
    pub sources: Vec<String>,
}

/// 生成校验记录文件路径：{dir}/UAV{机号:03}_VALID_{YYYYMMDD_HHMMSS}.dat
pub fn generate_validated_path(dir: &Path, uav_id: u8) -> PathBuf {
    let now = chrono::Local::now();
    let stem = format!("UAV{uav_id:03}_VALID_{}", now.format("%Y%m%d_%H%M%S"));
    let mut path = dir.join(format!("{stem}.dat"));
    for i in 1..=99 {
        if !path.exists() {
            break;
        }
        path = dir.join(format!("{stem}_{i}.dat"));
    }
    path
}

/// 校验记录文件头的固定链路表
pub fn validated_link_entries(uav_id: u8) -> Vec<LinkEntry> {
    [
        (ValidatedKind::Fp981c, ProtocolType::FP981C, "FP981C"),
        (ValidatedKind::Fp95, ProtocolType::FP95, "FP95"),
        (ValidatedKind::UavInfo, ProtocolType::UAVInfo, "UAVInfo"),
    ]
    .into_iter()
    .map(|(kind, protocol, suffix)| LinkEntry {
        link_id: kind.link_id(),
        protocol: encode_protocol(protocol),
        link_type: format::link_kind::OTHER,
        name: format!("UAV{uav_id:03}-{suffix}"),
    })
    .collect()
}

fn is_replay_source(source_link: &str) -> bool {
    source_link.starts_with(REPLAY_LINK_PREFIX)
}

/// 是否为能产生校验记录数据的实时接收链路（FP981C / FP95 / UAVInfo，回放虚拟链路除外）
fn is_live_rx_link(link_type: &str, protocol: ProtocolType) -> bool {
    link_type != REPLAY_LINK_TYPE
        && matches!(
            protocol,
            ProtocolType::FP981C | ProtocolType::FP95 | ProtocolType::UAVInfo
        )
}

fn create_session(
    dir: &Path,
    uav_id: u8,
    first_received_at: Instant,
) -> Result<Arc<AircraftSession>, String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建校验记录目录失败: {e}"))?;
    let path = generate_validated_path(dir, uav_id);
    // 以首帧接收时刻为时间零点，墙钟时间同步回推
    let start_instant = first_received_at;
    let start_wall_ms = chrono::Local::now().timestamp_millis()
        - start_instant.elapsed().as_millis().min(i64::MAX as u128) as i64;

    let header = FileHeader {
        start_wall_ms,
        links: validated_link_entries(uav_id),
    };
    let mut file = BufWriter::with_capacity(
        64 * 1024,
        File::create(&path).map_err(|e| format!("创建校验记录文件失败: {e}"))?,
    );
    file.write_all(&encode_header(&header))
        .and_then(|_| file.flush())
        .map_err(|e| format!("写入校验记录文件头失败: {e}"))?;

    let (tx, rx) = mpsc::channel::<TapRecordEvent>(1024);
    let cancel = CancellationToken::new();
    let records_count = Arc::new(AtomicU64::new(0));
    let bytes_count = Arc::new(AtomicU64::new(0));
    let dropped_count = Arc::new(AtomicU64::new(0));
    let join = tauri::async_runtime::spawn(single_link_writer_task(
        rx,
        file,
        cancel.clone(),
        records_count.clone(),
        bytes_count.clone(),
    ));

    log::info!("[Recorder] 飞机 {uav_id} 开始记录校验数据: {path:?}");
    Ok(Arc::new(AircraftSession {
        uav_id,
        path,
        start_instant,
        start_wall_ms,
        last_ts_ns: AtomicU64::new(0),
        kinds: AtomicU8::new(0),
        dedup: Mutex::new(HashMap::new()),
        tx,
        cancel,
        join: Mutex::new(Some(join)),
        records_count,
        bytes_count,
        dropped_count,
    }))
}

/// 通知写任务停止并等待其排空、fsync，返回会话摘要
async fn finalize_session(session: Arc<AircraftSession>) -> RecorderSummary {
    session.cancel.cancel();
    let join = session
        .join
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take();
    let writer_result = match join {
        Some(join) => join.await.unwrap_or_else(|e| WriterResult {
            records: session.records_count.load(Ordering::Relaxed),
            bytes: session.bytes_count.load(Ordering::Relaxed),
            error: Some(format!("writer 任务异常: {e}")),
        }),
        None => WriterResult {
            records: session.records_count.load(Ordering::Relaxed),
            bytes: session.bytes_count.load(Ordering::Relaxed),
            error: None,
        },
    };
    let duration_ms = session.start_instant.elapsed().as_millis() as u64;
    log::info!(
        "[Recorder] 飞机 {} 校验数据记录完成: {:?}（{} 条，{} 字节）",
        session.uav_id,
        session.path,
        writer_result.records,
        writer_result.bytes
    );
    RecorderSummary {
        link_name: format!("UAV{:03} 校验记录", session.uav_id),
        file: session.path.to_string_lossy().into_owned(),
        duration_ms,
        records: writer_result.records,
        bytes: writer_result.bytes,
        dropped: session.dropped_count.load(Ordering::Relaxed),
        error: writer_result.error,
    }
}

impl RecorderService {
    /// 校验记录输出目录
    pub fn validated_dir(&self) -> PathBuf {
        self.get_recordings_dir().join(VALIDATED_SUBDIR)
    }

    /// 正在进行校验记录的飞机数量
    pub fn validated_sessions_count(&self) -> usize {
        self.validated.sessions.len()
    }

    /// 登记 FP95 帧所在链路的机号（CRC 通过即登记，不论仲裁结果），供同链路 AA55 载荷帧归属
    pub fn note_link_aircraft(&self, source_link: &str, uav_id: u8) {
        if is_replay_source(source_link) {
            return;
        }
        if self.validated.link_aircraft.get(source_link).map(|v| *v) == Some(uav_id) {
            return;
        }
        self.validated
            .link_aircraft
            .insert(source_link.to_string(), uav_id);
    }

    /// AA55 载荷帧归属的飞机号：同链路最近一帧 FP95 的机号，未知时为 MISSION_PAYLOAD_UAV_ID
    pub fn payload_aircraft(&self, source_link: &str) -> u8 {
        self.validated
            .link_aircraft
            .get(source_link)
            .map(|v| *v)
            .unwrap_or(MISSION_PAYLOAD_UAV_ID)
    }

    /// 非阻塞 tap：记录一帧通过校验的合法数据到对应飞机的校验记录文件
    pub fn record_validated(
        &self,
        source_link: &str,
        kind: ValidatedKind,
        uav_id: u8,
        frame: &[u8],
        received_at: Instant,
    ) {
        // 安全围栏：回放注入的数据绝不记录
        if is_replay_source(source_link) || frame.is_empty() {
            return;
        }

        let mut created = false;
        let session = match self.validated.sessions.entry(uav_id) {
            Entry::Occupied(entry) => entry.get().clone(),
            Entry::Vacant(entry) => {
                match create_session(&self.validated_dir(), uav_id, received_at) {
                    Ok(session) => {
                        self.validated
                            .start_error_logged
                            .store(false, Ordering::Relaxed);
                        entry.insert(session.clone());
                        created = true;
                        session
                    }
                    Err(e) => {
                        if !self
                            .validated
                            .start_error_logged
                            .swap(true, Ordering::Relaxed)
                        {
                            log::warn!("[Recorder] 飞机 {uav_id} 校验记录启动失败: {e}");
                        }
                        return;
                    }
                }
            }
        };
        if created {
            self.emit_status();
        }

        if kind.needs_cross_link_dedup()
            && session.is_cross_link_duplicate(source_link, frame, received_at)
        {
            return;
        }

        // 多链路的 received_at 可能有微小乱序，时间戳取单调不减，保证回放节拍与总时长正确
        let ts = received_at
            .saturating_duration_since(session.start_instant)
            .as_nanos()
            .min(u64::MAX as u128) as u64;
        let ts = ts.max(session.last_ts_ns.fetch_max(ts, Ordering::Relaxed));
        session.kinds.fetch_or(kind.bit(), Ordering::Relaxed);

        let event = TapRecordEvent::RxRaw {
            timestamp_ns: ts,
            link_id: kind.link_id(),
            data: frame.to_vec(),
        };
        if session.tx.try_send(event).is_ok() {
            session.records_count.fetch_add(1, Ordering::Relaxed);
            session
                .bytes_count
                .fetch_add(frame.len() as u64, Ordering::Relaxed);
        } else {
            session.dropped_count.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// 随链路维护周期调用：清理已关闭链路的机号归属。
    ///
    /// 这里不收尾任何校验记录：热重载会先停后启链路，维护周期可能恰好看到链路表为空，
    /// 若在此收尾会把同一次通信切成多个文件。收尾只在停止通信和退出程序时进行。
    pub(super) fn sync_validated_sessions(&self, active_links: &DashMap<String, ActiveLink>) {
        if !self.validated.link_aircraft.is_empty() {
            self.validated
                .link_aircraft
                .retain(|link, _| active_links.contains_key(link));
        }
    }

    /// 停止通信判定：链路切换完成后已没有任何实时接收链路时，收尾全部校验记录文件。
    /// 由保存通信配置（热重载完成后）与单独停止链路的命令调用。
    pub async fn close_validated_if_comms_stopped(
        &self,
        active_links: &DashMap<String, ActiveLink>,
    ) -> Vec<RecorderSummary> {
        let has_live_rx_link = active_links
            .iter()
            .any(|link| is_live_rx_link(&link.link_type, link.protocol));
        if has_live_rx_link || self.validated.sessions.is_empty() {
            return Vec::new();
        }
        log::info!("[Recorder] 已停止通信（无启用的接收链路），收尾全部校验记录");
        self.stop_all_validated().await
    }

    /// 收尾全部校验记录文件
    pub async fn stop_all_validated(&self) -> Vec<RecorderSummary> {
        let ids: Vec<u8> = self.validated.sessions.iter().map(|e| *e.key()).collect();
        let removed: Vec<Arc<AircraftSession>> = ids
            .iter()
            .filter_map(|uav_id| self.validated.sessions.remove(uav_id).map(|(_, s)| s))
            .collect();
        if removed.is_empty() {
            return Vec::new();
        }
        let mut summaries = Vec::with_capacity(removed.len());
        for session in removed {
            summaries.push(finalize_session(session).await);
        }
        self.emit_status();
        summaries
    }

    /// 校验记录会话状态快照（按机号排序）
    pub(super) fn validated_status(&self) -> Vec<AircraftRecordStatus> {
        let mut list: Vec<AircraftRecordStatus> = self
            .validated
            .sessions
            .iter()
            .map(|entry| {
                let session = entry.value();
                AircraftRecordStatus {
                    uav_id: session.uav_id,
                    file: session.path.to_string_lossy().into_owned(),
                    started_at_ms: session.start_wall_ms,
                    bytes: session.bytes_count.load(Ordering::Relaxed),
                    records: session.records_count.load(Ordering::Relaxed),
                    dropped: session.dropped_count.load(Ordering::Relaxed),
                    sources: session.sources(),
                }
            })
            .collect();
        list.sort_by_key(|status| status.uav_id);
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufReader;

    fn temp_test_dir() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("gcs_validated_test_{nanos}_{seq}"));
        let _ = fs::create_dir_all(&path);
        path
    }

    fn read_records(path: &str) -> (FileHeader, Vec<format::OwnedRecord>) {
        let mut file = File::open(path).unwrap();
        let header = format::read_header(&mut file).unwrap();
        let mut reader = format::RecordReader::new(BufReader::new(file));
        let mut records = Vec::new();
        while let Some(record) = reader.next_record().unwrap() {
            records.push(record);
        }
        assert!(!reader.was_truncated());
        (header, records)
    }

    #[tokio::test]
    async fn records_split_by_aircraft_with_fixed_link_table() {
        let dir = temp_test_dir();
        let service = RecorderService::new();
        service.init_dir(dir.clone());
        let start = Instant::now();

        service.record_validated("UDP-A", ValidatedKind::Fp95, 7, &[0xEB, 0x90, 1], start);
        service.record_validated(
            "COM3",
            ValidatedKind::Fp981c,
            12,
            &[0xEB, 0x90, 2],
            start + Duration::from_millis(5),
        );
        service.record_validated(
            "UDP-B",
            ValidatedKind::Payload,
            7,
            &[0xAA, 0x55, 3],
            start + Duration::from_millis(10),
        );
        // 不同链路 received_at 轻微乱序：时间戳仍应单调不减
        service.record_validated(
            "UDP-C",
            ValidatedKind::UavInfo,
            7,
            &[4; 75],
            start + Duration::from_millis(8),
        );
        assert_eq!(service.validated_sessions_count(), 2);
        let status = service.status();
        assert!(status.active);
        assert_eq!(status.aircraft.len(), 2);
        assert_eq!(status.aircraft[0].uav_id, 7);
        assert_eq!(status.aircraft[0].sources, vec!["FP95", "载荷", "UAVInfo"]);

        tokio::time::sleep(Duration::from_millis(50)).await;
        let summaries = service.stop_all().await;
        assert_eq!(summaries.len(), 2);
        assert_eq!(service.validated_sessions_count(), 0);

        let uav7 = summaries
            .iter()
            .find(|s| s.link_name.starts_with("UAV007"))
            .expect("应有 7 号机文件");
        assert!(uav7.file.contains(VALIDATED_SUBDIR));
        assert!(Path::new(&uav7.file)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("UAV007_VALID_"));
        let (header, records) = read_records(&uav7.file);
        assert_eq!(header.links, validated_link_entries(7));
        assert_eq!(
            records.iter().map(|r| r.link_id).collect::<Vec<_>>(),
            vec![1, 1, 2],
            "FP95 与载荷帧共用 FP95 链路，UAVInfo 单独一路"
        );
        assert_eq!(records[1].payload, vec![0xAA, 0x55, 3]);
        assert!(records
            .windows(2)
            .all(|w| w[0].timestamp_ns <= w[1].timestamp_ns));

        let uav12 = summaries
            .iter()
            .find(|s| s.link_name.starts_with("UAV012"))
            .expect("应有 12 号机文件");
        let (_, records) = read_records(&uav12.file);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].link_id, 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn unsequenced_frames_deduplicated_across_links_only() {
        let dir = temp_test_dir();
        let service = RecorderService::new();
        service.init_dir(dir.clone());
        let start = Instant::now();
        let frame = [0xAA, 0x55, 0x0B, 0xC6, 1, 0, 9, 0x42, 0x00];

        service.record_validated("UDP-A", ValidatedKind::Payload, 7, &frame, start);
        // 冗余链路 20ms 后送达同一帧：丢弃
        service.record_validated(
            "UDP-B",
            ValidatedKind::Payload,
            7,
            &frame,
            start + Duration::from_millis(20),
        );
        // 同一链路再次送达相同字节：照常记录（设备可能不递增帧计数）
        service.record_validated(
            "UDP-A",
            ValidatedKind::Payload,
            7,
            &frame,
            start + Duration::from_millis(100),
        );
        // 超出去重窗口后另一链路送达：记录
        service.record_validated(
            "UDP-B",
            ValidatedKind::Payload,
            7,
            &frame,
            start + Duration::from_millis(700),
        );

        tokio::time::sleep(Duration::from_millis(50)).await;
        let summaries = service.stop_all_validated().await;
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].records, 3);
        let (_, records) = read_records(&summaries[0].file);
        assert_eq!(records.len(), 3);

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn replay_source_never_recorded() {
        let dir = temp_test_dir();
        let service = RecorderService::new();
        service.init_dir(dir.clone());

        service.note_link_aircraft("@replay:UAV007-FP95", 7);
        service.record_validated(
            "@replay:UAV007-FP95",
            ValidatedKind::Fp95,
            7,
            &[1, 2, 3],
            Instant::now(),
        );
        assert_eq!(service.validated_sessions_count(), 0);
        assert_eq!(
            service.payload_aircraft("@replay:UAV007-FP95"),
            MISSION_PAYLOAD_UAV_ID
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn payload_aircraft_follows_link_fp95_id() {
        let service = RecorderService::new();
        assert_eq!(service.payload_aircraft("UDP-A"), MISSION_PAYLOAD_UAV_ID);
        service.note_link_aircraft("UDP-A", 7);
        service.note_link_aircraft("UDP-B", 9);
        assert_eq!(service.payload_aircraft("UDP-A"), 7);
        assert_eq!(service.payload_aircraft("UDP-B"), 9);

        // 链路关闭后归属清除
        let active: DashMap<String, ActiveLink> = DashMap::new();
        service.sync_validated_sessions(&active);
        assert_eq!(service.payload_aircraft("UDP-A"), MISSION_PAYLOAD_UAV_ID);
    }

    #[tokio::test]
    async fn sessions_kept_until_comms_stopped() {
        let dir = temp_test_dir();
        let service = RecorderService::new();
        service.init_dir(dir.clone());
        let start = Instant::now();
        service.record_validated("UDP-A", ValidatedKind::Fp95, 3, &[1; 32], start);
        assert_eq!(service.validated_sessions_count(), 1);

        // 维护周期看到链路表为空（如热重载停旧启新的间隙）：不收尾、不切分文件
        let active: DashMap<String, ActiveLink> = DashMap::new();
        service.sync_validated_sessions(&active);
        assert_eq!(service.validated_sessions_count(), 1);

        // 长时间断数后同一飞机的数据仍写入同一个文件
        service.record_validated(
            "UDP-A",
            ValidatedKind::Fp95,
            3,
            &[2; 32],
            start + Duration::from_secs(600),
        );
        assert_eq!(service.validated_sessions_count(), 1);

        // 停止通信（已无接收链路）：全部收尾
        tokio::time::sleep(Duration::from_millis(50)).await;
        let summaries = service.close_validated_if_comms_stopped(&active).await;
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].records, 2);
        assert_eq!(service.validated_sessions_count(), 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn live_rx_link_classification() {
        assert!(is_live_rx_link("UDP", ProtocolType::FP95));
        assert!(is_live_rx_link("SERIAL", ProtocolType::FP981C));
        assert!(is_live_rx_link("UDP", ProtocolType::UAVInfo));
        assert!(!is_live_rx_link(REPLAY_LINK_TYPE, ProtocolType::FP95));
        assert!(!is_live_rx_link("UDP", ProtocolType::ServoTurntable));
        assert!(!is_live_rx_link("UDP", ProtocolType::PassthroughC0));
    }
}
