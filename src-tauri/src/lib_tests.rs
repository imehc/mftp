use super::*;

#[test]
fn export_typescript_bindings() {
    specta_builder()
        .export(Typescript::default(), "../src/bindings.ts")
        .expect("failed to export TypeScript bindings");
}
