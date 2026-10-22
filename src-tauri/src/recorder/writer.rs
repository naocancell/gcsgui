//! 记录服务：多链路自动感应记录与异步落盘。
//!
//! 核心设计：
//! 1. 底层自动感应：通信开始（链路启动或首帧数据到达）后，自动按链路创建独立的 .dat 录制文件；
//! 2. 一路一文件：文件名清晰标识链路名、协议类型、创建时间戳（例如 `FP95-UDP_FP95_20260930_160000.dat`）；
//! 3. 非阻塞 tap：DashMap 细粒度分段无锁读，try_send 异步落盘，绝不阻塞实时数据流；
//! 4. 链路随动生命周期：链路关闭或连接断开时，自动停止对应链路记录并 fsync 落盘；
//! 5. 安全围栏：@replay: 虚拟链路注入的数据天然被过滤，永不循环录制。

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::comms::{ProtocolType, RawData};

use super::format;
use super::format::{encode_header, encode_protocol, FileHeader, LinkEntry};

/// tap → writer 内部事件
pub(super) enum TapRecordEvent {
    RxRaw {
        timestamp_ns: u64,
        link_id: u16,
        data: Vec<u8>,
    },
}

/// 单条链路写任务的结果
pub(super) struct WriterResult {
    pub(super) records: u64,
    pub(super) bytes: u64,
    pub(super) error: Option<String>,
}

/// 单条链路的录制会话
pub struct SingleLinkSession {
    pub link_name: String,
    pub protocol: ProtocolType,
    pub link_type_str: String,
    pub path: PathBuf,
    pub start_instant: Instant,
    pub start_wall_ms: i64,
    tx: mpsc::Sender<TapRecordEvent>,
    cancel: CancellationToken,
    join: Mutex<Option<tauri::async_runtime::JoinHandle<WriterResult>>>,
    records_count: Arc<AtomicU64>,
    bytes_count: Arc<AtomicU64>,
    dropped_count: Arc<AtomicU64>,
}

/// 单条链路录制状态（供前端展示）
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkRecordStatus {
    pub link_name: String,
    pub protocol: String,
    pub file: String,
    pub started_at_ms: i64,
    pub bytes: u64,
    pub records: u64,
    pub dropped: u64,
}

/// 前端可见的记录器汇总状态
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecorderStatus {
    pub active: bool,
    pub active_count: usize,
    pub links: Vec<LinkRecordStatus>,
    pub total_bytes: u64,
    pub total_records: u64,
    pub total_dropped: u64,
    /// 按飞机号划分的校验数据记录会话
    pub aircraft: Vec<super::validated::AircraftRecordStatus>,
}

/// 某链路停止录制后返回的会话摘要
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecorderSummary {
    pub link_name: String,
    pub file: String,
    pub duration_ms: u64,
    pub records: u64,
    pub bytes: u64,
    pub dropped: u64,
    pub error: Option<String>,
}

/// 清洗文件名中非法字符（针对 Windows 与常见文件系统保留字符）
pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect()
}

/// 生成链路专用的 dat 记录文件名与路径
/// 规则：{安全链路名}_{协议名}_{YYYYMMDD_HHMMSS}.dat
pub fn generate_recording_path(dir: &Path, link_name: &str, protocol: ProtocolType) -> PathBuf {
    let safe_name = sanitize_filename(link_name);
    let protocol_str = format!("{protocol:?}");
    let now = chrono::Local::now();
    let stem = format!("{safe_name}_{protocol_str}_{}", now.format("%Y%m%d_%H%M%S"));
    let mut path = dir.join(format!("{stem}.dat"));
    for i in 1..=99 {
        if !path.exists() {
            break;
        }
        path = dir.join(format!("{stem}_{i}.dat"));
    }
    path
}

/// 未调用 init_dir 前的默认录制目录；单元测试改用系统临时目录，避免在仓库内生成录制文件
fn default_recordings_dir() -> PathBuf {
    if cfg!(test) {
        std::env::temp_dir().join("gcsgui_test_recordings")
    } else {
        PathBuf::from("./recordings")
    }
}

/// 记录服务：被 AppState 持有，全局管理各链路的自动录制会话
#[derive(Clone)]
pub struct RecorderService {
    recordings_dir: Arc<RwLock<PathBuf>>,
    sessions: Arc<dashmap::DashMap<String, Arc<SingleLinkSession>>>,
    lifecycle_lock: Arc<tokio::sync::Mutex<()>>,
    /// 按飞机号划分的校验数据记录（见 [`super::validated`]）
    pub(super) validated: super::validated::ValidatedRecorder,
}

