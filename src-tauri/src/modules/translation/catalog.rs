use super::model::TranslationModel;
use crate::error::{AppError, AppResult, CustomErrorCode};

// Profiles describe language/prompt/sampling behavior independently of weights.
#[derive(Clone, Copy)]
pub(super) enum Profile {
    HyMt2,
}

pub(super) struct ModelSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub quantization: &'static str,
    pub profile: Profile,
    pub bytes: u64,
    pub sha256: &'static str,
    pub url: &'static str,
    pub legacy_stq: bool,
}

pub(super) const CATALOG: &[ModelSpec] = &[
    ModelSpec {
        id: "hy-mt2-1.8b-stq-1.25",
        name: "HY-MT2 1.8B · 1.25-bit",
        quantization: "STQ1_0 (legacy)",
        profile: Profile::HyMt2,
        bytes: 461_860_800,
        sha256: "cc497fe8f033b52b3b8b00a7669e9661435432f9d4cd43f7ed24400c01507a93",
        url: "https://modelscope.cn/models/Tencent-Hunyuan/Hy-MT2-1.8B-1.25bit-GGUF/resolve/a1ba5a8101d7b257d42c0980e0d6415d0bd9e1cf/Hy-MT2-1.8B-1.25Bit.gguf",
        legacy_stq: true,
    },
    ModelSpec {
        id: "hy-mt2-1.8b-q4-k-m",
        name: "HY-MT2 1.8B · Q4_K_M",
        quantization: "Q4_K_M",
        profile: Profile::HyMt2,
        bytes: 1_133_080_448,
        sha256: "dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699",
        url: "https://modelscope.cn/models/Tencent-Hunyuan/Hy-MT2-1.8B-GGUF/resolve/ef1d40b8b315575d30d1eb6579996130b8fc0bb2/Hy-MT2-1.8B-Q4_K_M.gguf",
        legacy_stq: false,
    },
];

pub(super) fn default_id() -> &'static str {
    if cfg!(mobile) {
        CATALOG[0].id
    } else {
        CATALOG[1].id
    }
}

pub(super) fn find(id: &str) -> AppResult<&'static ModelSpec> {
    available()
        .find(|spec| spec.id == id)
        .ok_or_else(|| AppError::custom(CustomErrorCode::TranslationModelUnknown))
}

pub(super) fn find_any(id: &str) -> AppResult<&'static ModelSpec> {
    CATALOG
        .iter()
        .find(|spec| spec.id == id)
        .ok_or_else(|| AppError::custom(CustomErrorCode::TranslationModelUnknown))
}

pub(super) fn available() -> impl Iterator<Item = &'static ModelSpec> {
    CATALOG
        .iter()
        .filter(|spec| cfg!(test) || spec.id == default_id())
}

impl ModelSpec {
    pub fn view(&self, installed: bool, downloaded: u64) -> TranslationModel {
        TranslationModel {
            id: self.id.into(),
            name: self.name.into(),
            family: "HY-MT2".into(),
            quantization: self.quantization.into(),
            bytes: self.bytes as f64,
            license: "Apache-2.0".into(),
            source_url: self
                .url
                .split_once("/resolve/")
                .map_or(self.url, |(url, _)| url)
                .into(),
            installed,
            downloaded_bytes: downloaded as f64,
            recommended: self.id == default_id(),
        }
    }
}

impl Profile {
    pub fn prompt(self, source: &str, target: &str, text: &str) -> AppResult<String> {
        let language = |code: &str| match code {
            "zh-CN" => Some("Chinese"),
            "en" => Some("English"),
            "ja" => Some("Japanese"),
            "ko" => Some("Korean"),
            "fr" => Some("French"),
            "de" => Some("German"),
            "es" => Some("Spanish"),
            _ => None,
        };
        let target = language(target)
            .ok_or_else(|| AppError::custom(CustomErrorCode::TranslationInputInvalid))?;
        if source != "auto" && language(source).is_none() {
            return Err(AppError::custom(CustomErrorCode::TranslationInputInvalid));
        }
        let source = language(source).map_or(String::new(), |name| format!(" from {name}"));
        match self {
            Self::HyMt2 => Ok(format!("Translate the following segment{source} into {target}, without additional explanation.\n\n{text}")),
        }
    }

    pub fn parameters(self, legacy_stq: bool) -> mftp_translation_engine::Parameters {
        match self {
            Self::HyMt2 => mftp_translation_engine::Parameters {
                context: 2048,
                output: 512,
                threads: std::thread::available_parallelism()
                    .map_or(2, |count| count.get().clamp(1, 4)) as u32,
                seed: 42,
                top_k: 20,
                top_p: 0.6,
                temperature: 0.7,
                repeat_penalty: 1.05,
                legacy_stq: u8::from(legacy_stq),
            },
        }
    }
}
