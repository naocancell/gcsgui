use std::any::Any;
use crate::error::CommsError;

/// 传输链路特征：所有物理介质（UDP、TCP、串口、CAN 等）必须实现的统一规范
#[async_trait::async_trait]
pub trait TransportLink: Send + Sync + 'static {
    /// 唯一链路实例名称
    fn name(&self) -> &str;

    /// 链路协议/介质分类（如 "UDP" / "Serial"）
    fn link_type(&self) -> &str;

    /// 统一异步发包接口
    async fn send(&self, payload: &[u8]) -> Result<usize, CommsError>;

    /// 安全终止当前链路监听与收发后台
    fn stop(&self);

    /// 一键向下转型为具体类型（解决特定硬件独有控制指令需求）
    fn as_any(&self) -> &dyn Any;
}
