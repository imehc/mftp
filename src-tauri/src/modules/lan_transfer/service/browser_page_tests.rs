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
