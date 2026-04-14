use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub claude_ai_oauth: OAuthTokens,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
}

impl Credentials {
    pub fn load() -> Result<Self, String> {
        let path = Self::credentials_path()?;
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read credentials at {}: {}", path.display(), e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse credentials: {}", e))
    }

    fn credentials_path() -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or("Cannot find home directory")?;
        Ok(home.join(".claude").join(".credentials.json"))
    }

    pub fn is_expired(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        now >= self.claude_ai_oauth.expires_at
    }

    pub fn tier_display(&self) -> String {
        match self.claude_ai_oauth.rate_limit_tier.as_deref() {
            Some("pro") => "Pro".to_string(),
            Some("max_5x") => "Max 5x".to_string(),
            Some("max_20x") => "Max 20x".to_string(),
            Some("free") => "Free".to_string(),
            Some(other) => other.to_string(),
            None => "Unknown".to_string(),
        }
    }
}
