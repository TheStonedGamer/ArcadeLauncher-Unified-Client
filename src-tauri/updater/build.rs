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

    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // Embed the manifest as a Windows resource alongside the icon. Passing it
        // to the linker with /MANIFESTINPUT makes link.exe merge it with its
        // default manifest and namespace the execution-level attributes. Windows
        // then rejects the result because the required unqualified `level`
        // attribute is missing.
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../icons/icon.ico");
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("updater.manifest");
        res.set_manifest_file(manifest.to_str().expect("manifest path is valid UTF-8"));
        res.compile().expect("embed updater icon and manifest resources");
    }
}
