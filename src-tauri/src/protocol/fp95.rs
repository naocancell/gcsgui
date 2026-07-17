mod frame80_to_83;
mod frame84;
mod frame94;
pub use frame80_to_83::*;
pub use frame84::*;
pub use frame94::*;

use gcs_macros::{self, FPAggregate, FPSubFrame};
use serde::Serialize;

// ================= 解析入口 =================
#[derive(FPSubFrame, FPAggregate, Debug, Clone, Serialize)]
#[aggregate_struct(FP95Aggregate, rename_all = "camelCase")]
pub enum ParsedSubFrame {
    #[id(0x80)]
    Frame80(FP95Frame80),
    #[id(0x81)]
    Frame81(FP95Frame81),
    #[id(0x83)]
    Frame83(FP95Frame83),
    #[id(0x84)]
    Frame84(FP95Frame84),
    #[id(0x94)]
    Frame94(FP95Frame94),
}

