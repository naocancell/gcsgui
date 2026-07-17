use serde::{Deserialize, Serialize};
use std::future::Future;
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
}

#[derive(Debug, Clone, Copy)]
struct ActiveCommand {
    command: NoAckCommand,
    policy: CommandSendPolicy,
    remaining_cycles: Option<u16>,
}

impl ActiveCommand {
    fn new(command: NoAckCommand, policy: CommandSendPolicy) -> Result<Self, UplinkCommandError> {
        let remaining_cycles = match policy {
            CommandSendPolicy::Once => Some(1),
            CommandSendPolicy::RepeatCycles { cycles: 0 } => {
                return Err(UplinkCommandError::InvalidPolicy {
                    message: "重复发送周期数必须大于 0".to_string(),
                })
            }
            CommandSendPolicy::RepeatCycles { cycles } => Some(cycles),
            CommandSendPolicy::UntilCleared => None,
        };
        Ok(Self {
            command,
            policy,
            remaining_cycles,
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
    context: UplinkFrameContext,
    command_frames_remaining: u8,
    release_frames_remaining: u8,
}

impl ActiveFlightSwitch {
    fn new(command: FlightSwitchCommand, context: UplinkFrameContext) -> Self {
        Self {
            command,
            context,
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
    pub configured: bool,
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

pub(crate) struct UplinkCore {
    frame_context: Option<UplinkFrameContext>,
    control: UplinkControlState,
    periodic: PeriodicNavigationData,
    active_command: Option<ActiveCommand>,
    active_flight_switch: Option<ActiveFlightSwitch>,
    sequence: u8,
    enqueued_frames: u64,
    dropped_ticks: u64,
}

impl UplinkCore {
    pub(crate) fn new() -> Self {
        Self {
            frame_context: None,
            control: UplinkControlState::default(),
            periodic: PeriodicNavigationData::default(),
            active_command: None,
            active_flight_switch: None,
            sequence: 0,
            enqueued_frames: 0,
            dropped_ticks: 0,
        }
    }

    pub(crate) fn configure(&mut self, context: UplinkFrameContext) -> Result<(), String> {
        encode_uplink_frame(
            context,
            self.control,
            self.sequence,
            UplinkPayload::Periodic(self.periodic),
        )
        .map_err(|error| error.to_string())?;
        self.frame_context = Some(context);
        Ok(())
    }

    pub(crate) fn update_control(&mut self, control: UplinkControlState) {
        self.control = control;
    }

    pub(crate) fn update_periodic(
        &mut self,
        periodic: PeriodicNavigationData,
    ) -> Result<(), String> {
        let validation_context = self.frame_context.unwrap_or(UplinkFrameContext {
            destination: 0,
            source: 0,
            aircraft_id: 0,
            data_source: 0xAA,
        });
        encode_uplink_frame(
            validation_context,
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
        aircraft_id: u8,
        command: FlightSwitchCommand,
    ) -> Result<(), UplinkCommandError> {
        if self.active_flight_switch.is_some() {
            return Err(UplinkCommandError::Conflict {
                message: "已有飞行开关指令正在发送".to_string(),
                status: self.status(),
            });
        }
        let context = UplinkFrameContext {
            destination: 0x02,
            source: 0x01,
            aircraft_id,
            data_source: 0xAA,
        };
        self.frame_context = Some(context);
        self.active_flight_switch = Some(ActiveFlightSwitch::new(command, context));
        Ok(())
    }

    pub(crate) fn status(&self) -> UplinkStatus {
        UplinkStatus {
            configured: self.frame_context.is_some(),
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
        let Some(context) = self
            .active_flight_switch
            .map(|active| active.context)
            .or(self.frame_context)
        else {
            return;
        };
        if !sink.has_targets() {
            return;
        }

        let flight_switch_active = self.active_flight_switch.is_some();
        let payload = if flight_switch_active {
            UplinkPayload::Periodic(self.periodic)
        } else {
            self.active_command
                .map(|active| UplinkPayload::Command(active.command))
                .unwrap_or(UplinkPayload::Periodic(self.periodic))
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
        if !flight_switch_active
            && self
                .active_command
                .as_mut()
                .is_some_and(ActiveCommand::mark_dispatched)
        {
            self.active_command = None;
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
    Configure {
        context: UplinkFrameContext,
        reply: oneshot::Sender<Result<(), String>>,
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
        aircraft_id: u8,
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
}

impl UplinkHandle {
    pub async fn configure(&self, context: UplinkFrameContext) -> Result<(), String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(UplinkMessage::Configure {
                context,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "上行 Actor 不可用".to_string())?;
        reply_rx
            .await
            .map_err(|_| "上行 Actor 未返回配置结果".to_string())?
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
        aircraft_id: u8,
        command: FlightSwitchCommand,
    ) -> Result<(), UplinkCommandError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(UplinkMessage::SubmitFlightSwitch {
                aircraft_id,
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

fn build_actor(
    sink: Arc<dyn UplinkFrameSink>,
) -> (UplinkHandle, impl Future<Output = ()> + Send + 'static) {
    let (tx, mut rx) = mpsc::channel(32);
    let task = async move {
        let mut core = UplinkCore::new();
        let mut interval = tokio::time::interval(Duration::from_millis(20));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        interval.tick().await;

        loop {
            tokio::select! {
                message = rx.recv() => {
                    let Some(message) = message else {
                        break;
                    };
                    match message {
                        UplinkMessage::Configure { context, reply } => {
                            let _ = reply.send(core.configure(context));
                        }
                        UplinkMessage::UpdateControl { control, reply } => {
                            core.update_control(control);
                            let _ = reply.send(());
                        }
                        UplinkMessage::UpdatePeriodic { periodic, reply } => {
                            let _ = reply.send(core.update_periodic(periodic));
                        }
                        UplinkMessage::SubmitCommand { command, policy, reply } => {
                            let _ = reply.send(core.submit_command(command, policy));
                        }
                        UplinkMessage::SubmitFlightSwitch { aircraft_id, command, reply } => {
                            let _ = reply.send(core.submit_flight_switch(aircraft_id, command));
                        }
                        UplinkMessage::ClearCommand { reply } => {
                            core.clear_command();
                            let _ = reply.send(());
                        }
                        UplinkMessage::ClearCommandIf { function_code, reply } => {
                            let _ = reply.send(core.clear_command_if(function_code));
                        }
                        UplinkMessage::Status { reply } => {
                            let _ = reply.send(core.status());
                        }
                    }
                }
                _ = interval.tick() => core.tick(sink.as_ref()),
            }
        }
    };
    (UplinkHandle { tx }, task)
}

pub(crate) fn start_actor(sink: Arc<dyn UplinkFrameSink>) -> UplinkHandle {
    let (handle, task) = build_actor(sink);
    tauri::async_runtime::spawn(task);
    handle
}


