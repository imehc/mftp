fn main() {
    if let Err(error) = tauri_plugin::Builder::new(&[])
        .android_path("android")
        .ios_path("ios")
        .try_build()
    {
        eprintln!("Failed to build native viewer plugin: {error}");
        std::process::exit(1);
    }
}
