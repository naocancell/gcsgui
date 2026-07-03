pub mod error;
pub mod event;
pub mod transport;
pub mod transports;

pub use error::CommsError;
pub use event::{LinkEvent, LinkStatus};
pub use transport::TransportLink;
pub use transports::{
    serial::{list_available_ports, SerialConfig, SerialLink},
    udp::{UdpConfig, UdpLink},
};
