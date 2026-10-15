//! dat 记录文件格式编解码（"GCSREC" v1）。
//!
//! 文件布局（全部小端序，无对齐填充）：
//!
//! ```text
//! FileHeader（记录开始时一次性写入）
//!   magic[6]          "GCSREC"
//!   version: u16      = 1
//!   header_size: u32  文件头总字节数（含尾部 CRC32）
//!   start_wall_ms: i64 记录开始的墙钟时间（Unix epoch 毫秒）
//!   reserved[8]       置零，扩展预留
//!   link_table_count: u32
//!   link_entry × N    { link_id: u16, protocol: u8, link_type: u8, name_len: u8, name: utf8 }
//!   header_crc32: u32 对此前文件头全部字节校验
//!
//! Record（变长，随数据流持续追加，单条固定开销 19 字节）
//!   type: u8          0=RxRaw 1=TxFrame 2=LinkAnnounce 3=LinkRestart 4=Bookmark
//!   timestamp_ns: u64 相对记录开始的纳秒偏移
//!   link_id: u16
//!   payload_len: u32
//!   payload_crc32: u32
//!   payload: [u8; payload_len]
//! ```
//!
//! 崩溃安全语义：每条记录自带长度与 CRC32，回放读到第一条 CRC 不符
//! 或长度异常的记录即截断停止，之前的所有记录完整可用。

use std::io::{self, Read};

use crate::comms::ProtocolType;

pub const MAGIC: [u8; 6] = *b"GCSREC";
pub const VERSION: u16 = 1;

/// 文件头定长前缀：magic(6) + version(2) + header_size(4) + start_wall_ms(8)
/// + reserved(8) + link_table_count(4)
pub const HEADER_FIXED_LEN: usize = 32;

/// 单条记录固定开销：type(1) + ts(8) + link_id(2) + len(4) + crc(4)
pub const RECORD_OVERHEAD: usize = 19;

/// 单条 payload 防御性上限（超出视为文件损坏）
pub const MAX_PAYLOAD: usize = 1 << 20;

/// 记录类型码
pub mod record_type {
    /// 链路一次 recv/read 的原始字节块
    pub const RX_RAW: u8 = 0;
    /// 上行发送的原始帧（V2）
    pub const TX_FRAME: u8 = 1;
    /// 记录中途新链路动态入表
    pub const LINK_ANNOUNCE: u8 = 2;
    /// 链路热重载重启（代数递增）标记
    pub const LINK_RESTART: u8 = 3;
    /// 人工标注事件点（V2）
    pub const BOOKMARK: u8 = 4;
}

/// 链路物理介质分类码
pub mod link_kind {
    pub const UDP: u8 = 0;
    pub const SERIAL: u8 = 1;
    pub const OTHER: u8 = 2;
}

