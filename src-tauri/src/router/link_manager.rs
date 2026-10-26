use bytes::{Buf, BytesMut};
use std::collections::{HashMap, HashSet};

use crate::comms::{ProtocolType, RawData};
use crate::protocol::uav_info::UAVInfo;
use crate::recorder::ValidatedKind;
use crate::router::rx_arbiter::{
    FrameObservation, RxArbiter, RxArbiterConfig, RxDecision, RxHealthSnapshot, StreamKey,
};
use crate::state::AppState;
use crate::uplink::FP95ResponseCoordinator;

use std::sync::Arc;
use std::time::{Duration, Instant};

/// 同协议活跃链路快照：链路集合变化前所有帧共享同一份，切帧循环里只克隆 Arc
type ActiveLinkSet = Arc<HashSet<String>>;

struct RouterCore {
    arbiter: RxArbiter,
    link_buffers: HashMap<String, LinkBuffer>,
    link_generations: HashMap<String, u64>,
    /// (协议, 是否回放中) → 活跃链路快照；链路代数变化时整体失效
    active_sets: HashMap<(ProtocolType, bool), ActiveLinkSet>,
    /// 已应用的 RX 状态代次（见 AppState::reset_rx_pools）
    rx_epoch: u64,
}
struct LinkBuffer {
    generation: u64,
    protocol: ProtocolType,
    data: BytesMut,
    payload_reassembler: crate::protocol::payload::PayloadStreamReassembler,
}

impl LinkBuffer {
    fn new(generation: u64, protocol: ProtocolType) -> Self {
        Self {
            generation,
            protocol,
            data: BytesMut::new(),
            payload_reassembler: crate::protocol::payload::PayloadStreamReassembler::new(),
        }
    }

    fn reset_if_source_changed(&mut self, generation: u64, protocol: ProtocolType) {
        if self.generation != generation || self.protocol != protocol {
            self.generation = generation;
            self.protocol = protocol;
            self.data.clear();
            self.payload_reassembler = crate::protocol::payload::PayloadStreamReassembler::new();
        }
    }
}

impl RouterCore {
    fn new(config: RxArbiterConfig) -> Self {
        Self {
            arbiter: RxArbiter::new(config),
            link_buffers: HashMap::new(),
            link_generations: HashMap::new(),
            active_sets: HashMap::new(),
            rx_epoch: 0,
        }
    }

    /// 回放启动/跳转重置状态池后，同步清空序号仲裁状态与切帧缓冲，保证从零重演
    fn sync_rx_epoch(&mut self, app_state: &AppState) {
        let epoch = app_state.rx_epoch();
        if epoch != self.rx_epoch {
            self.rx_epoch = epoch;
            self.arbiter.reset_sequences();
            self.link_buffers.clear();
        }
    }

    /// 活跃链路（名称 + 代数）与路由层记录不一致时才重建快照；常态下只遍历比较、不分配内存
    fn refresh_links(&mut self, app_state: &AppState) {
        let changed = app_state.active_links.len() != self.link_generations.len()
            || app_state
                .active_links
                .iter()
                .any(|link| self.link_generations.get(link.key()) != Some(&link.generation));
        if changed {
            self.sync_link_generations(&active_link_generations(app_state));
            self.active_sets.clear();
        }
    }

    fn active_links_for(
        &mut self,
        app_state: &AppState,
        protocol: ProtocolType,
        replay_active: bool,
    ) -> ActiveLinkSet {
        self.active_sets
            .entry((protocol, replay_active))
            .or_insert_with(|| {
                Arc::new(active_links_for_protocol(app_state, protocol, replay_active))
            })
            .clone()
    }

    fn sync_link_generations(&mut self, active_link_generations: &HashMap<String, u64>) {
        let reset_links: Vec<String> = self
            .link_generations
            .iter()
            .filter_map(|(name, generation)| {
                (active_link_generations.get(name) != Some(generation)).then(|| name.clone())
            })
            .collect();

        for name in reset_links {
            self.link_generations.remove(&name);
            self.link_buffers.remove(&name);
            self.arbiter.reset_link(&name);
        }

        self.link_generations.extend(
            active_link_generations
                .iter()
                .map(|(name, generation)| (name.clone(), *generation)),
        );
    }

    fn process_raw(
        &mut self,
        raw: &RawData,
        protocol: ProtocolType,
        datagram: bool,
        active_protocol_links: ActiveLinkSet,
        app_state: &AppState,
        response_coordinator: &FP95ResponseCoordinator,
    ) {
        let buffer = self
            .link_buffers
            .entry(raw.source_link.clone())
            .or_insert_with(|| LinkBuffer::new(raw.link_generation, protocol));
        buffer.reset_if_source_changed(raw.link_generation, protocol);
        if datagram && protocol == ProtocolType::UAVInfo {
            // UAVInfo 无帧头无校验，UDP 链路按数据报对齐：每个数据报独立切帧，
            // 避免一个残缺数据报让后续所有 75 字节帧永久错位
            buffer.data.clear();
        }
        buffer.data.extend_from_slice(&raw.data);

        match protocol {
            ProtocolType::FP981C => extract_and_process_fp981c(
                &mut buffer.data,
                &raw.source_link,
                raw.received_at,
                active_protocol_links,
                &mut self.arbiter,
                app_state,
            ),
            ProtocolType::UAVInfo => {
                extract_and_process_uav_info(
                    &mut buffer.data,
                    &raw.source_link,
                    raw.received_at,
                    app_state,
                );
                if datagram && !buffer.data.is_empty() {
                    log::debug!(
                        "链路 {} UAVInfo 数据报长度 {} 不是 75 的整数倍，丢弃尾部 {} 字节",
                        raw.source_link,
                        raw.data.len(),
                        buffer.data.len()
                    );
                    app_state.metrics.inc_parse_err();
                    buffer.data.clear();
                }
            }
            ProtocolType::FP95 => extract_and_process_fp95_and_payload(
                &mut buffer.data,
                &mut buffer.payload_reassembler,
                &raw.source_link,
                raw.received_at,
                active_protocol_links,
                &mut self.arbiter,
                app_state,
                response_coordinator,
            ),
            ProtocolType::ServoTurntable => {
                // 伺服转台链路为下行单播转发链路，忽略接收缓冲区中的数据
                buffer.data.clear();
            }
            ProtocolType::PassthroughC0 => {
                process_passthrough_uplink(
                    &raw.data,
                    crate::protocol::payload::PAYLOAD_ID_ATMOSPHERE,
                    app_state,
                );
                buffer.data.clear();
            }
            ProtocolType::PassthroughC1 => {
                process_passthrough_uplink(
                    &raw.data,
                    crate::protocol::payload::PAYLOAD_ID_FLARE,
                    app_state,
                );
                buffer.data.clear();
            }
            ProtocolType::PassthroughC2 => {
                process_passthrough_uplink(
                    &raw.data,
                    crate::protocol::payload::PAYLOAD_ID_CLOUD_DROP,
                    app_state,
                );
                buffer.data.clear();
            }
        }

        if buffer.data.len() > 4096 {
            log::warn!("链路 {} 缓冲区溢出，执行清空", raw.source_link);
            buffer.data.clear();
            app_state.metrics.inc_overflow();
        }
    }

