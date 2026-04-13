use crate::app_state::AppState;
use crate::routes::accounts::{is_mt5_headless_bridge_target, push_mt5_account_to_bridge, Mt5BridgePushOutcome};
use crate::state::AccountEntry;
use crate::timings;
use crate::util;
use futures_util::future::join_all;
use std::time::Duration;

#[derive(Debug, Default)]
pub struct Mt5BridgeSyncSummary {
    pub accounts: usize,
    pub sent: usize,
    pub had_unreachable: bool,
    pub failed: Vec<(String, String)>,
}

pub async fn ping_mt5_bridge_reachable(http: &reqwest::Client) -> bool {
    let url = format!("{}/api/health", util::mt5_bridge_base_url().trim_end_matches('/'));
    match http
        .get(&url)
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

pub async fn sync_all_headless_accounts_to_bridge(state: &AppState) -> Mt5BridgeSyncSummary {
    let mut summary = Mt5BridgeSyncSummary::default();
    let Some(ref mgr) = state.state_manager else {
        return summary;
    };
    let list: Vec<(String, AccountEntry)> = mgr
        .read(|snap| {
            snap.accounts
                .iter()
                .filter(|(_, e)| is_mt5_headless_bridge_target(e))
                .map(|(id, e)| (id.clone(), e.clone()))
                .collect()
        })
        .await;
    summary.accounts = list.len();
    if list.is_empty() {
        return summary;
    }

    let ids_to_clear: Vec<String> = list.iter().map(|(id, _)| id.clone()).collect();
    mgr.update(|snap| {
        for id in &ids_to_clear {
            if let Some(entry) = snap.accounts.get_mut(id) {
                if entry.reconnect_type.is_some() {
                    tracing::debug!(account_id = %id, old = ?entry.reconnect_type, "clearing stale reconnect_type before bridge resync");
                    entry.reconnect_type = None;
                }
            }
        }
    })
    .await;

    let app = state.clone();
    let pushes = list.into_iter().map(|(account_id, entry)| {
        let app = app.clone();
        async move {
            let outcome = push_mt5_account_to_bridge(&app, &account_id, &entry).await;
            (account_id, outcome)
        }
    });
    for (account_id, outcome) in join_all(pushes).await {
        match outcome {
            Mt5BridgePushOutcome::Sent => summary.sent += 1,
            Mt5BridgePushOutcome::SkippedUnreachable => summary.had_unreachable = true,
            Mt5BridgePushOutcome::Failed(msg) => summary.failed.push((account_id, msg)),
        }
    }
    summary
}

pub async fn run_mt5_bridge_resync_loop(app_state: AppState) {
    tokio::time::sleep(Duration::from_secs(timings::MT5_BRIDGE_SYNC_INITIAL_DELAY_SECS)).await;
    let mut bridge_was_reachable = false;
    let mut pending_retries: Vec<String> = Vec::new();
    let mut retry_count: u32 = 0;
    loop {
        let reachable = ping_mt5_bridge_reachable(&app_state.http_client).await;
        if reachable {
            if !bridge_was_reachable {
                pending_retries.clear();
                retry_count = 0;
                let summary = sync_all_headless_accounts_to_bridge(&app_state).await;
                if summary.accounts > 0 {
                    if summary.had_unreachable {
                        tracing::warn!(
                            accounts = summary.accounts,
                            sent = summary.sent,
                            failed = ?summary.failed,
                            "MT5 bridge sync: bridge reachable but POST failed for some accounts (unreachable mid-batch?)"
                        );
                    } else if !summary.failed.is_empty() {
                        tracing::warn!(
                            accounts = summary.accounts,
                            sent = summary.sent,
                            failed = ?summary.failed,
                            "MT5 bridge sync: some accounts failed to apply (check broker credentials / license on bridge)"
                        );
                    } else {
                        tracing::info!(
                            accounts = summary.accounts,
                            sent = summary.sent,
                            "MT5 bridge sync: pushed headless credentials to iptrade-mt5-api"
                        );
                    }
                    for (id, _msg) in &summary.failed {
                        pending_retries.push(id.clone());
                    }
                }
            } else if !pending_retries.is_empty() && retry_count < timings::MT5_BRIDGE_SYNC_MAX_RETRIES {
                retry_count += 1;
                let retried = retry_failed_accounts(&app_state, &pending_retries).await;
                let mut still_failing = Vec::new();
                for (id, outcome) in retried {
                    match outcome {
                        Mt5BridgePushOutcome::Sent => {
                            tracing::info!(account_id = %id, attempt = retry_count, "MT5 bridge retry: account pushed successfully");
                        }
                        Mt5BridgePushOutcome::SkippedUnreachable | Mt5BridgePushOutcome::Failed(_) => {
                            still_failing.push(id);
                        }
                    }
                }
                pending_retries = still_failing;
                if pending_retries.is_empty() {
                    tracing::info!("MT5 bridge sync: all retries succeeded");
                }
            }
            bridge_was_reachable = true;
            tokio::time::sleep(Duration::from_secs(timings::MT5_BRIDGE_HEALTH_POLL_UP_SECS)).await;
        } else {
            bridge_was_reachable = false;
            tokio::time::sleep(Duration::from_secs(timings::MT5_BRIDGE_HEALTH_POLL_DOWN_SECS)).await;
        }
    }
}

async fn retry_failed_accounts(
    state: &AppState,
    account_ids: &[String],
) -> Vec<(String, Mt5BridgePushOutcome)> {
    let Some(ref mgr) = state.state_manager else {
        return Vec::new();
    };
    let entries: Vec<(String, AccountEntry)> = mgr
        .read(|snap| {
            account_ids
                .iter()
                .filter_map(|id| snap.accounts.get(id).map(|e| (id.clone(), e.clone())))
                .filter(|(_, e)| is_mt5_headless_bridge_target(e))
                .collect()
        })
        .await;
    let app = state.clone();
    let pushes = entries.into_iter().map(|(account_id, entry)| {
        let app = app.clone();
        async move {
            let outcome = push_mt5_account_to_bridge(&app, &account_id, &entry).await;
            (account_id, outcome)
        }
    });
    join_all(pushes).await
}