/// 链路表条目：文件头与 LinkAnnounce 记录共用同一序列化布局
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkEntry {
    pub link_id: u16,
    pub protocol: u8,
    pub link_type: u8,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileHeader {
    /// 记录开始的墙钟时间（Unix epoch 毫秒）
    pub start_wall_ms: i64,
    pub links: Vec<LinkEntry>,
}

/// dat 文件解析错误
#[derive(Debug, thiserror::Error)]
pub enum DatError {
    #[error("IO 读写失败: {0}")]
    Io(#[from] io::Error),
    #[error("非法的 dat 文件标识（非 GCSREC）")]
    InvalidMagic,
    #[error("不支持的 dat 版本: {0}（当前软件支持 {VERSION}）")]
    UnsupportedVersion(u16),
    #[error("文件头 CRC32 校验失败，文件已损坏")]
    HeaderCrcMismatch,
    #[error("文件头结构非法: {0}")]
    InvalidHeader(String),
}

/// ProtocolType 与 u8 编码互转（文件头链路表 / LinkAnnounce 使用）
pub fn protocol_to_u8(p: ProtocolType) -> u8 {
    match p {
        ProtocolType::FP981C => 0,
        ProtocolType::UAVInfo => 1,
        ProtocolType::FP95 => 2,
        ProtocolType::ServoTurntable => 3,
        ProtocolType::PassthroughC0 => 4,
        ProtocolType::PassthroughC1 => 5,
        ProtocolType::PassthroughC2 => 6,
    }
}

/// 把 u8 解码回 ProtocolType，非法值返回 None
pub fn protocol_from_u8(v: u8) -> Option<ProtocolType> {
    match v {
        0 => Some(ProtocolType::FP981C),
        1 => Some(ProtocolType::UAVInfo),
        2 => Some(ProtocolType::FP95),
        3 => Some(ProtocolType::ServoTurntable),
        4 => Some(ProtocolType::PassthroughC0),
        5 => Some(ProtocolType::PassthroughC1),
        6 => Some(ProtocolType::PassthroughC2),
        _ => None,
    }
}

/// 兼容旧引用的别名
pub use protocol_from_u8 as decode_protocol;
pub use protocol_to_u8 as encode_protocol;

fn encode_link_entry_into(out: &mut Vec<u8>, entry: &LinkEntry) {
    let name = entry.name.as_bytes();
    debug_assert!(name.len() <= 255, "链路名超过 255 字节将被截断");
    out.extend_from_slice(&entry.link_id.to_le_bytes());
    out.push(entry.protocol);
    out.push(entry.link_type);
    out.push(name.len().min(255) as u8);
    out.extend_from_slice(&name[..name.len().min(255)]);
}

fn decode_link_entry(buf: &[u8]) -> Result<(LinkEntry, usize), DatError> {
    if buf.len() < 5 {
        return Err(DatError::InvalidHeader("链路表条目不完整".into()));
    }
    let link_id = u16::from_le_bytes([buf[0], buf[1]]);
    let protocol = buf[2];
    let link_type = buf[3];
    let name_len = buf[4] as usize;
    if buf.len() < 5 + name_len {
        return Err(DatError::InvalidHeader("链路名不完整".into()));
    }
    let name = String::from_utf8_lossy(&buf[5..5 + name_len]).into_owned();
    Ok((LinkEntry { link_id, protocol, link_type, name }, 5 + name_len))
}

/// 编码完整文件头（含尾部 CRC32）
pub fn encode_header(header: &FileHeader) -> Vec<u8> {
    let mut body = Vec::with_capacity(HEADER_FIXED_LEN + header.links.len() * 16);
    body.extend_from_slice(&MAGIC);
    body.extend_from_slice(&VERSION.to_le_bytes());
    // header_size 占位，回填
    body.extend_from_slice(&0u32.to_le_bytes());
    body.extend_from_slice(&header.start_wall_ms.to_le_bytes());
    body.extend_from_slice(&[0u8; 8]);
    body.extend_from_slice(&(header.links.len() as u32).to_le_bytes());
    for entry in &header.links {
        encode_link_entry_into(&mut body, entry);
    }
    let header_size = (body.len() + 4) as u32;
    body[8..12].copy_from_slice(&header_size.to_le_bytes());
    let crc = crc32fast::hash(&body);
    body.extend_from_slice(&crc.to_le_bytes());
    body
}

/// 从读取源解析文件头。成功后读取位置停在第一条记录起点。
pub fn read_header<R: Read>(reader: &mut R) -> Result<FileHeader, DatError> {
    let mut fixed = [0u8; HEADER_FIXED_LEN];
    reader.read_exact(&mut fixed)?;
    if fixed[..6] != MAGIC {
        return Err(DatError::InvalidMagic);
    }
    let version = u16::from_le_bytes([fixed[6], fixed[7]]);
    if version != VERSION {
        return Err(DatError::UnsupportedVersion(version));
    }
    let header_size = u32::from_le_bytes([fixed[8], fixed[9], fixed[10], fixed[11]]) as usize;
    if header_size < HEADER_FIXED_LEN + 4 || header_size > MAX_PAYLOAD {
        return Err(DatError::InvalidHeader(format!("非法 header_size: {header_size}")));
    }
    let start_wall_ms = i64::from_le_bytes(fixed[12..20].try_into().unwrap());
    let mut rest = vec![0u8; header_size - HEADER_FIXED_LEN];
    reader.read_exact(&mut rest)?;

    // CRC 覆盖"定长前缀 + 链路表"（与 encode_header 口径一致）
    let body_len = rest.len() - 4;
    let stored_crc = u32::from_le_bytes(rest[body_len..].try_into().unwrap());
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(&fixed);
    hasher.update(&rest[..body_len]);
    if hasher.finalize() != stored_crc {
        return Err(DatError::HeaderCrcMismatch);
    }

    let count = u32::from_le_bytes(fixed[28..32].try_into().unwrap()) as usize;
    let mut links = Vec::with_capacity(count);
    let mut offset = 0usize;
    for _ in 0..count {
        let (entry, consumed) = decode_link_entry(&rest[offset..body_len])?;
        links.push(entry);
        offset += consumed;
    }
    if offset != body_len {
        return Err(DatError::InvalidHeader("链路表长度与 header_size 不一致".into()));
    }

    Ok(FileHeader { start_wall_ms, links })
}

/// 一条记录（借用形式，供编码）
#[derive(Debug, Clone)]
pub struct Record<'a> {
    pub record_type: u8,
    pub timestamp_ns: u64,
    pub link_id: u16,
    pub payload: &'a [u8],
}

/// 一条记录（持有形式，供解码）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedRecord {
    pub record_type: u8,
    pub timestamp_ns: u64,
    pub link_id: u16,
    pub payload: Vec<u8>,
}

