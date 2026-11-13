use crate::overlay::{self, Frame, PanelMode, Placement};
use crate::protocol::{self, Command};
use crate::{profile, protocol::availability};
use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy,
    NSApplicationDidChangeScreenParametersNotification, NSAutoresizingMaskOptions,
    NSBackingStoreType, NSEvent, NSEventType, NSPanel, NSResponder, NSScreen, NSWindow,
    NSWindowCollectionBehavior, NSWindowNumberListOptions, NSWindowOrderingMode, NSWindowStyleMask,
    NSWorkspace, NSWorkspaceActiveSpaceDidChangeNotification,
    NSWorkspaceDidActivateApplicationNotification,
};
use objc2_foundation::{
    NSNotificationCenter, NSObjectProtocol, NSOperationQueue, NSPoint, NSProcessInfo, NSRect,
    NSSize, NSString, NSURLRequest, NSURL, NSUUID,
};
use objc2_web_kit::{WKWebView, WKWebViewConfiguration, WKWebsiteDataStore};
use serde_json::json;
use std::cell::{Cell, OnceCell, RefCell};
use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::rc::Rc;

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
    let data_store =
        profile::data_store_id(&profile_dir, || NSUUID::UUID().UUIDString().to_string())?;
    let mtm = MainThreadMarker::new().ok_or("WKWebView host must start on the main thread")?;
    DATA_STORE.with(|cell| cell.set(data_store)).map_err(|_| "data store already set")?;
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
    let _observers = observe_window_environment();
    protocol::emit(json!({ "event": "ready" }));
    app.run();
    Ok(())
}

#[derive(Default)]
struct PanelIvars {
    /// Set by an explicit `focus` or a real user click; cleared when the panel loses key
    /// status or leaves the screen, so ordering a panel in never takes keyboard focus.
    key_allowed: Cell<bool>,
}

define_class!(
    /// Borderless panels refuse key status by default; the browser needs it for typing
    /// after an explicit focus. It never becomes main, so it never activates the helper.
    #[unsafe(super(NSPanel, NSWindow, NSResponder, objc2_foundation::NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "CocBrowserPanel"]
    #[ivars = PanelIvars]
    struct BrowserPanel;

    impl BrowserPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            self.ivars().key_allowed.get()
        }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool {
            false
        }

        #[unsafe(method(sendEvent:))]
        fn send_event(&self, event: &NSEvent) {
            if matches!(
                event.r#type(),
                NSEventType::LeftMouseDown | NSEventType::RightMouseDown | NSEventType::OtherMouseDown
            ) {
                self.ivars().key_allowed.set(true);
            }
            unsafe { msg_send![super(self), sendEvent: event] }
        }

        #[unsafe(method(resignKeyWindow))]
        fn resign_key_window(&self) {
            self.ivars().key_allowed.set(false);
            unsafe { msg_send![super(self), resignKeyWindow] }
        }
    }
);

struct View {
    panel: Retained<BrowserPanel>,
    webview: Retained<WKWebView>,
    parent_window: Cell<Option<isize>>,
    placement: Cell<Placement>,
    mode: Cell<PanelMode>,
}

thread_local! {
    static DATA_STORE: OnceCell<String> = const { OnceCell::new() };
    static VIEWS: RefCell<HashMap<String, Rc<View>>> = RefCell::new(HashMap::new());
}

fn main_thread() -> MainThreadMarker {
    MainThreadMarker::new().expect("browser commands run on the main thread")
}

fn primary_height(mtm: MainThreadMarker) -> f64 {
    NSScreen::screens(mtm).firstObject().map_or(0.0, |screen| screen.frame().size.height)
}

/// Window numbers AppKit lists are the visible windows of all apps on the active Space,
/// so a minimized, hidden or other-Space parent is absent.
fn parent_on_active_space(window: isize, mtm: MainThreadMarker) -> bool {
    NSWindow::windowNumbersWithOptions(NSWindowNumberListOptions::AllApplications, mtm)
        .is_some_and(|numbers| numbers.iter().any(|number| number.integerValue() == window))
}

fn ns_rect(frame: Frame) -> NSRect {
    NSRect::new(NSPoint::new(frame.x, frame.y), NSSize::new(frame.width, frame.height))
}

fn frame_of(rect: NSRect) -> Frame {
    Frame { x: rect.origin.x, y: rect.origin.y, width: rect.size.width, height: rect.size.height }
}

