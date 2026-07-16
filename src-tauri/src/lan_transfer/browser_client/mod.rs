mod assets;

pub(super) const BROWSER_HTML: &str = include_str!("index.html");

pub(super) use assets::{BROWSER_CSS, BROWSER_JS};

#[cfg(test)]
mod tests {
    use super::{BROWSER_HTML, BROWSER_JS};

    #[test]
    fn browser_download_uses_native_navigation_without_zip_or_blob() {
        assert!(BROWSER_JS.contains("link.href = url"));
        assert!(!BROWSER_JS.contains("download-zip"));
        assert!(!BROWSER_JS.contains("new Blob"));
        assert!(!BROWSER_JS.contains("webkitdirectory"));
        assert!(BROWSER_HTML.contains("id=\"dropzone\""));
        assert!(BROWSER_JS.contains("input.addEventListener('change'"));
        assert!(!BROWSER_HTML.contains("id=\"upload-files\""));
    }
}
