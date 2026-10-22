pub mod actor;
pub mod dispatcher;
pub mod response;

pub use crate::protocol::uplink::FlightSwitchCommand;
pub use actor::{CommandSendPolicy, UplinkCommandError, UplinkHandle, UplinkStatus};
pub use response::{ExpectedResponse, FP95Response, FP95ResponseCoordinator, PendingResponse};

use crate::state::AppState;

pub fn start(state: AppState, aircraft_id: u8) -> UplinkHandle {
    let sink = dispatcher::start_dispatcher(state);
    actor::start_actor(sink, aircraft_id)
}
