use base64::{engine::general_purpose, Engine as _};
use futures_util::StreamExt;
use std::collections::HashMap;
use std::io::{Read as _, Write as _};
use std::net::TcpListener;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

// ── OAuth ──────────────────────────────────────────────────────────────────────

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
                html.len(), html
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

// ── Spotify token exchange / refresh ──────────────────────────────────────────

#[tauri::command]
async fn exchange_spotify_code(code: String, verifier: String, client_id: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", "http://localhost:8888/callback"),
        ("client_id", client_id.as_str()),
        ("code_verifier", verifier.as_str()),
    ];
    let resp = client.post("https://accounts.spotify.com/api/token").form(&params).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Token exchange failed: {}", resp.text().await.unwrap_or_default()));
    }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn refresh_spotify_token(refresh_token: String, client_id: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
        ("client_id", client_id.as_str()),
    ];
    let resp = client.post("https://accounts.spotify.com/api/token").form(&params).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Token refresh failed: {}", resp.text().await.unwrap_or_default()));
    }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

// ── Background image ───────────────────────────────────────────────────────────

#[tauri::command]
async fn fetch_image_base64(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }

    let ct = resp.headers().get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(format!("data:{};base64,{}", ct, general_purpose::STANDARD.encode(&bytes)))
}

// ── Audio streaming ────────────────────────────────────────────────────────────
//
// Flow:
//   1. If an API key is provided, use YouTube Data API search (~300 ms) to get
//      a video ID, then pass the direct watch URL to yt-dlp -g.
//      Without a key, yt-dlp handles the search itself (~6-8 s slower).
//   2. yt-dlp -g extracts the signed CDN URL without downloading (~2-4 s).
//   3. Results are cached in memory for 2 h so repeat moods are instant.
//   4. A tiny Tokio TCP proxy streams bytes from the CDN on demand; the
//      <audio> element hits http://127.0.0.1:<port> and starts buffering
//      immediately.

const CACHE_TTL: Duration = Duration::from_secs(2 * 60 * 60);

static URL_CACHE: std::sync::OnceLock<Arc<Mutex<HashMap<String, (String, Instant)>>>> =
    std::sync::OnceLock::new();

fn url_cache() -> &'static Arc<Mutex<HashMap<String, (String, Instant)>>> {
    URL_CACHE.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

static PROXY_ABORT: std::sync::OnceLock<Arc<Mutex<Option<tokio::task::AbortHandle>>>> =
    std::sync::OnceLock::new();

fn proxy_store() -> &'static Arc<Mutex<Option<tokio::task::AbortHandle>>> {
    PROXY_ABORT.get_or_init(|| Arc::new(Mutex::new(None)))
}

#[tauri::command]
async fn prepare_audio_stream(app: AppHandle, query: String, _api_key: String) -> Result<String, String> {
    // Cache hit → skip yt-dlp entirely
    {
        let cache = url_cache().lock().await;
        if let Some((cdn_url, cached_at)) = cache.get(&query) {
            if cached_at.elapsed() < CACHE_TTL {
                let cdn_url = cdn_url.clone();
                drop(cache);
                return start_proxy_for(cdn_url).await;
            }
        }
    }

    let search_query = format!("{} ambience focus music", query);
    let yt_url = format!("ytsearch1:{}", search_query);

    // Extract CDN stream URL without downloading
    let cdn_url = extract_stream_url(&app, &yt_url).await?;

    // Store in cache
    {
        let mut cache = url_cache().lock().await;
        cache.insert(query, (cdn_url.clone(), Instant::now()));
    }

    start_proxy_for(cdn_url).await
}


async fn extract_stream_url(app: &AppHandle, yt_url: &str) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args([
            "-g",
            "-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
            "--no-playlist",
            "--match-filter", "duration > 120",
            "--quiet",
            yt_url,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() { "No audio found for this mood.".into() } else { err });
    }

    let cdn_url = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string();

    if cdn_url.is_empty() {
        return Err("Could not extract stream URL.".into());
    }

    Ok(cdn_url)
}

async fn start_proxy_for(cdn_url: String) -> Result<String, String> {
    {
        let mut guard = proxy_store().lock().await;
        if let Some(h) = guard.take() { h.abort(); }
    }

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let task = tokio::spawn(async move {
        loop {
            let Ok((socket, _)) = listener.accept().await else { return };
            let url = cdn_url.clone();
            tokio::spawn(proxy_request(socket, url));
        }
    });

    {
        let mut guard = proxy_store().lock().await;
        *guard = Some(task.abort_handle());
    }

    Ok(format!("http://127.0.0.1:{}", port))
}

async fn proxy_request(mut socket: tokio::net::TcpStream, cdn_url: String) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buf = [0u8; 8192];
    let n = match socket.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };
    let request_str = String::from_utf8_lossy(&buf[..n]);

    let range_val = request_str.lines().find_map(|line| {
        let lower = line.to_lowercase();
        lower.starts_with("range:").then(|| line["range:".len()..].trim().to_string())
    });

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .build()
        .unwrap_or_default();

    let mut req = client.get(&cdn_url);
    if let Some(r) = range_val { req = req.header("Range", r); }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(_) => return,
    };

    let status = resp.status().as_u16();
    let status_text = if status == 206 { "Partial Content" } else { "OK" };

    let content_type = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("audio/webm").to_string();
    let content_length = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).map(str::to_string);
    let content_range = resp.headers().get("content-range").and_then(|v| v.to_str().ok()).map(str::to_string);

    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\n",
        status, status_text, content_type
    );
    if let Some(cl) = content_length { head.push_str(&format!("Content-Length: {}\r\n", cl)); }
    if let Some(cr) = content_range { head.push_str(&format!("Content-Range: {}\r\n", cr)); }
    head.push_str("\r\n");

    if socket.write_all(head.as_bytes()).await.is_err() { return; }

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) if socket.write_all(&bytes).await.is_ok() => {}
            _ => break,
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            prepare_audio_stream,
            fetch_image_base64,
            start_oauth_server,
            exchange_spotify_code,
            refresh_spotify_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
