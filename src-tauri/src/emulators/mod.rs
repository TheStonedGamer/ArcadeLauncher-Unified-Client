//! Emulator runtime staging. The server hosts emulator runtimes under
//! `/emulators/<id>/<rel>` and enumerates them at `/api/emulators`. The client
//! mirrors them into `app_data_dir/emulators/<id>` and reports which are fully
//! present ("ready") so Settings can show readiness and offer a download.

pub mod commands;
pub mod unpack;
