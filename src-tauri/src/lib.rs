use base64::{engine::general_purpose, Engine as _};
use futures_util::StreamExt;
use std::collections::HashMap;
use std::io::{Read as _, Write as _};
use std::net::TcpListener;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
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
    log::info!("[spotify] exchanging auth code for tokens (client_id: {}…)", &client_id[..8.min(client_id.len())]);
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", "http://localhost:8888/callback"),
        ("client_id", client_id.as_str()),
        ("code_verifier", verifier.as_str()),
    ];
    let resp = client.post("https://accounts.spotify.com/api/token").form(&params).send().await.map_err(|e| {
        log::error!("[spotify] token exchange request failed: {}", e);
        e.to_string()
    })?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        log::error!("[spotify] token exchange HTTP {}: {}", status.as_u16(), body);
        return Err(format!("Token exchange failed: {}", body));
    }
    log::info!("[spotify] token exchange OK (HTTP {})", status.as_u16());
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn refresh_spotify_token(refresh_token: String, client_id: String) -> Result<serde_json::Value, String> {
    log::info!("[spotify] refreshing access token (client_id: {}…)", &client_id[..8.min(client_id.len())]);
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
        ("client_id", client_id.as_str()),
    ];
    let resp = client.post("https://accounts.spotify.com/api/token").form(&params).send().await.map_err(|e| {
        log::error!("[spotify] token refresh request failed: {}", e);
        e.to_string()
    })?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        log::error!("[spotify] token refresh HTTP {}: {}", status.as_u16(), body);
        return Err(format!("Token refresh failed: {}", body));
    }
    log::info!("[spotify] token refresh OK (HTTP {})", status.as_u16());
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

// ── Local image generation (Core ML via sd-swift sidecar) ─────────────────────

const MODEL_URL: &str = "https://github.com/wbarahona/mood-music/releases/download/models-v1/dreamshaper-coreml.zip";
const MODEL_DIR_NAME: &str = "dreamshaper-coreml";
const DOWNLOAD_SENTINEL: &str = "TextEncoder.mlpackage"; // presence = zip extracted
const MODEL_SENTINEL: &str = "TextEncoder.mlmodelc";     // presence = compiled and ready

fn get_model_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("models")
        .join(MODEL_DIR_NAME)
}

#[tauri::command]
async fn check_model(app: AppHandle) -> bool {
    let dir = get_model_dir(&app);
    let exists = dir.join(MODEL_SENTINEL).exists();
    log::info!("[check_model] {} — compiled: {}", dir.display(), exists);
    exists
}

#[tauri::command]
async fn is_model_downloaded(app: AppHandle) -> bool {
    let dir = get_model_dir(&app);
    let exists = dir.join(DOWNLOAD_SENTINEL).exists();
    log::info!("[is_model_downloaded] {} — downloaded: {}", dir.display(), exists);
    exists
}

#[tauri::command]
async fn compile_models(app: AppHandle) -> Result<(), String> {
    let model_dir = get_model_dir(&app);
    log::info!("[compile_models] starting sd-swift --compile-only at {}", model_dir.display());

    let (mut rx, _child) = app
        .shell()
        .sidecar("sd-swift")
        .map_err(|e| e.to_string())?
        .args(["--model-dir", model_dir.to_str().unwrap_or(""), "--compile-only"])
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut exit_code: Option<i32> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                let line = String::from_utf8_lossy(&b);
                let t = line.trim().to_string();
                if !t.is_empty() {
                    log::info!("[compile_models] {}", t);
                    let _ = app.emit("model-compile-progress", serde_json::json!({ "message": t }));
                }
            }
            CommandEvent::Terminated(p) => {
                exit_code = p.code;
                log::info!("[compile_models] sd-swift exited {:?}", exit_code);
                break;
            }
            _ => {}
        }
    }

    if exit_code != Some(0) {
        return Err(format!("Compilation failed (exit {:?})", exit_code));
    }
    Ok(())
}

