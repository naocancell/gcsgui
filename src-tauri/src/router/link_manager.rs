use bytes::BytesMut;
use std::collections::HashMap;

use crate::comms::{ProtocolType, RawData};
use crate::protocol::uav_info::UAVInfo;
use crate::state::AppState;

use moka::sync::Cache;
use std::time::{Duration, Instant};

/// 从字节流中寻找 FP981C 包头 0xEB 0x90
fn find_fp981c_header(buffer: &[u8]) -> Option<usize> {
    for i in 0..buffer.len().saturating_sub(1) {
        if buffer[i] == 0xEB && buffer[i + 1] == 0x90 {
            return Some(i);
        }
    }
    None
}

pub async fn start_router(mut rx: tokio::sync::mpsc::Receiver<RawData>, app_state: AppState) {
    // 去重缓存
    let dedup_cache: Cache<String, ()> = Cache::builder()
        .time_to_live(Duration::from_millis(250))
        .build();

    // 每条链路的字节累积缓冲区（串口流式数据需要拼接后再切帧）
    let mut link_buffers: HashMap<String, BytesMut> = HashMap::new();

    while let Some(raw) = rx.recv().await {
        // 从 active_links 查找该链路绑定的协议类型
        let protocol = {
            if let Some(link) = app_state.active_links.get(&raw.source_link) {
                // 顺便更新心跳
                let mut lock = link
                    .last_heartbeat
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                *lock = raw.received_at;
                link.protocol
            } else {
                continue;
            }
        };

        // 获取该链路的累积缓冲区并追加新数据
        let buffer = link_buffers
            .entry(raw.source_link.clone())
            .or_insert_with(BytesMut::new);
        buffer.extend_from_slice(&raw.data);

        // 根据协议类型执行切帧 + 解析
        match protocol {
            ProtocolType::FP981C => {
                extract_and_process_fp981c(buffer, &dedup_cache, &app_state);
            }
            ProtocolType::UAVInfo => {
                extract_and_process_uav_info(buffer, &app_state);
            }
            ProtocolType::FP95 => {
                extract_and_process_fp95(buffer, &dedup_cache, &app_state);
            }
        }

        // 防止缓冲区无限膨胀
        if buffer.len() > 4096 {
            log::warn!("链路 {} 缓冲区溢出，执行清空", raw.source_link);
            buffer.clear();
            app_state.metrics.inc_overflow();
        }
    }
}

// ==================== FP981C 切帧 + 解析 ====================

fn extract_and_process_fp981c(
    buffer: &mut BytesMut,
    dedup_cache: &Cache<String, ()>,
    app_state: &AppState,
) {
    while let Some(header_idx) = find_fp981c_header(buffer) {
        if header_idx > 0 {
            let _ = buffer.split_to(header_idx); // O(1) 零拷贝丢弃头部垃圾
        }
        if buffer.len() >= 32 {
            let frame = buffer.split_to(32); // O(1) 零拷贝切出整帧
            process_fp981c_frame(&frame, dedup_cache, app_state);
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

fn process_fp981c_frame(frame: &[u8], dedup_cache: &Cache<String, ()>, app_state: &AppState) {
    if !crate::protocol::fkd_crc::verify_fkd_crc(frame, 0xEB, 0x90) {
        app_state.metrics.inc_crc_fail();
        return;
    }

    let frame_id = frame[2];
    let seq_num = frame[3];
    let uav_id = frame[4];

    let dedup_key = format!("981c-{}-{}-{}", uav_id, frame_id, seq_num);
    if dedup_cache.contains_key(&dedup_key) {
        app_state.metrics.inc_dedup();
        return;
    }
    dedup_cache.insert(dedup_key, ());

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

            match parsed {
                ParsedSubFrame::C0(c0) => agg.c0 = Some(c0),
                ParsedSubFrame::C1(c1) => agg.c1 = Some(c1),
                ParsedSubFrame::C2(c2) => agg.c2 = Some(c2),
                ParsedSubFrame::C3(c3) => {
                    match &c3.sub_frames {
                        crate::protocol::fp981c::C3SubFrames::Sub0(s) => {
                            agg.c3_sub0 = Some(s.clone())
                        }
                        crate::protocol::fp981c::C3SubFrames::Sub1(s) => {
                            agg.c3_sub1 = Some(s.clone())
                        }
                        crate::protocol::fp981c::C3SubFrames::Sub2(s) => {
                            agg.c3_sub2 = Some(s.clone())
                        }
                        crate::protocol::fp981c::C3SubFrames::Sub3(s) => {
                            agg.c3_sub3 = Some(s.clone())
                        }
                    }
                    agg.c3 = Some(c3);
                }
                ParsedSubFrame::C5(c5) => agg.c5 = Some(c5),
            }
            app_state.fp981c_seen.insert(uav_id, Instant::now());
        }
        Err(_) => {
            app_state.metrics.inc_parse_err();
        }
    }
}

// ==================== UAVInfo 切帧 + 解析 ====================

fn extract_and_process_uav_info(buffer: &mut BytesMut, app_state: &AppState) {
    while buffer.len() >= 75 {
        let frame = buffer.split_to(75);

        match UAVInfo::from_bytes(&frame) {
            Ok(info) => {
                app_state.metrics.inc_ok();
                let uav_id = info.uav_id as u8;
                app_state.uav_pool.insert(uav_id, info);
                app_state.uav_seen.insert(uav_id, Instant::now());
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
    dedup_cache: &Cache<String, ()>,
    app_state: &AppState,
) {
    while let Some(header_idx) = find_fp95_header(buffer) {
        if header_idx > 0 {
            let _ = buffer.split_to(header_idx);
        }
        if buffer.len() >= 32 {
            let frame = buffer.split_to(32);
            process_fp95_frame(&frame, dedup_cache, app_state);
        } else {
            break;
        }
    }

    if find_fp95_header(buffer).is_none() && buffer.len() > 1 {
        let drop_len = buffer.len() - 1;
        let _ = buffer.split_to(drop_len);
    }
}

fn process_fp95_frame(frame: &[u8], dedup_cache: &Cache<String, ()>, app_state: &AppState) {
    if !crate::protocol::fkd_crc::verify_fkd_crc(frame, 0x23, 0x23) {
        app_state.metrics.inc_crc_fail();
        return;
    }

    let seq_num = frame[2];
    let uav_id = frame[3];
    let frame_id = frame[4];

    let dedup_key = format!("95-{}-{}-{}", uav_id, frame_id, seq_num);
    if dedup_cache.contains_key(&dedup_key) {
        app_state.metrics.inc_dedup();
        return;
    }
    dedup_cache.insert(dedup_key, ());

    let subframe_payload = &frame[6..];

    use crate::protocol::fp95::ParsedSubFrame;

    match ParsedSubFrame::from_bytes(frame_id, subframe_payload) {
        Ok(parsed) => match parsed {
            ParsedSubFrame::Frame94Sub1(frame_94_sub1) => {
                if frame_94_sub1.raw_s_address == [0, 0, 0] {
                    return;
                }

                app_state.metrics.inc_ok();
                let s_address = frame_94_sub1.raw_s_address;
                app_state.fp95_pool.insert(s_address, frame_94_sub1);
                app_state.fp95_seen.insert(s_address, Instant::now());
            }
        },
        Err(_err) => {
            app_state.metrics.inc_parse_err();
        }
    }
}
