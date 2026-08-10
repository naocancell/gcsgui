use super::RxArbiter;
use crate::comms::ProtocolType;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkHealthState {
    Healthy,
    Suspect,
    Down,
    Recovering,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AircraftConnectivity {
    Online,
    Degraded,
    Recovering,
    Offline,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkHealthSnapshot {
    pub link_name: String,
    pub protocol: ProtocolType,
    pub uav_id: u8,
    pub state: LinkHealthState,
    pub valid_age_ms: u64,
    pub fresh_age_ms: u64,
    pub relative_delay_ms: Option<u64>,
    pub delay_ewma_ms: Option<f64>,
    pub jitter_ewma_ms: Option<f64>,
    pub delivered_frames: u64,
    pub first_arrival_wins: u64,
    pub duplicate_frames: u64,
    pub stale_frames: u64,
    pub conflict_frames: u64,
    pub missed_frames: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AircraftHealthSnapshot {
    pub protocol: ProtocolType,
    pub uav_id: u8,
    pub state: AircraftConnectivity,
    pub fresh_age_ms: u64,
    pub all_links_missing: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RxHealthSnapshot {
    pub links: Vec<LinkHealthSnapshot>,
    pub aircraft: Vec<AircraftHealthSnapshot>,
}

impl RxArbiter {
    pub fn maintenance(
        &mut self,
        now: Instant,
        active_links: &HashMap<ProtocolType, HashSet<String>>,
    ) -> RxHealthSnapshot {
        self.close_expired_observations(now);

        let aircraft_keys: HashSet<_> = self
            .streams
            .keys()
            .map(|stream| (stream.protocol, stream.uav_id))
            .collect();
        for (protocol, uav_id) in &aircraft_keys {
            if let Some(names) = active_links.get(protocol) {
                for name in names {
                    self.links
                        .entry(super::LinkAircraftKey {
                            source_link: name.clone(),
                            protocol: *protocol,
                            uav_id: *uav_id,
                        })
                        .or_insert_with(|| super::LinkAircraftRuntime::new(now));
                }
            }
        }

        let mut links = Vec::new();
        for (key, runtime) in &self.links {
            if !active_links
                .get(&key.protocol)
                .is_some_and(|names| names.contains(&key.source_link))
            {
                continue;
            }
            let valid_age = now.saturating_duration_since(
                runtime.last_valid_rx.unwrap_or(runtime.first_expected_at),
            );
            let fresh_age = now.saturating_duration_since(
                runtime.last_fresh_rx.unwrap_or(runtime.first_expected_at),
            );
            let recovering = self.streams.iter().any(|(stream, stream_runtime)| {
                stream.protocol == key.protocol
                    && stream.uav_id == key.uav_id
                    && stream_runtime
                        .recovery
                        .as_ref()
                        .is_some_and(|recovery| recovery.source_links.contains(&key.source_link))
            });
            let state = if runtime.last_fresh_rx.is_none() {
                LinkHealthState::Down
            } else if recovering {
                LinkHealthState::Recovering
            } else if runtime.last_fresh_rx.is_some() && fresh_age <= self.config.suspect_after {
                LinkHealthState::Healthy
            } else if fresh_age <= self.config.down_after {
                LinkHealthState::Suspect
            } else {
                LinkHealthState::Down
            };
            links.push(LinkHealthSnapshot {
                link_name: key.source_link.clone(),
                protocol: key.protocol,
                uav_id: key.uav_id,
                state,
                valid_age_ms: duration_millis(valid_age),
                fresh_age_ms: duration_millis(fresh_age),
                relative_delay_ms: runtime.last_relative_delay.map(duration_millis),
                delay_ewma_ms: runtime.delay_ewma_ms,
                jitter_ewma_ms: runtime.jitter_ewma_ms,
                delivered_frames: runtime.delivered_frames,
                first_arrival_wins: runtime.first_arrival_wins,
                duplicate_frames: runtime.duplicate_frames,
                stale_frames: runtime.stale_frames,
                conflict_frames: runtime.conflict_frames,
                missed_frames: runtime.missed_frames,
            });
        }
        links.sort_by_key(|link| {
            (
                protocol_rank(link.protocol),
                link.uav_id,
                link.link_name.clone(),
            )
        });

        let mut aircraft = Vec::new();
        for (protocol, uav_id) in aircraft_keys {
            let states: Vec<_> = links
                .iter()
                .filter(|link| link.protocol == protocol && link.uav_id == uav_id)
                .map(|link| link.state)
                .collect();
            let recovering = self.streams.iter().any(|(stream, runtime)| {
                stream.protocol == protocol && stream.uav_id == uav_id && runtime.recovery.is_some()
            });
            let state = if recovering {
                AircraftConnectivity::Recovering
            } else if states.is_empty()
                || states.iter().all(|state| *state == LinkHealthState::Down)
            {
                AircraftConnectivity::Offline
            } else if !states.is_empty()
                && states
                    .iter()
                    .all(|state| *state == LinkHealthState::Healthy)
            {
                AircraftConnectivity::Online
            } else {
                AircraftConnectivity::Degraded
            };
            let last_accepted_at = self
                .streams
                .iter()
                .filter(|(stream, _)| stream.protocol == protocol && stream.uav_id == uav_id)
                .map(|(_, runtime)| runtime.last_accepted_at)
                .max()
                .expect("aircraft key comes from streams");
            let all_links_missing = self
                .all_links_missing
                .iter()
                .filter(|(stream, _)| stream.protocol == protocol && stream.uav_id == uav_id)
                .map(|(_, missing)| *missing)
                .sum();
            aircraft.push(AircraftHealthSnapshot {
                protocol,
                uav_id,
                state,
                fresh_age_ms: duration_millis(now.saturating_duration_since(last_accepted_at)),
                all_links_missing,
            });
        }
        aircraft.sort_by_key(|item| (protocol_rank(item.protocol), item.uav_id));

        RxHealthSnapshot { links, aircraft }
    }
}

fn duration_millis(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

fn protocol_rank(protocol: ProtocolType) -> u8 {
    match protocol {
        ProtocolType::FP95 => 0,
        ProtocolType::FP981C => 1,
        ProtocolType::UAVInfo => 2,
    }
}
