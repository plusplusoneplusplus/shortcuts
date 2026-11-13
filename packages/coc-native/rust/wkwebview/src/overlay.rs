use crate::protocol::Bounds;

/// Largest panel edge main may place, in points. Larger requests are rejected.
pub const MAX_PANEL_EDGE: f64 = 16_384.0;
/// Background panels render here: far outside any display arrangement, so they stay
/// ordered in (WebKit keeps painting and running timers) without being seen.
pub const OFFSCREEN_ORIGIN: f64 = -100_000.0;

/// A rectangle in AppKit screen coordinates (bottom-left origin of the primary display).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn valid_bounds(bounds: &Bounds) -> bool {
    [bounds.x, bounds.y, bounds.width, bounds.height].iter().all(|value| value.is_finite())
        && bounds.width >= 1.0
        && bounds.height >= 1.0
        && bounds.width <= MAX_PANEL_EDGE
        && bounds.height <= MAX_PANEL_EDGE
        && bounds.x.abs() <= 1_000_000.0
        && bounds.y.abs() <= 1_000_000.0
}

/// Electron screen bounds use a top-left origin on the primary display; AppKit flips y.
pub fn to_appkit(bounds: &Bounds, primary_height: f64) -> Frame {
    Frame {
        x: bounds.x,
        y: primary_height - bounds.y - bounds.height,
        width: bounds.width,
        height: bounds.height,
    }
}

pub fn from_appkit(frame: &Frame, primary_height: f64) -> Bounds {
    Bounds {
        x: frame.x,
        y: primary_height - frame.y - frame.height,
        width: frame.width,
        height: frame.height,
    }
}

/// What main last told the helper about one view.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Placement {
    /// Screen bounds of the view's slot; `None` while the view is unplaced.
    pub bounds: Option<Bounds>,
    /// Size the page last rendered at, kept for background rendering.
    pub last_size: Option<(f64, f64)>,
    /// Main's view of the parent window: shown, not minimized/hidden/occluded.
    pub parent_shown: bool,
    /// Whether the parent window is on the active Space (helper-observed).
    pub parent_on_active_space: bool,
    /// Background control is running and needs the page to keep rendering.
    pub background: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PanelMode {
    /// Ordered in above the parent at this frame.
    Shown(Frame),
    /// Ordered in off-screen at the last size; never visible and never key.
    Background(Frame),
    /// Ordered out.
    Hidden,
}

impl PanelMode {
    pub fn name(&self) -> &'static str {
        match self {
            PanelMode::Shown(_) => "shown",
            PanelMode::Background(_) => "background",
            PanelMode::Hidden => "hidden",
        }
    }
}

/// The panel is visible only while it is placed and its parent is visible on the
/// active Space. Otherwise background control keeps it rendering off-screen.
pub fn panel_mode(placement: &Placement, primary_height: f64) -> PanelMode {
    let parent_visible = placement.parent_shown && placement.parent_on_active_space;
    if let (Some(bounds), true) = (placement.bounds, parent_visible) {
        return PanelMode::Shown(to_appkit(&bounds, primary_height));
    }
    if placement.background {
        let (width, height) = placement
            .bounds
            .map(|bounds| (bounds.width, bounds.height))
            .or(placement.last_size)
            .unwrap_or((1024.0, 768.0));
        return PanelMode::Background(Frame {
            x: OFFSCREEN_ORIGIN - width,
            y: OFFSCREEN_ORIGIN - height,
            width,
            height,
        });
    }
    PanelMode::Hidden
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds { x, y, width, height }
    }

    fn placed() -> Placement {
        Placement {
            bounds: Some(bounds(100.0, 50.0, 800.0, 600.0)),
            last_size: None,
            parent_shown: true,
            parent_on_active_space: true,
            background: false,
        }
    }

    #[test]
    fn bounds_flip_between_electron_and_appkit_coordinates() {
        let frame = to_appkit(&bounds(100.0, 50.0, 800.0, 600.0), 1000.0);
        assert_eq!(frame, Frame { x: 100.0, y: 350.0, width: 800.0, height: 600.0 });
        assert_eq!(from_appkit(&frame, 1000.0), bounds(100.0, 50.0, 800.0, 600.0));
        // Displays above or left of the primary have negative Electron coordinates.
        let above = to_appkit(&bounds(-1920.0, -1080.0, 300.0, 200.0), 1000.0);
        assert_eq!((above.x, above.y), (-1920.0, 1880.0));
    }

    #[test]
    fn invalid_bounds_are_rejected() {
        assert!(valid_bounds(&bounds(0.0, 0.0, 1.0, 1.0)));
        assert!(valid_bounds(&bounds(-5000.0, -5000.0, MAX_PANEL_EDGE, 10.0)));
        for invalid in [
            bounds(0.0, 0.0, 0.0, 10.0),
            bounds(0.0, 0.0, 10.0, 0.5),
            bounds(0.0, 0.0, MAX_PANEL_EDGE + 1.0, 10.0),
            bounds(f64::NAN, 0.0, 10.0, 10.0),
            bounds(0.0, f64::INFINITY, 10.0, 10.0),
            bounds(2_000_000.0, 0.0, 10.0, 10.0),
        ] {
            assert!(!valid_bounds(&invalid), "{invalid:?}");
        }
    }

    #[test]
    fn placed_views_with_a_visible_parent_are_shown() {
        assert_eq!(
            panel_mode(&placed(), 1000.0),
            PanelMode::Shown(Frame { x: 100.0, y: 350.0, width: 800.0, height: 600.0 })
        );
    }

    #[test]
    fn hidden_minimized_or_other_space_parents_and_unplaced_views_hide_the_panel() {
        for placement in [
            Placement { parent_shown: false, ..placed() },
            Placement { parent_on_active_space: false, ..placed() },
            Placement { bounds: None, ..placed() },
            Placement::default(),
        ] {
            assert_eq!(panel_mode(&placement, 1000.0), PanelMode::Hidden, "{placement:?}");
        }
    }

    #[test]
    fn background_control_renders_off_screen_at_the_last_size() {
        let hidden = Placement { parent_shown: false, background: true, ..placed() };
        let PanelMode::Background(frame) = panel_mode(&hidden, 1000.0) else {
            panic!("expected background mode");
        };
        assert_eq!((frame.width, frame.height), (800.0, 600.0));
        assert!(frame.x + frame.width < OFFSCREEN_ORIGIN + 1.0);
        assert!(frame.y + frame.height < OFFSCREEN_ORIGIN + 1.0);
        let unplaced = Placement {
            bounds: None,
            last_size: Some((640.0, 480.0)),
            background: true,
            ..placed()
        };
        let PanelMode::Background(frame) = panel_mode(&unplaced, 1000.0) else {
            panic!("expected background mode");
        };
        assert_eq!((frame.width, frame.height), (640.0, 480.0));
        // A visible placed view stays where main put it even while control runs.
        assert!(matches!(
            panel_mode(&Placement { background: true, ..placed() }, 1000.0),
            PanelMode::Shown(_)
        ));
    }
}
