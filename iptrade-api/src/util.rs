pub fn tcp_host_for_accounts() -> String {
    std::env::var("TCP_PUBLIC_HOST")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "localhost".to_string())
}

pub fn api_base_for_accounts(port: u16) -> String {
    std::env::var("API_BASE_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("http://localhost:{}", port))
}

pub fn tcp_port_from_base_url(tcp_base_url: &str) -> Option<u16> {
    let s = tcp_base_url.trim();
    let after_last_colon = s.rfind(':').map(|i| &s[i + 1..])?;
    after_last_colon.split('/').next()?.parse().ok()
}

pub fn tcp_url_for_account(tcp_port: u16, account_id: &str) -> String {
    format!("tcp://{}:{}/{}", tcp_host_for_accounts(), tcp_port, account_id)
}

pub fn should_use_mt5_bridge() -> bool {
    matches!(std::env::var("IPTRADE_ELECTRON_PLATFORM").as_deref(), Ok("win32"))
}

pub fn mt5_bridge_base_url() -> String {
    if let Ok(u) = std::env::var("IPTRADE_MT5_BRIDGE_URL") {
        let t = u.trim();
        if !t.is_empty() {
            return t.trim_end_matches('/').to_string();
        }
    }
    let port = std::env::var("IPTRADE_MT5_BRIDGE_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(crate::build_config::MT5_BRIDGE_PORT);
    format!("http://127.0.0.1:{}", port)
}

pub fn mt5_bridge_account_post_url(account_id: &str) -> String {
    format!(
        "{}/api/accounts/{}",
        mt5_bridge_base_url().trim_end_matches('/'),
        account_id.trim()
    )
}

