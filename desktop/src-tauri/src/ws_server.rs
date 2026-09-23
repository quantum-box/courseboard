use crate::cart_simulator::Simulator;
use futures_util::SinkExt;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio::time;
use tokio_tungstenite::tungstenite::Message;

pub const DEFAULT_BIND: &str = "127.0.0.1:9001";

pub async fn run(bind_addr: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind(bind_addr).await?;
    log::info!("cart WebSocket server listening on ws://{}/ws", bind_addr);

    // Broadcast channel: simulator → all connected clients.
    let (tx, _rx) = broadcast::channel::<String>(64);

    // Tick task: 5 Hz simulation broadcast.
    {
        let tx = tx.clone();
        tokio::spawn(async move {
            let sim = Simulator::new();
            let mut interval = time::interval(Duration::from_millis(200));
            interval.set_missed_tick_behavior(time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                let msg = sim.tick();
                match serde_json::to_string(&msg) {
                    Ok(json) => {
                        // Ignore send errors when there are no subscribers.
                        let _ = tx.send(json);
                    }
                    Err(err) => log::warn!("cart serialize failed: {err}"),
                }
            }
        });
    }

    // Accept loop.
    loop {
        let (stream, peer) = listener.accept().await?;
        let rx = tx.subscribe();
        tokio::spawn(async move {
            if let Err(err) = handle_connection(stream, rx).await {
                log::debug!("ws connection {peer} ended: {err}");
            }
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    mut rx: broadcast::Receiver<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let ws_stream = tokio_tungstenite::accept_async(stream).await?;
    let (mut sink, _stream) = futures_util::StreamExt::split(ws_stream);

    while let Ok(msg) = rx.recv().await {
        if sink.send(Message::Text(msg)).await.is_err() {
            break;
        }
    }
    Ok(())
}
