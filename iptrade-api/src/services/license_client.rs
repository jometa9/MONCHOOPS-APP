use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLicenseResponse {
    pub email: Option<String>,
    pub name: Option<String>,
    pub plan: Option<String>,
    pub version: Option<String>,
    pub account_limit: Option<u32>,
    pub fixed_lot_size: Option<f64>,
}

impl ExternalLicenseResponse {
    pub fn plan(&self) -> String {
        self.plan
            .as_deref()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "free".to_string())
    }
}

#[derive(Clone)]
pub struct LicenseClient {
    validate_url: String,
    client: reqwest::Client,
}

impl LicenseClient {
    pub fn with_client(validate_url: String, client: reqwest::Client) -> Self {
        Self {
            validate_url,
            client,
        }
    }

    pub async fn validate_api_key(&self, api_key: &str) -> Result<LicenseInfoDto, String> {
        let res = self
            .client
            .get(&self.validate_url)
            .query(&[("apiKey", api_key)])
            .send()
            .await
            .map_err(|_| "Error connecting".to_string())?;

        let status = res.status();
        let body = res.text().await.map_err(|_| "Error connecting".to_string())?;

        if !status.is_success() {
            let msg = serde_json::from_str::<ErrorBody>(&body)
                .ok()
                .and_then(|e| e.error)
                .unwrap_or_else(|| format!("license server returned {}", status));
            return Err(msg);
        }

        let data: ExternalLicenseResponse = serde_json::from_str(&body).map_err(|_| "Error connecting".to_string())?;
        let email = data.email.clone().unwrap_or_default();
        if email.is_empty() {
            return Err("invalid response from license server (missing email)".to_string());
        }
        let user_id = email.clone();
        Ok(LicenseInfoDto {
            user_id,
            email,
            name: data.name.clone().unwrap_or_default(),
            plan: data.plan(),
            account_limit: data.account_limit,
            fixed_lot: data.fixed_lot_size,
            api_key: Some(api_key.to_string()),
            version: data.version.clone(),
        })
    }
}

#[derive(Debug, Deserialize)]
struct ErrorBody {
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LicenseInfoDto {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub plan: String,
    pub account_limit: Option<u32>,
    pub fixed_lot: Option<f64>,
    pub api_key: Option<String>,
    pub version: Option<String>,
}
