pub mod error;
pub mod event;
pub mod transport;
pub mod transports;

pub use error::CommsError;
pub use event::{LinkEvent, LinkStatus};
pub use transport::{TransportLink, TxPriority};
pub use transports::{
    serial::{list_available_ports, DataBits, Parity, SerialConfig, SerialLink, StopBits},
    udp::{UdpConfig, UdpLink},
};
