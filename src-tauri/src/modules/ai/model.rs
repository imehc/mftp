#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiConnectionConfig {
    pub base_url: String,
    pub model: String,
    pub streaming_enabled: bool,
}
