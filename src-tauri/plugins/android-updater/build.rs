fn main() {
    if let Err(error) = tauri_plugin::Builder::new(&[])
        .android_path("android")
        .try_build()
    {
        eprintln!("failed to prepare Android updater plugin: {error}");
        std::process::exit(1);
    }
}
