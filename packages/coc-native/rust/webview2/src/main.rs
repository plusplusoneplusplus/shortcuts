#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
mod host;
#[cfg_attr(not(all(target_os = "windows", target_arch = "x86_64")), allow(dead_code))]
mod protocol;

fn main() {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    if let Err(error) = host::run() {
        eprintln!("WebView2 host failed: {error}");
        std::process::exit(1);
    }
    #[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
    {
        protocol::emit(serde_json::json!({
            "available": false, "reason": "unsupported-platform",
            "message": "WebView2 requires Windows x64. Select Electron in Desktop Preferences."
        }));
    }
}
