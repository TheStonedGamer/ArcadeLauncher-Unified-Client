//! Pure request-shaping + response-parsing for the in-client Game Requests board
//! (T12h). The board is the standalone `ArcadeLauncher-Requests` service (axum,
//! own port `8723`, deployed behind nginx at `<host>/requests`). It shares the
//! launcher accounts/DB but authenticates with its **own** browser session
//! cookie (`arq_session`) obtained from a form `POST /login`, so the client logs
//! in to it separately from the main-server session token.
//!
//! Everything here is pure: a `base` URL in, URLs / typed structs out. The HTTP +
//! cookie handling lives in `commands.rs`. The `base` carries the deployment
//! prefix (e.g. `https://arcade.example/requests`) so the nginx mount point is a
//! configuration concern, never baked into the path builders.

use serde::{Deserialize, Serialize};

/// Percent-encode a query-parameter value so spaces/specials can't break the URL.
/// (Same allow-list the RetroAchievements core uses.)
pub fn encode_param(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Endpoint builder rooted at the service's public base URL. `base` may include a
/// path prefix (the nginx mount) and any number of trailing slashes — they're
/// normalised away so the joined paths are always well-formed.
#[derive(Debug, Clone)]
pub struct Endpoint {
    base: String,
}

impl Endpoint {
    /// Build from a public base URL, e.g. `https://arcade.example/requests`.
    pub fn new(base: &str) -> Self {
        Endpoint { base: base.trim_end_matches('/').to_string() }
    }

    fn join(&self, path: &str) -> String {
        format!("{}/{}", self.base, path.trim_start_matches('/'))
    }

    /// `POST /login` (form-encoded username/password/totp_code).
    pub fn login_url(&self) -> String {
        self.join("login")
    }

    /// `POST /logout`.
    pub fn logout_url(&self) -> String {
        self.join("logout")
    }

    /// `GET /api/me` — current session info.
    pub fn me_url(&self) -> String {
        self.join("api/me")
    }

    /// `GET /api/search?q=&platform=` — IGDB search for a release to request.
    /// A blank `platform` omits the filter (the service treats it as "any").
    pub fn search_url(&self, query: &str, platform: &str) -> String {
        let base = format!("{}?q={}", self.join("api/search"), encode_param(query));
        if platform.trim().is_empty() {
            base
        } else {
            format!("{base}&platform={}", encode_param(platform.trim()))
        }
    }

    /// `GET`/`POST /api/requests` — list the board / create a request.
    pub fn requests_url(&self) -> String {
        self.join("api/requests")
    }

    /// `POST /api/requests/:id/vote` — upvote.
    pub fn vote_url(&self, id: u64) -> String {
        self.join(&format!("api/requests/{id}/vote"))
    }

    /// `POST /api/requests/:id/rating` — community 1–5 star game rating.
    pub fn rating_url(&self, id: u64) -> String {
        self.join(&format!("api/requests/{id}/rating"))
    }

    /// `POST /api/requests/:id/status` — admin status change.
    pub fn status_url(&self, id: u64) -> String {
        self.join(&format!("api/requests/{id}/status"))
    }
}

/// One row on the request board. Mirrors the service's `GET /api/requests` item
/// (already camelCase on the wire), re-serialised verbatim to the webview.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRequest {
    pub id: u64,
    #[serde(default)]
    pub igdb_id: u64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub cover_url: String,
    #[serde(default)]
    pub release_date: i64,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub requested_by: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub votes: i64,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub voted_by_me: bool,
    /// Average community game rating (0.0 when nobody has rated yet).
    #[serde(default)]
    pub rating_avg: f64,
    /// Number of ratings contributing to `rating_avg`.
    #[serde(default)]
    pub rating_count: i64,
    /// The caller's own rating (0 = not rated).
    #[serde(default)]
    pub my_rating: i64,
}

/// The full `GET /api/requests` body: the board plus whether the caller is an
/// admin (admins get the triage status control).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    #[serde(default)]
    pub requests: Vec<GameRequest>,
    #[serde(default)]
    pub is_admin: bool,
}

/// One IGDB search hit. The service serialises these snake_case (`igdb_id`,
/// `cover_url`, `release_date`); we read that shape and re-emit camelCase.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub igdb_id: u64,
    pub name: String,
    pub summary: String,
    pub platforms: String,
    pub cover_url: String,
    pub release_date: i64,
}

#[derive(Deserialize)]
struct RawHit {
    #[serde(default)]
    igdb_id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    platforms: String,
    #[serde(default)]
    cover_url: String,
    #[serde(default)]
    release_date: i64,
}

