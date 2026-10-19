use super::*;

fn parameters() -> Parameters {
    Parameters {
        context: 2048,
        output: 512,
        threads: 4,
        seed: 42,
        top_k: 20,
        top_p: 0.6,
        temperature: 0.7,
        repeat_penalty: 1.05,
        legacy_stq: 1,
    }
}

#[test]
fn cancellation_before_loading_does_not_open_model() {
    assert_eq!(
        translate(
            Path::new("missing.gguf"),
            "hello",
            &parameters(),
            &AtomicBool::new(true),
            |_| true
        ),
        Err(Failure::Cancelled)
    );
}

#[test]
fn missing_model_returns_native_error() {
    assert!(matches!(
        translate(
            Path::new("missing.gguf"),
            "hello",
            &parameters(),
            &AtomicBool::new(false),
            |_| true
        ),
        Err(Failure::Engine(_))
    ));
}

#[test]
#[ignore = "Requires an explicitly supplied, isolated official model file"]
fn official_model_translates_and_cancels() {
    let path = std::env::var("MFTP_TEST_TRANSLATION_MODEL").expect("isolated model path");
    let mut params = parameters();
    if std::env::var("MFTP_TEST_TRANSLATION_LEGACY").as_deref() == Ok("0") {
        params.legacy_stq = 0;
    }
    let mut bytes = Vec::new();
    translate(Path::new(&path), "将以下文本翻译为英语，注意只需要输出翻译后的结果，不要额外解释：今天天气很好，我们一起去公园散步吧。",
        &params, &AtomicBool::new(false), |chunk| { bytes.extend_from_slice(chunk); true }).unwrap();
    let output = String::from_utf8(bytes).unwrap();
    assert!(output.contains("park"), "{output}");
    assert!(output.contains("weather"), "{output}");
    println!("{output}");
    let stopped = translate(Path::new(&path), "Translate the following segment into Chinese, without additional explanation.\n\nThe weather is lovely today.",
        &params, &AtomicBool::new(false), |_| false);
    assert_eq!(stopped, Err(Failure::Cancelled));
}

#[test]
#[ignore = "Requires an explicitly supplied official model; host performance only"]
fn multilingual_samples_and_limits() {
    let path = std::env::var("MFTP_TEST_TRANSLATION_MODEL").expect("isolated model path");
    let params = parameters();
    for (source, required) in [
        ("こんにちは。駅はどこですか？", "车站"),
        ("안녕하세요. 만나서 반갑습니다.", "高兴"),
        ("Line one: hello.\n第二行：明天见！", "明天"),
    ] {
        let prompt = format!("Translate the following segment into Chinese, without additional explanation.\n\n{source}");
        let started = std::time::Instant::now();
        let mut first = None;
        let mut bytes = Vec::new();
        translate(
            Path::new(&path),
            &prompt,
            &params,
            &AtomicBool::new(false),
            |chunk| {
                first.get_or_insert_with(|| started.elapsed());
                bytes.extend_from_slice(chunk);
                true
            },
        )
        .unwrap();
        let result = String::from_utf8(bytes).unwrap();
        assert!(result.contains(required), "{source} -> {result}");
        println!(
            "{source} -> {result}; first={first:?}, total={:?}",
            started.elapsed()
        );
    }
    let mut short = parameters();
    short.output = 1;
    assert_eq!(
        translate(
            Path::new(&path),
            "Translate into Chinese: The weather is lovely and we are going to the park.",
            &short,
            &AtomicBool::new(false),
            |_| true
        ),
        Err(Failure::OutputLimit)
    );
    assert_eq!(
        translate(
            Path::new(&path),
            &"hello world ".repeat(4096),
            &params,
            &AtomicBool::new(false),
            |_| true
        ),
        Err(Failure::InputLimit)
    );
}