    fn maintenance(
        &mut self,
        now: Instant,
        active_links: &HashMap<ProtocolType, HashSet<String>>,
    ) -> RxHealthSnapshot {
        self.arbiter.maintenance(now, active_links)
    }
}

/// 从字节流中寻找 FP981C 包头 0xEB 0x90
fn find_fp981c_header(buffer: &[u8]) -> Option<usize> {
    for i in 0..buffer.len().saturating_sub(1) {
        if buffer[i] == 0xEB && buffer[i + 1] == 0x90 {
            return Some(i);
        }
    }
    None
}

pub async fn start_router(
    mut rx: tokio::sync::mpsc::Receiver<RawData>,
    app_state: AppState,
    response_coordinator: FP95ResponseCoordinator,
) {
    let mut router = RouterCore::new(RxArbiterConfig::default());
    let mut maintenance = tokio::time::interval(Duration::from_millis(250));
    maintenance.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    // 回放期间实时链路的数据只录制不解析，避免与回放画面混叠；仅在状态切换时打一次日志
    let mut live_suppressed_logged = false;

    loop {
        tokio::select! {
            raw = rx.recv() => {
                let Some(raw) = raw else { break };
                router.sync_rx_epoch(&app_state);
                router.refresh_links(&app_state);
                let (protocol, link_type) = {
                    let Some(link) = app_state.active_links.get(&raw.source_link) else {
                        continue;
                    };
                    if raw.link_generation != link.generation {
                        continue;
                    }
                    let mut lock = link
                        .last_raw_rx
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    *lock = raw.received_at;
                    (link.protocol, link.link_type.clone())
                };
                // 记录 tap：非阻塞，按链路独立记录
                app_state
                    .recorder
                    .try_record(&raw, protocol, Some(&link_type));
                let replay_active = app_state.replay_active();
                if replay_active && link_type != REPLAY_LINK_TYPE {
                    if !live_suppressed_logged {
                        log::info!("[Replay] 回放进行中，实时链路数据仅录制、暂停解析");
                        live_suppressed_logged = true;
                    }
                    continue;
                }
                if !replay_active && live_suppressed_logged {
                    log::info!("[Replay] 回放已结束，实时链路数据恢复解析");
                    live_suppressed_logged = false;
                }
                let datagram = link_type == "UDP";
                let active = router.active_links_for(&app_state, protocol, replay_active);
                let processed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    router.process_raw(
                        &raw,
                        protocol,
                        datagram,
                        active,
                        &app_state,
                        &response_coordinator,
                    );
                }));
                if processed.is_err() {
                    // 单帧解析 panic 不得让整个路由任务静默退出；只丢弃出错链路的缓冲，其他链路不受影响
                    log::error!(
                        "[Router] 处理链路 {} 数据时发生 panic，已丢弃该链路缓冲并继续运行",
                        raw.source_link
                    );
                    router.link_buffers.remove(&raw.source_link);
                }
            }
            _ = maintenance.tick() => {
                router.refresh_links(&app_state);
                let active = active_links_by_protocol(&app_state, app_state.replay_active());
                let snapshot = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    router.maintenance(app_state.clock_now(), &active)
                }));
                match snapshot {
                    Ok(snapshot) => app_state.replace_rx_health(snapshot),
                    Err(_) => log::error!("[Router] 链路健康维护发生 panic，本轮跳过"),
                }
                // 自动同步并清理已停用链路的录制会话
                app_state.recorder.sync_active_links(&app_state.active_links);
            }
        }
    }
}

/// 回放虚拟链路的 link_type（见 recorder::replay::register_virtual_link）
const REPLAY_LINK_TYPE: &str = "Replay";

/// 回放期间仅回放虚拟链路参与仲裁，实时链路不计入期望链路（否则会被误记丢帧）
fn link_participates(link: &crate::state::ActiveLink, replay_active: bool) -> bool {
    !replay_active || link.link_type == REPLAY_LINK_TYPE
}

fn active_links_for_protocol(
    app_state: &AppState,
    protocol: ProtocolType,
    replay_active: bool,
) -> HashSet<String> {
    app_state
        .active_links
        .iter()
        .filter(|link| link.protocol == protocol && link_participates(link, replay_active))
        .map(|link| link.key().clone())
        .collect()
}

