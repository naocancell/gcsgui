use bytes::BytesMut;
use std::collections::{HashMap, HashSet};

use crate::comms::{ProtocolType, RawData};
use crate::protocol::uav_info::UAVInfo;
use crate::router::rx_arbiter::{
    FrameObservation, RxArbiter, RxArbiterConfig, RxDecision, RxHealthSnapshot, StreamKey,
};
use crate::state::AppState;
use crate::uplink::FP95ResponseCoordinator;

use std::time::{Duration, Instant};

struct RouterCore {
    arbiter: RxArbiter,
    link_buffers: HashMap<String, LinkBuffer>,
    link_generations: HashMap<String, u64>,
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
        }
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
        raw: RawData,
        protocol: ProtocolType,
        active_protocol_links: HashSet<String>,
        app_state: &AppState,
        response_coordinator: &FP95ResponseCoordinator,
    ) {
        let buffer = self
            .link_buffers
            .entry(raw.source_link.clone())
            .or_insert_with(|| LinkBuffer::new(raw.link_generation, protocol));
        buffer.reset_if_source_changed(raw.link_generation, protocol);
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
                extract_and_process_uav_info(&mut buffer.data, raw.received_at, app_state)
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

    loop {
        tokio::select! {
            raw = rx.recv() => {
                let Some(raw) = raw else { break };
                router.sync_link_generations(&active_link_generations(&app_state));
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
                let active = active_links_for_protocol(&app_state, protocol);
                // 记录 tap：非阻塞，按链路独立记录
                app_state
                    .recorder
                    .try_record(&raw, protocol, Some(&link_type));
                router.process_raw(raw, protocol, active, &app_state, &response_coordinator);
            }
            _ = maintenance.tick() => {
                router.sync_link_generations(&active_link_generations(&app_state));
                let active = active_links_by_protocol(&app_state);
                app_state.replace_rx_health(router.maintenance(Instant::now(), &active));
                // 自动同步并清理已停用链路的录制会话
                app_state.recorder.sync_active_links(&app_state.active_links);
            }
        }
    }
}

fn active_links_for_protocol(app_state: &AppState, protocol: ProtocolType) -> HashSet<String> {
    app_state
        .active_links
        .iter()
        .filter(|link| link.protocol == protocol)
        .map(|link| link.key().clone())
        .collect()
}

