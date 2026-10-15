const MASK: &[u8] = b"[REDACTED]";

// No Debug/Serialize: known credentials and raw scratch buffers never enter snapshots.
#[derive(Default)]
pub(crate) struct Redactor {
    secrets: Vec<Vec<u8>>,
}

pub(crate) fn sensitive(name: &str) -> bool {
    let normalized: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    matches!(
        normalized.as_str(),
        "authorization"
            | "proxyauthorization"
            | "cookie"
            | "setcookie"
            | "password"
            | "passwd"
            | "passphrase"
            | "token"
            | "accesstoken"
            | "refreshtoken"
            | "idtoken"
            | "apikey"
            | "xapikey"
            | "secret"
            | "clientsecret"
            | "privatekey"
    )
}

impl Redactor {
    pub(crate) fn error(&self, mut error: crate::error::AppError) -> crate::error::AppError {
        error.message = self.text(&error.message).0;
        error.args = error
            .args
            .into_iter()
            .map(|(key, value)| {
                let value = if sensitive(&key) {
                    "[REDACTED]".into()
                } else {
                    self.text(&value).0
                };
                (self.text(&key).0, value)
            })
            .collect();
        error
    }

    pub(crate) fn url(&self, raw: &str) -> String {
        let mut text = raw.to_string();
        if url::Url::parse(raw).is_ok() {
            if let Some((scheme, rest)) = raw.split_once("://") {
                let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
                if let Some((userinfo, host)) = rest[..end].rsplit_once('@') {
                    if let Some((username, _)) = userinfo.split_once(':') {
                        // Replace only the password span; URL reserialization would
                        // otherwise normalize unrelated path/query bytes.
                        text = format!("{scheme}://{username}:[REDACTED]@{host}{}", &rest[end..]);
                    }
                }
            }
        }
        if let Some((base, rest)) = text.split_once('?') {
            let (query, fragment) = rest
                .split_once('#')
                .map_or((rest, None), |(q, f)| (q, Some(f)));
            let query = query
                .split('&')
                .map(|pair| {
                    let Some((key, _)) = pair.split_once('=') else {
                        return pair.to_string();
                    };
                    let decoded = url::form_urlencoded::parse(pair.as_bytes()).next();
                    if decoded.is_some_and(|(key, _)| sensitive(&key)) {
                        format!("{key}=[REDACTED]")
                    } else {
                        pair.into()
                    }
                })
                .collect::<Vec<_>>()
                .join("&");
            text = format!(
                "{base}?{query}{}",
                fragment.map(|f| format!("#{f}")).unwrap_or_default()
            );
        }
        self.text(&text).0
    }
    pub(crate) fn add_secret(&mut self, secret: &str) {
        if secret.is_empty() {
            return;
        }
        self.secrets.push(secret.as_bytes().to_vec());
        if let Ok(encoded) = serde_json::to_string(secret) {
            self.secrets
                .push(encoded.as_bytes()[1..encoded.len() - 1].to_vec());
        }
        let encoded: String = url::form_urlencoded::byte_serialize(secret.as_bytes()).collect();
        self.secrets.push(encoded.into_bytes());
        self.secrets
            .sort_by_key(|value| std::cmp::Reverse(value.len()));
        self.secrets.dedup();
    }

    pub(crate) fn text(&self, raw: &str) -> (String, bool) {
        let (bytes, redacted) = self.bytes(raw.as_bytes(), false);
        (String::from_utf8_lossy(&bytes).into_owned(), redacted)
    }

    pub(crate) fn bytes(&self, raw: &[u8], partial: bool) -> (Vec<u8>, bool) {
        let mut output = Vec::with_capacity(raw.len());
        let mut i = 0;
        let mut redacted = false;
        // Locate JSON credential value spans, preserving every other original byte,
        // including whitespace and SSE framing. Incomplete values are masked to EOF.
        while i < raw.len() {
            if raw[i] == b'"' {
                let end = string_end(raw, i);
                if let Ok(name) = serde_json::from_slice::<String>(&raw[i..end]) {
                    let colon = skip_space(raw, end);
                    if sensitive(&name) && raw.get(colon) == Some(&b':') {
                        let start = skip_space(raw, colon + 1);
                        output.extend_from_slice(&raw[i..start]);
                        if start < raw.len() {
                            output.push(b'"');
                            output.extend_from_slice(MASK);
                            output.push(b'"');
                            redacted = true;
                        }
                        i = value_end(raw, start);
                        continue;
                    }
                }
                // Scan strings as one token so escaped quotes cannot invent keys.
                output.extend_from_slice(&raw[i..end]);
                i = end;
            } else {
                output.push(raw[i]);
                i += 1;
            }
        }
        let mut safe = Vec::with_capacity(output.len());
        let mut index = 0;
        while index < output.len() {
            let remaining = &output[index..];
            let matched = self
                .secrets
                .iter()
                .find(|secret| remaining.starts_with(secret));
            if let Some(secret) = matched {
                safe.extend_from_slice(MASK);
                index += secret.len();
                redacted = true;
            } else if partial
                && self
                    .secrets
                    .iter()
                    .any(|secret| secret.starts_with(remaining))
            {
                safe.extend_from_slice(MASK);
                redacted = true;
                break;
            } else {
                safe.push(output[index]);
                index += 1;
            }
        }
        (safe, redacted)
    }
}

fn skip_space(raw: &[u8], mut i: usize) -> usize {
    while raw.get(i).is_some_and(u8::is_ascii_whitespace) {
        i += 1;
    }
    i
}

fn string_end(raw: &[u8], start: usize) -> usize {
    let mut i = start + 1;
    while i < raw.len() {
        if raw[i] == b'\\' {
            i = (i + 2).min(raw.len());
        } else if raw[i] == b'"' {
            return i + 1;
        } else {
            i += 1;
        }
    }
    raw.len()
}

fn value_end(raw: &[u8], start: usize) -> usize {
    if raw.get(start) == Some(&b'"') {
        return string_end(raw, start);
    }
    let mut depth = 0_usize;
    let mut i = start;
    while i < raw.len() {
        match raw[i] {
            b'"' => {
                i = string_end(raw, i);
                continue;
            }
            b'{' | b'[' => depth += 1,
            b'}' | b']' => {
                if depth == 0 {
                    break;
                }
                depth -= 1;
                if depth == 0 {
                    return i + 1;
                }
            }
            b',' | b'\r' | b'\n' if depth == 0 => break,
            _ => {}
        }
        i += 1;
    }
    i
}