fn active_links_by_protocol(
    app_state: &AppState,
    replay_active: bool,
) -> HashMap<ProtocolType, HashSet<String>> {
    let mut result: HashMap<ProtocolType, HashSet<String>> = HashMap::new();
    for link in app_state.active_links.iter() {
        if !link_participates(&link, replay_active) {
            continue;
        }
        result
            .entry(link.protocol)
            .or_default()
            .insert(link.key().clone());
    }
    result
}

fn active_link_generations(app_state: &AppState) -> HashMap<String, u64> {
    app_state
        .active_links
        .iter()
        .map(|link| (link.key().clone(), link.generation))
        .collect()
}

// ==================== FP981C 切帧 + 解析 ====================

fn extract_and_process_fp981c(
    buffer: &mut BytesMut,
    source_link: &str,
    received_at: Instant,
    active_links: ActiveLinkSet,
    arbiter: &mut RxArbiter,
    app_state: &AppState,
) {
    while let Some(header_idx) = find_fp981c_header(buffer) {
        if header_idx > 0 {
            buffer.advance(header_idx); // 丢弃头部垃圾
        }
        if buffer.len() < 32 {
            break;
        }
        // 先校验整帧 CRC：数据区里偶然出现的 EB 90 伪帧头校验失败时只滑过 1 字节，
        // 不整段吞掉 32 字节，避免把紧随其后的真实帧一起丢弃
        if !crate::protocol::fkd_crc::verify_fkd_crc(&buffer[..32], 0xEB, 0x90) {
            app_state.metrics.inc_crc_fail();
            buffer.advance(1);
            continue;
        }
        let frame = buffer.split_to(32); // O(1) 零拷贝切出整帧
        process_fp981c_frame(
            &frame,
            source_link,
            received_at,
            active_links.clone(),
            arbiter,
            app_state,
        );
    }
    // 找不到头时保留末尾1字节防EB90被切断
    if find_fp981c_header(buffer).is_none() && buffer.len() > 1 {
        let drop_len = buffer.len() - 1;
        let _ = buffer.split_to(drop_len);
    }
}

fn process_fp981c_frame(
    frame: &[u8],
    source_link: &str,
    received_at: Instant,
    active_links: ActiveLinkSet,
    arbiter: &mut RxArbiter,
    app_state: &AppState,
) {
    if !crate::protocol::fkd_crc::verify_fkd_crc(frame, 0xEB, 0x90) {
        app_state.metrics.inc_crc_fail();
        return;
    }

    let frame_id = frame[2];
    let seq_num = frame[3];
    let uav_id = frame[4];

    let frame_bytes: [u8; 32] = frame.try_into().expect("FP981C frame length was checked");
    let decision = arbiter.observe(
        FrameObservation {
            source_link: source_link.to_string(),
            stream: StreamKey {
                protocol: ProtocolType::FP981C,
                uav_id,
            },
            frame_id,
            raw_sequence: seq_num,
            frame: frame_bytes,
            received_at,
        },
        active_links,
    );
    if !accept_decision(decision, app_state) {
        return;
    }

    let subframe_payload = &frame[5..];

    use crate::protocol::fp981c::ParsedSubFrame;

    match ParsedSubFrame::from_bytes(frame_id, subframe_payload) {
        Ok(parsed) => {
            app_state.metrics.inc_ok();
            // 校验记录：CRC 通过 + 仲裁采纳 + 解析成功的帧按飞机号落盘
            app_state.recorder.record_validated(
                source_link,
                ValidatedKind::Fp981c,
                uav_id,
                frame,
                received_at,
            );
            let mut agg = app_state.fp981c_pool.entry(uav_id).or_insert_with(|| {
                crate::protocol::fp981c::FP981CAggregate {
                    uav_id,
                    ..Default::default()
                }
            });
            agg.uav_id = uav_id;

            agg.merge(parsed);
            app_state.fp981c_seen.insert(uav_id, received_at);
        }
        Err(_) => {
            app_state.metrics.inc_parse_err();
        }
    }
}

// ==================== UAVInfo 切帧 + 解析 ====================

fn extract_and_process_uav_info(
    buffer: &mut BytesMut,
    source_link: &str,
    received_at: Instant,
    app_state: &AppState,
) {
    while buffer.len() >= 75 {
        let frame = buffer.split_to(75);

        match UAVInfo::from_bytes(&frame) {
            Ok(info) => {
                // 机号超出 u8 范围说明帧错位或数据异常，截断成 u8 会凭空造出“幽灵飞机”
                let Ok(uav_id) = u8::try_from(info.uav_id) else {
                    app_state.metrics.inc_parse_err();
                    log::debug!("UAVInfo 机号 {} 超出 0-255，已丢弃", info.uav_id);
                    continue;
                };
                app_state.metrics.inc_ok();
                app_state.recorder.record_validated(
                    source_link,
                    ValidatedKind::UavInfo,
                    uav_id,
                    &frame,
                    received_at,
                );
                app_state.uav_pool.insert(uav_id, info);
                app_state.uav_seen.insert(uav_id, received_at);
            }
            Err(e) => {
                app_state.metrics.inc_parse_err();
                log::warn!("UAVInfo 解析失败: {}", e);
            }
        }
    }
    if buffer.len() > 4096 {
        let drop_len = buffer.len() - 74;
        let _ = buffer.split_to(drop_len);
        app_state.metrics.inc_overflow();
    }
}

// ==================== FP95 + 任管载荷 (EB90 / 2323 + AA55) 双协议切帧 + 解析 ====================

enum MixedFp95Header {
    Fp95(usize, u8, u8), // 偏移量, 同步字1, 同步字2 (支持 0xEB 0x90 与 0x23 0x23)
    Payload(usize),      // 偏移量 (0xAA 0x55)
}

