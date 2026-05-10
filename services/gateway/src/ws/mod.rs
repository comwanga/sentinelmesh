pub mod hub;
pub mod circle_hub; // will be implemented in Task 5

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use serde::Deserialize;
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
