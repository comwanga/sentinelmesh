pub mod events_ws;

pub use events_ws::{ws_events_handler, ViewportEvent};

pub mod circle_hub;
pub mod hub;

use crate::AppState;
use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct WsParams {
    pub county: Option<String>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsParams>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let county = params.county.unwrap_or_else(|| "global".to_string());
    ws.on_upgrade(move |socket| handle_public_ws(socket, county, state))
}

async fn handle_public_ws(mut socket: WebSocket, county: String, state: AppState) {
    let mut rx = state.hub.subscribe(&county);
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(msg) => {
                        let text = String::from_utf8_lossy(&msg).into_owned();
                        if socket.send(Message::Text(text)).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("ws client lagged by {n} messages, county={county}");
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(_)) => {}
                    _ => break,
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Circle WebSocket handler
//
// Member invalidation is broadcast via in-process CircleHub only. This means
// MEMBER_REMOVED events are not propagated across gateway instances — Phase 2
// is deployed as a single process, so this is acceptable. If we scale to
// multiple gateway replicas, this must be replaced with a Redis pub/sub
// channel (e.g. circle:{id}:members) to fan out across instances.
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum CircleClientMsg {
    JoinCircle {
        circle_id: Uuid,
        nostr_auth_event: Option<serde_json::Value>,
    },
}

pub async fn ws_circles_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_circle_ws(socket, state))
}

async fn handle_circle_ws(mut socket: WebSocket, state: AppState) {
    let (circle_id, pubkey) = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => {
                let msg = match serde_json::from_str::<CircleClientMsg>(&text) {
                    Ok(m) => m,
                    Err(_) => {
                        let _ = socket
                            .send(Message::Text(
                                r#"{"error":"expected join_circle message"}"#.into(),
                            ))
                            .await;
                        continue;
                    }
                };
                let CircleClientMsg::JoinCircle {
                    circle_id,
                    nostr_auth_event,
                } = msg;

                let resolved_pubkey = match nostr_auth_event {
                    Some(raw) => match verify_ws_auth(&raw) {
                        Ok(pk) => pk,
                        Err(e) => {
                            let _ = socket
                                .send(Message::Close(Some(CloseFrame {
                                    code: 4001,
                                    reason: std::borrow::Cow::Owned(e),
                                })))
                                .await;
                            return;
                        }
                    },
                    None => {
                        let _ = socket
                            .send(Message::Close(Some(CloseFrame {
                                code: 4001,
                                reason: std::borrow::Cow::Borrowed("nostr_auth_event required"),
                            })))
                            .await;
                        return;
                    }
                };

                let join_token = crate::circles::token::circle_token(
                    &state.config.circle_token_secret,
                    circle_id,
                    &resolved_pubkey,
                );
                let is_member: bool = sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM (
                       SELECT 1 FROM circle_members WHERE circle_id = $1 AND member_token = $2
                       UNION
                       SELECT 1 FROM circles WHERE id = $1 AND owner_token = $2
                     ) sub",
                )
                .bind(circle_id)
                .bind(&join_token)
                .fetch_one(&state.db)
                .await
                .map(|n| n > 0)
                .unwrap_or(false);

                if !is_member {
                    let _ = socket
                        .send(Message::Close(Some(CloseFrame {
                            code: 4003,
                            reason: std::borrow::Cow::Borrowed("not a circle member"),
                        })))
                        .await;
                    return;
                }

                break (circle_id, resolved_pubkey);
            }
            _ => return,
        }
    };

    // Location transport is independently dark unless explicitly enabled.
    if state.config.safe_circle_location_enabled {
        if let Ok(blobs) = fetch_blob_snapshot(&state.db, circle_id).await {
            let payload =
                serde_json::json!({ "type": "CIRCLE_LOCATION_SNAPSHOT", "payload": blobs });
            let _ = socket.send(Message::Text(payload.to_string())).await;
        }
    }

    let mut rx = state.circle_hub.subscribe(circle_id);
    // This connection's own per-circle token, matched against MEMBER_REMOVED
    // broadcasts (which carry the removed member's token, not a raw pubkey) so a
    // removed member's live socket is force-closed.
    let self_token =
        crate::circles::token::circle_token(&state.config.circle_token_secret, circle_id, &pubkey);
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(msg) => {
                        let text = String::from_utf8_lossy(&msg).into_owned();
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                            if v["type"] == "MEMBER_REMOVED" && v["token"] == self_token.as_str() {
                                let _ = socket.send(Message::Close(Some(CloseFrame {
                                    code: 4003,
                                    reason: std::borrow::Cow::Borrowed("removed from circle"),
                                }))).await;
                                return;
                            }
                            // Internal token-targeted control message; never expose it to clients.
                            if v["type"] == "MEMBER_REMOVED" { continue; }
                        }
                        if socket.send(Message::Text(text)).await.is_err() { break; }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        if state.config.safe_circle_location_enabled {
                            if let Ok(blobs) = fetch_blob_snapshot(&state.db, circle_id).await {
                                let payload = serde_json::json!({ "type": "CIRCLE_LOCATION_SNAPSHOT", "payload": blobs });
                                if socket.send(Message::Text(payload.to_string())).await.is_err() { break; }
                            }
                        }
                        rx = state.circle_hub.subscribe(circle_id);
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                if !matches!(msg, Some(Ok(_))) { break; }
            }
        }
    }
}

fn verify_ws_auth(raw: &serde_json::Value) -> Result<String, String> {
    let event: nostr_sdk::Event =
        serde_json::from_value(raw.clone()).map_err(|_| "invalid auth event JSON".to_string())?;
    if event.kind != nostr_sdk::Kind::Custom(27235) {
        return Err("auth event must be kind 27235".to_string());
    }
    let now = chrono::Utc::now().timestamp();
    let ts = event.created_at.as_u64() as i64;
    if (now - ts).abs() > 60 {
        return Err("auth event expired".to_string());
    }
    event
        .verify()
        .map_err(|_| "invalid signature".to_string())?;
    Ok(event.pubkey.to_hex())
}

async fn fetch_blob_snapshot(
    pool: &sqlx::PgPool,
    circle_id: Uuid,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            i16,
            i32,
            String,
            chrono::DateTime<chrono::Utc>,
            chrono::DateTime<chrono::Utc>,
        ),
    >(
        "SELECT id, protocol_version, key_epoch, ciphertext, created_at, expires_at
         FROM location_blobs WHERE circle_id = $1 AND expires_at > NOW()",
    )
    .bind(circle_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, version, key_epoch, ciphertext, created_at, expires_at)| {
                serde_json::json!({
                    "id": id, "version": version, "circle_id": circle_id, "key_epoch": key_epoch,
                    "ciphertext": ciphertext, "created_at": created_at, "expires_at": expires_at
                })
            },
        )
        .collect())
}
