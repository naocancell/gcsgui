use serde::{Deserialize, Serialize};

/// 领域错误模型与业务状态码定义
#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    /// 5 位标准化业务错误码
    pub code: u32,
    /// 领域分类（如 "System"、"Comms"、"Uplink"、"GIS" 等）
    pub category: String,
    /// 面向用户/操作员的清晰错误说明
    pub message: String,
    /// 详细技术原因、底层堆栈或错误详情
    pub detail: Option<String>,
    /// 是否属于可恢复性错误（前端可据此决定是否重试或阻止操作）
    pub recoverable: bool,
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(detail) = &self.detail {
            write!(f, "[E{}:{}] {} ({})", self.code, self.category, self.message, detail)
        } else {
            write!(f, "[E{}:{}] {}", self.code, self.category, self.message)
        }
    }
}

impl AppError {
    pub fn new(code: u32, category: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code,
            category: category.into(),
            message: message.into(),
            detail: None,
            recoverable: true,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn unrecoverable(mut self) -> Self {
        self.recoverable = false;
        self
    }

    // 各领域便捷构造函数
    pub fn system(code: u32, message: impl Into<String>) -> Self {
        Self::new(code, "System", message)
    }

    pub fn comms(code: u32, message: impl Into<String>) -> Self {
        Self::new(code, "Comms", message)
    }

    pub fn protocol(code: u32, message: impl Into<String>) -> Self {
        Self::new(code, "Protocol", message)
    }

    pub fn uplink(code: u32, message: impl Into<String>) -> Self {
        Self::new(code, "Uplink", message)
    }

    pub fn gis(code: u32, message: impl Into<String>) -> Self {
        Self::new(code, "GIS", message)
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        Self::new(10001, "General", s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        Self::new(10001, "General", s.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::new(10002, "IO", err.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        Self::new(10003, "Tauri", err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::new(10004, "Serialization", err.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
