use crate::comms::ProtocolType;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

mod health;

pub use health::{
    AircraftConnectivity, AircraftHealthSnapshot, LinkHealthSnapshot, LinkHealthState,
    RxHealthSnapshot,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
/// One protocol-specific aircraft sequence stream shared by all subframes.
pub struct StreamKey {
    pub protocol: ProtocolType,
    pub uav_id: u8,
}

#[derive(Debug, Clone)]
pub struct FrameObservation {
    pub source_link: String,
    pub stream: StreamKey,
    pub frame_id: u8,
    pub raw_sequence: u8,
    pub frame: [u8; 32],
    pub received_at: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RxDecision {
    Accept {
        extended_sequence: u64,
        missing_before: u8,
    },
    Duplicate {
        winner_link: String,
        relative_delay: Duration,
    },
    Stale,
    Conflict,
    Buffering,
}

#[derive(Debug, Clone)]
pub struct RxArbiterConfig {
    pub observation_window: Duration,
    pub suspect_after: Duration,
    pub down_after: Duration,
    pub sequence_resync_after: Duration,
    pub recovery_confirmations: u8,
}

impl Default for RxArbiterConfig {
    fn default() -> Self {
        Self {
            observation_window: Duration::from_secs(5),
            suspect_after: Duration::from_secs(2),
            down_after: Duration::from_secs(10),
            sequence_resync_after: Duration::from_secs(10),
            recovery_confirmations: 2,
        }
    }
}

#[derive(Debug)]
struct StreamRuntime {
    last_raw_sequence: u8,
    last_extended_sequence: u64,
    last_accepted_at: Instant,
    recovery: Option<RecoveryRuntime>,
}

#[derive(Debug, Clone)]
struct RecoveryRuntime {
    last_raw_sequence: u8,
    confirmations: u8,
    source_links: HashSet<String>,
}

#[derive(Debug)]
struct ArrivalRecord {
    frame: [u8; 32],
    first_link: String,
    first_received_at: Instant,
    seen_links: HashSet<String>,
    #[allow(dead_code)]
    expected_links: HashSet<String>,
    #[allow(dead_code)]
    expires_at: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct LinkAircraftKey {
    source_link: String,
    protocol: ProtocolType,
    uav_id: u8,
}

#[derive(Debug)]
struct LinkAircraftRuntime {
    first_expected_at: Instant,
    last_valid_rx: Option<Instant>,
    last_fresh_rx: Option<Instant>,
    last_relative_delay: Option<Duration>,
    delay_ewma_ms: Option<f64>,
    jitter_ewma_ms: Option<f64>,
    delivered_frames: u64,
    first_arrival_wins: u64,
    duplicate_frames: u64,
    stale_frames: u64,
    conflict_frames: u64,
    missed_frames: u64,
}

impl LinkAircraftRuntime {
    fn new(first_expected_at: Instant) -> Self {
        Self {
            first_expected_at,
            last_valid_rx: None,
            last_fresh_rx: None,
            last_relative_delay: None,
            delay_ewma_ms: None,
            jitter_ewma_ms: None,
            delivered_frames: 0,
            first_arrival_wins: 0,
            duplicate_frames: 0,
            stale_frames: 0,
            conflict_frames: 0,
            missed_frames: 0,
        }
    }
}

pub struct RxArbiter {
    config: RxArbiterConfig,
    streams: HashMap<StreamKey, StreamRuntime>,
    arrivals: HashMap<(StreamKey, u64), ArrivalRecord>,
    all_links_missing: HashMap<StreamKey, u64>,
    links: HashMap<LinkAircraftKey, LinkAircraftRuntime>,
}

impl RxArbiter {
    pub fn new(config: RxArbiterConfig) -> Self {
        Self {
            config,
            streams: HashMap::new(),
            arrivals: HashMap::new(),
            all_links_missing: HashMap::new(),
            links: HashMap::new(),
        }
    }

    pub fn observe(
        &mut self,
        observation: FrameObservation,
        mut active_links: HashSet<String>,
    ) -> RxDecision {
        self.close_expired_observations(observation.received_at);
        let stream = observation.stream;
        active_links.insert(observation.source_link.clone());
        self.ensure_link_runtimes(stream, &active_links, observation.received_at);
        self.mark_valid(&observation.source_link, stream, observation.received_at);
        if let Some((last_raw_sequence, last_extended_sequence, last_accepted_at, recovering)) =
            self.streams.get(&stream).map(|runtime| {
                (
                    runtime.last_raw_sequence,
                    runtime.last_extended_sequence,
                    runtime.last_accepted_at,
                    runtime.recovery.is_some(),
                )
            })
        {
            if recovering
                || (observation
                    .received_at
                    .saturating_duration_since(last_accepted_at)
                    > self.config.sequence_resync_after
                    && self.aircraft_requires_resync(
                        stream,
                        observation.received_at,
                        &active_links,
                    ))
            {
                return self.observe_recovery(observation, active_links, last_extended_sequence);
            }
            let delta = observation.raw_sequence.wrapping_sub(last_raw_sequence);
            let possible_extended_sequence = if delta == 0 {
                Some(last_extended_sequence)
            } else if delta >= 128 {
                let backward = last_raw_sequence.wrapping_sub(observation.raw_sequence);
                last_extended_sequence.checked_sub(u64::from(backward))
            } else {
                None
            };
            if let Some(possible_extended_sequence) = possible_extended_sequence {
                let key = (stream, possible_extended_sequence);
                if let Some(record) = self.arrivals.get(&key) {
                    if record.frame != observation.frame {
                        self.mark_conflict(&observation.source_link, stream);
                        return RxDecision::Conflict;
                    }
                    let source_link = observation.source_link.clone();
                    let (winner_link, relative_delay, first_delivery_from_link) = {
                        let record = self
                            .arrivals
                            .get_mut(&key)
                            .expect("arrival record was just observed");
                        let first_delivery_from_link =
                            record.seen_links.insert(source_link.clone());
                        (
                            record.first_link.clone(),
                            observation
                                .received_at
                                .saturating_duration_since(record.first_received_at),
                            first_delivery_from_link,
                        )
                    };
                    if first_delivery_from_link {
                        self.mark_duplicate(
                            &source_link,
                            stream,
                            observation.received_at,
                            relative_delay,
                            possible_extended_sequence == last_extended_sequence,
                        );
                    } else {
                        self.mark_repeated_duplicate(&source_link, stream);
                    }
                    return RxDecision::Duplicate {
                        winner_link,
                        relative_delay,
                    };
                }
            }
            if (1..=127).contains(&delta) {
                let extended_sequence = last_extended_sequence + u64::from(delta);
                let missing_before = delta - 1;
                *self.all_links_missing.entry(stream).or_default() += u64::from(missing_before);
                self.insert_accepted(observation, active_links, extended_sequence);
                return RxDecision::Accept {
                    extended_sequence,
                    missing_before,
                };
            }
            self.mark_stale(&observation.source_link, stream);
            return RxDecision::Stale;
        }

        let extended_sequence = observation.raw_sequence as u64;
        self.insert_accepted(observation, active_links, extended_sequence);
        RxDecision::Accept {
            extended_sequence,
            missing_before: 0,
        }
    }

    pub fn all_links_missing(&self, stream: StreamKey) -> u64 {
        self.all_links_missing.get(&stream).copied().unwrap_or(0)
    }

    pub fn reset_link(&mut self, source_link: &str) {
        self.links.retain(|key, _| key.source_link != source_link);
        for record in self.arrivals.values_mut() {
            record.expected_links.remove(source_link);
        }
    }

    fn close_expired_observations(&mut self, now: Instant) {
        let expired: Vec<_> = self
            .arrivals
            .iter()
            .filter_map(|(key, record)| (record.expires_at <= now).then_some(*key))
            .collect();

        for key in expired {
            let Some(record) = self.arrivals.remove(&key) else {
                continue;
            };
            for link in record.expected_links.difference(&record.seen_links) {
                if let Some(runtime) = self.links.get_mut(&link_key(link, record_stream(key))) {
                    runtime.missed_frames += 1;
                }
            }
        }
    }

    fn insert_accepted(
        &mut self,
        observation: FrameObservation,
        active_links: HashSet<String>,
        extended_sequence: u64,
    ) {
        let stream = observation.stream;
        self.streams.insert(
            stream,
            StreamRuntime {
                last_raw_sequence: observation.raw_sequence,
                last_extended_sequence: extended_sequence,
                last_accepted_at: observation.received_at,
                recovery: None,
            },
        );
        self.arrivals.insert(
            (stream, extended_sequence),
            ArrivalRecord {
                frame: observation.frame,
                first_link: observation.source_link.clone(),
                first_received_at: observation.received_at,
                seen_links: HashSet::from([observation.source_link.clone()]),
                expected_links: active_links,
                expires_at: observation.received_at + self.config.observation_window,
            },
        );
        self.mark_accepted(&observation.source_link, stream, observation.received_at);
    }

    fn observe_recovery(
        &mut self,
        observation: FrameObservation,
        active_links: HashSet<String>,
        last_extended_sequence: u64,
    ) -> RxDecision {
        let stream = observation.stream;
        let Some(runtime) = self.streams.get_mut(&stream) else {
            unreachable!("recovery requires an existing stream")
        };

        let Some(recovery) = runtime.recovery.as_mut() else {
            runtime.recovery = Some(RecoveryRuntime {
                last_raw_sequence: observation.raw_sequence,
                confirmations: 1,
                source_links: HashSet::from([observation.source_link]),
            });
            return RxDecision::Buffering;
        };

        recovery
            .source_links
            .insert(observation.source_link.clone());
        let delta = observation
            .raw_sequence
            .wrapping_sub(recovery.last_raw_sequence);
        if (1..=127).contains(&delta) {
            recovery.last_raw_sequence = observation.raw_sequence;
            recovery.confirmations = recovery.confirmations.saturating_add(1);
            if recovery.confirmations < self.config.recovery_confirmations.max(1) {
                return RxDecision::Buffering;
            }
        } else if delta == 0 {
            return RxDecision::Buffering;
        } else {
            recovery.last_raw_sequence = observation.raw_sequence;
            recovery.confirmations = 1;
            recovery.source_links = HashSet::from([observation.source_link]);
            return RxDecision::Buffering;
        }

        let epoch_base = (last_extended_sequence / 256 + 1) * 256;
        let extended_sequence = epoch_base + u64::from(observation.raw_sequence);
        self.insert_accepted(observation, active_links, extended_sequence);
        RxDecision::Accept {
            extended_sequence,
            missing_before: 0,
        }
    }

    fn ensure_link_runtimes(
        &mut self,
        stream: StreamKey,
        active_links: &HashSet<String>,
        now: Instant,
    ) {
        for source_link in active_links {
            self.links
                .entry(link_key(source_link, stream))
                .or_insert_with(|| LinkAircraftRuntime::new(now));
        }
    }

    fn aircraft_requires_resync(
        &self,
        stream: StreamKey,
        now: Instant,
        active_links: &HashSet<String>,
    ) -> bool {
        active_links.iter().all(|source_link| {
            self.links
                .get(&link_key(source_link, stream))
                .and_then(|runtime| runtime.last_fresh_rx)
                .map_or(true, |last_fresh| {
                    now.saturating_duration_since(last_fresh) > self.config.sequence_resync_after
                })
        })
    }

    fn mark_valid(&mut self, source_link: &str, stream: StreamKey, received_at: Instant) {
        let runtime = self
            .links
            .entry(link_key(source_link, stream))
            .or_insert_with(|| LinkAircraftRuntime::new(received_at));
        runtime.last_valid_rx = Some(received_at);
    }

    fn mark_accepted(&mut self, source_link: &str, stream: StreamKey, received_at: Instant) {
        let runtime = self
            .links
            .entry(link_key(source_link, stream))
            .or_insert_with(|| LinkAircraftRuntime::new(received_at));
        let jitter_sample = runtime
            .last_relative_delay
            .map(|previous| previous.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        runtime.last_fresh_rx = Some(received_at);
        runtime.last_relative_delay = Some(Duration::ZERO);
        runtime.delay_ewma_ms = Some(ewma(runtime.delay_ewma_ms, 0.0));
        runtime.jitter_ewma_ms = Some(ewma(runtime.jitter_ewma_ms, jitter_sample));
        runtime.delivered_frames += 1;
        runtime.first_arrival_wins += 1;
    }

    fn mark_duplicate(
        &mut self,
        source_link: &str,
        stream: StreamKey,
        received_at: Instant,
        relative_delay: Duration,
        refresh_freshness: bool,
    ) {
        let runtime = self
            .links
            .entry(link_key(source_link, stream))
            .or_insert_with(|| LinkAircraftRuntime::new(received_at));
        let sample_ms = relative_delay.as_secs_f64() * 1000.0;
        let jitter_sample = runtime
            .last_relative_delay
            .map(|previous| (sample_ms - previous.as_secs_f64() * 1000.0).abs())
            .unwrap_or(0.0);
        if refresh_freshness {
            runtime.last_fresh_rx = Some(received_at);
        }
        runtime.last_relative_delay = Some(relative_delay);
        runtime.delay_ewma_ms = Some(ewma(runtime.delay_ewma_ms, sample_ms));
        runtime.jitter_ewma_ms = Some(ewma(runtime.jitter_ewma_ms, jitter_sample));
        runtime.delivered_frames += 1;
        runtime.duplicate_frames += 1;
    }

    fn mark_repeated_duplicate(&mut self, source_link: &str, stream: StreamKey) {
        if let Some(runtime) = self.links.get_mut(&link_key(source_link, stream)) {
            runtime.duplicate_frames += 1;
        }
    }

    fn mark_stale(&mut self, source_link: &str, stream: StreamKey) {
        if let Some(runtime) = self.links.get_mut(&link_key(source_link, stream)) {
            runtime.stale_frames += 1;
        }
    }

    fn mark_conflict(&mut self, source_link: &str, stream: StreamKey) {
        if let Some(runtime) = self.links.get_mut(&link_key(source_link, stream)) {
            runtime.conflict_frames += 1;
        }
    }
}

fn record_stream(key: (StreamKey, u64)) -> StreamKey {
    key.0
}

fn link_key(source_link: &str, stream: StreamKey) -> LinkAircraftKey {
    LinkAircraftKey {
        source_link: source_link.to_string(),
        protocol: stream.protocol,
        uav_id: stream.uav_id,
    }
}

fn ewma(previous: Option<f64>, sample: f64) -> f64 {
    const ALPHA: f64 = 0.2;
    previous.map_or(sample, |value| ALPHA * sample + (1.0 - ALPHA) * value)
}


