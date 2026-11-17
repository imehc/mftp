use crate::{
    i18n::{LanguagePreference, Locale, text},
    platform::AppPaths,
};
use gpui_kit::{
    App, AppContext, Context, Entity, Role, SharedString, Subscription, TestSupportExt, Window,
    component::{
        ActiveTheme, IndexPath, Theme,
        searchable_list::SearchableListItem,
        select::{Select, SelectEvent, SelectState},
    },
    div,
    prelude::*,
};

pub use crate::preferences::AppearancePreference;
use crate::preferences::Preferences;

const APPEARANCES: [AppearancePreference; 3] = [
    AppearancePreference::System,
    AppearancePreference::Light,
    AppearancePreference::Dark,
];

#[derive(Clone)]
struct LanguageChoice {
    value: LanguagePreference,
    title: SharedString,
}

impl SearchableListItem for LanguageChoice {
    type Value = LanguagePreference;

    fn title(&self) -> SharedString {
        self.title.clone()
    }

    fn value(&self) -> &Self::Value {
        &self.value
    }

    fn render(&self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = match self.value {
            LanguagePreference::System => "language-option-system",
            LanguagePreference::Chinese => "language-option-chinese",
            LanguagePreference::English => "language-option-english",
        };
        // The Kit row wrapper does not forward its visible text into the native accessibility tree.
        div()
            .id(id)
            .test_support()
            .role(Role::Label)
            .aria_label(self.title.clone())
            .child(self.title.clone())
    }
}

fn language_choices(locale: Locale) -> Vec<LanguageChoice> {
    [
        LanguagePreference::System,
        LanguagePreference::Chinese,
        LanguagePreference::English,
    ]
    .into_iter()
    .map(|value| LanguageChoice {
        value,
        title: value.label(locale).into_owned().into(),
    })
    .collect()
}

#[derive(Clone)]
struct AppearanceChoice {
    value: AppearancePreference,
    title: SharedString,
}

impl SearchableListItem for AppearanceChoice {
    type Value = AppearancePreference;
    fn title(&self) -> SharedString {
        self.title.clone()
    }
    fn value(&self) -> &Self::Value {
        &self.value
    }
    fn render(&self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .id(self.value.control_id())
            .test_support()
            .role(Role::Label)
            .aria_label(self.title.clone())
            .child(self.title.clone())
    }
}

fn appearance_choices(locale: Locale) -> Vec<AppearanceChoice> {
    APPEARANCES
        .into_iter()
        .map(|value| AppearanceChoice {
            value,
            title: text(value.label_key(), locale).into_owned().into(),
        })
        .collect()
}

/// Retained preferences controls; persistence is coordinated by the application shell.
pub struct Settings {
    // Keep the independent startup identity available for later service assembly.
    _paths: AppPaths,
    system_locale: Locale,
    language: LanguagePreference,
    appearance: AppearancePreference,
    language_select: Entity<SelectState<Vec<LanguageChoice>>>,
    appearance_select: Entity<SelectState<Vec<AppearanceChoice>>>,
    _subscriptions: Vec<Subscription>,
}

impl gpui_kit::EventEmitter<Preferences> for Settings {}

impl Settings {
    /// Create retained controls and subscriptions once, outside the render loop.
    pub fn new(paths: AppPaths, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let system_locale = sys_locale::get_locale()
            .as_deref()
            .map(Locale::from_system)
            .unwrap_or(Locale::English);
        let language = LanguagePreference::System;
        gpui_kit::component::set_locale(language.resolve(system_locale).as_str());
        Theme::sync_system_appearance(Some(window), cx);
        let language_select = cx.new(|cx| {
            SelectState::new(
                language_choices(system_locale),
                Some(IndexPath::new(0)),
                window,
                cx,
            )
        });
        let select_subscription = cx.subscribe_in(
            &language_select,
            window,
            |this, _, event: &SelectEvent<Vec<LanguageChoice>>, window, cx| {
                let SelectEvent::Confirm(value) = event;
                if let Some(value) = value {
                    this.set_language(*value, window, cx);
                }
            },
        );
        let appearance_select = cx.new(|cx| {
            SelectState::new(
                appearance_choices(system_locale),
                Some(IndexPath::new(0)),
                window,
                cx,
            )
        });
        let appearance_select_subscription = cx.subscribe_in(
            &appearance_select,
            window,
            |this, _, event: &SelectEvent<Vec<AppearanceChoice>>, window, cx| {
                let SelectEvent::Confirm(value) = event;
                if let Some(value) = value {
                    this.set_appearance_preference(*value, window, cx);
                }
            },
        );
        let appearance_subscription = cx.observe_window_appearance(window, |this, window, cx| {
            this.apply_appearance(window, cx);
        });
        Self {
            _paths: paths,
            system_locale,
            language,
            appearance: AppearancePreference::System,
            language_select,
            appearance_select,
            _subscriptions: vec![
                select_subscription,
                appearance_subscription,
                appearance_select_subscription,
            ],
        }
    }

