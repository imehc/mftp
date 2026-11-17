#![expect(
    clippy::unwrap_used,
    reason = "A failed headless fixture must fail the test immediately."
)]

use super::{AppearancePreference, Settings};
use crate::{
    i18n::{LanguagePreference, text},
    platform::AppPaths,
};

// GPUI component translations use one process-wide locale, even across test Apps.
use crate::UI_TEST_LOCK;
use gpui_kit::{
    AppContext, Bounds, Context, Entity, Role, TestAppContext, Window, WindowAppearance,
    WindowBounds, WindowHandle, WindowOptions,
    base::Root,
    component::{
        ActiveTheme, ThemeMode,
        input::{Input, InputState},
    },
    div,
    prelude::*,
    px, size,
    test::TestWindowExt,
};

struct InputFixture {
    settings: Entity<Settings>,
    title: Entity<InputState>,
}

impl Render for InputFixture {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.settings.read(cx).locale();
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(div().h(px(260.)).child(self.settings.clone()))
            .child(
                div()
                    .p_6()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(text("todo.title", locale).into_owned())
                    .child(
                        Input::new(&self.title)
                            .id("task-title")
                            .aria_label(text("todo.title", locale).into_owned())
                            .w(px(320.)),
                    ),
            )
    }
}

fn open_fixture(cx: &mut TestAppContext) -> (WindowHandle<Root>, Entity<InputFixture>) {
    cx.update(gpui_kit::init);
    cx.update(|cx| {
        let (handle, fixture) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(720.), px(480.)),
                    cx,
                ))),
                ..Default::default()
            },
            cx,
            |window, cx| {
                cx.new(|cx| InputFixture {
                    settings: cx.new(|cx| {
                        Settings::new(
                            AppPaths {
                                data_dir: "/isolated/native-headless".into(),
                            },
                            window,
                            cx,
                        )
                    }),
                    title: cx.new(|cx| InputState::new(window, cx)),
                })
            },
        )
        .unwrap();
        (handle.downcast::<Root>().unwrap(), fixture)
    })
}

#[gpui_kit::test]
fn language_switch_preserves_input_value_focus_and_semantics(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (handle, fixture) = open_fixture(cx);
    cx.update_window(handle.into(), |_, window, cx| {
        let settings = fixture.read(cx).settings.clone();
        settings.update(cx, |settings, cx| {
            settings.set_language(LanguagePreference::Chinese, window, cx)
        });
        window.render_frame(cx);
        window.click("task-title", cx);
        window.input("核对发布资料 José", cx);
        let input = window.find("task-title");
        assert_eq!(input.label(), Some("任务标题"));
        assert_eq!(input.role(), Some(Role::TextInput));
        assert_eq!(input.focused(), Some(true));
        settings.update(cx, |settings, cx| {
            settings.set_language(LanguagePreference::English, window, cx)
        });
        window.render_frame(cx);
        let input = window.find("task-title");
        assert_eq!(input.label(), Some("Task title"));
        assert_eq!(input.value(), Some("核对发布资料 José"));
        assert_eq!(input.focused(), Some(true));
        assert_eq!(window.find("language").label(), Some("Language"));
        assert_eq!(window.find("language").value(), Some("English"));
        assert_eq!(&*gpui_kit::component::locale(), "en");
        // Native text editing bindings still work after re-rendering translated controls.
        window.press("backspace", cx);
        assert_eq!(window.find("task-title").value(), Some("核对发布资料 Jos"));
        // TestPlatform uses an isolated in-memory clipboard, never the system clipboard.
        window.press("cmd-a", cx);
        window.press("cmd-c", cx);
        window.press("backspace", cx);
        assert_eq!(window.find("task-title").value(), Some(""));
        window.press("cmd-v", cx);
        assert_eq!(window.find("task-title").value(), Some("核对发布资料 Jos"));
    })
    .unwrap();
}

