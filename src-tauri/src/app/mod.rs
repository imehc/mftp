mod cleanup;
mod lifecycle;
#[cfg(all(test, desktop))]
mod maintenance_export_tests;
pub(crate) mod registry;
pub(crate) mod services;

use crate::error::AppResult;
use services::AppServices;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;

pub(crate) fn run() -> AppResult<()> {
    cleanup::cleanup_stale_local_transfer_files();
    let registry = registry::specta_builder();
    // Bundled debug apps also run without a source tree. Export only in Tauri
    // development mode; tests export explicitly for all host builds.
    #[cfg(all(dev, desktop))]
    registry
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .map_err(|_| {
            crate::error::AppError::external(
                "bindings:export",
                "Failed to export TypeScript bindings",
            )
        })?;

    let app = tauri::Builder::default().manage(Arc::new(
        crate::modules::model_viewer::system::ModelOpenInbox::default(),
    ));
    #[cfg(desktop)]
    let app = app.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        crate::modules::model_viewer::system::enqueue_arguments(
            app,
            args,
            std::path::Path::new(&cwd),
        );
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }));
    let app = app
        .plugin(tauri_plugin_native_viewer::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(crate::file_opener::init())
        .plugin(tauri_plugin_native_export::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init());
    #[cfg(desktop)]
    let app = app
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(target_os = "android")]
    let app = app.plugin(tauri_plugin_keystore::init());

    let app = app
        .setup(|app| {
            let services = services::install(app.handle())?;
            app.manage(services.lifecycle.clone());
            app.manage(services);
            #[cfg(desktop)]
            if let Ok(cwd) = std::env::current_dir() {
                crate::modules::model_viewer::system::enqueue_arguments(
                    app.handle(),
                    std::env::args().collect(),
                    &cwd,
                );
            }
            Ok(())
        })
        .invoke_handler(guard_commands(registry.invoke_handler()))
        .build(tauri::generate_context!())?;

    app.run(on_run_event);
    Ok(())
}

fn guard_commands<R: tauri::Runtime>(
    commands: impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        // These commands only cancel/close owned export IDs or remove unpublished HDR drafts. Keep cleanup
        // available while maintenance or shutdown is draining the native worker.
        if matches!(
            invoke.message.command(),
            "model_export_cancel" | "model_export_close" | "model_environment_abort"
        ) {
            return commands(invoke);
        }
        let admission = invoke
            .message
            .webview_ref()
            .try_state::<Arc<lifecycle::Lifecycle>>()
            .map_or(Ok(()), |lifecycle| {
                if crate::modules::maintenance::reset::is_recovery_command(invoke.message.command())
                {
                    lifecycle.check_recovery_admission()
                } else {
                    lifecycle.check_admission()
                }
            });
        if let Err(error) = admission {
            invoke.resolver.reject(error);
            true
        } else {
            commands(invoke)
        }
    }
}

fn on_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    let Some(state) = app.try_state::<AppServices>() else {
        return;
    };
    #[cfg(target_os = "android")]
    state.ai_credentials.on_run_event(&event);
    match event {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        tauri::RunEvent::Opened { urls } => {
            for url in urls {
                state.model_inbox.push(url.to_string());
            }
        }
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if state.lifecycle.is_finished() {
                return;
            }
            // Tauri ignores prevent_exit for restart. Never turn a restart into
            // a regular exit; OS-forced exits are best effort, like RunEvent::Exit.
            api.prevent_exit();
            let resume_exit = (code != Some(tauri::RESTART_EXIT_CODE)).then_some(code.unwrap_or(0));
            shutdown(app, &state.lifecycle, resume_exit);
        }
        tauri::RunEvent::Exit => shutdown(app, &state.lifecycle, None),
        _ => {}
    }
}

fn shutdown(app: &tauri::AppHandle, lifecycle: &Arc<lifecycle::Lifecycle>, exit_code: Option<i32>) {
    if !lifecycle.begin_shutdown() {
        return;
    }
    let lifecycle = lifecycle.clone();
    let app = app.clone();
    // Manager stop routines may join threads. Keep them off Tauri's event loop.
    tauri::async_runtime::spawn_blocking(move || {
        let report = lifecycle.shutdown_blocking(Duration::from_secs(5));
        if report.completed() {
            cleanup::cleanup_stale_local_transfer_files();
        } else {
            eprintln!(
                "shutdown incomplete: {:?}, pipeline idle: {}",
                report.unfinished, report.operations_idle
            );
        }
        // Let the second ExitRequested through only after cleanup has finished.
        lifecycle.finish_shutdown();
        if let Some(code) = exit_code {
            app.exit(code);
        }
    });
}

#[cfg(all(test, desktop))]
mod tests;
