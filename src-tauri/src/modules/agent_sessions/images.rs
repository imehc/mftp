use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;

use super::model::AgentSessionImagePayload;
use crate::error::{AppError, AppResult, CustomErrorCode};

const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;

pub(super) enum NativeImage<'a> {
    File { path: PathBuf, name: String },
    Inline { data: &'a str, name: String },
}

impl NativeImage<'_> {
    pub fn name(&self) -> &str {
        match self {
            Self::File { name, .. } | Self::Inline { name, .. } => name,
        }
    }

    pub fn read(&self, home: &Path) -> AppResult<AgentSessionImagePayload> {
        let bytes = match self {
            Self::File { path, .. } => {
                let path = if let Ok(relative) = path.strip_prefix("~") {
                    home.join(relative)
                } else {
                    path.clone()
                }
                .canonicalize()?;
                let roots = [
                    home.to_path_buf(),
                    std::env::temp_dir(),
                    PathBuf::from("/private/tmp"),
                ];
                if !roots
                    .iter()
                    .filter_map(|root| root.canonicalize().ok())
                    .any(|root| path.starts_with(root))
                {
                    return Err(AppError::custom(CustomErrorCode::AgentSessionImage));
                }
                let file = File::open(path)?;
                if file.metadata()?.len() > MAX_IMAGE_BYTES as u64 {
                    return Err(AppError::custom(CustomErrorCode::AgentSessionImage));
                }
                let mut bytes = Vec::new();
                file.take(MAX_IMAGE_BYTES as u64 + 1)
                    .read_to_end(&mut bytes)?;
                bytes
            }
            Self::Inline { data, .. } => {
                if data.len() > MAX_IMAGE_BYTES * 4 / 3 + 4 {
                    return Err(AppError::custom(CustomErrorCode::AgentSessionImage));
                }
                STANDARD
                    .decode(data)
                    .map_err(|_| AppError::custom(CustomErrorCode::AgentSessionImage))?
            }
        };
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(AppError::custom(CustomErrorCode::AgentSessionImage));
        }
        // Bound decoded dimensions as well as compressed bytes before handing
        // an untrusted image to WebKit's decoder.
        let dimensions = image::ImageReader::new(std::io::Cursor::new(&bytes))
            .with_guessed_format()
            .ok()
            .and_then(|reader| reader.into_dimensions().ok());
        let dimensions = dimensions.or_else(|| {
            if bytes.len() >= 10 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a") {
                Some((
                    u16::from_le_bytes([bytes[6], bytes[7]]) as u32,
                    u16::from_le_bytes([bytes[8], bytes[9]]) as u32,
                ))
            } else {
                None
            }
        });
        if !dimensions.is_some_and(|(width, height)| {
            width > 0 && height > 0 && u64::from(width) * u64::from(height) <= 20_000_000
        }) {
            return Err(AppError::custom(CustomErrorCode::AgentSessionImage));
        }
        let mime = match image::guess_format(&bytes) {
            Ok(image::ImageFormat::Png) => "image/png",
            Ok(image::ImageFormat::Jpeg) => "image/jpeg",
            Ok(image::ImageFormat::WebP) => "image/webp",
            Ok(image::ImageFormat::Gif) => "image/gif",
            Ok(image::ImageFormat::Bmp) => "image/bmp",
            Ok(image::ImageFormat::Avif) => "image/avif",
            _ => return Err(AppError::custom(CustomErrorCode::AgentSessionImage)),
        };
        Ok(AgentSessionImagePayload {
            data_base64: STANDARD.encode(bytes),
            mime: mime.into(),
        })
    }
}

pub(super) fn collect<'a>(value: &'a Value, out: &mut Vec<NativeImage<'a>>) {
    if let Some(text) = value.as_str() {
        collect_tags(text, out);
        return;
    }
    if out.len() >= 20 {
        return;
    }
    if let Some(blocks) = value.as_array() {
        for block in blocks {
            collect(block, out);
        }
        return;
    }
    if !value.is_object() {
        return;
    }
    match value["type"].as_str() {
        Some("image")
            if value["mimeType"]
                .as_str()
                .is_some_and(|mime| mime.starts_with("image/")) =>
        {
            if let Some(data) = value["data"].as_str() {
                out.push(NativeImage::Inline {
                    data,
                    name: "image".into(),
                });
            }
        }
        Some("image") if value["source"]["type"] == "base64" => {
            if let Some(data) = value["source"]["data"].as_str() {
                out.push(NativeImage::Inline {
                    data,
                    name: "image".into(),
                });
            }
        }
        Some("image_blob_ref") => {
            if let Some(path) = value["blob_path"].as_str() {
                out.push(local(path, value["original_filename"].as_str()));
            }
        }
        Some("input_image" | "image_url") => {
            if let Some(url) = value["image_url"]
                .as_str()
                .or(value["image_url"]["url"].as_str())
            {
                if let Some((prefix, data)) = url.split_once(",") {
                    if prefix.starts_with("data:image/") && prefix.ends_with(";base64") {
                        out.push(NativeImage::Inline {
                            data,
                            name: "image".into(),
                        });
                    }
                }
            }
        }
        _ => {}
    }
    if let Some(text) = value["text"].as_str() {
        collect_tags(text, out);
    }
    if let Some(content) = value.get("content") {
        collect(content, out);
    }
    for key in ["message", "payload", "output"] {
        if let Some(child) = value.get(key) {
            collect(child, out);
        }
    }
}

fn local(path: &str, name: Option<&str>) -> NativeImage<'static> {
    let path = url::Url::parse(path)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .unwrap_or_else(|| PathBuf::from(path));
    let name = name.map(str::to_owned).unwrap_or_else(|| {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "image".into())
    });
    NativeImage::File { path, name }
}

fn attribute<'a>(tag: &'a str, key: &str) -> Option<&'a str> {
    let (_, tail) = tag.split_once(&format!("{key}=\""))?;
    tail.split_once('"').map(|(value, _)| value)
}

fn collect_tags<'a>(text: &'a str, out: &mut Vec<NativeImage<'a>>) {
    for part in text.split("<image").skip(1) {
        if out.len() >= 20 {
            break;
        }
        let Some((tag, _)) = part.split_once('>') else {
            continue;
        };
        if let Some(path) = attribute(tag, "path") {
            out.push(local(path, attribute(tag, "name")));
        }
    }
}
