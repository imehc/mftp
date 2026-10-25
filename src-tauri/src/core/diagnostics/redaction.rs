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
            | "sig"
            | "signature"
            | "jwt"
            | "xamzsignature"
            | "xamzsecuritytoken"
            | "xgoogsignature"
            | "xgoogcredential"
            | "xamzcredential"
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
        String::from_utf8_lossy(&self.url_bytes(raw.as_bytes()).0).into_owned()
    }

    pub(crate) fn url_bytes(&self, raw: &[u8]) -> (Vec<u8>, bool) {
        let (safe, redacted) = redact_url(raw);
        let (safe, text_redacted) = self.bytes(&safe, false);
        (safe, redacted || text_redacted)
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
        let (output, url_redacted) = redact_urls(&output);
        redacted |= url_redacted;
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

fn redact_urls(raw: &[u8]) -> (Vec<u8>, bool) {
    let mut output = Vec::with_capacity(raw.len());
    let mut index = 0;
    let mut redacted = false;
    while index < raw.len() {
        let remaining = &raw[index..];
        let prefix = [b"https://".as_slice(), b"http://".as_slice()]
            .iter()
            .any(|prefix| {
                remaining
                    .get(..prefix.len())
                    .is_some_and(|start| start.eq_ignore_ascii_case(prefix))
            });
        if !prefix {
            output.push(raw[index]);
            index += 1;
            continue;
        }
        let length = remaining
            .iter()
            .position(|byte| {
                byte.is_ascii_whitespace()
                    || matches!(byte, b'"' | b'\'' | b'<' | b'>' | b')' | b'\\')
            })
            .unwrap_or(remaining.len());
        let (safe, changed) = redact_url(&remaining[..length]);
        output.extend_from_slice(&safe);
        redacted |= changed;
        index += length;
    }
    (output, redacted)
}

fn redact_url(raw: &[u8]) -> (Vec<u8>, bool) {
    let mut spans = Vec::new();
    if let Some(scheme_end) = raw.windows(3).position(|part| part == b"://") {
        let authority_start = scheme_end + 3;
        let authority_end = raw[authority_start..]
            .iter()
            .position(|byte| matches!(byte, b'/' | b'?' | b'#'))
            .map_or(raw.len(), |end| authority_start + end);
        if let Some(user_end) = raw[authority_start..authority_end]
            .iter()
            .rposition(|byte| *byte == b'@')
        {
            let user_end = authority_start + user_end;
            if let Some(separator) = raw[authority_start..user_end]
                .iter()
                .position(|byte| *byte == b':')
            {
                spans.push(authority_start + separator + 1..user_end);
            }
        }
    }
    let fragment = raw
        .iter()
        .position(|byte| *byte == b'#')
        .unwrap_or(raw.len());
    if let Some(query_start) = raw[..fragment].iter().position(|byte| *byte == b'?') {
        let mut cursor = query_start + 1;
        for pair in raw[cursor..fragment].split(|byte| *byte == b'&') {
            if let Some(separator) = pair.iter().position(|byte| *byte == b'=') {
                let key = &pair[..separator];
                if url::form_urlencoded::parse(key)
                    .next()
                    .is_some_and(|(key, _)| sensitive(&key))
                {
                    spans.push(cursor + separator + 1..cursor + pair.len());
                }
            }
            cursor += pair.len() + 1;
        }
    }
    let mut output = Vec::with_capacity(raw.len());
    let mut cursor = 0;
    for span in &spans {
        output.extend_from_slice(&raw[cursor..span.start]);
        output.extend_from_slice(MASK);
        cursor = span.end;
    }
    output.extend_from_slice(&raw[cursor..]);
    (output, !spans.is_empty())
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