#[gpui_kit::test]
fn language_dropdown_commits_the_keyboard_selection(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (handle, fixture) = open_fixture(cx);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        window.click("language", cx);
        assert_eq!(
            window.find("language-option-chinese").label(),
            Some("简体中文")
        );
        assert_eq!(
            window.find("language-option-english").label(),
            Some("English")
        );
        window.press("down", cx);
        window.press("down", cx);
        window.press("enter", cx);
    })
    .unwrap();
    // Select commits through deferred effects after the input dispatch releases its entities.
    cx.run_until_parked();
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        let settings = fixture.read(cx).settings.clone();
        assert_eq!(settings.read(cx).locale(), crate::i18n::Locale::English);
        assert_eq!(window.find("language").label(), Some("Language"));
        assert_eq!(window.find("language").value(), Some("English"));
    })
    .unwrap();
}

#[gpui_kit::test]
fn tab_navigation_leaves_input_and_returns_without_changing_text(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (handle, _) = open_fixture(cx);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        window.click("task-title", cx);
        window.input("Input retained", cx);
        window.press("shift-tab", cx);
        assert_ne!(window.find("task-title").focused(), Some(true));
        window.press("tab", cx);
        assert_eq!(window.find("task-title").focused(), Some(true));
        assert_eq!(window.find("task-title").value(), Some("Input retained"));
    })
    .unwrap();
}

#[gpui_kit::test]
fn appearance_selection_cannot_be_cleared_by_repeated_clicks(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (handle, fixture) = open_fixture(cx);
    for (id, expected) in [
        ("appearance-dark", AppearancePreference::Dark),
        ("appearance-dark", AppearancePreference::Dark),
        ("appearance-light", AppearancePreference::Light),
        ("appearance-system", AppearancePreference::System),
    ] {
        cx.update_window(handle.into(), |_, window, cx| {
            window.click("appearance", cx);
            window.click(id, cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            let settings = fixture.read(cx).settings.clone();
            assert_eq!(settings.read(cx).appearance_preference(), expected);
            assert_eq!(cx.theme().mode, expected.resolve(window.appearance()));
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn english_controls_fit_inside_the_minimum_window(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (handle, fixture) = open_fixture(cx);
    cx.update_window(handle.into(), |_, window, cx| {
        let settings = fixture.read(cx).settings.clone();
        settings.update(cx, |settings, cx| {
            settings.set_language(LanguagePreference::English, window, cx)
        });
        window.render_frame(cx);
        for id in ["language", "appearance"] {
            let control = window.find(id);
            assert!(control.visible());
            assert!(control.bounds().size.width > px(0.));
            assert!(control.bounds().right() <= px(720.));
        }
        assert_eq!(
            window.find("language").bounds().size.width,
            window.find("appearance").bounds().size.width
        );
        assert_eq!(
            window.find("language").bounds().right(),
            window.find("appearance").bounds().right()
        );
        window.click("appearance", cx);
        for (id, label) in [
            ("appearance-system", "Follow system"),
            ("appearance-light", "Light"),
            ("appearance-dark", "Dark"),
        ] {
            assert_eq!(window.find(id).label(), Some(label));
        }
    })
    .unwrap();
}

#[test]
fn explicit_appearance_does_not_change_with_the_system() {
    assert_eq!(
        AppearancePreference::Light.resolve(WindowAppearance::Dark),
        ThemeMode::Light
    );
    assert_eq!(
        AppearancePreference::Dark.resolve(WindowAppearance::Light),
        ThemeMode::Dark
    );
    assert_eq!(
        AppearancePreference::System.resolve(WindowAppearance::Dark),
        ThemeMode::Dark
    );
    assert_eq!(
        AppearancePreference::System.resolve(WindowAppearance::Light),
        ThemeMode::Light
    );
}

#[test]
fn native_window_override_is_cleared_when_following_system() {
    assert_eq!(AppearancePreference::System.window_override(), None);
    assert_eq!(
        AppearancePreference::Light.window_override(),
        Some(WindowAppearance::Light)
    );
    assert_eq!(
        AppearancePreference::Dark.window_override(),
        Some(WindowAppearance::Dark)
    );
}
