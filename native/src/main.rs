use mftp_native::{app, platform::Startup};

fn main() -> std::process::ExitCode {
    match Startup::from_args(std::env::args_os().skip(1)) {
        Ok(Startup::Help) => {
            println!("mftp-native [--data-dir <directory>] [--help]");
            std::process::ExitCode::SUCCESS
        }
        Ok(Startup::Run(paths)) => app::run(paths),
        Err(error) => {
            eprintln!("Failed to configure native application: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