/// 从字节流中寻找最靠前的 FP95 包头 (0xEB 0x90 / 0x23 0x23) 或任管载荷包头 (0xAA 0x55)
fn find_next_fp95_or_payload_header(buffer: &[u8]) -> Option<MixedFp95Header> {
    for i in 0..buffer.len().saturating_sub(1) {
        let b0 = buffer[i];
        let b1 = buffer[i + 1];
        if (b0 == 0xEB && b1 == 0x90) || (b0 == 0x23 && b1 == 0x23) {
            return Some(MixedFp95Header::Fp95(i, b0, b1));
        }
        if b0 == 0xAA && b1 == 0x55 {
            return Some(MixedFp95Header::Payload(i));
        }
    }
    None
}

/// 任管载荷外层帧最大有效数据长度：保证整帧不超过 4096 字节的链路缓冲上限
const MAX_PAYLOAD_DATA_LEN: usize = 4096 - 8;

/// AA55 帧头合理性：方向码为 0x0A/0x0B、载荷 ID 在 0xC0~0xC6、声明长度不超过缓冲上限
fn plausible_payload_header(buffer: &[u8]) -> bool {
    use crate::protocol::payload::{
        CODE_DOWNLINK, CODE_UPLINK, PAYLOAD_ID_ATMOSPHERE, PAYLOAD_ID_DEICE,
    };
    if buffer.len() < 6 {
        return false;
    }
    let data_len = u16::from_le_bytes([buffer[4], buffer[5]]) as usize;
    matches!(buffer[2], CODE_UPLINK | CODE_DOWNLINK)
        && (PAYLOAD_ID_ATMOSPHERE..=PAYLOAD_ID_DEICE).contains(&buffer[3])
        && data_len <= MAX_PAYLOAD_DATA_LEN
}

fn extract_and_process_fp95_and_payload(
    buffer: &mut BytesMut,
    reassembler: &mut crate::protocol::payload::PayloadStreamReassembler,
    source_link: &str,
    received_at: Instant,
    active_links: ActiveLinkSet,
    arbiter: &mut RxArbiter,
    app_state: &AppState,
    response_coordinator: &FP95ResponseCoordinator,
) {
    while let Some(header) = find_next_fp95_or_payload_header(buffer) {
        match header {
            MixedFp95Header::Fp95(header_idx, h1, h2) => {
                if header_idx > 0 {
                    buffer.advance(header_idx);
                }
                if buffer.len() < 32 {
                    break;
                }
                // 伪帧头（数据区里偶然出现 EB90/2323）CRC 必然失败：只滑过 1 字节继续找头
                if !crate::protocol::fkd_crc::verify_fkd_crc(&buffer[..32], h1, h2) {
                    app_state.metrics.inc_crc_fail();
                    buffer.advance(1);
                    continue;
                }
                let frame = buffer.split_to(32);
                process_fp95_frame(
                    frame.as_ref(),
                    (h1, h2),
                    source_link,
                    received_at,
                    active_links.clone(),
                    arbiter,
                    app_state,
                    response_coordinator,
                );
            }
            MixedFp95Header::Payload(header_idx) => {
                if header_idx > 0 {
                    buffer.advance(header_idx);
                }
                if buffer.len() < 8 {
                    break; // 长度不足以读取头部和长度字段
                }
                // 帧头合理性检查：方向码/载荷 ID/长度任一不合理即视为伪帧头，只滑过 1 字节，
                // 防止 FP95 数据区里的 AA 55 声明一个超长长度把后续真实帧全部“吞掉”
                if !plausible_payload_header(buffer) {
                    buffer.advance(1);
                    continue;
                }
                let data_len = u16::from_le_bytes([buffer[4], buffer[5]]) as usize;
                let total_len = 8 + data_len;
                if buffer.len() < total_len {
                    break;
                }
                let checksum =
                    crate::protocol::payload::calculate_checksum(&buffer[..total_len - 1]);
                if checksum != buffer[total_len - 1] {
                    app_state.metrics.inc_crc_fail();
                    buffer.advance(1);
                    continue;
                }
                let frame = buffer.split_to(total_len);
                process_payload_frame(
                    frame.as_ref(),
                    reassembler,
                    source_link,
                    app_state,
                    received_at,
                );
            }
        }
    }

    if find_next_fp95_or_payload_header(buffer).is_none() && buffer.len() > 1 {
        let drop_len = buffer.len() - 1;
        let _ = buffer.split_to(drop_len);
    }
}

fn process_payload_frame(
    frame: &[u8],
    reassembler: &mut crate::protocol::payload::PayloadStreamReassembler,
    source_link: &str,
    app_state: &AppState,
    received_at: Instant,
) {
    match crate::protocol::payload::unpack_payload_frame(frame) {
        Ok(outer) => {
            app_state.metrics.inc_ok();
            // 校验记录：AA55 不带机号，按同链路 FP95 机号归属
            let record_uav_id = app_state.recorder.payload_aircraft(source_link);
            app_state.recorder.record_validated(
                source_link,
                ValidatedKind::Payload,
                record_uav_id,
                frame,
                received_at,
            );
            let uav_id = crate::protocol::payload::MISSION_PAYLOAD_UAV_ID;
            let now_ms = crate::protocol::payload::unix_now_ms();

            let mut agg = app_state
                .mission_payload_pool
                .entry(uav_id)
                .or_insert_with(|| crate::protocol::payload::MissionPayloadAggregate::new(uav_id));

            reassembler.feed_payload(outer.payload_id, &outer.data, &mut agg, now_ms);
            if outer.payload_id == crate::protocol::payload::PAYLOAD_ID_DEICE {
                if let Some(deice) = &agg.deice {
                    // 载荷外层协议不带机号，合入 FP95 聚合时不得覆盖 FP95 帧上报的真实机号
                    app_state.merge_fp95_deice(uav_id, deice.clone(), received_at);
                }
            } else if matches!(
                outer.payload_id,
                crate::protocol::payload::PAYLOAD_ID_ATMOSPHERE
                    | crate::protocol::payload::PAYLOAD_ID_FLARE
                    | crate::protocol::payload::PAYLOAD_ID_CLOUD_DROP
            ) {
                forward_to_passthrough(app_state, outer.payload_id, &outer.data);
            }
            app_state.mission_payload_seen.insert(uav_id, received_at);
        }
        Err(_err) => {
            app_state.metrics.inc_parse_err();
        }
    }
}