    /// Return the effective interface locale without changing the preference.
    pub fn locale(&self) -> Locale {
        self.language.resolve(self.system_locale)
    }

    /// Return the preference rather than the theme resolved from the operating system.
    pub fn appearance_preference(&self) -> AppearancePreference {
        self.appearance
    }

    /// Keep platform window chrome and the content theme under the same preference.
    pub fn set_appearance_preference(
        &mut self,
        value: AppearancePreference,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.appearance = value;
        self.appearance_select.update(cx, |select, cx| {
            select.set_selected_value(&value, window, cx)
        });
        cx.set_window_appearance(value.window_override());
        self.apply_appearance(window, cx);
        cx.emit(self.preferences());
        cx.notify();
    }

    /// Update application and component translations while retaining input entities.
    pub fn set_language(
        &mut self,
        value: LanguagePreference,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.language = value;
        let locale = self.locale();
        gpui_kit::component::set_locale(locale.as_str());
        self.language_select.update(cx, |select, cx| {
            select.set_items(language_choices(locale), window, cx);
            select.set_selected_value(&value, window, cx);
        });
        self.appearance_select.update(cx, |select, cx| {
            select.set_items(appearance_choices(locale), window, cx);
            select.set_selected_value(&self.appearance, window, cx);
        });
        cx.notify();
        cx.emit(self.preferences());
        cx.refresh_windows();
    }

    pub fn preferences(&self) -> Preferences {
        Preferences::new(self.language, self.appearance)
    }

    pub fn restore(
        &mut self,
        preferences: Preferences,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_language(preferences.language(), window, cx);
        self.set_appearance_preference(preferences.appearance(), window, cx);
    }

    fn apply_appearance(&self, window: &mut Window, cx: &mut Context<Self>) {
        Theme::change(
            self.appearance.resolve(window.appearance()),
            Some(window),
            cx,
        );
    }
}

impl Render for Settings {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.locale();
        div()
            .id("settings")
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .text_sm()
            .p_6()
            .child(
                div()
                    .w_full()
                    .max_w(gpui_kit::rems(35.))
                    .flex()
                    .flex_col()
                    .gap_6()
                    .child(
                        div()
                            .w_full()
                            .text_xl()
                            .font_weight(gpui_kit::FontWeight::SEMIBOLD)
                            .child(text("settings.title", locale).into_owned()),
                    )
                    .child(
                        div()
                            .w_full()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_4()
                            .child(text("settings.language", locale).into_owned())
                            .child(
                                div().w(gpui_kit::rems(11.25)).flex_shrink_0().child(
                                    Select::new(&self.language_select)
                                        .id("language")
                                        .accessibility_label(
                                            text("settings.language", locale).into_owned(),
                                        )
                                        .w_full(),
                                ),
                            ),
                    )
                    .child(
                        div()
                            .w_full()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_4()
                            .child(text("settings.appearance", locale).into_owned())
                            .child(
                                div().w(gpui_kit::rems(11.25)).flex_shrink_0().child(
                                    Select::new(&self.appearance_select)
                                        .id("appearance")
                                        .accessibility_label(
                                            text("settings.appearance", locale).into_owned(),
                                        )
                                        .w_full(),
                                ),
                            ),
                    ),
            )
    }
}