#[derive(Deserialize)]
struct RawSearch {
    #[serde(default)]
    results: Vec<RawHit>,
}

/// Current session info from `GET /api/me`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    #[serde(default)]
    pub signed_in: bool,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub is_admin: bool,
}

/// Outbound body for `POST /api/requests`. Field names match the service's
/// `CreateRequest` (snake_case); `igdb_id == 0` means a free-text request that
/// can't be deduped to an existing board row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CreateBody {
    pub igdb_id: u64,
    pub title: String,
    pub platform: String,
    pub cover_url: String,
    pub release_date: i64,
    pub summary: String,
    pub note: String,
}

impl CreateBody {
    /// Build a create body from a chosen search hit plus the user's note.
    pub fn from_hit(hit: &SearchHit, note: &str) -> Self {
        CreateBody {
            igdb_id: hit.igdb_id,
            title: hit.name.clone(),
            platform: hit.platforms.clone(),
            cover_url: hit.cover_url.clone(),
            release_date: hit.release_date,
            summary: hit.summary.clone(),
            note: note.trim().chars().take(500).collect(),
        }
    }
}

/// The four board statuses, in the service's display/sort order.
pub const STATUSES: [&str; 4] = ["pending", "approved", "fulfilled", "declined"];

/// True if `status` is one the service accepts (guards the admin status control
/// before we POST it).
pub fn is_valid_status(status: &str) -> bool {
    STATUSES.contains(&status)
}

/// Parse the `GET /api/requests` board response.
pub fn parse_board(body: &str) -> Result<Board, serde_json::Error> {
    serde_json::from_str(body)
}

/// Parse the `GET /api/search` response into camelCase hits.
pub fn parse_search(body: &str) -> Result<Vec<SearchHit>, serde_json::Error> {
    let raw: RawSearch = serde_json::from_str(body)?;
    Ok(raw
        .results
        .into_iter()
        .map(|r| SearchHit {
            igdb_id: r.igdb_id,
            name: r.name,
            summary: r.summary,
            platforms: r.platforms,
            cover_url: r.cover_url,
            release_date: r.release_date,
        })
        .collect())
}

/// Parse `GET /api/me`.
pub fn parse_me(body: &str) -> Result<Me, serde_json::Error> {
    serde_json::from_str(body)
}

/// The `POST /api/requests/:id/rating` response: the caller's stored rating plus
/// the freshly-recomputed average/count for the row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateResult {
    #[serde(default)]
    pub id: u64,
    #[serde(default)]
    pub my_rating: i64,
    #[serde(default)]
    pub rating_avg: f64,
    #[serde(default)]
    pub rating_count: i64,
}

