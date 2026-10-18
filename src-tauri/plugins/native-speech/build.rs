fn main() {
    if let Err(error) = tauri_plugin::Builder::new(&[])
        .android_path("android")
        .try_build()
    {
        eprintln!("Failed to build native speech plugin: {error}");
        std::process::exit(1);
    }
}
