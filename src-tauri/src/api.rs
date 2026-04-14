use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UsageResponse {
    pub five_hour: Option<UsageLimit>,
    pub seven_day: Option<UsageLimit>,
    pub seven_day_sonnet: Option<UsageLimit>,
    pub seven_day_opus: Option<UsageLimit>,
    pub seven_day_cowork: Option<UsageLimit>,
    pub seven_day_oauth_apps: Option<UsageLimit>,
    pub extra_usage: Option<ExtraUsage>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UsageLimit {
    pub utilization: f64,
    pub resets_at: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExtraUsage {
    pub is_enabled: bool,
    pub monthly_limit: Option<f64>,
    pub used_credits: Option<f64>,
    pub utilization: Option<f64>,
}

pub async fn fetch_usage(access_token: &str) -> Result<UsageResponse, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    response
        .json::<UsageResponse>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}
