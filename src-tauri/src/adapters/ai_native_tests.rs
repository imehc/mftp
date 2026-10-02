//! Opt-in native checks. Only fresh UUID accounts are touched; application
//! databases and the legacy default account are never opened by this fixture.

use crate::error::{AppError, AppResult};
use crate::modules::ai::AiCredentials;

fn require(condition: bool, step: &'static str) -> AppResult<()> {
    if condition {
        Ok(())
    } else {
        Err(AppError::external("credential:test", step))
    }
}

pub(crate) async fn verify_roundtrip(
    credentials: &impl AiCredentials,
    mut progress: impl FnMut(&'static str),
) -> AppResult<()> {
    let first = format!("ai-{}", uuid::Uuid::new_v4());
    let second = format!("ai-{}", uuid::Uuid::new_v4());
    let original = uuid::Uuid::new_v4().to_string();
    let replacement = uuid::Uuid::new_v4().to_string();
    let independent = uuid::Uuid::new_v4().to_string();

    // Cleanup runs after every completed success/error path. No assertion
    // formats plaintext values, including on a native readback mismatch.
    let result = async {
        progress("missing_read");
        require(
            credentials.read(first.clone()).await?.is_none(),
            "missing_read",
        )?;
        progress("save_first");
        credentials.save(first.clone(), original.clone()).await?;
        progress("save_second");
        credentials
            .save(second.clone(), independent.clone())
            .await?;
        progress("read_first");
        require(
            credentials.read(first.clone()).await?.as_deref() == Some(original.as_str()),
            "read_first",
        )?;
        progress("replace_first");
        credentials.save(first.clone(), replacement.clone()).await?;
        progress("read_replacement");
        require(
            credentials.read(first.clone()).await?.as_deref() == Some(replacement.as_str()),
            "read_replacement",
        )?;
        progress("read_independent");
        require(
            credentials.read(second.clone()).await?.as_deref() == Some(independent.as_str()),
            "read_independent",
        )?;
        progress("delete_first_twice");
        credentials.clear(first.clone()).await?;
        credentials.clear(first.clone()).await?;
        require(
            credentials.read(first.clone()).await?.is_none(),
            "deleted_read",
        )?;
        progress("read_surviving_account");
        require(
            credentials.read(second.clone()).await?.as_deref() == Some(independent.as_str()),
            "read_surviving_account",
        )
    }
    .await;

    progress("cleanup");
    let first_cleanup = credentials.clear(first.clone()).await;
    let second_cleanup = credentials.clear(second.clone()).await;
    first_cleanup?;
    second_cleanup?;
    require(credentials.read(first).await?.is_none(), "cleanup_first")?;
    require(credentials.read(second).await?.is_none(), "cleanup_second")?;
    result?;
    progress("passed");
    Ok(())
}

#[cfg(all(test, desktop))]
#[test]
#[ignore = "writes and removes fresh temporary accounts in the native credential store"]
fn native_credential_roundtrip() {
    let credentials = crate::adapters::ai::AiKeychain::default();
    tauri::async_runtime::block_on(verify_roundtrip(&credentials, |step| {
        println!("native credential check: {step}");
    }))
    .expect("native credential check failed (no credential values in diagnostics)");
}
