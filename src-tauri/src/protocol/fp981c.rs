pub mod c0_to_c3;
pub use c0_to_c3::*;

pub mod c4_to_c8;
pub use c4_to_c8::*;

use gcs_macros::{self, FPAggregate, FPSubFrame};
use serde::Serialize;

// ================= 解析与聚合入口 =================
#[derive(FPSubFrame, FPAggregate, Debug, Clone, Serialize)]
pub enum ParsedSubFrame {
    #[id(0xC0)]
    C0(FrameC0),
    #[id(0xC1)]
    C1(FrameC1),
    #[id(0xC2)]
    C2(FrameC2),
    #[id(0xC3)]
    #[aggregate(
        sub_enum = "C3SubFrames",
        sub_field = "sub_frames",
        subs(Sub0(C3Sub0), Sub1(C3Sub1), Sub2(C3Sub2), Sub3(C3Sub3))
    )]
    C3(C3StatusFrame),
    #[id(0xC5)]
    C5(FrameC5),
}
