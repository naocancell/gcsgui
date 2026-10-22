use crate::comms::ProtocolType;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// 未配置时的默认上行机号（沿用此前前端写死的 255）
pub const DEFAULT_UPLINK_AIRCRAFT_ID: u8 = 255;

#[derive(Default, Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct CommsConfig {
    pub udp: Vec<UdpConfig>,
    pub serial: Vec<SerialConfig>,
    /// 上行机号（0~255）：所有带机号字段的上行帧统一使用该值。
    /// 为空表示未人工设置，按 [`DEFAULT_UPLINK_AIRCRAFT_ID`] 处理。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uplink_aircraft_id: Option<u8>,
}
#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Copy)]
#[serde(rename_all = "lowercase")]
pub enum UdpMode {
    Unicast,
    #[default]
    Multicast,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug)]
pub struct UdpConfig {
    pub name: String,
    #[serde(default)]
    pub mode: UdpMode,
    pub ip: String,
    pub port: u16,
    #[serde(default)]
    pub target_port: u16,
    pub interface_ip: String,
    pub protocol: ProtocolType,
    pub enabled: bool,
    pub auto_connect: bool,
}

impl UdpConfig {
    pub fn effective_target_port(&self) -> u16 {
        if self.target_port == 0 {
            self.port
        } else {
            self.target_port
        }
    }
}

#[derive(Default, Serialize, Deserialize, Clone, Debug)]
pub struct SerialConfig {
    pub name: String,
    pub port_name: String,
    pub baud_rate: u32,
    #[serde(default = "default_data_bits")]
    pub data_bits: u8,
    #[serde(default = "default_stop_bits")]
    pub stop_bits: u8,
    #[serde(default = "default_parity")]
    pub parity: ParityConfig,
    pub protocol: ProtocolType,
    pub enabled: bool,
    pub auto_connect: bool,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Copy)]
#[serde(rename_all = "lowercase")]
pub enum ParityConfig {
    #[default]
    None,
    Odd,
    Even,
}

fn default_data_bits() -> u8 {
    8
}
fn default_stop_bits() -> u8 {
    1
}
fn default_parity() -> ParityConfig {
    ParityConfig::None
}

impl CommsConfig {
    /// 实际生效的上行机号
    pub fn effective_uplink_aircraft_id(&self) -> u8 {
        self.uplink_aircraft_id
            .unwrap_or(DEFAULT_UPLINK_AIRCRAFT_ID)
    }

    pub fn normalize(&mut self) {
        for udp in &mut self.udp {
            if udp.target_port == 0 {
                udp.target_port = udp.port;
            }
        }
    }

    pub fn file_path(app: &AppHandle) -> Result<PathBuf, String> {
        let mut path = app
            .path()
            .app_config_dir()
            .map_err(|e| format!("获取应用系统目录失败: {}", e))?;

        path.push("comms.json");
        Ok(path)
    }

    pub fn load(app: &AppHandle) -> Self {
        let path = match Self::file_path(app) {
            Ok(p) => p,
            Err(e) => {
                log::error!("{}", e);
                return Self::default();
            }
        };

        if !path.exists() {
            return Self::default();
        }

        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<Self>(&content) {
                Ok(mut config) => {
                    config.normalize();
                    config
                }
                Err(e) => {
                    log::warn!("解析 comms.json 失败, 使用默认值: {}", e);
                    Self::default()
                }
            },
            Err(e) => {
                log::error!("读取配置文件报错: {}", e);
                Self::default()
            }
        }
    }

    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let path = Self::file_path(app)?;

        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
            }
        }

        let mut normalized = self.clone();
        normalized.normalize();
        let json_str = serde_json::to_string_pretty(&normalized)
            .map_err(|e| format!("JSON 序列化失败: {}", e))?;
        fs::write(&path, json_str).map_err(|e| format!("写入 comms.json 失败: {}", e))?;
        log::info!("配置成功写入: {:?}", path);
        Ok(())
    }
}
