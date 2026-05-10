pub mod hub;
pub mod circle_hub;

use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use serde::Deserialize;
use uuid::Uuid;
use crate::AppState;

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
                        let _ = socket.send(Message::Text(
                            r#"{"error":"expected join_circle message"}"#.into()
                        )).await;
                        continue;
                    }
                };
                let CircleClientMsg::JoinCircle { circle_id, nostr_auth_event } = msg;

                let resolved_pubkey = match nostr_auth_event {
                    Some(raw) => match verify_ws_auth(&raw) {
                        Ok(pk) => pk,
                        Err(e) => {
                            let _ = socket.send(Message::Close(Some(CloseFrame {
                                code: 4001,
                                reason: std::borrow::Cow::Owned(e),
                            }))).await;
                            return;
                        }
                    },
                    None => {
                        let _ = socket.send(Message::Close(Some(CloseFrame {
                            code: 4001,
                            reason: std::borrow::Cow::Borrowed("nostr_auth_event required"),
                        }))).await;
                        return;
                    }
                };

                let is_member: bool = sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM (
                       SELECT 1 FROM circle_members WHERE circle_id = $1 AND member_pubkey = $2
                       UNION
                       SELECT 1 FROM circles WHERE id = $1 AND owner_pubkey = $2
                     ) sub"
                )
                .bind(circle_id)
                .bind(&resolved_pubkey)
                .fetch_one(&state.db)
                .await
                .map(|n| n > 0)
                .unwrap_or(false);

                if !is_member {
                    let _ = socket.send(Message::Close(Some(CloseFrame {
                        code: 4003,
                        reason: std::borrow::Cow::Borrowed("not a circle member"),
                    }))).await;
                    return;
                }

                break (circle_id, resolved_pubkey);
            }
            _ => return,
        }
    };

    // Send snapshot of current blobs
    if let Ok(blobs) = fetch_blob_snapshot(&state.db, circle_id).await {
        let payload = serde_json::json!({ "type": "CIRCLE_SNAPSHOT", "payload": blobs });
        let _ = socket.send(Message::Text(payload.to_string())).await;
    }

    let mut rx = state.circle_hub.subscribe(circle_id);
    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(msg) => {
                        let text = String::from_utf8_lossy(&msg).into_owned();
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                            if v["type"] == "MEMBER_REMOVED" && v["pubkey"] == pubkey.as_str() {
                                let _ = socket.send(Message::Close(Some(CloseFrame {
                                    code: 4003,
                                    reason: std::borrow::Cow::Borrowed("removed from circle"),
                                }))).await;
                                return;
                            }
                        }
                        if socket.send(Message::Text(text)).await.is_err() { break; }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        if let Ok(blobs) = fetch_blob_snapshot(&state.db, circle_id).await {
                            let payload = serde_json::json!({ "type": "CIRCLE_SNAPSHOT", "payload": blobs });
                            if socket.send(Message::Text(payload.to_string())).await.is_err() { break; }
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
    let event: nostr_sdk::Event = serde_json::from_value(raw.clone())
        .map_err(|_| "invalid auth event JSON".to_string())?;
    if event.kind != nostr_sdk::Kind::Custom(27235) {
        return Err("auth event must be kind 27235".to_string());
    }
    let now = chrono::Utc::now().timestamp();
    let ts = event.created_at.as_u64() as i64;
    if (now - ts).abs() > 60 {
        return Err("auth event expired".to_string());
    }
    event.verify().map_err(|_| "invalid signature".to_string())?;
    Ok(event.pubkey.to_hex())
}

async fn fetch_blob_snapshot(
    pool: &sqlx::PgPool,
    circle_id: Uuid,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let rows = sqlx::query_as::<_, (Uuid, String, String, chrono::DateTime<chrono::Utc>)>(
        "SELECT id, sender_pubkey, encrypted_payload, expires_at
         FROM location_blobs WHERE circle_id = $1 AND expires_at > NOW()"
    )
    .bind(circle_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, sender, payload, exp)| serde_json::json!({
        "id": id, "sender_pubkey": sender, "encrypted_payload": payload, "expires_at": exp
    })).collect())
}