/// 编码一条记录并追加到 out（自动计算 payload CRC32）
pub fn encode_record_into(out: &mut Vec<u8>, record: &Record) {
    out.push(record.record_type);
    out.extend_from_slice(&record.timestamp_ns.to_le_bytes());
    out.extend_from_slice(&record.link_id.to_le_bytes());
    out.extend_from_slice(&(record.payload.len() as u32).to_le_bytes());
    out.extend_from_slice(&crc32fast::hash(record.payload).to_le_bytes());
    out.extend_from_slice(record.payload);
}

/// 把 LinkEntry 编码为 LinkAnnounce 记录的 payload
pub fn encode_link_announce_payload(entry: &LinkEntry) -> Vec<u8> {
    let mut out = Vec::with_capacity(5 + entry.name.len());
    encode_link_entry_into(&mut out, entry);
    out
}

/// 解析 LinkAnnounce 记录的 payload
pub fn decode_link_announce_payload(payload: &[u8]) -> Result<LinkEntry, DatError> {
    decode_link_entry(payload).map(|(entry, _)| entry)
}

/// 流式记录读取器：逐条读取并校验。
///
/// 截断语义：EOF 恰好落在记录边界 → 干净结束（`next_record` 返回 `Ok(None)`）；
/// 部分记录 / CRC 不符 / payload_len 异常 → 视为损坏尾部，同样返回 `Ok(None)`
/// 并置 `was_truncated() == true`，之前的记录仍全部有效。
pub struct RecordReader<R> {
    inner: R,
    truncated: bool,
}

impl<R: Read> RecordReader<R> {
    pub fn new(inner: R) -> Self {
        Self { inner, truncated: false }
    }

    pub fn into_inner(self) -> R {
        self.inner
    }

    /// 尾部是否因损坏/截断而提前终止
    pub fn was_truncated(&self) -> bool {
        self.truncated
    }

    /// 读取下一条记录；返回 Ok(None) 表示结束（干净 EOF 或损坏截断）
    pub fn next_record(&mut self) -> Result<Option<OwnedRecord>, DatError> {
        if self.truncated {
            return Ok(None);
        }
        let mut head = [0u8; RECORD_OVERHEAD];
        match read_exact_or_eof(&mut self.inner, &mut head) {
            Ok(true) => {}
            Ok(false) => return Ok(None), // 干净 EOF（记录边界）
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
                // 头部被截断 → 损坏尾部，停止
                self.truncated = true;
                return Ok(None);
            }
            Err(e) => {
                self.truncated = true;
                return Err(DatError::Io(e));
            }
        }