fn process_fp95_frame(
    frame: &[u8],
    header: (u8, u8),
    source_link: &str,
    received_at: Instant,
    active_links: ActiveLinkSet,
    arbiter: &mut RxArbiter,
    app_state: &AppState,
    response_coordinator: &FP95ResponseCoordinator,
) {
    if !crate::protocol::fkd_crc::verify_fkd_crc(frame, header.0, header.1) {
        app_state.metrics.inc_crc_fail();
        return;
    }

    let seq_num = frame[2];
    let uav_id = frame[3];
    let frame_id = frame[4];
    // 冗余链路上的重复帧同样说明该链路承载此机号，供同链路 AA55 载荷帧归属
    app_state.recorder.note_link_aircraft(source_link, uav_id);

    let frame_bytes: [u8; 32] = frame.try_into().expect("FP95 frame length was checked");
    let decision = arbiter.observe(
        FrameObservation {
            source_link: source_link.to_string(),
            stream: StreamKey {
                protocol: ProtocolType::FP95,
                uav_id,
            },
            frame_id,
            raw_sequence: seq_num,
            frame: frame_bytes,
            received_at,
        },
        active_links,
    );
    if !accept_decision(decision, app_state) {
        return;
    }

    let subframe_payload = &frame[5..30];

    use crate::protocol::fp95::ParsedSubFrame;

    match ParsedSubFrame::from_bytes(frame_id, subframe_payload) {
        Ok(parsed) => {
            app_state.metrics.inc_ok();
            app_state.recorder.record_validated(
                source_link,
                ValidatedKind::Fp95,
                uav_id,
                frame,
                received_at,
            );
            // 回放注入的历史 0x80 回报不得结算实时上行事务，也不得向前端发装订回执
            if let ParsedSubFrame::Frame80(frame80) = &parsed
                && !app_state.replay_active()
            {
                response_coordinator.deliver(uav_id, frame80.injection_response);
                maybe_emit_pod_ack(uav_id, &frame80.injection_response);
            }
            if let ParsedSubFrame::Frame83(ref frame83) = parsed {
                log::trace!(
                    "[FP95] 收到0x83位置帧 - 飞机ID: {}, 经度: {:.7}°, 纬度: {:.7}°, 高度(绝对): {:.2}m, 气压高: {:.2}m, 相对高: {:.2}m",
                    uav_id,
                    frame83.longitude,
                    frame83.latitude,
                    frame83.altitude,
                    frame83.pressure_altitude,
                    frame83.relative_altitude
                );
                forward_to_servo_turntable(app_state, frame83);
            }
            app_state.merge_fp95(uav_id, parsed, received_at);
        }
        Err(_err) => {
            app_state.metrics.inc_parse_err();
        }
    }
}

/// 吊舱控制指令装订回执：主事件码 0x28（吊舱控制指令装订），
/// 子状态 0x01（吊舱控制指令装订已响应），见规范 5.3 节。
const POD_ACK_MAIN_EVENT: u8 = 0x28;
const POD_ACK_SUB_STATE: u8 = 0x01;

/// 检测 0x80 注入回报帧中的吊舱装订回执，通过 Tauri 事件
/// `pod-command-acked`（载荷为飞机 ID）通知前端显示装订确认状态。
fn maybe_emit_pod_ack(uav_id: u8, injection_response: &[u8; 16]) {
    if injection_response[0] != POD_ACK_MAIN_EVENT || injection_response[1] != POD_ACK_SUB_STATE {
        return;
    }
    let Some(app_handle) = crate::APP_HANDLE.get() else {
        return;
    };
    use tauri::Emitter;
    if let Err(error) = app_handle.emit("pod-command-acked", uav_id) {
        log::warn!("发送吊舱装订回执事件失败: {error}");
    } else {
        log::info!("[FP95] 吊舱控制指令装订已响应（0x28/0x01），飞机 {uav_id}");
    }
}

/// 将 FP95 0x83 位置帧中的空间三维坐标打包并异步单播转发给活动的伺服转台链路
fn forward_to_servo_turntable(
    app_state: &AppState,
    frame83: &crate::protocol::fp95::FP95Frame83,
) {
    // 回放安全围栏：回放会话存在时禁止向真实伺服转台链路转发数据
    if app_state.replay_active() {
        return;
    }

    let servo_transports: Vec<_> = app_state
        .active_links
        .iter()
        .filter(|entry| entry.value().protocol == ProtocolType::ServoTurntable)
        .map(|entry| entry.value().transport.clone())
        .collect();

    if servo_transports.is_empty() {
        return;
    }

    let payload = crate::protocol::servo_turntable::pack_servo_frame(
        frame83.longitude,
        frame83.latitude,
        frame83.altitude,
        frame83.pressure_altitude,
        frame83.relative_altitude,
    );

    // 同步投递到链路发送队列：按帧顺序发出，链路忙时丢弃旧帧，不再每帧起一个异步任务
    for transport in servo_transports {
        if let Err(e) = transport.try_send(&payload, comms_core::TxPriority::Periodic) {
            FORWARD_ERROR_LOG.warn(format_args!("伺服转台坐标转发失败: {e}"));
        }
    }
}

/// 高频转发失败日志节流：同类失败每 5s 最多记一条，避免链路异常时按帧刷屏
struct ThrottledLog {
    last_ms: std::sync::atomic::AtomicU64,
}

impl ThrottledLog {
    const INTERVAL_MS: u64 = 5_000;

    const fn new() -> Self {
        Self {
            last_ms: std::sync::atomic::AtomicU64::new(0),
        }
    }

