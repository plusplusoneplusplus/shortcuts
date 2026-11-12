use crate::protocol::{self, Command};
use crate::{profile, protocol::availability};
use dispatch2::DispatchQueue;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
use objc2_foundation::{NSProcessInfo, NSUUID};
use serde_json::json;
use std::io;
use std::path::PathBuf;

pub type HostResult<T> = Result<T, Box<dyn std::error::Error>>;

pub fn macos_major() -> u64 {
    NSProcessInfo::processInfo().operatingSystemVersion().majorVersion.max(0) as u64
}

pub fn run() -> HostResult<()> {
    if std::env::args().any(|arg| arg == "--check") {
        protocol::emit(availability(Some(macos_major())));
        return Ok(());
    }
    let check = availability(Some(macos_major()));
    if check["available"] != true {
        protocol::failure(0, "native-unavailable", check["message"].as_str().unwrap_or_default());
        return Ok(());
    }
    let profile_dir = PathBuf::from(std::env::args().nth(1).ok_or("Missing profile directory")?);
    let _lock = match profile::lock(&profile_dir) {
        Ok(lock) => lock,
        Err(error) => {
            protocol::failure(
                0,
                "profile-locked",
                format!("Close the other desktop process using this browser profile, then retry: {error}"),
            );
            return Ok(());
        }
    };
    let _data_store =
        profile::data_store_id(&profile_dir, || NSUUID::UUID().UUIDString().to_string())?;
    let mtm = MainThreadMarker::new().ok_or("WKWebView host must start on the main thread")?;
    let app = NSApplication::sharedApplication(mtm);
    // An accessory app has no Dock icon or menu bar and never activates on its own.
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    std::thread::spawn(|| {
        let mut input = io::stdin().lock();
        loop {
            match protocol::read_command(&mut input) {
                Ok(Some(Ok(command))) => {
                    DispatchQueue::main().exec_async(move || dispatch(command))
                }
                Ok(Some(Err(message))) => protocol::failure(0, "invalid", message),
                Ok(None) => break,
                Err(error) => {
                    eprintln!("Browser command input failed: {error}");
                    break;
                }
            }
        }
        // The desktop closed stdin: stop on the main thread like an explicit quit.
        DispatchQueue::main().exec_async(|| std::process::exit(0));
    });
    protocol::emit(json!({ "event": "ready" }));
    app.run();
    Ok(())
}

fn dispatch(command: Command) {
    if protocol::output_failed() {
        std::process::exit(1);
    }
    match command.op.as_str() {
        "quit" => {
            protocol::success(command.id);
            std::process::exit(0);
        }
        _ => protocol::failure(command.id, "invalid", "Unsupported WKWebView command."),
    }
}