#[tauri::command]
async fn download_model(app: AppHandle) -> Result<(), String> {
    let models_root = app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("models");

    std::fs::create_dir_all(&models_root).map_err(|e| e.to_string())?;

    let tmp_zip = models_root.join("coreml.zip.tmp");
    log::info!("[download_model] url: {}", MODEL_URL);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(7200))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(MODEL_URL).send().await.map_err(|e| {
        log::error!("[download_model] request error: {}", e);
        e.to_string()
    })?;

    let status = resp.status();
    log::info!("[download_model] HTTP {}", status.as_u16());
    if !status.is_success() {
        return Err(format!("Download failed: HTTP {}", status.as_u16()));
    }

    let total = resp.content_length().unwrap_or(0);
    log::info!("[download_model] size: {} bytes", total);

    let mut file = tokio::fs::File::create(&tmp_zip).await.map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut last_pct = 0u32;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = (downloaded as f64 / total as f64 * 100.0) as u32;
            if pct / 5 > last_pct / 5 {
                log::info!("[download_model] {}% ({}/{} bytes)", pct, downloaded, total);
                last_pct = pct;
            }
            let _ = app.emit("model-download-progress", serde_json::json!({
                "percent": pct,
                "downloaded": downloaded,
                "total": total,
            }));
        }
    }
    drop(file);

    log::info!("[download_model] download done, extracting zip…");
    let _ = app.emit("model-download-progress", serde_json::json!({
        "percent": 100u32, "downloaded": downloaded, "total": total,
        "status": "extracting"
    }));

    let models_root_clone = models_root.clone();
    let tmp_zip_clone = tmp_zip.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::open(&tmp_zip_clone).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file))
            .map_err(|e| e.to_string())?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let outpath = match entry.enclosed_name() {
                Some(p) => models_root_clone.join(p),
                None => continue,
            };
            if entry.is_dir() {
                std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = outpath.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut out = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            }
        }
        let _ = std::fs::remove_file(&tmp_zip_clone);
        Ok(())
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))?;

    log::info!("[download_model] extraction complete");

    // Remove any pre-compiled .mlmodelc bundles that came from the zip.
    // They are compiled for the machine that built the release and will fail
    // on any other Apple Silicon generation (M1 vs M2 vs M3 ANE are incompatible).
    // Deleting them here forces sd-swift to recompile locally on first run.
    let model_dir = models_root.join(MODEL_DIR_NAME);
    for name in ["TextEncoder", "UnetChunk1", "UnetChunk2", "VAEDecoder"] {
        let compiled = model_dir.join(format!("{}.mlmodelc", name));
        if compiled.exists() {
            log::info!("[download_model] removing cross-compiled {}.mlmodelc", name);
            let _ = std::fs::remove_dir_all(&compiled);
        }
    }

    Ok(())
}

// Global child process slot — lets a second generate_image_local call cancel the first.
static CURRENT_GEN: std::sync::OnceLock<Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>> =
    std::sync::OnceLock::new();

fn gen_guard() -> &'static Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>> {
    CURRENT_GEN.get_or_init(|| Arc::new(Mutex::new(None)))
}

