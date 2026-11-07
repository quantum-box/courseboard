//! `POST /v1/course/insights/layout` — asks Claude to lay out an answer screen.
//!
//! PoC. The desk sends a question plus the json-render catalog prompt, which
//! lists the charts and tables it may use and the datasets they can bind to.
//! Claude answers with a json-render spec (JSONL patches) that only *binds* to
//! those datasets; the numbers are computed in the desk from the tee sheet and
//! never pass through the model, so a chart cannot show an invented count.
//!
//! The API key stays here. The endpoint is off (404) until
//! `ANTHROPIC_API_KEY` is set.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{AppError, AppState};

const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL: &str = "claude-opus-5-5";
/// Generous for a catalog prompt plus dataset descriptions, small enough that
/// the endpoint is not a general-purpose relay for large documents.
const MAX_SYSTEM_CHARS: usize = 60_000;
const MAX_QUESTION_CHARS: usize = 2_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutRequest {
    /// `catalog.prompt()` output plus the dataset descriptions.
    pub system: String,
    /// The operator's question, as typed.
    pub question: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutResponse {
    /// The model's text: json-render JSONL patch lines.
    pub text: String,
    pub model: String,
}

pub async fn layout(
    State(state): State<AppState>,
    Json(body): Json<LayoutRequest>,
) -> Result<Json<LayoutResponse>, AppError> {
    let Some(api_key) = std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
    else {
        return Err(AppError::NotFound("insights are not configured"));
    };
    let question = body.question.trim();
    if question.is_empty() {
        return Err(AppError::BadRequest("question is required"));
    }
    if question.chars().count() > MAX_QUESTION_CHARS {
        return Err(AppError::BadRequest("question is too long"));
    }
    if body.system.chars().count() > MAX_SYSTEM_CHARS {
        return Err(AppError::BadRequest("system prompt is too long"));
    }
    let model = std::env::var("COURSEBOARD_INSIGHTS_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let request = json!({
        "model": model,
        "max_tokens": 16000,
        "thinking": { "type": "adaptive" },
        // Laying out a handful of bound components is light work.
        "output_config": { "effort": "low" },
        // A declined request is re-run server-side on the recommended model
        // instead of coming back as a refusal.
        "fallbacks": "default",
        "system": body.system,
        "messages": [{ "role": "user", "content": question }],
    });

    let response = state
        .http_client
        .post(ANTHROPIC_MESSAGES_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2026-10-21")
        .header("anthropic-beta", "server-side-fallback-2026-07-01")
        .json(&request)
        .send()
        .await
        .map_err(|error| AppError::Provider(format!("Claude request failed: {error}")))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|error| AppError::Provider(format!("Claude response unreadable: {error}")))?;
    if !status.is_success() {
        let message = payload["error"]["message"]
            .as_str()
            .unwrap_or("Claude request failed");
        return Err(AppError::Provider(format!("{status}: {message}")));
    }
    let text = extract_text(&payload)?;
    Ok(Json(LayoutResponse {
        text,
        model: payload["model"].as_str().unwrap_or(&model).to_string(),
    }))
}

fn extract_text(payload: &serde_json::Value) -> Result<String, AppError> {
    match payload["stop_reason"].as_str() {
        Some("refusal") => {
            return Err(AppError::Provider(
                "Claude declined to answer this question".to_string(),
            ))
        }
        Some("max_tokens") => {
            return Err(AppError::Provider(
                "Claude's answer was cut off; ask a narrower question".to_string(),
            ))
        }
        _ => {}
    }
    let text = payload["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("");
    if text.trim().is_empty() {
        return Err(AppError::Provider("Claude returned no layout".to_string()));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_text_blocks_and_skips_thinking() {
        let payload = json!({
            "stop_reason": "end_turn",
            "content": [
                { "type": "thinking", "thinking": "" },
                { "type": "text", "text": "{\"op\":\"add\"}\n" },
                { "type": "text", "text": "{\"op\":\"replace\"}" },
            ],
        });
        assert_eq!(
            extract_text(&payload).unwrap(),
            "{\"op\":\"add\"}\n{\"op\":\"replace\"}"
        );
    }

    #[test]
    fn refusal_is_an_error() {
        let payload = json!({ "stop_reason": "refusal", "content": [] });
        assert!(extract_text(&payload).is_err());
    }
}
