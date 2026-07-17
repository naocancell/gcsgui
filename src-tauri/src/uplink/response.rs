use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

use crate::protocol::fp95_command::{
    decode_air_traffic_query, decode_switch_query, matches_air_traffic_binding,
    matches_switch_binding, AirTrafficParamReadback, TransponderSwitchReadback,
    AIR_TRAFFIC_QUERY_CODE, SWITCH_QUERY_CODE,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExpectedResponse {
    SwitchBinding([u8; 15]),
    SwitchQuery,
    AirTrafficBinding([u8; 15]),
    AirTrafficQuery,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FP95Response {
    BindingConfirmed,
    SwitchQuery(TransponderSwitchReadback),
    AirTrafficQuery(AirTrafficParamReadback),
}

pub struct PendingResponse {
    pub id: u64,
    pub receiver: oneshot::Receiver<Result<FP95Response, String>>,
}

struct PendingResponseState {
    id: u64,
    aircraft_id: u8,
    expected: ExpectedResponse,
    sender: oneshot::Sender<Result<FP95Response, String>>,
}

#[derive(Default)]
struct CoordinatorState {
    next_id: u64,
    pending: Option<PendingResponseState>,
}

#[derive(Clone, Default)]
pub struct FP95ResponseCoordinator {
    state: Arc<Mutex<CoordinatorState>>,
}

impl FP95ResponseCoordinator {
    pub fn register(
        &self,
        aircraft_id: u8,
        expected: ExpectedResponse,
    ) -> Result<PendingResponse, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "FP95回报事务状态不可用".to_string())?;
        if state.pending.is_some() {
            return Err("已有应答机或航管参数指令正在等待回报".to_string());
        }
        state.next_id = state.next_id.wrapping_add(1).max(1);
        let id = state.next_id;
        let (sender, receiver) = oneshot::channel();
        state.pending = Some(PendingResponseState {
            id,
            aircraft_id,
            expected,
            sender,
        });
        Ok(PendingResponse { id, receiver })
    }

    pub fn cancel(&self, id: u64) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if state
            .pending
            .as_ref()
            .is_some_and(|pending| pending.id == id)
        {
            state.pending = None;
            true
        } else {
            false
        }
    }

    pub fn deliver(&self, aircraft_id: u8, data: [u8; 16]) {
        let pending = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            let Some(pending) = state.pending.as_ref() else {
                return;
            };
            if pending.aircraft_id != aircraft_id || !Self::matches(&pending.expected, &data) {
                return;
            }
            state.pending.take()
        };

        if let Some(pending) = pending {
            let result = match pending.expected {
                ExpectedResponse::SwitchBinding(_) | ExpectedResponse::AirTrafficBinding(_) => {
                    Ok(FP95Response::BindingConfirmed)
                }
                ExpectedResponse::SwitchQuery => {
                    decode_switch_query(data).map(FP95Response::SwitchQuery)
                }
                ExpectedResponse::AirTrafficQuery => {
                    decode_air_traffic_query(data).map(FP95Response::AirTrafficQuery)
                }
            };
            let _ = pending.sender.send(result);
        }
    }

    fn matches(expected: &ExpectedResponse, data: &[u8; 16]) -> bool {
        match expected {
            ExpectedResponse::SwitchBinding(payload) => matches_switch_binding(data, payload),
            ExpectedResponse::SwitchQuery => data[0] == SWITCH_QUERY_CODE,
            ExpectedResponse::AirTrafficBinding(payload) => {
                matches_air_traffic_binding(data, payload)
            }
            ExpectedResponse::AirTrafficQuery => data[0] == AIR_TRAFFIC_QUERY_CODE,
        }
    }
}


