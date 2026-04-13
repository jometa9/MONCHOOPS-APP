use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::app_state::AppState;
use crate::middleware::AuthState;
use crate::config::{API_KEY_HEADER, API_SECRET_HEADER};
use crate::routes::common::ApiResponse;
use crate::services::account_history::TcpSnapshotMessage;

pub async fn mt5_master_push(
    State(state): State<AppState>,
    Json(msg): Json<TcpSnapshotMessage>,
) -> Result<StatusCode, (StatusCode, Json<ApiResponse<()>>)> {
    let account_id = msg.account.account_id.trim().to_string();
    if account_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::<()>::err("account_id required")),
        ));
    }
    let line = msg.to_json_line().map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::<()>::err(&e.to_string())),
        )
    })?;
    state
        .master_snapshots
        .write()
        .await
        .insert(account_id.clone(), line.clone());
    state
        .ctrader_snapshot_cache
        .write()
        .await
        .insert(account_id.clone(), msg);
    let _ = state.orders_ws_notify_tx.send(());
    if let Some(ref tcp) = state.tcp_server {
        tcp.broadcast(&account_id, &line).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct BrokerSearchQuery {
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerServerResult {
    pub server_name: String,
    pub company: String,
}

pub async fn broker_search(
    State(state): State<AppState>,
    Query(params): Query<BrokerSearchQuery>,
) -> Result<Json<ApiResponse<Vec<BrokerServerResult>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let query = params.query.unwrap_or_default();
    if query.trim().is_empty() {
        return Ok(Json(ApiResponse {
            success: true,
            data: Some(vec![]),
            message: None,
            errors: None,
        }));
    }

    if !crate::util::should_use_mt5_bridge() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::<()>::err("MT5 broker search requires the Windows app with the local MetaTrader bridge.")),
        ));
    }

    let bridge_base = crate::util::mt5_bridge_base_url();
    let url = format!("{}/api/broker-search?query={}", bridge_base, urlencoding::encode(query.trim()));

    let key_with_month = AuthState::key_with_month(&state.auth_state.api_key);
    let secret_with_month = AuthState::key_with_month(&state.auth_state.api_secret);

    let resp = state
        .http_client
        .get(&url)
        .timeout(std::time::Duration::from_secs(15))
        .header(API_KEY_HEADER, &key_with_month)
        .header(API_SECRET_HEADER, &secret_with_month)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(ApiResponse::<()>::err(&format!("MT5 bridge unreachable: {}", e))),
            )
        })?;

    if !resp.status().is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(ApiResponse::<()>::err("MT5 bridge returned an error for broker search")),
        ));
    }

    let body = resp.text().await.unwrap_or_default();

    #[derive(Deserialize)]
    struct BridgeResponse {
        data: Option<Vec<BrokerServerResult>>,
    }

    let parsed: BridgeResponse = serde_json::from_str(&body).unwrap_or(BridgeResponse {
        data: None,
    });

    let servers = parsed.data.unwrap_or_default();
    Ok(Json(ApiResponse {
        success: true,
        data: Some(servers),
        message: None,
        errors: None,
    }))
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route(
            "/api/internal/mt5-master/push",
            axum::routing::post(mt5_master_push),
        )
        .route(
            "/api/mt5/broker-search",
            axum::routing::get(broker_search),
        )
}
