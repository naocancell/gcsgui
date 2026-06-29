use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct RouteUpload {
    pub code: i32,
    pub points: Vec<PtJson>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct PtJson {
    #[serde(rename = "nPt")]
    pub n_pt: i32,
    #[serde(default)]
    pub ch1: i32,
    #[serde(default)]
    pub ch2: i32,
    #[serde(default)]
    pub speed: f64,
    #[serde(default)]
    pub alt: f64,
    #[serde(default)]
    pub lon: f64,
    #[serde(default)]
    pub lat: f64,
}

impl PtJson {
    pub fn to_bytes(&self, code: i32) -> [u8; 48] {
        let mut bytes = [0u8; 48];
        bytes[0..4].copy_from_slice(&code.to_le_bytes());                  // nL (i32)
        bytes[4..8].copy_from_slice(&self.n_pt.to_le_bytes());             // nPt (i32)
        bytes[8..16].copy_from_slice(&self.lon.to_le_bytes());             // dX (f64)
        bytes[16..24].copy_from_slice(&self.lat.to_le_bytes());            // dY (f64)
        bytes[24..32].copy_from_slice(&self.alt.to_le_bytes());            // nH (f64)
        bytes[32..40].copy_from_slice(&self.speed.to_le_bytes());          // nV (f64)
        bytes[40..44].copy_from_slice(&self.ch1.to_le_bytes());            // ch1 (i32)
        bytes[44..48].copy_from_slice(&self.ch2.to_le_bytes());            // ch2 (i32)
        bytes
    }
}
