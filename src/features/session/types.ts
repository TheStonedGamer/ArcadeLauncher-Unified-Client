// Mirror of the Rust `Session` struct (serde camelCase). Keep in sync with
// src-tauri/src/session/commands.rs.

export interface Session {
  host: string;
  username: string;
  token: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
}