impl View {
    fn apply(&self, mtm: MainThreadMarker) {
        let mut placement = self.placement.get();
        placement.parent_on_active_space =
            self.parent_window.get().is_none_or(|window| parent_on_active_space(window, mtm));
        let mode = overlay::panel_mode(&placement, primary_height(mtm));
        match mode {
            PanelMode::Shown(frame) => {
                placement.last_size = Some((frame.width, frame.height));
                self.panel.setFrame_display(ns_rect(frame), true);
                // Ordering relative to the parent keeps other apps' windows above both.
                match self.parent_window.get() {
                    Some(parent) => {
                        self.panel.orderWindow_relativeTo(NSWindowOrderingMode::Above, parent)
                    }
                    None => self.panel.orderFrontRegardless(),
                }
            }
            PanelMode::Background(frame) => {
                // An off-screen panel must never keep keyboard focus.
                if self.panel.isKeyWindow() {
                    self.panel.orderOut(None);
                }
                self.panel.setFrame_display(ns_rect(frame), true);
                if !self.panel.isVisible() {
                    self.panel.orderWindow_relativeTo(NSWindowOrderingMode::Below, 0);
                }
            }
            PanelMode::Hidden => self.panel.orderOut(None),
        }
        if !matches!(mode, PanelMode::Shown(_)) {
            self.panel.ivars().key_allowed.set(false);
        }
        self.placement.set(placement);
        self.mode.set(mode);
    }

    fn state(&self, mtm: MainThreadMarker) -> serde_json::Value {
        let frame = overlay::from_appkit(&frame_of(self.panel.frame()), primary_height(mtm));
        json!({
            "mode": self.mode.get().name(),
            "visible": self.panel.isVisible(),
            "key": self.panel.isKeyWindow(),
            "frame": { "x": frame.x, "y": frame.y, "width": frame.width, "height": frame.height },
            "windowNumber": self.panel.windowNumber(),
            "parentOnActiveSpace": self.placement.get().parent_on_active_space,
        })
    }

    fn close(&self) {
        self.panel.orderOut(None);
        self.panel.close();
    }
}

fn reapply_all() {
    let mtm = main_thread();
    let views: Vec<_> = VIEWS.with(|views| views.borrow().values().cloned().collect());
    for view in views {
        view.apply(mtm);
    }
}

/// Space switches, app activation (which can raise the parent above its panel) and
/// display changes all re-place every panel against its parent.
fn observe_window_environment() -> Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>> {
    let block = RcBlock::new(|_| DispatchQueue::main().exec_async(reapply_all));
    let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
    let default = NSNotificationCenter::defaultCenter();
    let queue = NSOperationQueue::mainQueue();
    unsafe {
        [
            (&workspace, NSWorkspaceActiveSpaceDidChangeNotification),
            (&workspace, NSWorkspaceDidActivateApplicationNotification),
            (&default, NSApplicationDidChangeScreenParametersNotification),
        ]
        .into_iter()
        .map(|(center, name)| {
            center.addObserverForName_object_queue_usingBlock(
                Some(name),
                None,
                Some(&queue),
                &block,
            )
        })
        .collect()
    }
}

fn parent_window(command: &Command) -> Result<Option<isize>, &'static str> {
    match command.parent_window {
        None => Ok(None),
        Some(window) if window > 0 => {
            isize::try_from(window).map(Some).map_err(|_| "Invalid parent window.")
        }
        Some(_) => Err("Invalid parent window."),
    }
}

fn checked_bounds(command: &Command) -> Result<Option<protocol::Bounds>, &'static str> {
    match command.bounds {
        Some(bounds) if !overlay::valid_bounds(&bounds) => Err("Invalid browser view bounds."),
        bounds => Ok(bounds),
    }
}

