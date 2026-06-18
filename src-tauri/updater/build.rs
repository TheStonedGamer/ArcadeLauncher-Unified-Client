// Embed a Windows application manifest declaring `asInvoker`, so the OS does not
// auto-elevate the executable just because its name contains "update". Applied
// to both the shipped binary and the test harness (whose exe name also trips the
// heuristic). MSVC-only embedding via the linker; a no-op on other toolchains.
fn main() {
    println!("cargo:rerun-if-changed=updater.manifest");

    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("updater.manifest");
        let manifest = manifest.display();
        // rustc-link-arg covers binaries, examples, and test executables — so
        // both updater.exe and the unit-test harness get the asInvoker manifest.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{manifest}");
    }
}
