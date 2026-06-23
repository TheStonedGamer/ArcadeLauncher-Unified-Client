// Embed Windows resources into updater.exe:
//   * the launcher's icon (`../icons/icon.ico`), so the bootstrapper matches the
//     app in Explorer and the taskbar instead of showing a generic exe icon; and
//   * an application manifest declaring `asInvoker`, so the OS does not
//     auto-elevate the executable just because its name contains "update".
// The manifest is applied to both the shipped binary and the test harness (whose
// exe name also trips the heuristic). MSVC-only; a no-op on other toolchains.
fn main() {
    println!("cargo:rerun-if-changed=updater.manifest");
    println!("cargo:rerun-if-changed=../icons/icon.ico");

    // Embed the *app* version (from ../tauri.conf.json) as APP_VERSION. The
    // updater ships in lockstep with the app it bundles, so this is the version
    // currently installed. The update check compares the release manifest against
    // this — NOT against the updater's own CARGO_PKG_VERSION, which tracks the
    // bootstrapper independently and would otherwise make every launch reinstall.
    println!("cargo:rerun-if-changed=../tauri.conf.json");
    let conf = std::fs::read_to_string("../tauri.conf.json")
        .expect("read ../tauri.conf.json for APP_VERSION");
    let app_version = conf
        .lines()
        .find_map(|l| {
            let l = l.trim();
            l.strip_prefix("\"version\"")
                .map(|rest| rest.trim_start_matches([':', ' ']).trim_matches(['"', ',', ' ']))
        })
        .expect("find top-level \"version\" in tauri.conf.json");
    println!("cargo:rustc-env=APP_VERSION={app_version}");

    // Embed the host engine (Sunshine sidecar) version as SUNSHINE_HOST_VERSION.
    // The bootstrapper pulls the host engine itself (see update.rs), so it needs
    // to know which engine release to fetch. Parse it straight out of the app
    // crate's host_fetch.rs so that const stays the single source of truth — the
    // in-app runtime fetch and the bootstrapper can never drift out of lockstep.
    println!("cargo:rerun-if-changed=../src/streaming/host_fetch.rs");
    let host_fetch = std::fs::read_to_string("../src/streaming/host_fetch.rs")
        .expect("read ../src/streaming/host_fetch.rs for SUNSHINE_HOST_VERSION");
    let engine_version = host_fetch
        .lines()
        .find(|l| l.contains("SUNSHINE_HOST_VERSION") && l.contains('='))
        .and_then(|l| l.split('"').nth(1))
        .expect("parse SUNSHINE_HOST_VERSION from host_fetch.rs");
    println!("cargo:rustc-env=SUNSHINE_HOST_VERSION={engine_version}");

    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // Same icon the launcher ships (src-tauri/icons/icon.ico). Compiled into a
        // .res and linked into updater.exe. We leave the manifest unset here so the
        // linker-based asInvoker embedding below stays the single source of truth.
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../icons/icon.ico");
        res.compile().expect("embed updater icon resource");

        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("updater.manifest");
        let manifest = manifest.display();
        // rustc-link-arg covers binaries, examples, and test executables — so
        // both updater.exe and the unit-test harness get the asInvoker manifest.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{manifest}");
    }
}
