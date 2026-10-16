use super::prepare;

fn config(identifier: &str) -> tauri::Config {
    let mut config = tauri::Config {
        identifier: identifier.into(),
        ..Default::default()
    };
    config.app.windows.push(Default::default());
    config
}

#[test]
fn alternate_webview_stores_are_stable_and_isolated_from_production() {
    let mut production = config("com.imehc.mftp");
    let mut development = config("com.imehc.mftp.dev");
    let mut reopened = config("com.imehc.mftp.dev");
    let mut qa = config("com.imehc.mftp.qa");
    for config in [&mut production, &mut development, &mut reopened, &mut qa] {
        prepare(config);
    }
    assert_eq!(production.app.windows[0].data_store_identifier, None);
    assert!(development.app.windows[0].data_store_identifier.is_some());
    assert_eq!(
        development.app.windows[0].data_store_identifier,
        reopened.app.windows[0].data_store_identifier
    );
    assert_ne!(
        development.app.windows[0].data_store_identifier,
        qa.app.windows[0].data_store_identifier
    );
}
