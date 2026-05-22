use std::io::{Read as _, Write as _};
use std::net::TcpListener;
use tauri::{AppHandle, Emitter};

// Starts a one-shot TCP listener on port 8888 for the Spotify OAuth callback.
// Emits "spotify-callback" with { code, state } on success or { error } on failure.
#[tauri::command]
async fn start_oauth_server(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:8888").map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0u8; 4096];
            let n = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..n]).to_string();

            let code = extract_query_param(&request, "code");
            let state = extract_query_param(&request, "state");
            let error = extract_query_param(&request, "error");

            let html = if code.is_some() {
                "<html><body style='font-family:sans-serif;padding:40px'>\
                 <h2>Connected to Mood Music!</h2>\
                 <p>You can close this tab and return to the app.</p>\
                 </body></html>"
            } else {
                "<html><body style='font-family:sans-serif;padding:40px'>\
                 <h2>Authorization failed</h2>\
                 <p>Please close this tab and try again in the app.</p>\
                 </body></html>"
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(),
                html
            );
            let _ = stream.write_all(response.as_bytes());

            let payload = if let Some(c) = code {
                serde_json::json!({ "code": c, "state": state.unwrap_or_default() })
            } else {
                serde_json::json!({ "error": error.unwrap_or_else(|| "Access denied".into()) })
            };
            let _ = app.emit("spotify-callback", payload);
        }
    });
    Ok(())
}

fn extract_query_param(request: &str, param: &str) -> Option<String> {
    let first_line = request.lines().next()?;
    let query_start = first_line.find('?')?;
    let after_q = &first_line[query_start + 1..];
    let end = after_q.find(' ').unwrap_or(after_q.len());
    let query = &after_q[..end];
    let prefix = format!("{}=", param);
    for part in query.split('&') {
        if let Some(val) = part.strip_prefix(&prefix) {
            // Minimal percent-decode for base64url chars that survive encoding
            return Some(
                val.replace("%2B", "+")
                    .replace("%2F", "/")
                    .replace("%3D", "=")
                    .replace("%20", " "),
            );
        }
    }
    None
}

// Exchanges a Spotify authorization code for access + refresh tokens via PKCE.
#[tauri::command]
async fn exchange_spotify_code(
    code: String,
    verifier: String,
    client_id: String,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", "http://localhost:8888/callback"),
        ("client_id", client_id.as_str()),
        ("code_verifier", verifier.as_str()),
    ];
    let resp = client
        .post("https://accounts.spotify.com/api/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed: {}", text));
    }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

// Refreshes a Spotify access token.
#[tauri::command]
async fn refresh_spotify_token(
    refresh_token: String,
    client_id: String,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
        ("client_id", client_id.as_str()),
    ];
    let resp = client
        .post("https://accounts.spotify.com/api/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed: {}", text));
    }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

// Calls yt-dlp on the host system, searches YouTube for the mood query,
// and returns the best audio stream URL for the HTML5 audio element.
#[tauri::command]
async fn get_audio_url(query: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new("yt-dlp")
            .args([
                "--get-url",
                "-f", "bestaudio[ext=m4a]/bestaudio/best",
                "--no-playlist",
                "--quiet",
                &format!("ytsearch1:{}", query),
            ])
            .output()
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound =>
                    "yt-dlp is not installed. Run: brew install yt-dlp".to_string(),
                _ => format!("Failed to run yt-dlp: {}", e),
            })?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        // Take the first URL only — bestaudio can return multiple lines in some formats
        let url = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string();

        if url.is_empty() {
            return Err("No audio stream found for this mood.".to_string());
        }

        Ok(url)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_audio_url,
            start_oauth_server,
            exchange_spotify_code,
            refresh_spotify_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
