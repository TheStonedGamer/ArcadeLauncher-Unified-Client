//! ArcadeLauncher bootstrap updater. Installed alongside the launcher and made
//! the entry point by the installer, it runs FIRST: shows a tiny frameless
//! "Checking for updates… / Updating…" window, applies any signed update via
//! the same release manifest the app publishes, then launches the app and exits
//! — Steam-style. All update work is best-effort; failures fall through to
//! launching the app so updates never block startup.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use eframe::egui;

mod instance;
mod update;

/// Shared status the worker thread writes and the UI polls each frame.
pub struct Status {
    pub message: String,
    pub done: bool,
}

fn main() -> eframe::Result<()> {
    let status = Arc::new(Mutex::new(Status {
        message: "Checking for updates…".to_string(),
        done: false,
    }));

    // Do all network/install work off the UI thread; mark done when finished so
    // the window can close and the app can take over.
    let worker = status.clone();
    thread::spawn(move || {
        update::run(&worker);
        worker.lock().unwrap().done = true;
    });

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([420.0, 160.0])
            .with_resizable(false)
            .with_decorations(false)
            .with_always_on_top()
            .with_taskbar(false),
        centered: true,
        ..Default::default()
    };

    eframe::run_native(
        "ArcadeLauncher Updater",
        options,
        Box::new(|_cc| Ok(Box::new(UpdaterApp { status }))),
    )
}

struct UpdaterApp {
    status: Arc<Mutex<Status>>,
}

impl eframe::App for UpdaterApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let (message, done) = {
            let s = self.status.lock().unwrap();
            (s.message.clone(), s.done)
        };

        egui::CentralPanel::default().show(ctx, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(28.0);
                ui.heading("ArcadeLauncher");
                ui.add_space(18.0);
                ui.add(egui::Spinner::new().size(28.0));
                ui.add_space(14.0);
                ui.label(message);
            });
        });

        if done {
            // The app has been launched by the worker; close the bootstrapper.
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        } else {
            // Keep polling the worker's status while work is in flight.
            ctx.request_repaint_after(Duration::from_millis(120));
        }
    }
}