#[tauri::command]
async fn generate_image_local(
    app: AppHandle,
    prompt: String,
    steps: Option<u32>,
    cfg_scale: Option<f32>,
    scheduler: Option<String>,
) -> Result<String, String> {
    let model_dir = get_model_dir(&app);
    if !model_dir.join(MODEL_SENTINEL).exists() {
        return Err("model_not_found".into());
    }

    let steps_str = steps.unwrap_or(15).to_string();
    let cfg_str = format!("{:.1}", cfg_scale.unwrap_or(7.5));
    let scheduler_str = scheduler.unwrap_or_else(|| "dpm".into());

    // Kill any in-flight generation (React StrictMode can fire this twice).
    {
        let mut guard = gen_guard().lock().await;
        if let Some(prev) = guard.take() {
            eprintln!("[generate_image] cancelling previous generation");
            let _ = prev.kill();
        }
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let output_path = std::env::temp_dir().join(format!("mood-music-{}.png", ts));
    let full_prompt = format!("{} cinematic atmospheric mood", prompt);

    eprintln!("[generate_image] prompt: {:?}", full_prompt);
    eprintln!("[generate_image] model:  {}", model_dir.display());
    eprintln!("[generate_image] output: {}", output_path.display());

    let (mut rx, child) = app
        .shell()
        .sidecar("sd-swift")
        .map_err(|e| { eprintln!("[generate_image] sidecar error: {}", e); e.to_string() })?
        .args([
            "--model-dir",       model_dir.to_str().unwrap_or(""),
            "--prompt",          &full_prompt,
            "--negative-prompt", "blurry, low quality, text, watermark, logo, nsfw",
            "--output",          output_path.to_str().unwrap_or(""),
            "--steps",           &steps_str,
            "--seed",            "-1",
            "--cfg-scale",       &cfg_str,
            "--scheduler",       &scheduler_str,
        ])
        .spawn()
        .map_err(|e| { eprintln!("[generate_image] spawn failed: {}", e); e.to_string() })?;

    // Register child so the next call can cancel us.
    { *gen_guard().lock().await = Some(child); }

    let mut exit_code: Option<i32> = None;
    let mut stderr_lines: Vec<String> = Vec::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                let line = String::from_utf8_lossy(&b);
                let t = line.trim();
                if !t.is_empty() { eprintln!("[sd-swift] {}", t); }
                if !t.is_empty() { stderr_lines.push(t.to_string()); }
            }
            CommandEvent::Terminated(p) => {
                exit_code = p.code;
                eprintln!("[generate_image] sd-swift exited {:?}", exit_code);
                break;
            }
            _ => {}
        }
    }

    // If guard is empty, a newer call cancelled us — bail silently.
    {
        let mut guard = gen_guard().lock().await;
        if guard.is_none() {
            return Err("cancelled".into());
        }
        *guard = None;
    }

    if exit_code != Some(0) {
        let last = stderr_lines.last().cloned().unwrap_or_default();
        return Err(if last.is_empty() {
            format!("sd-swift exited {:?}", exit_code)
        } else {
            last
        });
    }

    if !output_path.exists() {
        return Err("sd-swift produced no output file".into());
    }

    let bytes = std::fs::read(&output_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&output_path);
    eprintln!("[generate_image] done — {} bytes", bytes.len());
    Ok(format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(&bytes)))
}

// ── Background image (legacy fetch fallback) ───────────────────────────────────

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
    log::info!("[youtube] prepare_audio_stream: {:?}", query);

    // Cache hit → skip yt-dlp entirely
    {
        let cache = url_cache().lock().await;
        if let Some((cdn_url, cached_at)) = cache.get(&query) {
            if cached_at.elapsed() < CACHE_TTL {
                log::info!("[youtube] cache hit (age {:.0}s) for {:?}", cached_at.elapsed().as_secs_f64(), query);
                let cdn_url = cdn_url.clone();
                drop(cache);
                return start_proxy_for(cdn_url).await;
            }
            log::info!("[youtube] cache expired for {:?}, re-fetching", query);
        } else {
            log::info!("[youtube] cache miss for {:?}", query);
        }
    }

    let search_query = format!("{} ambience focus music", query);
    let yt_url = format!("ytsearch1:{}", search_query);
    log::info!("[youtube] searching: {:?}", search_query);

    let t0 = Instant::now();
    let cdn_url = extract_stream_url(&app, &yt_url).await?;
    log::info!("[youtube] yt-dlp resolved in {:.1}s → {}…", t0.elapsed().as_secs_f64(), &cdn_url[..60.min(cdn_url.len())]);

    // Store in cache
    {
        let mut cache = url_cache().lock().await;
        cache.insert(query, (cdn_url.clone(), Instant::now()));
    }

    start_proxy_for(cdn_url).await
}