impl Default for RecorderService {
    fn default() -> Self {
        Self::new()
    }
}

impl RecorderService {
    pub fn new() -> Self {
        Self {
            recordings_dir: Arc::new(RwLock::new(default_recordings_dir())),
            sessions: Arc::new(dashmap::DashMap::new()),
            lifecycle_lock: Arc::new(tokio::sync::Mutex::new(())),
            validated: super::validated::ValidatedRecorder::default(),
        }
    }

    /// 设置录制文件输出目录
    pub fn init_dir(&self, dir: PathBuf) {
        *self.recordings_dir.write().unwrap() = dir;
    }

    /// 获取当前录制根目录
    pub fn get_recordings_dir(&self) -> PathBuf {
        self.recordings_dir
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// 是否有任何链路正在记录
    pub fn is_recording(&self) -> bool {
        !self.sessions.is_empty()
    }

    /// 正在记录的链路数量
    pub fn sessions_count(&self) -> usize {
        self.sessions.len()
    }

    /// 检查指定链路是否正在记录
    pub fn is_link_recording(&self, link_name: &str) -> bool {
        self.sessions.contains_key(link_name)
    }

    /// 为指定链路启动自动记录会话（如果已在记录则直接返回当前文件路径）
    pub fn start_link(
        &self,
        link_name: &str,
        protocol: ProtocolType,
        link_type_str: &str,
    ) -> Result<PathBuf, String> {
        // 安全围栏：回放注入的数据链路绝对禁止录制
        if link_name.starts_with(crate::recorder::replay::REPLAY_LINK_PREFIX) {
            return Err("回放虚拟链路禁止录制".into());
        }

        if let Some(existing) = self.sessions.get(link_name) {
            return Ok(existing.path.clone());
        }

        let dir = self.get_recordings_dir();
        if let Err(e) = fs::create_dir_all(&dir) {
            return Err(format!("创建录制目录失败: {e}"));
        }

        let path = generate_recording_path(&dir, link_name, protocol);
        let link_type = match link_type_str {
            "UDP" => format::link_kind::UDP,
            "Serial" | "SERIAL" => format::link_kind::SERIAL,
            _ => format::link_kind::OTHER,
        };

        let now = chrono::Local::now();
        let start_wall_ms = now.timestamp_millis();
        let start_instant = Instant::now();

        // 写入该链路专属的 FileHeader（单链路单条目）
        let header = FileHeader {
            start_wall_ms,
            links: vec![LinkEntry {
                link_id: 0,
                protocol: encode_protocol(protocol),
                link_type,
                name: link_name.to_string(),
            }],
        };

        let mut file = BufWriter::with_capacity(
            64 * 1024,
            File::create(&path).map_err(|e| format!("创建录制文件失败: {e}"))?,
        );
        file.write_all(&encode_header(&header))
            .and_then(|_| file.flush())
            .map_err(|e| format!("写入文件头失败: {e}"))?;

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

        let session = Arc::new(SingleLinkSession {
            link_name: link_name.to_string(),
            protocol,
            link_type_str: link_type_str.to_string(),
            path: path.clone(),
            start_instant,
            start_wall_ms,
            tx,
            cancel,
            join: Mutex::new(Some(join)),
            records_count,
            bytes_count,
            dropped_count,
        });

        self.sessions.insert(link_name.to_string(), session);
        log::info!(
            "[Recorder] 链路 [{link_name}] ({protocol:?}) 自动开启记录: {:?}",
            path
        );
        self.emit_status();
        Ok(path)
    }

    /// 停止指定链路的录制会话并 fsync 落盘
    pub async fn stop_link(&self, link_name: &str) -> Result<Option<RecorderSummary>, String> {
        let _guard = self.lifecycle_lock.lock().await;

        let session = match self.sessions.remove(link_name) {
            Some((_, s)) => s,
            None => return Ok(None),
        };

        // 通知后台写入任务停止
        session.cancel.cancel();

        let join = session.join.lock().unwrap().take();
        let writer_result = if let Some(j) = join {
            j.await.map_err(|e| format!("writer 任务异常: {e}"))?
        } else {
            WriterResult {
                records: session.records_count.load(Ordering::Relaxed),
                bytes: session.bytes_count.load(Ordering::Relaxed),
                error: None,
            }
        };

        let duration_ms = session.start_instant.elapsed().as_millis() as u64;
        let summary = RecorderSummary {
            link_name: session.link_name.clone(),
            file: session.path.to_string_lossy().into_owned(),
            duration_ms,
            records: writer_result.records,
            bytes: writer_result.bytes,
            dropped: session.dropped_count.load(Ordering::Relaxed),
            error: writer_result.error,
        };

        log::info!(
            "[Recorder] 链路 [{link_name}] 录制完成: {:?}（{} 条记录，{} 字节，{:.1}s）",
            session.path,
            summary.records,
            summary.bytes,
            duration_ms as f64 / 1000.0
        );

        self.emit_status();
        Ok(Some(summary))
    }

    /// 停止全部链路的录制
    pub async fn stop_all(&self) -> Vec<RecorderSummary> {
        let link_names: Vec<String> = self.sessions.iter().map(|e| e.key().clone()).collect();
        let mut summaries = Vec::new();
        for name in link_names {
            if let Ok(Some(s)) = self.stop_link(&name).await {
                summaries.push(s);
            }
        }
        summaries.extend(self.stop_all_validated().await);
        summaries
    }

    /// 根据当前存活的 active_links 同步录制会话：已不在活动链路表中的自动关闭
    pub fn sync_active_links(
        &self,
        active_links: &dashmap::DashMap<String, crate::state::ActiveLink>,
    ) {
        let keys_to_stop: Vec<String> = self
            .sessions
            .iter()
            .filter(|entry| !active_links.contains_key(entry.key()))
            .map(|entry| entry.key().clone())
            .collect();

        if !keys_to_stop.is_empty() {
            let this = self.clone();
            tauri::async_runtime::spawn(async move {
                for key in keys_to_stop {
                    log::info!("[Recorder] 链路 [{key}] 已关闭，自动停止录制");
                    let _ = this.stop_link(&key).await;
                }
            });
        }

        self.sync_validated_sessions(active_links, Instant::now());
    }

    /// 非阻塞 tap：由 start_router 主循环调用，绝不阻塞实时链路
    pub fn try_record(&self, raw: &RawData, protocol: ProtocolType, link_type_hint: Option<&str>) {
        // 安全围栏：绝不录制回放注入的数据
        if raw
            .source_link
            .starts_with(crate::recorder::replay::REPLAY_LINK_PREFIX)
        {
            return;
        }

        if let Some(session) = self.sessions.get(&raw.source_link) {
            let timestamp_ns = raw
                .received_at
                .saturating_duration_since(session.start_instant)
                .as_nanos() as u64;
            let event = TapRecordEvent::RxRaw {
                timestamp_ns,
                link_id: 0,
                data: raw.data.clone(),
            };
            if session.tx.try_send(event).is_ok() {
                session.records_count.fetch_add(1, Ordering::Relaxed);
                session
                    .bytes_count
                    .fetch_add(raw.data.len() as u64, Ordering::Relaxed);
            } else {
                session.dropped_count.fetch_add(1, Ordering::Relaxed);
            }
        } else {
            // 底层自动感应：首帧到达但尚未建会话时，自动启动该链路录制
            let link_type = link_type_hint.unwrap_or("UDP");
            if self
                .start_link(&raw.source_link, protocol, link_type)
                .is_ok()
            {
                if let Some(session) = self.sessions.get(&raw.source_link) {
                    let timestamp_ns = raw
                        .received_at
                        .saturating_duration_since(session.start_instant)
                        .as_nanos() as u64;
                    let event = TapRecordEvent::RxRaw {
                        timestamp_ns,
                        link_id: 0,
                        data: raw.data.clone(),
                    };
                    if session.tx.try_send(event).is_ok() {
                        session.records_count.fetch_add(1, Ordering::Relaxed);
                        session
                            .bytes_count
                            .fetch_add(raw.data.len() as u64, Ordering::Relaxed);
                    } else {
                        session.dropped_count.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
    }

    /// 获取当前所有链路录制状态快照
    pub fn status(&self) -> RecorderStatus {
        let mut links = Vec::new();
        let mut total_bytes = 0;
        let mut total_records = 0;
        let mut total_dropped = 0;

        for entry in self.sessions.iter() {
            let session = entry.value();
            let bytes = session.bytes_count.load(Ordering::Relaxed);
            let records = session.records_count.load(Ordering::Relaxed);
            let dropped = session.dropped_count.load(Ordering::Relaxed);
            total_bytes += bytes;
            total_records += records;
            total_dropped += dropped;
            links.push(LinkRecordStatus {
                link_name: session.link_name.clone(),
                protocol: format!("{:?}", session.protocol),
                file: session.path.to_string_lossy().into_owned(),
                started_at_ms: session.start_wall_ms,
                bytes,
                records,
                dropped,
            });
        }

        let aircraft = self.validated_status();
        RecorderStatus {
            active: !links.is_empty() || !aircraft.is_empty(),
            active_count: links.len(),
            links,
            total_bytes,
            total_records,
            total_dropped,
            aircraft,
        }
    }

    /// 推送 recorder-status-event
    pub fn emit_status(&self) {
        let Some(app_handle) = crate::APP_HANDLE.get() else {
            return;
        };
        use tauri::Emitter;
        let payload = self.status();
        let _ = app_handle.emit("recorder-status-event", &payload);
    }
}

/// 异步落盘任务：消费单个录制文件的 tap 事件 → 编码追加 → 500ms 定时 flush。
/// 通道关闭或收到 cancel 时排空、flush、fsync 后退出。
pub(super) async fn single_link_writer_task(
    mut rx: mpsc::Receiver<TapRecordEvent>,
    mut file: BufWriter<File>,
    cancel: CancellationToken,
    records_count: Arc<AtomicU64>,
    bytes_count: Arc<AtomicU64>,
) -> WriterResult {
    let mut buf: Vec<u8> = Vec::with_capacity(16 * 1024);
    let mut flush_timer = tokio::time::interval(Duration::from_millis(500));
    flush_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    'outer: loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                break 'outer;
            }
            event = rx.recv() => {
                let Some(event) = event else {
                    break 'outer;
                };
                match event {
                    TapRecordEvent::RxRaw { timestamp_ns, link_id, data } => {
                        format::encode_record_into(&mut buf, &format::Record {
                            record_type: format::record_type::RX_RAW,
                            timestamp_ns,
                            link_id,
                            payload: &data,
                        });
                    }
                }
                // 批量排空当前积压
                loop {
                    match rx.try_recv() {
                        Ok(TapRecordEvent::RxRaw { timestamp_ns, link_id, data }) => {
                            format::encode_record_into(&mut buf, &format::Record {
                                record_type: format::record_type::RX_RAW,
                                timestamp_ns,
                                link_id,
                                payload: &data,
                            });
                        }
                        Err(mpsc::error::TryRecvError::Empty) => break,
                        Err(mpsc::error::TryRecvError::Disconnected) => break 'outer,
                    }
                }
                if let Err(e) = file.write_all(&buf) {
                    log::error!("[Recorder] 写入录制数据失败: {e}");
                    return WriterResult {
                        records: records_count.load(Ordering::Relaxed),
                        bytes: bytes_count.load(Ordering::Relaxed),
                        error: Some(e.to_string()),
                    };
                }
                buf.clear();
            }
            _ = flush_timer.tick() => {
                if let Err(e) = file.flush() {
                    log::error!("[Recorder] 定时 flush 录制数据失败: {e}");
                    return WriterResult {
                        records: records_count.load(Ordering::Relaxed),
                        bytes: bytes_count.load(Ordering::Relaxed),
                        error: Some(e.to_string()),
                    };
                }
            }
        }
    }

    // 退出前排空残留队列
    while let Ok(TapRecordEvent::RxRaw {
        timestamp_ns,
        link_id,
        data,
    }) = rx.try_recv()
    {
        format::encode_record_into(
            &mut buf,
            &format::Record {
                record_type: format::record_type::RX_RAW,
                timestamp_ns,
                link_id,
                payload: &data,
            },
        );
    }
    if !buf.is_empty() {
        let _ = file.write_all(&buf);
    }
    let _ = file.flush();
    if let Ok(f) = file.into_inner() {
        let _ = f.sync_all();
    }
    WriterResult {
        records: records_count.load(Ordering::Relaxed),
        bytes: bytes_count.load(Ordering::Relaxed),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufReader;

    fn temp_test_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("gcs_rec_test_{}", rand_id()));
        let _ = fs::create_dir_all(&path);
        path
    }

    static TEST_DIR_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

    fn rand_id() -> u64 {
        use std::time::SystemTime;
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;
        let seq = TEST_DIR_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        ts.wrapping_add(seq.wrapping_mul(1_000_000_007))
    }

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("COM1:115200"), "COM1_115200");
        assert_eq!(sanitize_filename("UDP/127.0.0.1"), "UDP_127.0.0.1");
        assert_eq!(sanitize_filename("Test*Link?"), "Test_Link_");
    }

    #[tokio::test]
    async fn test_auto_record_multi_links() {
        let dir = temp_test_dir();
        let service = RecorderService::new();
        service.init_dir(dir.clone());

        let start = Instant::now();
        // 链路 1：FP95-UDP
        let raw1 = RawData {
            source_link: "FP95-UDP".into(),
            link_generation: 1,
            data: vec![0xEB, 0x90, 0x83, 0x01],
            received_at: start,
        };
        service.try_record(&raw1, ProtocolType::FP95, Some("UDP"));

        // 链路 2：串口-COM3
        let raw2 = RawData {
            source_link: "串口:COM3".into(),
            link_generation: 1,
            data: vec![0xEB, 0x90, 0x01, 0x02, 0x03],
            received_at: start + Duration::from_millis(50),
        };
        service.try_record(&raw2, ProtocolType::FP981C, Some("Serial"));

        assert_eq!(service.sessions_count(), 2);
        let status = service.status();
        assert_eq!(status.active_count, 2);

        // 每条链路各写入 10 条
        for i in 1..10 {
            let r1 = RawData {
                source_link: "FP95-UDP".into(),
                link_generation: 1,
                data: vec![0xEB, 0x90, 0x83, i as u8],
                received_at: start + Duration::from_millis(i * 10),
            };
            service.try_record(&r1, ProtocolType::FP95, Some("UDP"));

            let r2 = RawData {
                source_link: "串口:COM3".into(),
                link_generation: 1,
                data: vec![0xEB, 0x90, 0x01, i as u8],
                received_at: start + Duration::from_millis(i * 10),
            };
            service.try_record(&r2, ProtocolType::FP981C, Some("Serial"));
        }

        tokio::time::sleep(Duration::from_millis(100)).await;

        let summaries = service.stop_all().await;
        assert_eq!(summaries.len(), 2);

        // 验证产出的 2 个文件
        for summary in &summaries {
            assert!(
                Path::new(&summary.file).exists(),
                "文件应存在: {}",
                summary.file
            );
            assert_eq!(summary.records, 10, "每条链路应有 10 条记录");

            let mut f = File::open(&summary.file).unwrap();
            let header = format::read_header(&mut f).unwrap();
            assert_eq!(header.links.len(), 1, "单链路文件链路表中应恰好有 1 条链路");

            let mut reader = format::RecordReader::new(BufReader::new(f));
            let mut read_records = 0;
            while let Some(rec) = reader.next_record().unwrap() {
                assert_eq!(rec.record_type, format::record_type::RX_RAW);
                read_records += 1;
            }
            assert_eq!(read_records, 10);
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_replay_link_ignored() {
        let dir = temp_test_dir();
        let service = RecorderService::new();
        service.init_dir(dir.clone());

        let raw = RawData {
            source_link: "@replay:FP95-UDP".into(),
            link_generation: 1,
            data: vec![1, 2, 3],
            received_at: Instant::now(),
        };
        service.try_record(&raw, ProtocolType::FP95, Some("UDP"));

        assert_eq!(
            service.sessions_count(),
            0,
            "回放虚拟链路绝不应开启记录会话"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn test_stop_single_link() {
        let dir = temp_test_dir();
        let service = RecorderService::new();
        service.init_dir(dir.clone());

        service.start_link("L1", ProtocolType::FP95, "UDP").unwrap();
        service
            .start_link("L2", ProtocolType::FP981C, "Serial")
            .unwrap();
        assert_eq!(service.sessions_count(), 2);

        let sum1 = service.stop_link("L1").await.unwrap();
        assert!(sum1.is_some());
        assert_eq!(service.sessions_count(), 1);
        assert!(service.is_link_recording("L2"));

        let sum2 = service.stop_link("L2").await.unwrap();
        assert!(sum2.is_some());
        assert_eq!(service.sessions_count(), 0);

        let _ = fs::remove_dir_all(&dir);
    }
}
