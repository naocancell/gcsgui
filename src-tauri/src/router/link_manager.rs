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
    link_buffers: HashMap<String, BytesMut>,
}

impl RouterCore {
    fn new(config: RxArbiterConfig) -> Self {
        Self {
            arbiter: RxArbiter::new(config),
            link_buffers: HashMap::new(),
        }
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
            .or_default();
        buffer.extend_from_slice(&raw.data);

        match protocol {
            ProtocolType::FP981C => extract_and_process_fp981c(
                buffer,
                &raw.source_link,
                raw.received_at,
                active_protocol_links,
                &mut self.arbiter,
                app_state,
            ),
            ProtocolType::UAVInfo => {
                extract_and_process_uav_info(buffer, raw.received_at, app_state)
            }
            ProtocolType::FP95 => extract_and_process_fp95(
                buffer,
                &raw.source_link,
                raw.received_at,
                active_protocol_links,
                &mut self.arbiter,
                app_state,
                response_coordinator,
            ),
        }

        if buffer.len() > 4096 {
            log::warn!("链路 {} 缓冲区溢出，执行清空", raw.source_link);
            buffer.clear();
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
                let protocol = {
                    let Some(link) = app_state.active_links.get(&raw.source_link) else {
                        continue;
                    };
                    let mut lock = link
                        .last_raw_rx
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    *lock = raw.received_at;
                    link.protocol
                };
                let active = active_links_for_protocol(&app_state, protocol);
                router.process_raw(raw, protocol, active, &app_state, &response_coordinator);
            }
            _ = maintenance.tick() => {
                let active = active_links_by_protocol(&app_state);
                app_state.replace_rx_health(router.maintenance(Instant::now(), &active));
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
                frame_id,
            },
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

// ==================== FP95 切帧 + 解析 ====================

/// 从字节流中寻找 FP95 包头 0x23 0x23
fn find_fp95_header(buffer: &[u8]) -> Option<usize> {
    for i in 0..buffer.len().saturating_sub(1) {
        if buffer[i] == 0x23 && buffer[i + 1] == 0x23 {
            return Some(i);
        }
    }
    None
}

fn extract_and_process_fp95(
    buffer: &mut BytesMut,
    source_link: &str,
    received_at: Instant,
    active_links: HashSet<String>,
    arbiter: &mut RxArbiter,
    app_state: &AppState,
    response_coordinator: &FP95ResponseCoordinator,
) {
    while let Some(header_idx) = find_fp95_header(buffer) {
        if header_idx > 0 {
            let _ = buffer.split_to(header_idx);
        }
        if buffer.len() >= 32 {
            let frame = buffer.split_to(32);
            process_fp95_frame(
                frame.as_ref(),
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

    if find_fp95_header(buffer).is_none() && buffer.len() > 1 {
        let drop_len = buffer.len() - 1;
        let _ = buffer.split_to(drop_len);
    }
}

fn process_fp95_frame(
    frame: &[u8],
    source_link: &str,
    received_at: Instant,
    active_links: HashSet<String>,
    arbiter: &mut RxArbiter,
    app_state: &AppState,
    response_coordinator: &FP95ResponseCoordinator,
) {
    if !crate::protocol::fkd_crc::verify_fkd_crc(frame, 0x23, 0x23) {
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
                frame_id,
            },
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
            }
            app_state.merge_fp95(uav_id, parsed, received_at);
        }
        Err(_err) => {
            app_state.metrics.inc_parse_err();
        }
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
