use serde::{Deserialize, Serialize};

pub const SWITCH_BIND_CODE: u8 = 0x2B;
pub const SWITCH_QUERY_CODE: u8 = 0x2C;
pub const AIR_TRAFFIC_BIND_CODE: u8 = 0x37;
pub const AIR_TRAFFIC_QUERY_CODE: u8 = 0x39;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransponderSwitchConfig {
    pub air_ground_state: u8,
    pub df11osc: u8,
    pub spi_state: u8,
    pub mode_switch: u8,
    pub baro_altitude_switch: u8,
    pub adsb_out_switch: u8,
    pub adsb_in_switch: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransponderSwitchReadback {
    pub air_ground_state: String,
    pub df11osc: String,
    pub spi_state: String,
    pub mode_switch: String,
    pub baro_altitude_switch: String,
    pub adsb_out_switch: String,
    pub adsb_in_switch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirTrafficParamConfig {
    pub a_code: Vec<u8>,
    pub s_mode_addr: Vec<String>,
    pub aircraft_category: String,
    pub adsb_emitter_type: String,
    pub flight_number: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AirTrafficParamReadback {
    pub a_code: String,
    pub s_mode_addr: String,
    pub aircraft_category_info: String,
    pub flight_number: String,
}

fn require_bit(value: u8, field: &str) -> Result<u8, String> {
    if value <= 1 {
        Ok(value)
    } else {
        Err(format!("{} 只能为 0 或 1", field))
    }
}

pub fn encode_switch_binding(config: &TransponderSwitchConfig) -> Result<[u8; 15], String> {
    let air_ground = require_bit(config.air_ground_state, "空地指示状态")?;
    let spi = require_bit(config.spi_state, "特殊位置识别")?;
    let adsb_out = require_bit(config.adsb_out_switch, "ADS-B OUT 开关")?;
    let baro = require_bit(config.baro_altitude_switch, "标准气压高度开关")?;
    let adsb_in = require_bit(config.adsb_in_switch, "ADS-B IN 开关")?;
    let df11osc = require_bit(config.df11osc, "DF11 断续振荡开关")?;
    let mode = match config.mode_switch {
        0 => 0x00,
        1 => 0x05,
        2 => 0x07,
        _ => return Err("A/C/S 模式开关取值无效".to_string()),
    };

    let mut payload = [0u8; 15];
    payload[0] = air_ground | (spi << 1) | (mode << 2) | (adsb_out << 5) | (baro << 7);
    payload[1] = adsb_in | (df11osc << 1);
    Ok(payload)
}

fn parse_hex_byte(value: &str, field: &str) -> Result<u8, String> {
    let digits = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .unwrap_or(value);
    if digits.len() != 2 {
        return Err(format!("{} 必须是两位十六进制字节", field));
    }
    u8::from_str_radix(digits, 16).map_err(|_| format!("{} 不是有效十六进制字节", field))
}

fn encode_aircraft_category(category: &str, detail: &str) -> Result<u8, String> {
    let major = match category {
        "A类" => 4,
        "B类" => 3,
        "C类" => 2,
        "D类" => 1,
        _ => return Err("飞行器类别必须为 A类、B类、C类或D类".to_string()),
    };
    let detail_code = match (category, detail) {
        (_, "无ADS-B发射器类型信息") => 0,
        ("A类", "轻型" | "轻型(<7000kg)") => 1,
        ("A类", "小型" | "中型(7000~136000kg)") => 2,
        ("A类", "大型") => 3,
        ("A类", "高漩涡式大型") => 4,
        ("A类", "重型" | "重型(>136000kg)") => 5,
        ("A类", "高性能" | "高机动型") => 6,
        ("A类", "旋翼飞机" | "旋翼机/直升机") => 7,
        ("B类", "滑翔机") => 1,
        ("B类", "Light-than-air超轻型") => 2,
        ("B类", "Parachutist/Skydiver") => 3,
        ("B类", "超轻型/悬挂式滑翔机/翼伞飞行器") => 4,
        ("B类", "无人飞行器" | "无人飞行器(UAV)") => 6,
        ("B类", "Space/Trans-atmospheric vehicle") => 7,
        ("C类", "水面航行器-应急设备") => 1,
        ("C类", "水面航行器-服务设备") => 2,
        ("C类", "单点式障碍物（包括系留气球）") => 3,
        ("D类", "保留（无定义）") => 0,
        _ => return Err(format!("{} 不支持发射器类型“{}”", category, detail)),
    };
    Ok((detail_code << 5) | major)
}

pub fn encode_air_traffic_binding(config: &AirTrafficParamConfig) -> Result<[u8; 15], String> {
    if config.a_code.len() != 4 || config.a_code.iter().any(|digit| *digit > 7) {
        return Err("A代码必须由4个0到7的数字组成".to_string());
    }
    if config.s_mode_addr.len() != 3 {
        return Err("S模式地址必须包含高、中、低3个字节".to_string());
    }
    let high = parse_hex_byte(&config.s_mode_addr[0], "S模式地址高字节")?;
    let middle = parse_hex_byte(&config.s_mode_addr[1], "S模式地址中字节")?;
    let low = parse_hex_byte(&config.s_mode_addr[2], "S模式地址低字节")?;
    if !(1..=0xFE).contains(&low) {
        return Err("S模式地址低字节范围必须为0x01到0xFE".to_string());
    }
    if !config.flight_number.is_ascii() || config.flight_number.len() > 8 {
        return Err("航班号最多8个ASCII字符".to_string());
    }

    let a_code = ((config.a_code[0] as u16) << 9)
        | ((config.a_code[1] as u16) << 6)
        | ((config.a_code[2] as u16) << 3)
        | config.a_code[3] as u16;
    let mut payload = [0u8; 15];
    payload[..2].copy_from_slice(&a_code.to_le_bytes());
    payload[2..5].copy_from_slice(&[low, middle, high]);
    payload[5] = encode_aircraft_category(&config.aircraft_category, &config.adsb_emitter_type)?;
    payload[6..14].fill(b' ');
    payload[6..6 + config.flight_number.len()].copy_from_slice(config.flight_number.as_bytes());
    payload[14] = 0;
    Ok(payload)
}

pub fn decode_switch_query(data: [u8; 16]) -> Result<TransponderSwitchReadback, String> {
    if data[0] != SWITCH_QUERY_CODE {
        return Err(format!("应答机状态查询回报功能码错误: 0x{:02X}", data[0]));
    }
    let state0 = data[1];
    let state1 = data[2];
    let mode_switch = match (state0 >> 2) & 0x07 {
        0x00 => "全关(静默)",
        0x05 => "仅A/S模式",
        0x07 => "A/C/S全开",
        _ => "未定义",
    };
    Ok(TransponderSwitchReadback {
        air_ground_state: if state0 & 0x01 != 0 {
            "空中"
        } else {
            "地面"
        }
        .to_string(),
        df11osc: if state1 & 0x02 != 0 {
            "工作"
        } else {
            "关闭"
        }
        .to_string(),
        spi_state: if state0 & 0x02 != 0 {
            "特殊识别"
        } else {
            "正常"
        }
        .to_string(),
        mode_switch: mode_switch.to_string(),
        baro_altitude_switch: if state0 & 0x80 != 0 {
            "高度有效"
        } else {
            "关闭"
        }
        .to_string(),
        adsb_out_switch: if state0 & 0x20 != 0 {
            "工作"
        } else {
            "关闭"
        }
        .to_string(),
        adsb_in_switch: if state1 & 0x01 != 0 {
            "工作"
        } else {
            "关闭"
        }
        .to_string(),
    })
}

fn decode_aircraft_category(value: u8) -> String {
    let major = value & 0x1F;
    let detail = (value >> 5) & 0x07;
    let category = match major {
        4 => "A类",
        3 => "B类",
        2 => "C类",
        1 => "D类",
        _ => "未定义类别",
    };
    let detail_text = match (major, detail) {
        (4, 0) | (3, 0) | (2, 0) => "无ADS-B发射器类型信息",
        (4, 1) => "轻型",
        (4, 2) => "小型",
        (4, 3) => "大型",
        (4, 4) => "高漩涡式大型",
        (4, 5) => "重型",
        (4, 6) => "高性能",
        (4, 7) => "旋翼飞机",
        (3, 1) => "滑翔机",
        (3, 2) => "超轻型",
        (3, 3) => "跳伞员",
        (3, 4) => "超轻型/悬挂式滑翔机/翼伞飞行器",
        (3, 6) => "无人飞行器",
        (3, 7) => "跨大气层飞行器",
        (2, 1) => "水面航行器-应急设备",
        (2, 2) => "水面航行器-服务设备",
        (2, 3) => "单点式障碍物",
        _ => "未定义",
    };
    format!("{}（{}）", category, detail_text)
}

pub fn decode_air_traffic_query(data: [u8; 16]) -> Result<AirTrafficParamReadback, String> {
    if data[0] != AIR_TRAFFIC_QUERY_CODE {
        return Err(format!("航管参数查询回报功能码错误: 0x{:02X}", data[0]));
    }
    let payload = &data[1..];
    let a_code = u16::from_le_bytes([payload[0], payload[1]]);
    let a_code_text = format!(
        "{}{}{}{}",
        (a_code >> 9) & 0x07,
        (a_code >> 6) & 0x07,
        (a_code >> 3) & 0x07,
        a_code & 0x07,
    );
    let flight_end = payload[6..14]
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(8);
    let flight_bytes = &payload[6..6 + flight_end];
    if !flight_bytes.is_ascii() {
        return Err("航班号回报不是ASCII字符串".to_string());
    }
    let flight_number = std::str::from_utf8(flight_bytes)
        .map_err(|_| "航班号回报不是有效ASCII字符串".to_string())?
        .trim_end_matches(' ')
        .to_string();

    Ok(AirTrafficParamReadback {
        a_code: a_code_text,
        s_mode_addr: format!("0x{:02X}{:02X}{:02X}", payload[4], payload[3], payload[2]),
        aircraft_category_info: decode_aircraft_category(payload[5]),
        flight_number,
    })
}

pub fn matches_switch_binding(data: &[u8; 16], expected: &[u8; 15]) -> bool {
    data[0] == SWITCH_BIND_CODE && data[1..3] == expected[0..2]
}

pub fn matches_air_traffic_binding(data: &[u8; 16], expected: &[u8; 15]) -> bool {
    data[0] == AIR_TRAFFIC_BIND_CODE && data[1..16] == expected[..]
}

pub const WEIGHT_BIND_CODE: u8 = 0x25;
pub const WEIGHT_QUERY_CODE: u8 = 0x27;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightBindingConfig {
    pub empty_uav_weight: u16,
    pub empty_uav_c: f64,
    pub load_weight: u16,
    pub load_c: f64,
    pub oil_total: u16,
    pub oil_type: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightReadback {
    pub empty_uav_weight: u16,
    pub empty_uav_c: f64,
    pub load_weight: u16,
    pub load_c: f64,
    pub oil_total: u16,
    pub oil_type: u8,
}

pub fn encode_weight_binding(config: &WeightBindingConfig) -> Result<[u8; 15], String> {
    if !config.empty_uav_c.is_finite() || config.empty_uav_c < 0.0 {
        return Err("空机重心必须为有限非负数值".to_string());
    }
    if !config.load_c.is_finite() || config.load_c < 0.0 {
        return Err("货物重心必须为有限非负数值".to_string());
    }
    if !(1..=4).contains(&config.oil_type) {
        return Err("燃油类型必须为 1 到 4".to_string());
    }

    let empty_c_scaled = (config.empty_uav_c * 100.0).round();
    if empty_c_scaled > u16::MAX as f64 {
        return Err("空机重心数值超出表示范围".to_string());
    }
    let empty_c_raw = empty_c_scaled as u16;

    let load_c_scaled = (config.load_c * 10.0).round();
    if load_c_scaled > u16::MAX as f64 {
        return Err("货物重心数值超出表示范围".to_string());
    }
    let load_c_raw = load_c_scaled as u16;

    let mut payload = [0u8; 15];
    payload[0..2].copy_from_slice(&config.empty_uav_weight.to_le_bytes());
    payload[2..4].copy_from_slice(&empty_c_raw.to_le_bytes());
    payload[4..6].copy_from_slice(&config.load_weight.to_le_bytes());
    payload[6..8].copy_from_slice(&load_c_raw.to_le_bytes());
    payload[8..10].copy_from_slice(&config.oil_total.to_le_bytes());
    payload[10] = config.oil_type;
    Ok(payload)
}

pub fn decode_weight_query(data: [u8; 16]) -> Result<WeightReadback, String> {
    if data[0] != WEIGHT_QUERY_CODE {
        return Err(format!("重量参数查询回报功能码错误: 0x{:02X}", data[0]));
    }
    let empty_uav_weight = u16::from_le_bytes([data[1], data[2]]);
    let empty_c_raw = u16::from_le_bytes([data[3], data[4]]);
    let load_weight = u16::from_le_bytes([data[5], data[6]]);
    let load_c_raw = u16::from_le_bytes([data[7], data[8]]);
    let oil_total = u16::from_le_bytes([data[9], data[10]]);
    let raw_oil_type = data[11];
    let oil_type = match raw_oil_type {
        0 => 4,
        1..=4 => raw_oil_type,
        _ => return Err(format!("燃油类型回报取值无效: {}", raw_oil_type)),
    };

    let empty_uav_c = (empty_c_raw as f64) * 0.01;
    let load_c = (load_c_raw as f64) * 0.1;

    Ok(WeightReadback {
        empty_uav_weight,
        empty_uav_c,
        load_weight,
        load_c,
        oil_total,
        oil_type,
    })
}

pub fn matches_weight_binding(data: &[u8; 16], expected: &[u8; 15]) -> bool {
    data[0] == WEIGHT_BIND_CODE && data[1..16] == expected[..]
}

