//! Pure helpers for DM attachments (ROADMAP T9c). Deterministic and IO-free so
//! they're exhaustively unit-testable; the network glue (presign → PUT bytes →
//! presigned GET) lives in `commands.rs`. The server caps an attachment at
//! 25 MiB (`ATTACHMENT_MAX_BYTES`), so we reject early client-side to avoid a
//! wasted upload round-trip.

/// Largest attachment the server will presign (mirrors `ATTACHMENT_MAX_BYTES`
/// in the server's `social_api.rs`: 25 MiB).
pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

/// The final path component of a user-picked file path, handling both `/` and
/// `\` separators (a Windows path may arrive on a Linux build and vice-versa).
/// Returns an empty string if the path ends in a separator.
pub fn basename(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or("").to_string()
}

/// Best-effort MIME type from a filename's extension, for the presign request's
/// `contentType` (and the `Content-Type` header on the PUT). Unknown/extension-
/// less files fall back to `application/octet-stream`, which the server accepts.
pub fn guess_content_type(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "log" => "text/plain",
        "json" => "application/json",
        "zip" => "application/zip",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

/// Whether `size` (bytes) is an acceptable, non-empty attachment. An empty file
/// is rejected because the server's presign requires `size > 0`.
pub fn is_acceptable_size(size: u64) -> bool {
    size > 0 && size <= MAX_ATTACHMENT_BYTES
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basename_strips_both_separators() {
        assert_eq!(basename("/home/me/shot.png"), "shot.png");
        assert_eq!(basename(r"C:\Users\me\My Pics\shot.png"), "shot.png");
        assert_eq!(basename("plain.txt"), "plain.txt");
        assert_eq!(basename("/trailing/"), "");
    }

    #[test]
    fn content_type_known_and_unknown() {
        assert_eq!(guess_content_type("a.PNG"), "image/png");
        assert_eq!(guess_content_type("photo.jpeg"), "image/jpeg");
        assert_eq!(guess_content_type("clip.mp4"), "video/mp4");
        assert_eq!(guess_content_type("save.dat"), "application/octet-stream");
        assert_eq!(guess_content_type("noext"), "application/octet-stream");
    }

    #[test]
    fn size_bounds() {
        assert!(!is_acceptable_size(0));
        assert!(is_acceptable_size(1));
        assert!(is_acceptable_size(MAX_ATTACHMENT_BYTES));
        assert!(!is_acceptable_size(MAX_ATTACHMENT_BYTES + 1));
    }
}
