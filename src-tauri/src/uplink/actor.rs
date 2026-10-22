use serde::{Deserialize, Serialize};
use std::future::Future;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::time::MissedTickBehavior;

use crate::protocol::uplink::{
    encode_uplink_frame, FlightSwitchCommand, NoAckCommand, PeriodicNavigationData,
    UplinkControlState, UplinkFrameContext, UplinkPayload,
};

pub(crate) trait UplinkFrameSink: Send + Sync {
    fn has_targets(&self) -> bool;
    fn try_dispatch(&self, frame: [u8; 32]) -> Result<(), ()>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum CommandSendPolicy {
    Once,
    RepeatCycles { cycles: u16 },
    UntilCleared,
    /// 周期节流持续发送：每 `interval_ticks` × 20ms 发送一帧指令，
    /// 间隔期回落到周期常发帧，直到被清除。
    UntilClearedPeriodic { interval_ticks: u8 },
}

#[derive(Debug, Clone, Copy)]
struct ActiveCommand {
    command: NoAckCommand,
    policy: CommandSendPolicy,
    remaining_cycles: Option<u16>,
    /// 相邻两帧指令之间的最小 tick 间隔（1 = 每 tick 都发，行为同原版）。
    interval_ticks: u8,
    /// 距下一次发送指令帧还需等待的 tick 数（0 = 本 tick 就发）。
    wait_ticks: u8,
}

impl ActiveCommand {
    fn new(command: NoAckCommand, policy: CommandSendPolicy) -> Result<Self, UplinkCommandError> {
        let (remaining_cycles, interval_ticks) = match policy {
            CommandSendPolicy::Once => (Some(1), 1),
            CommandSendPolicy::RepeatCycles { cycles: 0 } => {
                return Err(UplinkCommandError::InvalidPolicy {
                    message: "重复发送周期数必须大于 0".to_string(),
                })
            }
            CommandSendPolicy::RepeatCycles { cycles } => (Some(cycles), 1),
            CommandSendPolicy::UntilCleared => (None, 1),
            CommandSendPolicy::UntilClearedPeriodic { interval_ticks } => {
                (None, interval_ticks.max(1))
            }
        };
        Ok(Self {
            command,
            policy,
            remaining_cycles,
            interval_ticks,
            wait_ticks: 0,
        })
    }