        let record_type = head[0];
        let timestamp_ns = u64::from_le_bytes(head[1..9].try_into().unwrap());
        let link_id = u16::from_le_bytes(head[9..11].try_into().unwrap());
        let payload_len = u32::from_le_bytes(head[11..15].try_into().unwrap()) as usize;
        let stored_crc = u32::from_le_bytes(head[15..19].try_into().unwrap());

        if payload_len > MAX_PAYLOAD {
            self.truncated = true;
            return Ok(None);
        }

        let mut payload = vec![0u8; payload_len];
        if payload_len > 0 {
            match read_exact_or_eof(&mut self.inner, &mut payload) {
                Ok(true) => {}
                Ok(false) | Err(_) => {
                    // 载荷被截断或读取失败 → 损坏尾部，停止
                    self.truncated = true;
                    return Ok(None);
                }
            }
        }

        if crc32fast::hash(&payload) != stored_crc {
            self.truncated = true;
            return Ok(None);
        }

        Ok(Some(OwnedRecord { record_type, timestamp_ns, link_id, payload }))
    }
}

/// 读取精确填满 buf；返回 false 表示在读到任何字节前就 EOF（干净边界）
fn read_exact_or_eof<R: Read>(reader: &mut R, buf: &mut [u8]) -> io::Result<bool> {
    let mut filled = 0usize;
    while filled < buf.len() {
        let n = reader.read(&mut buf[filled..])?;
        if n == 0 {
            if filled == 0 {
                return Ok(false);
            }
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "记录在尾部被截断",
            ));
        }
        filled += n;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_header() -> FileHeader {
        FileHeader {
            start_wall_ms: 1_760_000_000_000,
            links: vec![
                LinkEntry { link_id: 0, protocol: 2, link_type: 0, name: "FP95-UDP".into() },
                LinkEntry { link_id: 1, protocol: 0, link_type: 1, name: "链路-串口".into() },
            ],
        }
    }

    #[test]
    fn test_header_roundtrip() {
        let encoded = encode_header(&sample_header());
        // header_size 字段自洽
        let header_size = u32::from_le_bytes(encoded[8..12].try_into().unwrap()) as usize;
        assert_eq!(header_size, encoded.len());
        let mut cursor = io::Cursor::new(&encoded);
        let decoded = read_header(&mut cursor).unwrap();
        assert_eq!(decoded, sample_header());
        // 读取位置停在第一条记录起点（即文件末尾）
        assert_eq!(cursor.position() as usize, encoded.len());
    }

    #[test]
    fn test_header_rejects_bad_magic() {
        let mut encoded = encode_header(&sample_header());
        encoded[0] = b'X';
        let mut cursor = io::Cursor::new(&encoded);
        assert!(matches!(
            read_header(&mut cursor),
            Err(DatError::InvalidMagic)
        ));
    }

    #[test]
    fn test_header_rejects_bad_crc() {
        let mut encoded = encode_header(&sample_header());
        let last = encoded.len() - 1;
        encoded[last] ^= 0xFF;
        let mut cursor = io::Cursor::new(&encoded);
        assert!(matches!(
            read_header(&mut cursor),
            Err(DatError::HeaderCrcMismatch)
        ));
    }

    #[test]
    fn test_record_roundtrip() {
        let mut stream = Vec::new();
        let payloads: [&[u8]; 3] = [b"hello", b"", &[0xEB, 0x90, 0x00, 0xFF]];
        for (i, p) in payloads.iter().enumerate() {
            encode_record_into(&mut stream, &Record {
                record_type: record_type::RX_RAW,
                timestamp_ns: 1_000_000 * i as u64,
                link_id: i as u16,
                payload: p,
            });
        }

        let mut reader = RecordReader::new(io::Cursor::new(&stream));
        for (i, p) in payloads.iter().enumerate() {
            let rec = reader.next_record().unwrap().expect("应有记录");
            assert_eq!(rec.record_type, record_type::RX_RAW);
            assert_eq!(rec.timestamp_ns, 1_000_000 * i as u64);
            assert_eq!(rec.link_id, i as u16);
            assert_eq!(rec.payload, *p);
        }
        assert!(reader.next_record().unwrap().is_none());
        assert!(!reader.was_truncated(), "干净 EOF 不算截断");
    }

    #[test]
    fn test_record_size_overhead() {
        let mut stream = Vec::new();
        encode_record_into(&mut stream, &Record {
            record_type: 0,
            timestamp_ns: 0,
            link_id: 0,
            payload: b"abcd",
        });
        assert_eq!(stream.len(), RECORD_OVERHEAD + 4);
    }

    #[test]
    fn test_truncated_tail_stops_cleanly() {
        let mut stream = Vec::new();
        for i in 0..5u64 {
            encode_record_into(&mut stream, &Record {
                record_type: record_type::RX_RAW,
                timestamp_ns: i,
                link_id: 0,
                payload: &[0xAA; 32],
            });
        }
        // 砍掉最后 10 字节 → 最后一条变残缺
        let cut = &stream[..stream.len() - 10];
        let mut reader = RecordReader::new(io::Cursor::new(cut));
        let mut count = 0;
        while reader.next_record().unwrap().is_some() {
            count += 1;
        }
        assert_eq!(count, 4, "前 4 条完整可用");
        assert!(reader.was_truncated());
    }

    #[test]
    fn test_crc_tamper_detected() {
        let mut stream = Vec::new();
        encode_record_into(&mut stream, &Record {
            record_type: 0,
            timestamp_ns: 0,
            link_id: 0,
            payload: b"good-record",
        });
        let good_len = stream.len();
        encode_record_into(&mut stream, &Record {
            record_type: 0,
            timestamp_ns: 1,
            link_id: 0,
            payload: b"tampered",
        });
        // 篡改第二条的 payload 首字节（位于固定头之后）
        stream[good_len + RECORD_OVERHEAD] ^= 0xFF;

        let mut reader = RecordReader::new(io::Cursor::new(&stream));
        assert!(reader.next_record().unwrap().is_some());
        assert!(reader.next_record().unwrap().is_none(), "CRC 不符即停");
        assert!(reader.was_truncated());
    }

    #[test]
    fn test_absurd_payload_len_stops() {
        let mut stream = Vec::new();
        stream.push(0u8);
        stream.extend_from_slice(&0u64.to_le_bytes());
        stream.extend_from_slice(&0u16.to_le_bytes());
        stream.extend_from_slice(&(u32::MAX).to_le_bytes());
        stream.extend_from_slice(&0u32.to_le_bytes());
        let mut reader = RecordReader::new(io::Cursor::new(&stream));
        assert!(reader.next_record().unwrap().is_none());
        assert!(reader.was_truncated());
    }

    #[test]
    fn test_link_announce_payload_roundtrip() {
        let entry = LinkEntry { link_id: 7, protocol: 1, link_type: 1, name: "新链路".into() };
        let payload = encode_link_announce_payload(&entry);
        let decoded = decode_link_announce_payload(&payload).unwrap();
        assert_eq!(decoded, entry);
    }

    #[test]
    fn test_protocol_codec() {
        for p in [
            ProtocolType::FP981C,
            ProtocolType::UAVInfo,
            ProtocolType::FP95,
            ProtocolType::ServoTurntable,
            ProtocolType::PassthroughC0,
            ProtocolType::PassthroughC1,
            ProtocolType::PassthroughC2,
        ] {
            assert_eq!(decode_protocol(encode_protocol(p)), Some(p));
        }
        assert_eq!(decode_protocol(200), None);
    }
}
