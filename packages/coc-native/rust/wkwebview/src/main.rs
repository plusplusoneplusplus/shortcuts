// The skeleton exposes the transport and policy the view host builds on.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod certificate;
#[path = "../../webview2/src/download.rs"]
#[allow(dead_code)]
mod download;
#[path = "../../webview2/src/history.rs"]
#[allow(dead_code)]
mod history;
#[cfg(target_os = "macos")]
mod host;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod overlay;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod profile;
#[allow(dead_code)]
mod protocol;

fn main() {
    #[cfg(target_os = "macos")]
    if let Err(error) = host::run() {
        eprintln!("WKWebView host failed: {error}");
        std::process::exit(1);
    }
    #[cfg(not(target_os = "macos"))]
    protocol::emit(protocol::availability(None));
}
