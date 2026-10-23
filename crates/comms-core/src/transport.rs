use std::any::Any;
use crate::error::CommsError;

/// 上行发送优先级：同一条链路上控制指令先于周期常发帧，周期帧先于后台轮询帧。
///
/// 只有带发送队列的链路（串口）会按优先级调度；UDP 等数据报链路直接发送，忽略优先级。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TxPriority {
    /// 用户触发的控制指令（继电器、防除冰、航线、透传上行等），队列满时直接报错
    Control,
    /// 周期常发帧与高频转发：队列满时丢弃最旧的一帧，只保留最新数据
    Periodic,
    /// 后台轮询（如继电器状态查询），队列满时直接丢弃本次请求
    Background,
}

/// 传输链路特征：所有物理介质（UDP、TCP、串口、CAN 等）必须实现的统一规范
#[async_trait::async_trait]
pub trait TransportLink: Send + Sync + 'static {
    /// 唯一链路实例名称
    fn name(&self) -> &str;

    /// 链路协议/介质分类（如 "UDP" / "Serial"）
    fn link_type(&self) -> &str;

    /// 统一异步发包接口（按控制指令优先级发送），等待写入完成后返回
    async fn send(&self, payload: &[u8]) -> Result<usize, CommsError>;

    /// 指定优先级发送并等待写入完成；默认实现忽略优先级直接发送
    async fn send_with_priority(
        &self,
        payload: &[u8],
        priority: TxPriority,
    ) -> Result<usize, CommsError> {
        let _ = priority;
        self.send(payload).await
    }

    /// 非阻塞投递：不等待写入完成，队列满或链路已关闭时立即返回错误。
    /// 供路由热路径上的高频转发使用，按调用顺序发出，无需为每帧单独起异步任务。
    fn try_send(&self, payload: &[u8], priority: TxPriority) -> Result<(), CommsError> {
        let _ = (payload, priority);
        Err(CommsError::LinkFaulted("该链路不支持非阻塞发送".into()))
    }

    /// 安全终止当前链路监听与收发后台（立即返回，不等待后台线程退出）
    fn stop(&self);

    /// 终止链路并等待底层句柄完全释放（串口读写线程退出）后返回，
    /// 用于热重载等需要立刻重新打开同一设备的场景；默认等同于 [`TransportLink::stop`]
    async fn shutdown(&self) {
        self.stop();
    }

    /// 一键向下转型为具体类型（解决特定硬件独有控制指令需求）
    fn as_any(&self) -> &dyn Any;
}
