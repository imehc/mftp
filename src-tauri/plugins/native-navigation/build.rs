fn main() {
    if let Err(error) = tauri_plugin::Builder::new(&[]).ios_path("ios").try_build() {
        eprintln!("Failed to build native navigation plugin: {error}");
        std::process::exit(1);
    }
}
