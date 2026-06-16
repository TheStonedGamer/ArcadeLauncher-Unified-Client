//! Pure window-lifecycle decisions. OS/IO-free so the close/startup policy is
//! unit-tested independently of the tray + window glue that acts on it.

/// What to do when the user clicks the window's close button.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Hide to the tray and keep running (close-to-tray enabled).
    HideToTray,
    /// Actually quit the app.
    Quit,
}

/// Decide the close behaviour from the `close_to_tray` setting.
pub fn close_action(close_to_tray: bool) -> CloseAction {
    if close_to_tray {
        CloseAction::HideToTray
    } else {
        CloseAction::Quit
    }
}

/// Whether the main window should start hidden (launch-minimized to tray).
pub fn start_hidden(launch_minimized: bool) -> bool {
    launch_minimized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_to_tray_hides_else_quits() {
        assert_eq!(close_action(true), CloseAction::HideToTray);
        assert_eq!(close_action(false), CloseAction::Quit);
    }

    #[test]
    fn start_hidden_follows_setting() {
        assert!(start_hidden(true));
        assert!(!start_hidden(false));
    }
}
