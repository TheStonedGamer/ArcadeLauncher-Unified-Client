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