    fn warn(&self, message: std::fmt::Arguments<'_>) {
        use std::sync::atomic::Ordering;
        let now_ms = crate::protocol::payload::unix_now_ms();
        let last = self.last_ms.load(Ordering::Relaxed);
        if now_ms.saturating_sub(last) < Self::INTERVAL_MS {
            return;
        }
        if self
            .last_ms
            .compare_exchange(last, now_ms, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            log::warn!("{message}");
        }
    }
}

static FORWARD_ERROR_LOG: ThrottledLog = ThrottledLog::new();
static PASSTHROUGH_ERROR_LOG: ThrottledLog = ThrottledLog::new();
static PASSTHROUGH_UPLINK_ERROR_LOG: ThrottledLog = ThrottledLog::new();

/// 将解包出的透传载荷有效数据直接转发给对应的外部透传链路（UDP 或串口）
fn forward_to_passthrough(app_state: &AppState, payload_id: u8, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    // 回放安全围栏：回放会话存在时禁止向外部真实设备发送
    if app_state.replay_active() {
        return;
    }

    let target_protocol = match payload_id {
        crate::protocol::payload::PAYLOAD_ID_ATMOSPHERE => ProtocolType::PassthroughC0,
        crate::protocol::payload::PAYLOAD_ID_FLARE => ProtocolType::PassthroughC1,
        crate::protocol::payload::PAYLOAD_ID_CLOUD_DROP => ProtocolType::PassthroughC2,
        _ => return,
    };

    let transports: Vec<_> = app_state
        .active_links
        .iter()
        .filter(|entry| entry.value().protocol == target_protocol)
        .map(|entry| entry.value().transport.clone())
        .collect();

    if transports.is_empty() {
        return;
    }

    for transport in transports {
        if let Err(e) = transport.try_send(data, comms_core::TxPriority::Periodic) {
            PASSTHROUGH_ERROR_LOG.warn(format_args!(
                "透传载荷 0x{payload_id:02X} 转发至外部链路失败: {e}"
            ));
        }
    }
}

/// 处理透传链路接收到的外部数据，自动封装为 0xAA 0x55 (0x0A) 上行透传帧并广播发送给飞机
fn process_passthrough_uplink(data: &[u8], payload_id: u8, app_state: &AppState) {
    if data.is_empty() {
        return;
    }
    // 回放安全围栏：回放进行中禁止上行发送
    if app_state.replay_active() {
        log::warn!("[Replay] 回放进行中，已拦截透传载荷 0x{:02X} 上行发送", payload_id);
        return;
    }

    let frame = crate::protocol::payload::pack_uplink_payload_frame(payload_id, data);

    // 同步投递：外部设备的透传数据按到达顺序进入各上行链路的控制指令队列
    if let Err(e) = crate::uplink::dispatcher::try_broadcast_raw_payload(
        app_state,
        &frame,
        comms_core::TxPriority::Control,
    ) {
        PASSTHROUGH_UPLINK_ERROR_LOG.warn(format_args!(
            "透传载荷 0x{payload_id:02X} 上行广播失败: {e}"
        ));
    }
}