/// Parse the rating-upsert response.
pub fn parse_rate(body: &str) -> Result<RateResult, serde_json::Error> {
    serde_json::from_str(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep() -> Endpoint {
        // Trailing slash + path prefix exercise the normalisation.
        Endpoint::new("https://arcade.example/requests/")
    }

    #[test]
    fn builds_urls_under_the_deployment_prefix() {
        let e = ep();
        assert_eq!(e.login_url(), "https://arcade.example/requests/login");
        assert_eq!(e.me_url(), "https://arcade.example/requests/api/me");
        assert_eq!(e.requests_url(), "https://arcade.example/requests/api/requests");
        assert_eq!(e.vote_url(7), "https://arcade.example/requests/api/requests/7/vote");
        assert_eq!(e.rating_url(7), "https://arcade.example/requests/api/requests/7/rating");
        assert_eq!(e.status_url(7), "https://arcade.example/requests/api/requests/7/status");
    }

    #[test]
    fn search_url_encodes_query_and_optional_platform() {
        assert_eq!(
            ep().search_url("Final Fantasy VII", ""),
            "https://arcade.example/requests/api/search?q=Final%20Fantasy%20VII"
        );
        assert_eq!(
            ep().search_url("Gran Turismo", "PS2"),
            "https://arcade.example/requests/api/search?q=Gran%20Turismo&platform=PS2"
        );
        // Whitespace-only platform is treated as no filter.
        assert_eq!(
            ep().search_url("Halo", "  "),
            "https://arcade.example/requests/api/search?q=Halo"
        );
    }

    #[test]
    fn base_without_prefix_still_joins_cleanly() {
        let e = Endpoint::new("https://host");
        assert_eq!(e.me_url(), "https://host/api/me");
        assert_eq!(e.requests_url(), "https://host/api/requests");
    }

    #[test]
    fn parses_board_with_admin_flag() {
        let body = r#"{
            "requests": [
                {"id":3,"igdbId":1010,"title":"DOOM","platform":"PC","coverUrl":"u",
                 "releaseDate":760579200,"summary":"rip and tear","requestedBy":"bob",
                 "note":"please","status":"pending","votes":5,"createdAt":1,"votedByMe":true}
            ],
            "isAdmin": true
        }"#;
        let board = parse_board(body).unwrap();
        assert!(board.is_admin);
        assert_eq!(board.requests.len(), 1);
        let r = &board.requests[0];
        assert_eq!(r.id, 3);
        assert_eq!(r.title, "DOOM");
        assert_eq!(r.votes, 5);
        assert!(r.voted_by_me);
    }

    #[test]
    fn parses_rating_fields_with_defaults() {
        // Row carrying ratings.
        let rated = parse_board(
            r#"{"requests":[{"id":1,"ratingAvg":4.5,"ratingCount":8,"myRating":5}]}"#,
        )
        .unwrap();
        assert_eq!(rated.requests[0].rating_avg, 4.5);
        assert_eq!(rated.requests[0].rating_count, 8);
        assert_eq!(rated.requests[0].my_rating, 5);
        // Unrated row (fields absent) defaults to zeros.
        let bare = parse_board(r#"{"requests":[{"id":2}]}"#).unwrap();
        assert_eq!(bare.requests[0].rating_avg, 0.0);
        assert_eq!(bare.requests[0].rating_count, 0);
        assert_eq!(bare.requests[0].my_rating, 0);
    }

    #[test]
    fn parses_rate_result() {
        let r = parse_rate(r#"{"ok":true,"id":3,"myRating":4,"ratingAvg":3.75,"ratingCount":12}"#).unwrap();
        assert_eq!(r.id, 3);
        assert_eq!(r.my_rating, 4);
        assert_eq!(r.rating_avg, 3.75);
        assert_eq!(r.rating_count, 12);
    }

    #[test]
    fn board_tolerates_missing_optional_fields() {
        let board = parse_board(r#"{"requests":[{"id":1}]}"#).unwrap();
        assert!(!board.is_admin);
        assert_eq!(board.requests[0].id, 1);
        assert_eq!(board.requests[0].votes, 0);
        assert!(!board.requests[0].voted_by_me);
    }

    #[test]
    fn parses_snake_case_search_hits_to_camel_struct() {
        let body = r#"{"results":[
            {"igdb_id":42,"name":"Celeste","summary":"climb","platforms":"PC, Switch",
             "cover_url":"c.jpg","release_date":1517356800}
        ]}"#;
        let hits = parse_search(body).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].igdb_id, 42);
        assert_eq!(hits[0].name, "Celeste");
        assert_eq!(hits[0].platforms, "PC, Switch");
    }

    #[test]
    fn empty_search_results_ok() {
        assert!(parse_search(r#"{"results":[]}"#).unwrap().is_empty());
        // Missing `results` defaults to empty rather than erroring.
        assert!(parse_search(r#"{}"#).unwrap().is_empty());
    }

    #[test]
    fn parses_me_states() {
        let signed = parse_me(r#"{"signedIn":true,"username":"bob","isAdmin":false}"#).unwrap();
        assert!(signed.signed_in);
        assert_eq!(signed.username, "bob");
        assert!(!signed.is_admin);
        let out = parse_me(r#"{"signedIn":false}"#).unwrap();
        assert!(!out.signed_in);
        assert_eq!(out.username, "");
    }

    #[test]
    fn create_body_from_hit_trims_and_caps_note() {
        let hit = SearchHit {
            igdb_id: 9,
            name: "Hades".into(),
            summary: "rogue-like".into(),
            platforms: "PC".into(),
            cover_url: "h.jpg".into(),
            release_date: 1600000000,
        };
        let body = CreateBody::from_hit(&hit, "  want it  ");
        assert_eq!(body.igdb_id, 9);
        assert_eq!(body.title, "Hades");
        assert_eq!(body.note, "want it");

        let long = "x".repeat(600);
        let capped = CreateBody::from_hit(&hit, &long);
        assert_eq!(capped.note.chars().count(), 500);
    }

    #[test]
    fn status_validation() {
        assert!(is_valid_status("pending"));
        assert!(is_valid_status("fulfilled"));
        assert!(!is_valid_status("bogus"));
        assert_eq!(STATUSES.len(), 4);
    }
}
