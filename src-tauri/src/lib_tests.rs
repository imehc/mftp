use super::*;

#[test]
fn export_typescript_bindings() {
    app::registry::specta_builder()
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("failed to export TypeScript bindings");
}
