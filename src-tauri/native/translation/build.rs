use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// Rust's canonicalize returns verbatim `\\?\` paths on Windows. CMake and
/// MSVC reject those when compiling llama.cpp, so hand them a normal path.
fn cmake_source_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let source = root.join("../../target/translation-source/llama.cpp");
    let spec: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("engine.json"))?)?;
    let revision = spec["revision"].as_str().ok_or("Missing engine revision")?;
    // Match prepare-translation-engine.mjs: Windows checkouts may store the
    // patch with CRLF while the extracted source uses LF.
    let patch = std::fs::read_to_string(root.join("legacy-stq.patch"))?.replace("\r\n", "\n");
    let patch = Sha256::digest(patch.as_bytes());
    let patch = patch
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let expected = format!("{revision}:{patch}");
    let actual = std::fs::read_to_string(source.join(".mftp-version"))
        .map_err(|_| "Prepare native sources first: pnpm translation:prepare")?;
    if actual != expected {
        return Err("Stale native sources: run pnpm translation:prepare".into());
    }
    for path in [
        "bridge.cpp",
        "bridge.h",
        "CMakeLists.txt",
        "engine.json",
        "legacy-stq.patch",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }
    println!(
        "cargo:rerun-if-changed={}",
        source.join(".mftp-version").display()
    );
    let target = std::env::var("TARGET")?;
    println!("cargo:rerun-if-env-changed=CMAKE");
    println!("cargo:rerun-if-env-changed=ANDROID_NDK_HOME");
    println!("cargo:rerun-if-env-changed=NDK_HOME");
    let mut build = cmake::Config::new(&root);
    build.profile("Release").define(
        "MFTP_LLAMA_SOURCE",
        cmake_source_path(source.canonicalize()?),
    );
    if target == "aarch64-apple-darwin" || target == "aarch64-apple-ios-sim" {
        // Every Apple Silicon Mac (M1+) has dotprod and fp16 vector arithmetic.
        build.define("GGML_CPU_ARM_ARCH", "armv8.2-a+dotprod+fp16");
    } else if target.starts_with("aarch64") {
        // iOS 14 and Android 28 still run on cores without dotprod (A9-A12, Cortex-A53/A73).
        build.define("GGML_CPU_ARM_ARCH", "armv8-a");
    } else if target.starts_with("x86_64") && !target.contains("android") {
        // Intel Macs supported by macOS 10.15 start at Ivy Bridge (AVX/F16C, no AVX2).
        let features: &[&str] = if target.contains("apple") {
            &["AVX", "F16C"]
        } else {
            &["AVX", "AVX2", "FMA", "F16C", "BMI2"]
        };
        for feature in features {
            build.define(format!("GGML_{feature}"), "ON");
        }
    }
    if target.contains("android") {
        let ndk = std::env::var("ANDROID_NDK_HOME").or_else(|_| std::env::var("NDK_HOME"))?;
        let abi = if target.starts_with("aarch64") {
            "arm64-v8a"
        } else if target.starts_with("armv7") {
            "armeabi-v7a"
        } else if target.starts_with("x86_64") {
            "x86_64"
        } else {
            "x86"
        };
        let api_level = "28";
        build
            .define(
                "CMAKE_TOOLCHAIN_FILE",
                PathBuf::from(&ndk).join("build/cmake/android.toolchain.cmake"),
            )
            .define("ANDROID_ABI", abi)
            .define("ANDROID_PLATFORM", format!("android-{api_level}"))
            .define("ANDROID_STL", "c++_static");
        let host = std::env::var("HOST")?;
        let prebuilt = if host.contains("apple") {
            "darwin-x86_64"
        } else if host.contains("windows") {
            "windows-x86_64"
        } else {
            "linux-x86_64"
        };
        let triple = if target.starts_with("armv7") {
            "arm-linux-androideabi"
        } else if target.starts_with("i686") {
            "i686-linux-android"
        } else {
            target.as_str()
        };
        // The versioned directory must come first: the unversioned one only
        // ships libc.a (no libc.so), so a bare `-L <sysroot>/<triple>` makes
        // the linker resolve -lc to the static Bionic. That pulls a private
        // __libc_shared_globals into our .so whose auxv is null, and gets
        // called from compiler-builtins' init_have_lse_atomics at load time,
        // crashing the process before any app code runs.
        println!("cargo:rustc-link-search=native={ndk}/toolchains/llvm/prebuilt/{prebuilt}/sysroot/usr/lib/{triple}/{api_level}");
        println!("cargo:rustc-link-search=native={ndk}/toolchains/llvm/prebuilt/{prebuilt}/sysroot/usr/lib/{triple}");
    }
    let output = build.build();
    println!("cargo:rustc-link-search=native={}/lib", output.display());
    for library in ["mftp-translation", "llama", "ggml", "ggml-cpu", "ggml-base"] {
        println!("cargo:rustc-link-lib=static={library}");
    }
    if target.contains("android") {
        println!("cargo:rustc-link-lib=static=c++_static");
        println!("cargo:rustc-link-lib=static=c++abi");
        println!("cargo:rustc-link-lib=dl");
        println!("cargo:rustc-link-lib=log");
    } else if target.contains("apple") {
        println!("cargo:rustc-link-lib=c++");
    } else if !target.contains("msvc") {
        println!("cargo:rustc-link-lib=stdc++");
    }
    Ok(())
}