async fn extract_stream_url(app: &AppHandle, yt_url: &str) -> Result<String, String> {
    log::info!("[yt-dlp] spawning: -g {}", yt_url);
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| { log::error!("[yt-dlp] sidecar error: {}", e); e.to_string() })?
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
        .map_err(|e| { log::error!("[yt-dlp] spawn failed: {}", e); e.to_string() })?;

    let exit_code = output.status.code().unwrap_or(-1);
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::error!("[yt-dlp] exited {} — stderr: {}", exit_code, if err.is_empty() { "(empty)" } else { &err });
        return Err(if err.is_empty() { "No audio found for this mood.".into() } else { err });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let cdn_url = stdout.lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string();

    if cdn_url.is_empty() {
        log::error!("[yt-dlp] exited 0 but stdout was empty");
        return Err("Could not extract stream URL.".into());
    }

    log::info!("[yt-dlp] exit {} — got URL ({}…)", exit_code, &cdn_url[..60.min(cdn_url.len())]);
    Ok(cdn_url)
}

async fn start_proxy_for(cdn_url: String) -> Result<String, String> {
    {
        let mut guard = proxy_store().lock().await;
        if let Some(h) = guard.take() {
            log::info!("[proxy] aborting previous proxy task");
            h.abort();
        }
    }

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| { log::error!("[proxy] bind failed: {}", e); e.to_string() })?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    log::info!("[proxy] listening on port {} → {}…", port, &cdn_url[..60.min(cdn_url.len())]);

    let task = tokio::spawn(async move {
        loop {
            let Ok((socket, peer)) = listener.accept().await else { return };
            log::debug!("[proxy] accepted connection from {}", peer);
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

    log::debug!("[proxy] → CDN range={}", range_val.as_deref().unwrap_or("none"));

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .build()
        .unwrap_or_default();

    let mut req = client.get(&cdn_url);
    if let Some(r) = range_val { req = req.header("Range", r); }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            log::error!("[proxy] CDN request failed: {}", e);
            return;
        }
    };

    let status = resp.status().as_u16();
    let status_text = if status == 206 { "Partial Content" } else { "OK" };

    if status >= 400 {
        log::warn!("[proxy] CDN returned HTTP {}", status);
    } else {
        log::debug!("[proxy] CDN HTTP {}", status);
    }

    let content_type = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("audio/webm").to_string();
    let content_length = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).map(str::to_string);
    let content_range = resp.headers().get("content-range").and_then(|v| v.to_str().ok()).map(str::to_string);

    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\n",
        status, status_text, content_type
    );
    if let Some(cl) = &content_length { head.push_str(&format!("Content-Length: {}\r\n", cl)); }
    if let Some(cr) = &content_range  { head.push_str(&format!("Content-Range: {}\r\n", cr)); }
    head.push_str("\r\n");

    if socket.write_all(head.as_bytes()).await.is_err() { return; }

    let mut bytes_sent: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                bytes_sent += bytes.len() as u64;
                if socket.write_all(&bytes).await.is_err() { break; }
            }
            Err(e) => {
                log::warn!("[proxy] CDN stream error after {} bytes: {}", bytes_sent, e);
                break;
            }
        }
    }
    log::debug!("[proxy] connection closed — {} bytes sent", bytes_sent);
}

#[tauri::command]
async fn delete_model(app: AppHandle) -> Result<(), String> {
    let model_dir = get_model_dir(&app);
    if model_dir.exists() {
        std::fs::remove_dir_all(&model_dir).map_err(|e| e.to_string())?;
        log::info!("[delete_model] removed {}", model_dir.display());
    } else {
        log::info!("[delete_model] nothing to remove at {}", model_dir.display());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("wry", log::LevelFilter::Warn)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("mood-music".into()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            prepare_audio_stream,
            fetch_image_base64,
            check_model,
            is_model_downloaded,
            compile_models,
            download_model,
            delete_model,
            generate_image_local,
            start_oauth_server,
            exchange_spotify_code,
            refresh_spotify_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
