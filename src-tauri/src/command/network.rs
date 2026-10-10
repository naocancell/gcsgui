use crate::error::AppError;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceInfo {
    name: String,
    ip: String,
}

#[tauri::command]
pub fn get_network_interfaces() -> Result<Vec<NetworkInterfaceInfo>, AppError> {
    let mut interfaces = Vec::new();
    match get_if_addrs::get_if_addrs() {
        Ok(if_addrs) => {
            for iface in if_addrs {
                if let std::net::IpAddr::V4(ipv4) = iface.addr.ip() {
                    interfaces.push(NetworkInterfaceInfo {
                        name: iface.name,
                        ip: ipv4.to_string(),
                    });
                }
            }
            Ok(interfaces)
        }
        Err(e) => Err(AppError::system(10003, format!("获取网卡列表失败：{}", e))),
    }
}