fn open(command: &Command, mtm: MainThreadMarker) -> Result<(), &'static str> {
    let id = command.view_id.as_deref().filter(|id| protocol::allowed_view_id(id));
    let url = command.url.as_deref().filter(|url| protocol::allowed_url(url, true));
    let (Some(id), Some(url)) = (id, url) else {
        return Err("A browser view id and HTTP(S) URL are required.");
    };
    if VIEWS.with(|views| views.borrow().contains_key(id)) {
        return Err("Browser view already exists.");
    }
    let parent = parent_window(command)?;
    let bounds = checked_bounds(command)?;
    let store_id =
        DATA_STORE.with(|cell| cell.get().cloned()).ok_or("Browser profile unavailable.")?;
    let uuid = NSUUID::from_string(&NSString::from_str(&store_id))
        .ok_or("Browser profile unavailable.")?;
    let request = NSURL::URLWithString(&NSString::from_str(url))
        .map(|url| NSURLRequest::requestWithURL(&url))
        .ok_or("A browser view id and HTTP(S) URL are required.")?;
    let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1024.0, 768.0));
    let panel: Retained<BrowserPanel> = unsafe {
        msg_send![
            super(BrowserPanel::alloc(mtm).set_ivars(PanelIvars::default())),
            initWithContentRect: rect,
            styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
            backing: NSBackingStoreType::Buffered,
            defer: false,
        ]
    };
    let webview = unsafe {
        let configuration = WKWebViewConfiguration::new(mtm);
        configuration.setWebsiteDataStore(&WKWebsiteDataStore::dataStoreForIdentifier(&uuid, mtm));
        WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), rect, &configuration)
    };
    unsafe { panel.setReleasedWhenClosed(false) };
    // Panels hide when their app deactivates; this helper is never the active app.
    panel.setHidesOnDeactivate(false);
    panel.setHasShadow(false);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle
            | NSWindowCollectionBehavior::Transient,
    );
    webview.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    panel.setContentView(Some(&webview));
    let view = Rc::new(View {
        panel,
        webview,
        parent_window: Cell::new(parent),
        placement: Cell::new(Placement {
            bounds,
            parent_shown: command.visible.unwrap_or(false),
            ..Placement::default()
        }),
        mode: Cell::new(PanelMode::Hidden),
    });
    VIEWS.with(|views| views.borrow_mut().insert(id.to_string(), view.clone()));
    view.apply(mtm);
    unsafe { view.webview.loadRequest(&request) };
    Ok(())
}

fn view_command(
    view: &View,
    command: &Command,
    mtm: MainThreadMarker,
) -> Result<Option<serde_json::Value>, &'static str> {
    match command.op.as_str() {
        "bounds" => {
            let bounds = checked_bounds(command)?;
            view.placement.set(Placement { bounds, ..view.placement.get() });
        }
        "parent" => {
            let visible = command.visible.ok_or("Parent visibility is required.")?;
            if command.parent_window.is_some() {
                view.parent_window.set(parent_window(command)?);
            }
            view.placement.set(Placement { parent_shown: visible, ..view.placement.get() });
        }
        "background" => {
            let enabled = command.enabled.ok_or("Background state is required.")?;
            view.placement.set(Placement { background: enabled, ..view.placement.get() });
        }
        "focus" => {
            view.apply(mtm);
            if !matches!(view.mode.get(), PanelMode::Shown(_)) {
                return Err("Browser view is not visible.");
            }
            // Explicit focus is the only path that activates the helper and makes the
            // panel key; background work never calls it.
            view.panel.ivars().key_allowed.set(true);
            NSApplication::sharedApplication(mtm).activate();
            view.panel.makeKeyAndOrderFront(None);
            view.panel.makeFirstResponder(Some(&view.webview));
            return Ok(None);
        }
        "view-state" => {
            view.apply(mtm);
            return Ok(Some(view.state(mtm)));
        }
        _ => return Err("Unsupported WKWebView command."),
    }
    view.apply(mtm);
    Ok(None)
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
        "open" => match open(&command, main_thread()) {
            Ok(()) => protocol::success(command.id),
            Err(message) => protocol::failure(command.id, "invalid", message),
        },
        "close" => {
            let id = command.view_id.as_deref().unwrap_or_default();
            if let Some(view) = VIEWS.with(|views| views.borrow_mut().remove(id)) {
                view.close();
            }
            protocol::success(command.id);
        }
        _ => {
            let id = command.view_id.as_deref().unwrap_or_default();
            let Some(view) = VIEWS.with(|views| views.borrow().get(id).cloned()) else {
                protocol::failure(command.id, "not-found", "Browser view not found.");
                return;
            };
            match view_command(&view, &command, main_thread()) {
                Ok(result) => protocol::reply(command.id, result),
                Err(message) => protocol::failure(command.id, "invalid", message),
            }
        }
    }
}