fn active_links_by_protocol(app_state: &AppState) -> HashMap<ProtocolType, HashSet<String>> {
    let mut result: HashMap<ProtocolType, HashSet<String>> = HashMap::new();
    for link in app_state.active_links.iter() {
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
    active_links: HashSet<String>,
    arbiter: &mut RxArbiter,
    app_state: &AppState,
) {
    while let Some(header_idx) = find_fp981c_header(buffer) {
        if header_idx > 0 {
            let _ = buffer.split_to(header_idx); // O(1) 零拷贝丢弃头部垃圾
        }
        if buffer.len() >= 32 {
            let frame = buffer.split_to(32); // O(1) 零拷贝切出整帧
            process_fp981c_frame(
                &frame,
                source_link,
                received_at,
                active_links.clone(),
                arbiter,
                app_state,
            );
        } else {
            break;
        }
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
    active_links: HashSet<String>,
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

fn extract_and_process_uav_info(buffer: &mut BytesMut, received_at: Instant, app_state: &AppState) {
    while buffer.len() >= 75 {
        let frame = buffer.split_to(75);

        match UAVInfo::from_bytes(&frame) {
            Ok(info) => {
                app_state.metrics.inc_ok();
                let uav_id = info.uav_id as u8;
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

fn extract_and_process_fp95_and_payload(
    buffer: &mut BytesMut,
    reassembler: &mut crate::protocol::payload::PayloadStreamReassembler,
    source_link: &str,
    received_at: Instant,
    active_links: HashSet<String>,
    arbiter: &mut RxArbiter,
    app_state: &AppState,
    response_coordinator: &FP95ResponseCoordinator,
) {
    while let Some(header) = find_next_fp95_or_payload_header(buffer) {
        match header {
            MixedFp95Header::Fp95(header_idx, h1, h2) => {
                if header_idx > 0 {
                    let _ = buffer.split_to(header_idx);
                }
                if buffer.len() >= 32 {
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
                } else {
                    break;
                }
            }
            MixedFp95Header::Payload(header_idx) => {
                if header_idx > 0 {
                    let _ = buffer.split_to(header_idx);
                }
                if buffer.len() < 8 {
                    break; // 长度不足以读取头部和长度字段
                }
                let data_len = u16::from_le_bytes([buffer[4], buffer[5]]) as usize;
                let total_len = 8 + data_len;
                if buffer.len() >= total_len {
                    let frame = buffer.split_to(total_len);
                    process_payload_frame(
                        frame.as_ref(),
                        reassembler,
                        app_state,
                        received_at,
                    );
                } else {
                    break;
                }
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
    app_state: &AppState,
    received_at: Instant,
) {
    match crate::protocol::payload::unpack_payload_frame(frame) {
        Ok(outer) => {
            app_state.metrics.inc_ok();
            let uav_id = 95; // 默认机号
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let mut agg = app_state
                .mission_payload_pool
                .entry(uav_id)
                .or_insert_with(|| crate::protocol::payload::MissionPayloadAggregate::new(uav_id));

            reassembler.feed_payload(outer.payload_id, &outer.data, &mut agg, now_ms);
            if outer.payload_id == crate::protocol::payload::PAYLOAD_ID_DEICE {
                if let Some(deice) = &agg.deice {
                    app_state.merge_fp95(
                        uav_id,
                        crate::protocol::fp95::ParsedSubFrame::Frame94(
                            crate::protocol::fp95::FP95Frame94::Sub2(deice.clone()),
                        ),
                        received_at,
                    );
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
    active_links: HashSet<String>,
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
            if let ParsedSubFrame::Frame80(frame80) = &parsed {
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

    for transport in servo_transports {
        tokio::spawn(async move {
            if let Err(e) = transport.send(&payload).await {
                log::warn!("伺服转台 UDP 坐标转发失败: {}", e);
            }
        });
    }
}

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

    let payload = data.to_vec();
    for transport in transports {
        let p = payload.clone();
        tokio::spawn(async move {
            if let Err(e) = transport.send(&p).await {
                log::warn!("透传载荷 0x{:02X} 转发至外部链路失败: {}", payload_id, e);
            }
        });
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

    static SEQ_C0: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
    static SEQ_C1: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
    static SEQ_C2: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

    let seq = match payload_id {
        crate::protocol::payload::PAYLOAD_ID_ATMOSPHERE => {
            SEQ_C0.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        }
        crate::protocol::payload::PAYLOAD_ID_FLARE => {
            SEQ_C1.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        }
        crate::protocol::payload::PAYLOAD_ID_CLOUD_DROP => {
            SEQ_C2.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        }
        _ => 0,
    };

    let frame = crate::protocol::payload::pack_payload_frame(
        crate::protocol::payload::CODE_UPLINK,
        payload_id,
        seq,
        data,
    );

    let state_clone = app_state.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::uplink::dispatcher::broadcast_raw_payload(&state_clone, &frame).await {
            log::warn!("透传载荷 0x{:02X} 上行广播失败: {}", payload_id, e);
        }
    });
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

        // 构造一包任管 0xC3 继电器响应帧（新版协议低字节在前）
        let relay_inner = [0x01, 0x01, 0x02, 0xF0, 0x0F, 0xBD, 0xF8];
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
            HashSet::new(),
            &mut arbiter,
            &app_state,
            &coordinator,
        );

        // 验证载荷成功解析并存入 app_state
        let agg = app_state.mission_payload_pool.get(&95);
        assert!(agg.is_some(), "应成功解析并创建 95 号机载荷状态");
        let payload_data = agg.unwrap();
        assert!(payload_data.relay.is_some());
        assert_eq!(payload_data.relay.unwrap().mask, 0xF00F);
    }

    #[tokio::test]
    async fn test_passthrough_downlink_forward() {
        use std::any::Any;
        use std::sync::Arc;
        use tokio::sync::Mutex;
        use comms_core::{CommsError, TransportLink};

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
                self.sent.lock().await.push(payload.to_vec());
                Ok(payload.len())
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
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let sent = mock_transport.sent.lock().await;
        assert_eq!(sent.len(), 1, "应成功转发一帧数据至 PassthroughC0 链路");
        assert_eq!(sent[0], raw_c0_data);
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
        process_payload_frame(&frame, &mut reassembler, &app_state, Instant::now());

        let agg = app_state.mission_payload_pool.get(&95);
        assert!(agg.is_some(), "应成功存入 95 号机载荷状态");
        assert!(agg.unwrap().deice.is_some(), "应成功解析防除冰状态");

        // 构造损坏校验和的错误帧测试容错分支
        let mut corrupt_frame = frame.clone();
        let last_idx = corrupt_frame.len() - 1;
        corrupt_frame[last_idx] ^= 0xFF;
        process_payload_frame(&corrupt_frame, &mut reassembler, &app_state, Instant::now());
    }
}
