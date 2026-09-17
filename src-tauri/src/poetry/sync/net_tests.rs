use super::*;

// Opt-in network probe: MFTP_NET_PROBE=1 cargo test probe -- --nocapture
#[test]
fn codeload_reachable() {
    if std::env::var("MFTP_NET_PROBE").is_err() {
        return;
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .user_agent("mftp-library-sync")
        .build()
        .expect("client builds");
    match client
        .get("https://codeload.github.com/chinese-poetry/chinese-poetry/tar.gz/refs/heads/master")
        .send()
    {
        Ok(response) => println!("status = {}", response.status()),
        Err(error) => {
            println!("chain = {}", error_chain(&error));
            panic!("probe failed");
        }
    }
}
