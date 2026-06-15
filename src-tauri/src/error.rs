//! Crate-wide error type. Implements `serde::Serialize` so `#[tauri::command]`
//! functions can return `Result<T, AppError>` and the message surfaces to JS as
//! a rejected promise.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid library.json: {0}")]
    Parse(#[from] serde_json::Error),

    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

// Commands return errors to the webview as plain strings.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
