use serde::Serialize;
use tracing::info;
use utoipa::ToSchema;
use urlencoding::encode;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use crate::app_state::AppState;
use crate::routes::common::ApiResponse;
use crate::util;
use crate::state::{AppPreferences, LicenseBlock};

#[derive(Debug, Serialize, ToSchema)]
pub struct LicenseInfoResponse {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub subscription_type: String,
    pub account_limit: Option<u32>,
    pub fixed_lot: Option<f64>,
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[utoipa::path(
    post,
    path = "/api/system/validate/{license_key}",
    tag = "System",
    params(("license_key" = String, Path, description = "License key")),
    responses(
        (status = 200, description = "", body = ApiResponse<LicenseInfoResponse>,
            example = json!({
                "success": true,
                "data": {
                    "user_id": "user@example.com",
                    "email": "user@example.com",
                    "name": "User Name",
                    "subscription_type": "unlimited",
                    "account_limit": 5,
                    "fixed_lot": null,
                    "api_key": "stored-key"
                },
                "message": "License validated successfully",
                "errors": null
            })),
        (status = 400, description = "", body = ApiResponse<()>,
            example = json!({"success": false, "data": null, "message": null, "errors": ["license_key is required"]})),
        (status = 401, description = "", body = ApiResponse<()>,
            example = json!({"success": false, "data": null, "message": null, "errors": ["license server returned 401"]}))
    )
)]
pub async fn validate(
    State(state): State<AppState>,
    Path(license_key): Path<String>,
) -> Result<Json<ApiResponse<LicenseInfoResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let license_key = license_key.trim();
    if license_key.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::<()>::err("license_key is required")),
        ));
    }

    let info = state
        .license_client
        .validate_api_key(license_key)
        .await
        .map_err(|e| {
            (
                StatusCode::UNAUTHORIZED,
                Json(ApiResponse::<()>::err(&e)),
            )
        })?;
    let key_to_store = info.api_key.clone().unwrap_or_else(|| license_key.to_string());
    state.auth_state.set_license_key(Some(key_to_store.clone())).await;
    if let Some(ref mgr) = state.state_manager {
        let block = LicenseBlock {
            api_key: Some(key_to_store),
            user_id: Some(info.user_id.clone()),
            email: Some(info.email.clone()),
            subscription_type: Some(info.plan.clone()),
            account_limit: info.account_limit,
            fixed_lot: Some(info.fixed_lot.is_some()),
            fixed_lot_value: info.fixed_lot,
            validated_at_utc: Some(utc_now()),
            expires_at_utc: None,
        };
        mgr.update(|snap| {
            snap.license = Some(block);
        })
        .await;
    }
    info!("license validated (endpoint)");
    if util::should_use_mt5_bridge() {
        let bridge_validate_url = format!(
            "{}/api/system/validate/{}",
            util::mt5_bridge_base_url().trim_end_matches('/'),
            encode(license_key)
        );
        if state
            .http_client
            .post(&bridge_validate_url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .is_err()
        {
            tracing::warn!("MT5 bridge license validate failed (bridge may be unavailable)");
        }
    }
    let response = LicenseInfoResponse {
        user_id: info.user_id,
        email: info.email,
        name: info.name,
        subscription_type: info.plan,
        account_limit: info.account_limit,
        fixed_lot: info.fixed_lot,
        api_key: None,
        version: info.version.clone(),
    };
    Ok(Json(ApiResponse::ok(response, "License validated successfully")))
}

fn utc_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}", t.as_secs())
}

#[utoipa::path(
    post,
    path = "/api/system/logout",
    tag = "System",
    responses(
        (status = 200, description = "", body = ApiResponse<serde_json::Value>,
            example = json!({
                "success": true,
                "data": { "success": true, "accountsCleared": 3 },
                "message": "Logged out successfully. Cleared 3 account(s).",
                "errors": null
            }))
    )
)]
pub async fn logout(State(state): State<AppState>) -> Json<ApiResponse<serde_json::Value>> {
    let accounts_cleared = if let Some(ref mgr) = state.state_manager {
        crate::routes::apply_system_tcp_ordered(&state, false).await;
        mgr.update(|snap| {
            for entry in snap.accounts.values_mut() {
                entry.role = Some("pending".to_string());
            }
        })
        .await;
        mgr.update(|snap| {
            let n = snap.accounts.len();
            snap.license = None;
            snap.accounts.clear();
            snap.preferences = Some(AppPreferences::default());
            n
        })
        .await
    } else {
        0
    };
    crate::routes::accounts::clear_runtime_all_account_state(&state).await;
    crate::services::pos_mapping::delete_all();
    crate::services::slave_mapping::delete_all();
    state.heartbeat_registry.write().await.clear();
    state.auth_state.set_license_key(None).await;
    Json(ApiResponse::ok(
        serde_json::json!({ "success": true, "accountsCleared": accounts_cleared }),
        &format!("Logged out successfully. Cleared {} account(s).", accounts_cleared),
    ))
}

