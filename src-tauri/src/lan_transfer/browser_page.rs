pub(super) fn browser_home(device_name: &str, security_mode: &str) -> String {
    let auth_block = match security_mode {
        "code" => {
            r#"<div id="auth" class="auth"><input id="code" placeholder="确认码" inputmode="numeric" maxlength="6" /><button id="authorize-access" class="button button-primary" type="button">授权</button></div>"#
        }
        "confirm" | "trusted" => {
            r#"<div id="auth" class="auth"><button id="request-access" class="button button-primary" type="button">请求访问</button></div>"#
        }
        _ => r#"<div id="auth"></div>"#,
    };
    let template = super::browser_client::BROWSER_HTML;
    template
        .replace("{{DEVICE_NAME}}", &html_escape(device_name))
        .replace("{{AUTH_BLOCK}}", auth_block)
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::browser_home;

    #[test]
    fn renders_hosted_assets_and_escapes_dynamic_values() {
        let html = browser_home("<我的设备>", "code");

        assert!(html.contains("&lt;我的设备&gt;"));
        assert!(html.contains("href=\"/browser.css\""));
        assert!(html.contains("src=\"/browser.js\""));
        assert!(!html.contains("{{DEVICE_NAME}}"));
        assert!(!html.contains("{{AUTH_BLOCK}}"));
        assert!(!html.contains("<style>"));
        assert!(!html.contains("onclick="));
    }
}
