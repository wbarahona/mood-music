use base64::{engine::general_purpose, Engine as _};
use std::io::{Read as _, Write as _};
use std::net::TcpListener;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

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

// Downloads audio via the bundled yt-dlp sidecar to a temp file and returns the local path.
// The WebView plays the local file via Tauri's asset protocol, which avoids the CORS /
// header-mismatch issues that arise when pointing an <audio> element at a signed CDN URL.
#[tauri::command]
async fn get_audio_url(app: AppHandle, query: String) -> Result<String, String> {
    // Clean up any leftover files from a previous search
    if let Ok(entries) = std::fs::read_dir("/private/tmp") {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with("mood-music-") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    // Use /private/tmp (the real path on macOS; /tmp is a symlink) so yt-dlp's
    // Python runtime and our Rust file check agree on the same path.
    let output_template = format!("/private/tmp/mood-music-{}.%(ext)s", ts);

    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args([
            // Prefer webm/opus (not DASH, no ffmpeg needed) then fall back to m4a.
            // --no-part writes directly to the final file, bypassing the .part rename
            // that fails on macOS when yt-dlp resolves /tmp vs /private/tmp differently.
            "-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
            "--no-playlist",
            "--no-part",
            "--quiet",
            "-o", &output_template,
            &format!("ytsearch1:{}", query),
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "No audio found for this mood.".into()
        } else {
            err
        });
    }

    // Find the file yt-dlp wrote (%(ext)s is replaced with the actual extension)
    let base = format!("/private/tmp/mood-music-{}", ts);
    for ext in ["webm", "m4a", "ogg", "opus", "mp4", "mkv"] {
        let path = format!("{}.{}", base, ext);
        if std::path::Path::new(&path).exists() {
            return Ok(path);
        }
    }

    Err("Downloaded file not found — please try again.".to_string())
}

// Fetches an external image URL from Rust (no browser Origin header) and returns
// it as a data URL so the WebView can render it without CORS restrictions.
#[tauri::command]
async fn fetch_image_base64(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }

    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let b64 = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", ct, b64))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_audio_url,
            fetch_image_base64,
            start_oauth_server,
            exchange_spotify_code,
            refresh_spotify_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