    fn mark_dispatched(&mut self) -> bool {
        match &mut self.remaining_cycles {
            Some(remaining) => {
                *remaining -= 1;
                *remaining == 0
            }
            None => false,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ActiveFlightSwitch {
    command: FlightSwitchCommand,
    command_frames_remaining: u8,
    release_frames_remaining: u8,
}

impl ActiveFlightSwitch {
    fn new(command: FlightSwitchCommand) -> Self {
        Self {
            command,
            command_frames_remaining: 6,
            release_frames_remaining: 4,
        }
    }

    fn current_code(&self) -> u8 {
        if self.command_frames_remaining > 0 {
            self.command.code()
        } else {
            0
        }
    }

    fn frames_remaining(&self) -> u8 {
        self.command_frames_remaining + self.release_frames_remaining
    }

    fn mark_enqueued(&mut self) -> bool {
        if self.command_frames_remaining > 0 {
            self.command_frames_remaining -= 1;
        } else if self.release_frames_remaining > 0 {
            self.release_frames_remaining -= 1;
        }
        self.frames_remaining() == 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UplinkStatus {
    /// 当前生效的上行机号（来自通信配置，全部上行帧统一使用）
    pub aircraft_id: u8,
    pub sequence: u8,
    pub has_active_command: bool,
    pub active_function_code: Option<u8>,
    pub active_policy: Option<CommandSendPolicy>,
    pub active_flight_switch: Option<FlightSwitchCommand>,
    pub flight_switch_frames_remaining: u8,
    pub enqueued_frames: u64,
    pub dropped_ticks: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UplinkCommandError {
    Conflict {
        message: String,
        status: UplinkStatus,
    },
    InvalidPolicy {
        message: String,
    },
    ServiceUnavailable {
        message: String,
    },
}

/// 上行帧固定的目的地址 / 源地址 / 数据来源
const UPLINK_DESTINATION: u8 = 0x02;
const UPLINK_SOURCE: u8 = 0x01;
const UPLINK_DATA_SOURCE: u8 = 0xAA;

pub(crate) fn uplink_frame_context(aircraft_id: u8) -> UplinkFrameContext {
    UplinkFrameContext {
        destination: UPLINK_DESTINATION,
        source: UPLINK_SOURCE,
        aircraft_id,
        data_source: UPLINK_DATA_SOURCE,
    }
}

pub(crate) struct UplinkCore {
    /// 上行机号：仅能通过通信配置修改，各业务指令不得自行覆盖
    aircraft_id: u8,
    control: UplinkControlState,
    periodic: PeriodicNavigationData,
    active_command: Option<ActiveCommand>,
    active_flight_switch: Option<ActiveFlightSwitch>,
    sequence: u8,
    enqueued_frames: u64,
    dropped_ticks: u64,
}

impl UplinkCore {
    pub(crate) fn new(aircraft_id: u8) -> Self {
        Self {
            aircraft_id,
            control: UplinkControlState::default(),
            periodic: PeriodicNavigationData::default(),
            active_command: None,
            active_flight_switch: None,
            sequence: 0,
            enqueued_frames: 0,
            dropped_ticks: 0,
        }
    }

    fn frame_context(&self) -> UplinkFrameContext {
        uplink_frame_context(self.aircraft_id)
    }

    pub(crate) fn set_aircraft_id(&mut self, aircraft_id: u8) {
        self.aircraft_id = aircraft_id;
    }

    pub(crate) fn update_control(&mut self, control: UplinkControlState) {
        self.control = control;
    }

    pub(crate) fn update_periodic(
        &mut self,
        periodic: PeriodicNavigationData,
    ) -> Result<(), String> {
        encode_uplink_frame(
            self.frame_context(),
            self.control,
            self.sequence,
            UplinkPayload::Periodic(periodic),
        )
        .map_err(|error| error.to_string())?;
        self.periodic = periodic;
        Ok(())
    }

    pub(crate) fn submit_command(
        &mut self,
        command: NoAckCommand,
        policy: CommandSendPolicy,
    ) -> Result<(), UplinkCommandError> {
        if let Some(active) = self.active_command {
            return Err(UplinkCommandError::Conflict {
                message: format!("已有指令 0x{:02X} 正在发送", active.command.function_code),
                status: self.status(),
            });
        }
        self.active_command = Some(ActiveCommand::new(command, policy)?);
        Ok(())
    }

    pub(crate) fn clear_command(&mut self) {
        self.active_command = None;
    }

    pub(crate) fn clear_command_if(&mut self, function_code: u8) -> bool {
        if self
            .active_command
            .is_some_and(|active| active.command.function_code == function_code)
        {
            self.active_command = None;
            true
        } else {
            false
        }
    }

    pub(crate) fn submit_flight_switch(
        &mut self,
        command: FlightSwitchCommand,
    ) -> Result<(), UplinkCommandError> {
        if self.active_flight_switch.is_some() {
            return Err(UplinkCommandError::Conflict {
                message: "已有飞行开关指令正在发送".to_string(),
                status: self.status(),
            });
        }
        self.active_flight_switch = Some(ActiveFlightSwitch::new(command));
        Ok(())
    }

    pub(crate) fn status(&self) -> UplinkStatus {
        UplinkStatus {
            aircraft_id: self.aircraft_id,
            sequence: self.sequence,
            has_active_command: self.active_command.is_some(),
            active_function_code: self
                .active_command
                .map(|active| active.command.function_code),
            active_policy: self.active_command.map(|active| active.policy),
            active_flight_switch: self.active_flight_switch.map(|active| active.command),
            flight_switch_frames_remaining: self
                .active_flight_switch
                .map_or(0, |active| active.frames_remaining()),
            enqueued_frames: self.enqueued_frames,
            dropped_ticks: self.dropped_ticks,
        }
    }

    pub(crate) fn tick(&mut self, sink: &dyn UplinkFrameSink) {
        if !sink.has_targets() {
            return;
        }
        let context = self.frame_context();

        let flight_switch_active = self.active_flight_switch.is_some();
        // wait_ticks > 0 时本 tick 发周期常发帧，指令仍占用槽位；用户松开由 clear_command_if 清空。
        let command_ready = self
            .active_command
            .is_some_and(|active| active.wait_ticks == 0);
        let payload = if flight_switch_active {
            UplinkPayload::Periodic(self.periodic)
        } else if command_ready {
            self.active_command
                .map(|active| UplinkPayload::Command(active.command))
                .unwrap_or(UplinkPayload::Periodic(self.periodic))
        } else {
            UplinkPayload::Periodic(self.periodic)
        };
        let mut control = self.control;
        if let Some(active) = self.active_flight_switch {
            control.switch_command = active.current_code();
        }
        let Ok(frame) = encode_uplink_frame(context, control, self.sequence, payload) else {
            return;
        };

        if sink.try_dispatch(frame).is_err() {
            self.dropped_ticks += 1;
            return;
        }

        self.sequence = self.sequence.wrapping_add(1);
        self.enqueued_frames += 1;
        if !flight_switch_active {
            if let Some(active) = self.active_command.as_mut() {
                if active.wait_ticks > 0 {
                    // 节流等待期：本 tick 发送的是周期常发帧，指令保持占用
                    active.wait_ticks -= 1;
                } else {
                    // 指令帧已发出：进入下一次节流等待并结算剩余周期
                    active.wait_ticks = active.interval_ticks.saturating_sub(1);
                    if active.mark_dispatched() {
                        self.active_command = None;
                    }
                }
            }
        }
        if self
            .active_flight_switch
            .as_mut()
            .is_some_and(ActiveFlightSwitch::mark_enqueued)
        {
            self.active_flight_switch = None;
        }
    }
}

enum UplinkMessage {
    SetAircraftId {
        aircraft_id: u8,
        reply: oneshot::Sender<()>,
    },
    UpdateControl {
        control: UplinkControlState,
        reply: oneshot::Sender<()>,
    },
    UpdatePeriodic {
        periodic: PeriodicNavigationData,
        reply: oneshot::Sender<Result<(), String>>,
    },
    SubmitCommand {
        command: NoAckCommand,
        policy: CommandSendPolicy,
        reply: oneshot::Sender<Result<(), UplinkCommandError>>,
    },
    SubmitFlightSwitch {
        command: FlightSwitchCommand,
        reply: oneshot::Sender<Result<(), UplinkCommandError>>,
    },
    ClearCommand {
        reply: oneshot::Sender<()>,
    },
    ClearCommandIf {
        function_code: u8,
        reply: oneshot::Sender<bool>,
    },
    Status {
        reply: oneshot::Sender<UplinkStatus>,
    },
}

#[derive(Clone)]
pub struct UplinkHandle {
    tx: mpsc::Sender<UplinkMessage>,
    /// 当前上行机号镜像（供应答事务匹配回报等同步读取）
    aircraft_id: Arc<AtomicU8>,
}

impl UplinkHandle {
    /// 当前生效的上行机号
    pub fn aircraft_id(&self) -> u8 {
        self.aircraft_id.load(Ordering::Acquire)
    }

    /// 更新上行机号（仅由通信配置保存流程调用）
    pub async fn set_aircraft_id(&self, aircraft_id: u8) -> Result<(), String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(UplinkMessage::SetAircraftId {
                aircraft_id,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "上行 Actor 不可用".to_string())?;
        reply_rx
            .await
            .map_err(|_| "上行 Actor 未确认机号更新".to_string())?;
        self.aircraft_id.store(aircraft_id, Ordering::Release);
        Ok(())
    }

    pub async fn update_control(&self, control: UplinkControlState) -> Result<(), String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(UplinkMessage::UpdateControl {
                control,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "上行 Actor 不可用".to_string())?;
        reply_rx
            .await
            .map_err(|_| "上行 Actor 未确认控制状态更新".to_string())
    }

    pub async fn update_periodic(&self, periodic: PeriodicNavigationData) -> Result<(), String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(UplinkMessage::UpdatePeriodic {
                periodic,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "上行 Actor 不可用".to_string())?;
        reply_rx
            .await
            .map_err(|_| "上行 Actor 未返回常发状态更新结果".to_string())?
    }

    pub async fn submit_command(
        &self,
        command: NoAckCommand,
        policy: CommandSendPolicy,
    ) -> Result<(), UplinkCommandError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(UplinkMessage::SubmitCommand {
                command,
                policy,
                reply: reply_tx,
            })
            .await
            .map_err(|_| UplinkCommandError::ServiceUnavailable {
                message: "上行 Actor 不可用".to_string(),
            })?;
        reply_rx
            .await
            .map_err(|_| UplinkCommandError::ServiceUnavailable {
                message: "上行 Actor 未返回指令提交结果".to_string(),
            })?
    }

    pub async fn clear_command(&self) -> Result<(), String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(UplinkMessage::ClearCommand { reply: reply_tx })
            .await
            .map_err(|_| "上行 Actor 不可用".to_string())?;
        reply_rx
            .await
            .map_err(|_| "上行 Actor 未确认清除指令".to_string())
    }

    pub async fn clear_command_if(&self, function_code: u8) -> Result<bool, String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(UplinkMessage::ClearCommandIf {
                function_code,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "上行 Actor 不可用".to_string())?;
        reply_rx
            .await
            .map_err(|_| "上行 Actor 未确认条件清除指令".to_string())
    }

    pub async fn submit_flight_switch(
        &self,
        command: FlightSwitchCommand,
    ) -> Result<(), UplinkCommandError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(UplinkMessage::SubmitFlightSwitch {
                command,
                reply: reply_tx,
            })
            .await
            .map_err(|_| UplinkCommandError::ServiceUnavailable {
                message: "上行 Actor 不可用".to_string(),
            })?;
        reply_rx
            .await
            .map_err(|_| UplinkCommandError::ServiceUnavailable {
                message: "上行 Actor 未返回飞行开关提交结果".to_string(),
            })?
    }

    pub async fn status(&self) -> Result<UplinkStatus, String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(UplinkMessage::Status { reply: reply_tx })
            .await
            .map_err(|_| "上行 Actor 不可用".to_string())?;
        reply_rx
            .await
            .map_err(|_| "上行 Actor 未返回状态".to_string())
    }
}

fn handle_message(core: &mut UplinkCore, message: UplinkMessage) {
    match message {
        UplinkMessage::SetAircraftId { aircraft_id, reply } => {
            core.set_aircraft_id(aircraft_id);
            let _ = reply.send(());
        }
        UplinkMessage::UpdateControl { control, reply } => {
            core.update_control(control);
            let _ = reply.send(());
        }
        UplinkMessage::UpdatePeriodic { periodic, reply } => {
            let _ = reply.send(core.update_periodic(periodic));
        }
        UplinkMessage::SubmitCommand {
            command,
            policy,
            reply,
        } => {
            let _ = reply.send(core.submit_command(command, policy));
        }
        UplinkMessage::SubmitFlightSwitch { command, reply } => {
            let _ = reply.send(core.submit_flight_switch(command));
        }
        UplinkMessage::ClearCommand { reply } => {
            core.clear_command();
            let _ = reply.send(());
        }
        UplinkMessage::ClearCommandIf {
            function_code,
            reply,
        } => {
            let _ = reply.send(core.clear_command_if(function_code));
        }
        UplinkMessage::Status { reply } => {
            let _ = reply.send(core.status());
        }
    }
}

fn build_actor(
    sink: Arc<dyn UplinkFrameSink>,
    aircraft_id: u8,
) -> (UplinkHandle, impl Future<Output = ()> + Send + 'static) {
    let (tx, mut rx) = mpsc::channel(32);
    let task = async move {
        let mut core = UplinkCore::new(aircraft_id);
        let mut interval = tokio::time::interval(Duration::from_millis(20));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        interval.tick().await;
        let mut tick_panics: u32 = 0;

        loop {
            tokio::select! {
                message = rx.recv() => {
                    let Some(message) = message else {
                        break;
                    };
                    let handled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        handle_message(&mut core, message)
                    }));
                    if handled.is_err() {
                        // 单条指令处理 panic 不得让上行任务静默死亡（回复通道随之丢弃，调用方会收到错误）
                        log::error!("[Uplink] 处理上行消息时发生 panic，已丢弃该消息并继续运行");
                    }
                }
                _ = interval.tick() => {
                    let ticked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        core.tick(sink.as_ref())
                    }));
                    if ticked.is_err() {
                        tick_panics = tick_panics.wrapping_add(1);
                        // 20ms 周期：首次及此后每 500 次（约 10s）记录一次，避免刷屏
                        if tick_panics % 500 == 1 {
                            log::error!("[Uplink] 上行周期发送发生 panic（累计 {tick_panics} 次），继续运行");
                        }
                    }
                }
            }
        }
    };
    (
        UplinkHandle {
            tx,
            aircraft_id: Arc::new(AtomicU8::new(aircraft_id)),
        },
        task,
    )
}