fn accept_decision(decision: RxDecision, app_state: &AppState) -> bool {
    match decision {
        RxDecision::Accept { missing_before, .. } => {
            app_state.metrics.add_all_links_missing(missing_before);
            true
        }
        RxDecision::Duplicate { .. } => {
            app_state.metrics.inc_dedup();
            false
        }
        RxDecision::Stale => {
            app_state.metrics.inc_stale();
            false
        }
        RxDecision::Conflict => {
            app_state.metrics.inc_conflict();
            false
        }
        RxDecision::Buffering => {
            app_state.metrics.inc_recovery_buffered();
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_next_fp95_or_payload_header() {
        let buf = [0xFF, 0x00, 0xEB, 0x90, 0x01, 0xAA, 0x55];
        let found = find_next_fp95_or_payload_header(&buf);
        assert!(matches!(found, Some(MixedFp95Header::Fp95(2, 0xEB, 0x90))));

        let buf2 = [0xAA, 0x55, 0x0B, 0xC3];
        let found2 = find_next_fp95_or_payload_header(&buf2);
        assert!(matches!(found2, Some(MixedFp95Header::Payload(0))));

        let buf3 = [0x12, 0x34, 0x23, 0x23, 0x01];
        let found3 = find_next_fp95_or_payload_header(&buf3);
        assert!(matches!(found3, Some(MixedFp95Header::Fp95(2, 0x23, 0x23))));
    }

    #[test]
    fn test_extract_mixed_fp95_and_payload() {
        let mut buffer = BytesMut::new();
        let mut reassembler = crate::protocol::payload::PayloadStreamReassembler::new();
        let app_state = AppState::new();
        let mut arbiter = RxArbiter::new(RxArbiterConfig::default());
        let coordinator = FP95ResponseCoordinator::default();

        // 构造一包任管 0xC3 继电器读线圈反馈（协议示例：线圈 6 闭合）
        let relay_inner = [0x00, 0x01, 0x02, 0x20, 0x00, 0x9D, 0xFC];
        let payload_frame = crate::protocol::payload::pack_payload_frame(
            crate::protocol::payload::CODE_DOWNLINK,
            crate::protocol::payload::PAYLOAD_ID_RELAY,
            1,
            &relay_inner,
        );

        // 拼接：垃圾字节 + 载荷帧
        buffer.extend_from_slice(&[0x00, 0x11]);
        buffer.extend_from_slice(&payload_frame);

        extract_and_process_fp95_and_payload(
            &mut buffer,
            &mut reassembler,
            "test_link",
            Instant::now(),
            Arc::new(HashSet::new()),
            &mut arbiter,
            &app_state,
            &coordinator,
        );

        // 验证载荷成功解析并存入 app_state
        let agg = app_state.mission_payload_pool.get(&95);
        assert!(agg.is_some(), "应成功解析并创建 95 号机载荷状态");
        let payload_data = agg.unwrap();
        assert!(payload_data.relay.is_some());
        assert_eq!(payload_data.relay.unwrap().mask, 0x2000);
    }

    #[tokio::test]
    async fn test_passthrough_downlink_forward() {
        use std::any::Any;
        use std::sync::{Arc, Mutex};
        use comms_core::{CommsError, TransportLink, TxPriority};

        #[derive(Default, Clone)]
        struct MockTransport {
            sent: Arc<Mutex<Vec<Vec<u8>>>>,
        }
        #[async_trait::async_trait]
        impl TransportLink for MockTransport {
            fn name(&self) -> &str {
                "passthrough_c0"
            }
            fn link_type(&self) -> &str {
                "UDP"
            }
            async fn send(&self, payload: &[u8]) -> Result<usize, CommsError> {
                self.sent.lock().unwrap().push(payload.to_vec());
                Ok(payload.len())
            }
            fn try_send(&self, payload: &[u8], _priority: TxPriority) -> Result<(), CommsError> {
                self.sent.lock().unwrap().push(payload.to_vec());
                Ok(())
            }
            fn stop(&self) {}
            fn as_any(&self) -> &dyn Any {
                self
            }
        }

        let app_state = AppState::new();
        let mock_transport = Arc::new(MockTransport::default());
        app_state.active_links.insert(
            "passthrough_c0".to_string(),
            crate::state::ActiveLink {
                link_type: "UDP".to_string(),
                name: "passthrough_c0".to_string(),
                generation: 1,
                endpoint_info: "127.0.0.1:9100".to_string(),
                protocol: ProtocolType::PassthroughC0,
                transport: mock_transport.clone(),
                last_raw_rx: Arc::new(std::sync::Mutex::new(Instant::now())),
            },
        );

        let raw_c0_data = vec![0x12, 0x34, 0x56, 0x78];
        forward_to_passthrough(
            &app_state,
            crate::protocol::payload::PAYLOAD_ID_ATMOSPHERE,
            &raw_c0_data,
        );
        // 同步投递：调用返回时数据已进入链路发送队列，无需等待异步任务
        let sent = mock_transport.sent.lock().unwrap();
        assert_eq!(sent.len(), 1, "应成功转发一帧数据至 PassthroughC0 链路");
        assert_eq!(sent[0], raw_c0_data);
    }

    fn valid_fp95_frame(seq: u8, uav_id: u8) -> [u8; 32] {
        let mut frame = [0u8; 32];
        frame[0] = 0xEB;
        frame[1] = 0x90;
        frame[2] = seq;
        frame[3] = uav_id;
        frame[4] = 0x80;
        let crc = crate::protocol::fkd_crc::calculate_fkd_crc(&frame[2..30]);
        frame[30..32].copy_from_slice(&crc);
        frame
    }

    fn run_fp95_extract(buffer: &mut BytesMut, app_state: &AppState) {
        let mut reassembler = crate::protocol::payload::PayloadStreamReassembler::new();
        let mut arbiter = RxArbiter::new(RxArbiterConfig::default());
        let coordinator = FP95ResponseCoordinator::default();
        extract_and_process_fp95_and_payload(
            buffer,
            &mut reassembler,
            "test_link",
            Instant::now(),
            Arc::new(HashSet::new()),
            &mut arbiter,
            app_state,
            &coordinator,
        );
    }

    #[test]
    fn false_fp95_header_does_not_swallow_following_real_frame() {
        let app_state = AppState::new();
        let mut buffer = BytesMut::new();
        // 伪帧头 EB 90 + 10 字节垃圾，紧跟一帧真实 FP95 帧
        buffer.extend_from_slice(&[0xEB, 0x90]);
        buffer.extend_from_slice(&[0u8; 10]);
        buffer.extend_from_slice(&valid_fp95_frame(1, 9));

        run_fp95_extract(&mut buffer, &app_state);

        let metrics = app_state.metrics.snapshot();
        assert_eq!(metrics.frames_crc_fail, 1, "伪帧头应只计一次 CRC 失败");
        assert_eq!(
            metrics.frames_ok + metrics.parse_err,
            1,
            "伪帧头后的真实帧必须被切出并解析"
        );
    }

    #[test]
    fn implausible_payload_header_does_not_stall_fp95_stream() {
        let app_state = AppState::new();
        let mut buffer = BytesMut::new();
        // 伪 AA55 帧头声明 0xFFFF 超长数据，旧逻辑会一直等待直至缓冲溢出
        buffer.extend_from_slice(&[0xAA, 0x55, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00]);
        buffer.extend_from_slice(&valid_fp95_frame(1, 9));

        run_fp95_extract(&mut buffer, &app_state);

        let metrics = app_state.metrics.snapshot();
        assert_eq!(metrics.frames_ok + metrics.parse_err, 1);
        assert!(buffer.len() <= 1, "处理后不应残留等待中的伪载荷帧");
    }

    #[test]
    fn plausible_payload_header_checks_direction_id_and_length() {
        let header = |direction: u8, id: u8, len: u16| {
            let [lo, hi] = len.to_le_bytes();
            [0xAA, 0x55, direction, id, lo, hi]
        };
        assert!(plausible_payload_header(&header(0x0B, 0xC6, 14)));
        assert!(plausible_payload_header(&header(0x0A, 0xC0, 0)));
        assert!(!plausible_payload_header(&header(0x0C, 0xC3, 1)));
        assert!(!plausible_payload_header(&header(0x0B, 0xC7, 1)));
        assert!(!plausible_payload_header(&header(0x0B, 0xC3, 4089)));
    }

    #[test]
    fn uav_info_datagram_misalignment_does_not_persist() {
        let app_state = AppState::new();
        let mut router = RouterCore::new(RxArbiterConfig::default());
        let raw = |data: Vec<u8>| RawData {
            source_link: "uav_udp".to_string(),
            link_generation: 1,
            data,
            received_at: Instant::now(),
        };
        let mut frame = vec![0u8; 75];
        frame[1..5].copy_from_slice(&7u32.to_le_bytes());
        let coordinator = FP95ResponseCoordinator::default();

        // 先来一个残缺数据报（74 字节），再来一个完整数据报
        router.process_raw(
            &raw(vec![0xFF; 74]),
            ProtocolType::UAVInfo,
            true,
            Arc::new(HashSet::new()),
            &app_state,
            &coordinator,
        );
        router.process_raw(
            &raw(frame),
            ProtocolType::UAVInfo,
            true,
            Arc::new(HashSet::new()),
            &app_state,
            &coordinator,
        );

        assert!(app_state.uav_pool.contains_key(&7), "完整数据报应正常解析");
        assert_eq!(app_state.uav_pool.len(), 1, "残缺数据报不得造成错位");
    }

    #[test]
    fn uav_info_rejects_out_of_range_uav_id() {
        let app_state = AppState::new();
        let mut buffer = BytesMut::new();
        let mut frame = vec![0u8; 75];
        frame[1..5].copy_from_slice(&300u32.to_le_bytes());
        buffer.extend_from_slice(&frame);

        extract_and_process_uav_info(&mut buffer, "UAVInfo-UDP", Instant::now(), &app_state);

        assert!(app_state.uav_pool.is_empty(), "机号超出 0-255 的帧应被丢弃");
    }

    #[test]
    fn test_process_payload_frame_deice_c6() {
        use crate::protocol::payload::{pack_payload_frame, CODE_DOWNLINK, PAYLOAD_ID_DEICE, PayloadStreamReassembler};

        let app_state = AppState::new();
        let mut reassembler = PayloadStreamReassembler::new();

        // 构造合法 14 字节防除冰控制器数据
        let mut deice_data = [
            0xEB, 0x90, 0xD0, 0x07, 0xD0, 0x07, 0x02, 0x00, 0x00, 0x32, 0x8C, 0x18, 0x01, 0x00,
        ];
        let sum: u32 = deice_data[..13].iter().map(|&b| b as u32).sum();
        deice_data[13] = ((256 - (sum % 256)) % 256) as u8;

        // 打包为 AA55 外层帧
        let frame = pack_payload_frame(CODE_DOWNLINK, PAYLOAD_ID_DEICE, 1, &deice_data);
        assert_eq!(&frame[0..2], &[0xAA, 0x55]);
        assert_eq!(frame[3], 0xC6);

        // 处理该帧（验证正常解包并合入状态）
        process_payload_frame(
            &frame,
            &mut reassembler,
            "FP95-UDP",
            &app_state,
            Instant::now(),
        );

        let agg = app_state.mission_payload_pool.get(&95);
        assert!(agg.is_some(), "应成功存入 95 号机载荷状态");
        assert!(agg.unwrap().deice.is_some(), "应成功解析防除冰状态");

        // 构造损坏校验和的错误帧测试容错分支
        let mut corrupt_frame = frame.clone();
        let last_idx = corrupt_frame.len() - 1;
        corrupt_frame[last_idx] ^= 0xFF;
        process_payload_frame(
            &corrupt_frame,
            &mut reassembler,
            "FP95-UDP",
            &app_state,
            Instant::now(),
        );
    }
    #[tokio::test]
    async fn validated_recording_merges_redundant_links_by_aircraft() {
        let app_state = AppState::new();
        let dir = std::env::temp_dir().join(format!(
            "gcs_router_validated_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        app_state.recorder.init_dir(dir.clone());
        let mut router = RouterCore::new(RxArbiterConfig::default());
        let coordinator = FP95ResponseCoordinator::default();
        let links: ActiveLinkSet = Arc::new(["UDP-A".to_string(), "UDP-B".to_string()].into());
        let raw = |link: &str, data: Vec<u8>| RawData {
            source_link: link.to_string(),
            link_generation: 1,
            data,
            received_at: Instant::now(),
        };

        let fp95 = valid_fp95_frame(1, 7).to_vec();
        let payload = crate::protocol::payload::pack_payload_frame(
            crate::protocol::payload::CODE_DOWNLINK,
            crate::protocol::payload::PAYLOAD_ID_ATMOSPHERE,
            3,
            &[0x01, 0x02, 0x03],
        );
        // 同一 FP95 帧经两条冗余链路到达：仲裁后只记一次
        for (link, data) in [
            ("UDP-A", fp95.clone()),
            ("UDP-B", fp95.clone()),
            // 载荷帧先经 B 到达（B 上的 FP95 虽是重复帧，也已登记 7 号机），再经 A 重复到达
            ("UDP-B", payload.clone()),
            ("UDP-A", payload.clone()),
        ] {
            router.process_raw(
                &raw(link, data),
                ProtocolType::FP95,
                true,
                links.clone(),
                &app_state,
                &coordinator,
            );
        }

        assert_eq!(app_state.recorder.validated_sessions_count(), 1);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let summaries = app_state.recorder.stop_all_validated().await;
        assert_eq!(summaries.len(), 1);
        assert!(
            summaries[0].link_name.starts_with("UAV007"),
            "载荷帧应归属 7 号机"
        );

        let mut file = std::fs::File::open(&summaries[0].file).unwrap();
        crate::recorder::format::read_header(&mut file).unwrap();
        let mut reader = crate::recorder::format::RecordReader::new(file);
        let mut records = Vec::new();
        while let Some(record) = reader.next_record().unwrap() {
            records.push(record);
        }
        assert_eq!(records.len(), 2, "冗余链路的重复帧不应重复记录");
        assert_eq!(records[0].payload, fp95);
        assert_eq!(records[1].payload, payload);
        assert!(records
            .iter()
            .all(|r| r.link_id == ValidatedKind::Fp95.link_id()));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
