use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm,
    Nonce,
};

// AES-GCM 使用 12 字节 nonce，同一密钥下不重复使用
const NONCE_SIZE: usize = 12;
// aes-gcm 把 16 字节认证标签附加在密文末尾，用于检测密钥错误或密文篡改
const TAG_SIZE: usize = 16;

// 使用 AES-256-GCM 加密字节数据。
// 返回的缓存文件格式为：
// `magic | nonce(12 字节) | ciphertext | authentication tag(16 字节)`。
// `key` 必须是 32 字节的 AES-256 密钥；`magic` 用于标识缓存的数据类型，
//禁飞区使用 `NFZ1`
pub(super) fn encrypt_data(
    plaintext: &[u8],
    key: &[u8; 32],
    magic: &[u8],
) -> Result<Vec<u8>, String> {
    // 根据传入的 32 字节密钥创建 AES-256-GCM 加密器
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|error| format!("创建加密器失败: {error}"))?;

    // 每次使用操作系统安全随机数生成新的 nonce
    let mut nonce = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce);

    // encrypt 返回的结果已经包含附加在末尾的 16 字节认证标签
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "AES-GCM 加密失败".to_string())?;

    // 一次性预分配完整文件所需容量，避免追加数据时反复扩容
    let mut result =
        Vec::with_capacity(magic.len() + NONCE_SIZE + ciphertext.len());

    // 按约定顺序组装最终缓存文件。
    result.extend_from_slice(magic);
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

// 解密由 `encrypt_data` 生成的缓存数据
// 解密前会检查文件长度及 `magic`，AES-GCM 解密时还会校验认证标签
// 密钥不正确、密文被修改或认证标签不匹配都会导致解密失败
pub(super) fn decrypt_data(
    encrypted: &[u8],
    key: &[u8; 32],
    magic: &[u8],
) -> Result<Vec<u8>, String> {
    // 文件头由数据类型标识和固定 12 字节 nonce 组成
    let header_size = magic.len() + NONCE_SIZE;

    // 一个合法文件至少要包含文件头和 16 字节认证标签
    if encrypted.len() < header_size + TAG_SIZE {
        return Err("加密缓存格式无效".to_string());
    }

    // 先校验数据类型，是否为禁飞区缓存
    if &encrypted[..magic.len()] != magic {
        return Err("加密缓存文件类型不匹配".to_string());
    }

    // 按加密时的文件格式切出 nonce 和密文
    let nonce_end = magic.len() + NONCE_SIZE;
    let nonce = Nonce::from_slice(&encrypted[magic.len()..nonce_end]);
    let ciphertext = &encrypted[nonce_end..];

    // 使用与加密时相同的密钥创建解密器
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|error| format!("创建解密器失败: {error}"))?;

    // decrypt 会同时完成明文恢复和认证标签校验
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "解密失败，密钥错误或文件已被篡改".to_string())
}
