//! 记录回放子系统。
//!
//! - [`format`]：dat 文件格式编解码（"GCSREC" v1）
//! - [`writer`]：记录服务（非阻塞 tap + 异步落盘）
//! - [`replay`]：回放引擎（虚拟链路 + pacing 注入）
//! - [`validated`]：按飞机号划分的校验数据记录（只记通过校验的合法帧）
//! - [`command`]：Tauri 命令入口

pub mod command;
pub mod format;
pub mod replay;
pub mod validated;
pub mod writer;

pub use validated::{AircraftRecordStatus, ValidatedKind};
pub use writer::{LinkRecordStatus, RecorderService, RecorderStatus, RecorderSummary};
