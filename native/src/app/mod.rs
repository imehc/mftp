//! Native application assembly, window entry point, and lifecycle.

pub use crate::features::settings::{AppearancePreference, Settings};
mod assets;
mod commands;
mod workspace;

use crate::platform::{APP_ID, AppPaths};
use gpui_kit::{
    App, AppContext, Bounds, Entity, Render, TitlebarOptions, Window, WindowBounds, WindowOptions,
    px, size,
};
use std::{cell::Cell, process::ExitCode, rc::Rc};

/// Launch the desktop application without initializing Tauri or its storage.
pub fn run(paths: AppPaths) -> ExitCode {
    let (worker, ready) = match crate::features::todo::TodoWorker::start(paths.clone()) {
        Ok(started) => started,
        Err(error) => {
            eprintln!("Failed to start native todo worker: {}", error.code);
            return ExitCode::FAILURE;
        }
    };
    let client = worker.client();
    let result = run_with_view(paths, move |paths, window, cx| {
        cx.new(|cx| workspace::Workspace::new(paths, client, ready, window, cx))
    });
    match worker.shutdown() {
        Ok(()) => result,
        Err(error) => {
            eprintln!("Failed to stop native todo worker: {}", error.code);
            ExitCode::FAILURE
        }
    }
}

/// Use the production window lifecycle for a native acceptance example.
pub fn run_with_view<V: Render>(
    paths: AppPaths,
    build: impl FnOnce(AppPaths, &mut Window, &mut App) -> Entity<V> + 'static,
) -> ExitCode {
    let exit_code = Rc::new(Cell::new(ExitCode::SUCCESS));
    let outcome = exit_code.clone();
    gpui_kit::application()
        .with_assets(assets::NativeAssets)
        .run(move |cx| {
            gpui_kit::init(cx);
            crate::components::rich_text::init(cx);
            commands::bind_keys(cx);
            crate::features::todo::page::bind_keys(cx);
            cx.set_app_identity(APP_ID, "MFTP Native");
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();

            let bounds = Bounds::centered(None, size(px(1080.), px(720.)), cx);
            let opened = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    window_min_size: Some(size(px(720.), px(480.))),
                    titlebar: Some(TitlebarOptions {
                        title: Some("MFTP Native".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                cx,
                move |window, cx| build(paths, window, cx),
            );
            if let Err(error) = opened {
                eprintln!("Failed to open native application window: {error}");
                outcome.set(ExitCode::FAILURE);
                cx.quit();
            } else {
                cx.activate(true);
            }
        });
    exit_code.get()
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "The isolated production-window fixture must open successfully."
)]
pub(crate) fn open_test_workspace(
    paths: AppPaths,
    client: crate::features::todo::TodoClient,
    ready: crate::features::todo::TodoTask<()>,
    cx: &mut App,
) -> (
    gpui_kit::AnyWindowHandle,
    Entity<crate::features::todo::page::TodoPage>,
) {
    commands::bind_keys(cx);
    crate::components::rich_text::init(cx);
    let (handle, workspace) = gpui_kit::open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                Default::default(),
                size(px(1080.), px(720.)),
            ))),
            ..Default::default()
        },
        cx,
        |window, cx| cx.new(|cx| workspace::Workspace::new(paths, client, ready, window, cx)),
    )
    .unwrap();
    (handle, workspace.read(cx).todo_for_test())
}
