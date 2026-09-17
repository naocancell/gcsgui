mod frame80_to_83;
mod frame84;
mod frame94;
pub use frame80_to_83::*;
pub use frame84::*;
pub use frame94::*;

use gcs_macros::FPSubFrame;
use serde::Serialize;

// ================= 解析入口 =================
#[derive(FPSubFrame, Debug, Clone, Serialize)]
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

/// FP95 单机全状态聚合模型。
///
/// 其中 frame94 为多子帧聚合容器 FP95Frame94Aggregate，
/// 确保 ADS-B（Sub1）、防除冰（Sub2）及未来扩展子帧长期并存且独立刷新。
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FP95Aggregate {
    pub uav_id: u8,
    pub frame80: Option<FP95Frame80>,
    pub frame81: Option<FP95Frame81>,
    pub frame83: Option<FP95Frame83>,
    pub frame84: Option<FP95Frame84>,
    pub frame94: Option<FP95Frame94Aggregate>,
}

impl FP95Aggregate {
    pub fn merge(&mut self, parsed: ParsedSubFrame) {
        match parsed {
            ParsedSubFrame::Frame80(val) => self.frame80 = Some(val),
            ParsedSubFrame::Frame81(val) => self.frame81 = Some(val),
            ParsedSubFrame::Frame83(val) => self.frame83 = Some(val),
            ParsedSubFrame::Frame84(val) => self.frame84 = Some(val),
            ParsedSubFrame::Frame94(val) => {
                let agg = self.frame94.get_or_insert_with(Default::default);
                agg.merge(val);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fp95_aggregate_frame94_multi_subframe_coexistence() {
        let mut aggregate = FP95Aggregate::default();
        aggregate.uav_id = 95;

        // 1. 合并数据注入回报帧 80
        aggregate.merge(ParsedSubFrame::Frame80(FP95Frame80 {
            reserved: [0; 8],
            injection_response: [0; 16],
            trailing_reserved: 0,
        }));
        assert!(aggregate.frame80.is_some());


        // 2. 合并 94 帧子帧 1 (ADS-B)
        aggregate.merge(ParsedSubFrame::Frame94(FP95Frame94::Sub1(FP95Frame94Sub1 {
            s_address: "A1B2C3".to_string(),
            ads_alt: 2500.0,
            ..Default::default()
        })));
        assert!(aggregate.frame94.is_some());
        let f94 = aggregate.frame94.as_ref().unwrap();
        assert!(f94.sub1.is_some());
        assert!(f94.sub2.is_none());

        // 3. 合并 94 帧子帧 2 (防除冰)
        aggregate.merge(ParsedSubFrame::Frame94(FP95Frame94::Sub2(FP95Frame94Sub2 {
            target_power: 4000,
            current_power: 3950,
            work_mode_desc: "恒温模式".to_string(),
            ..Default::default()
        })));

        // 核心验证：Sub1 和 Sub2 必须同时存在，不能互相覆盖！
        let f94 = aggregate.frame94.as_ref().unwrap();
        assert!(f94.sub1.is_some(), "Sub1 应该继续存在");
        assert!(f94.sub2.is_some(), "Sub2 应该成功合入并存在");
        assert_eq!(f94.sub1.as_ref().unwrap().s_address, "A1B2C3");
        assert_eq!(f94.sub2.as_ref().unwrap().target_power, 4000);

        // 4. 再次推送新的 Sub1，Sub2 依然不受影响
        aggregate.merge(ParsedSubFrame::Frame94(FP95Frame94::Sub1(FP95Frame94Sub1 {
            s_address: "A1B2C3".to_string(),
            ads_alt: 2600.0,
            ..Default::default()
        })));
        let f94 = aggregate.frame94.as_ref().unwrap();
        assert_eq!(f94.sub1.as_ref().unwrap().ads_alt, 2600.0);
        assert_eq!(f94.sub2.as_ref().unwrap().target_power, 4000);
    }
}


