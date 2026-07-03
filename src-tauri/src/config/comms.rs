use crate::comms::ProtocolType;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Default, Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct CommsConfig {
    pub udp: Vec<UdpConfig>,
    pub serial: Vec<SerialConfig>,
}

#[derive(Default, Serialize, Deserialize, Clone, Debug)]
pub struct UdpConfig {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub interface_ip: String,
    pub protocol: ProtocolType,
    pub enabled: bool,
    pub auto_connect: bool,
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
            Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
                log::warn!("解析 comms.json 失败, 使用默认值: {}", e);
                Self::default()
            }),
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

        let json_str =
            serde_json::to_string_pretty(self).map_err(|e| format!("JSON 序列化失败: {}", e))?;
        fs::write(&path, json_str).map_err(|e| format!("写入 comms.json 失败: {}", e))?;
        log::info!("配置成功写入: {:?}", path);
        Ok(())
    }
}