pub(crate) fn start_actor(sink: Arc<dyn UplinkFrameSink>, aircraft_id: u8) -> UplinkHandle {
    let (handle, task) = build_actor(sink, aircraft_id);
    tauri::async_runtime::spawn(task);
    handle
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::uplink::PERIODIC_FUNCTION_CODE;
    use std::sync::Mutex;

    struct RecordingSink {
        frames: Mutex<Vec<[u8; 32]>>,
    }

    impl RecordingSink {
        fn new() -> Self {
            Self {
                frames: Mutex::new(Vec::new()),
            }
        }

        fn codes(&self) -> Vec<u8> {
            self.frames
                .lock()
                .expect("recording sink")
                .iter()
                .map(|frame| frame[13])
                .collect()
        }

        fn last(&self) -> [u8; 32] {
            *self
                .frames
                .lock()
                .expect("recording sink")
                .last()
                .expect("no frames")
        }
    }

    impl UplinkFrameSink for RecordingSink {
        fn has_targets(&self) -> bool {
            true
        }

        fn try_dispatch(&self, frame: [u8; 32]) -> Result<(), ()> {
            self.frames.lock().expect("recording sink").push(frame);
            Ok(())
        }
    }

    fn configured_core() -> UplinkCore {
        UplinkCore::new(1)
    }

    fn pod_inject_command() -> NoAckCommand {
        let mut payload = [0u8; 15];
        payload[0] = 0x01;
        payload[1] = 0x19;
        payload[2..4].copy_from_slice(&(-9000i16).to_le_bytes());
        NoAckCommand {
            function_code: 0x70,
            payload,
        }
    }

    #[test]
    fn repeat_cycles_occupies_five_ticks_then_returns_to_periodic() {
        let mut core = configured_core();
        let sink = RecordingSink::new();
        core.submit_command(
            pod_inject_command(),
            CommandSendPolicy::RepeatCycles { cycles: 5 },
        )
        .unwrap();

        for _ in 0..6 {
            core.tick(&sink);
        }

        assert_eq!(
            sink.codes(),
            vec![0x70, 0x70, 0x70, 0x70, 0x70, PERIODIC_FUNCTION_CODE]
        );
        assert!(!core.status().has_active_command);
    }

    #[test]
    fn until_cleared_periodic_injects_at_10hz_until_clear() {
        let mut core = configured_core();
        let sink = RecordingSink::new();
        core.submit_command(
            pod_inject_command(),
            CommandSendPolicy::UntilClearedPeriodic { interval_ticks: 5 },
        )
        .unwrap();

        for _ in 0..6 {
            core.tick(&sink);
        }
        assert_eq!(
            sink.codes(),
            vec![
                0x70,
                PERIODIC_FUNCTION_CODE,
                PERIODIC_FUNCTION_CODE,
                PERIODIC_FUNCTION_CODE,
                PERIODIC_FUNCTION_CODE,
                0x70,
            ]
        );
        assert!(core.status().has_active_command);
        assert_eq!(core.status().active_function_code, Some(0x70));

        assert!(core.clear_command_if(0x70));
        core.tick(&sink);
        assert_eq!(sink.codes().last().copied(), Some(PERIODIC_FUNCTION_CODE));
        assert!(!core.status().has_active_command);
    }

    #[test]
    fn pod_inject_frame_keeps_switch_cmd_and_reserved_zeros() {
        let mut core = configured_core();
        let sink = RecordingSink::new();
        core.submit_command(
            pod_inject_command(),
            CommandSendPolicy::Once,
        )
        .unwrap();
        core.tick(&sink);

        let frame = sink.last();
        assert_eq!(&frame[0..2], &[0xEB, 0x90]);
        assert_eq!(frame[13], 0x70);
        assert_eq!(frame[14], 0x01);
        assert_eq!(frame[15], 0x19);
        assert_eq!(&frame[16..18], &(-9000i16).to_le_bytes());
        assert_eq!(&frame[18..20], &[0, 0]);
        assert!(frame[20..29].iter().all(|&byte| byte == 0));
    }

    #[test]
    fn all_uplink_frames_use_configured_aircraft_id() {
        let mut core = UplinkCore::new(42);
        let sink = RecordingSink::new();

        // 周期常发帧
        core.tick(&sink);
        assert_eq!(sink.last()[4], 42);

        // 飞行开关指令不再携带独立机号，沿用配置机号
        core.submit_flight_switch(FlightSwitchCommand::PayloadOn)
            .unwrap();
        core.tick(&sink);
        assert_eq!(sink.last()[4], 42);
        assert_eq!(sink.last()[6], FlightSwitchCommand::PayloadOn.code());

        // 修改配置机号后立即生效
        core.set_aircraft_id(7);
        core.tick(&sink);
        assert_eq!(sink.last()[4], 7);
        assert_eq!(core.status().aircraft_id, 7);
    }
}
