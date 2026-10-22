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

/// 固定链路（伺服转台与三路人影载荷转发）的固定名称，普通协议返回 None
pub fn fixed_link_name(protocol: ProtocolType) -> Option<&'static str> {
    match protocol {
        ProtocolType::ServoTurntable => Some("伺服转台转发"),
        ProtocolType::PassthroughC0 => Some("大气数据测量转发"),
        ProtocolType::PassthroughC1 => Some("焰条转发"),
        ProtocolType::PassthroughC2 => Some("云滴探测分析系统转发"),
        _ => None,
    }
}

/// 普通链路原样保留；固定链路首次出现时改为固定名称并保留，重复出现时返回 false（丢弃）
fn claim_fixed_link(
    seen: &mut Vec<ProtocolType>,
    protocol: ProtocolType,
    name: &mut String,
) -> bool {
    let Some(fixed_name) = fixed_link_name(protocol) else {
        return true;
    };
    if seen.contains(&protocol) {
        return false;
    }
    seen.push(protocol);
    if name != fixed_name {
        *name = fixed_name.to_string();
    }
    true
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
        self.normalize_fixed_links();
    }

    /// 固定链路按协议识别：名称强制为固定名称，同一协议只保留第一条（UDP 优先于串口）。
    /// 伺服转台只支持 UDP，串口上的伺服转台条目不按固定链路处理（前端会改为 FP981C）。
    fn normalize_fixed_links(&mut self) {
        let mut seen: Vec<ProtocolType> = Vec::new();
        self.udp
            .retain_mut(|udp| claim_fixed_link(&mut seen, udp.protocol, &mut udp.name));
        self.serial.retain_mut(|serial| {
            serial.protocol == ProtocolType::ServoTurntable
                || claim_fixed_link(&mut seen, serial.protocol, &mut serial.name)
        });
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

#[cfg(test)]
mod tests {
    use super::*;

    fn udp(name: &str, protocol: ProtocolType, port: u16) -> UdpConfig {
        UdpConfig {
            name: name.to_string(),
            ip: "127.0.0.1".to_string(),
            port,
            interface_ip: "0.0.0.0".to_string(),
            protocol,
            ..Default::default()
        }
    }

    fn serial(name: &str, protocol: ProtocolType) -> SerialConfig {
        SerialConfig {
            name: name.to_string(),
            port_name: "COM3".to_string(),
            baud_rate: 115200,
            protocol,
            ..Default::default()
        }
    }

    #[test]
    fn fixed_links_renamed_and_deduplicated() {
        let mut config = CommsConfig {
            udp: vec![
                udp("FP95_UDP", ProtocolType::FP95, 8999),
                udp("伺服转台", ProtocolType::ServoTurntable, 6001),
                udp("人影大气测量透传(0xC0)", ProtocolType::PassthroughC0, 9100),
                udp("我的透传", ProtocolType::PassthroughC0, 9200),
                udp("人影云滴透传(0xC2)", ProtocolType::PassthroughC2, 9102),
            ],
            serial: vec![
                serial("主链路", ProtocolType::FP981C),
                serial("焰条串口", ProtocolType::PassthroughC1),
                serial("云滴串口", ProtocolType::PassthroughC2),
                serial("旧伺服", ProtocolType::ServoTurntable),
            ],
            uplink_aircraft_id: None,
        };
        config.normalize();

        let udp_names: Vec<_> = config.udp.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            udp_names,
            vec![
                "FP95_UDP",
                "伺服转台转发",
                "大气数据测量转发",
                "云滴探测分析系统转发"
            ]
        );
        assert_eq!(config.udp[2].port, 9100, "重复的固定链路只保留第一条");
        let serial_names: Vec<_> = config.serial.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(serial_names, vec!["主链路", "焰条转发", "旧伺服"]);
    }
}
