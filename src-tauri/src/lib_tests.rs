use super::*;

#[test]
#[cfg(desktop)]
fn export_typescript_bindings() {
    app::registry::tests::full_contract::specta_builder()
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("failed to export TypeScript bindings");
}
