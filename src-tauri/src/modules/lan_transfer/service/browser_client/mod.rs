mod assets;

pub(super) const BROWSER_HTML: &str = include_str!("index.html");

pub(super) use assets::{BROWSER_CSS, BROWSER_JS};

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
