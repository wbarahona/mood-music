# Mood Music

![preview](./public/preview.png)

A macOS desktop app that turns your mood into music. Build a sentence that describes how you feel, and the app finds matching music, generates a cinematic AI background image locally on your Mac, and adapts its color theme to the artwork — all without sending your data anywhere.

Built with Tauri v2, React 19, Rust, and Swift.

---

## How it works

1. **Pick a theme** — Imaginary, Painting, Mineral, or Night Terrain. Each has its own visual language and word set.
2. **Build your mood sentence** — tap any highlighted word to swap it. The sentence drives everything: image generation, music search, and color theming.
3. **Enter the zone** — bundled ambient music starts instantly while a YouTube track matching your mood loads in the background. The AI image generates locally on Apple Silicon. When both are ready they transition automatically.

Tracks pre-fetch 20 seconds before the current one ends so playback never gaps. Music survives navigation back to the mood editor.

---

## Features

- **Local AI image generation** — DreamShaper 8 runs entirely on-device via Core ML and Apple Neural Engine. No cloud, no API key, no data sent anywhere. One-time ~1.5 GB model download on first launch.
- **Animated particle placeholder** — while the image generates, color-matched particles and aurora blobs fill the background using the active M3 theme palette.
- **Instant audio** — four bundled ambient tracks play from the first tap; no waiting for the network.
- **YouTube music search** — yt-dlp extracts a signed CDN stream URL; a Rust TCP proxy serves it to the audio element with full Range header support for seeking.
- **Continuous playback** — pre-fetches the next track while the current one plays; cycles through search variations (`mix`, `playlist`, `session`, …) to return different results each time.
- **Dynamic M3 theming** — the generated image's dominant palette is extracted with Material Color Utilities and applied as a live Material Design 3 dark theme across the entire UI.
- **Spotify support** — connects via PKCE OAuth; searches for a mood-matching playlist and streams it through the Spotify Web Playback SDK.
- **Tunable image generation** — steps (10/15/20/25), CFG scale (5–12), and scheduler (DPM-Solver++ or PNDM) are exposed in settings and persisted per-device.
- **2-hour CDN cache** — repeat moods skip yt-dlp entirely and stream instantly from memory.
- **File logging** — all audio fetch, image generation, and Spotify events are written to `~/Library/Logs/com.wbarahona.mood-music/mood-music.log`.

---

## Requirements

### System (one-time install)

| Dependency | Version | Purpose |
|---|---|---|
| **Node.js** | 18+ | Frontend build (Vite + React) |
| **Rust** | stable | Tauri v2 backend compilation |
| **Xcode Command Line Tools** | latest | macOS toolchain (Rust + Swift compilation) |

```bash
# Xcode Command Line Tools
xcode-select --install

# Rust (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

> **Note:** `yt-dlp` and `sd-swift` binaries are pre-compiled and committed to the repo — you do **not** need to install or build them separately.

### macOS

- **macOS 14 (Sonoma) or later** — required for Core ML ANE image generation
- **Apple Silicon (M1/M2/M3/M4)** — the pre-built binaries are `aarch64-apple-darwin` only

---

## Getting started

```bash
# 1. Clone the repo
git clone https://github.com/wbarahona/mood-music.git
cd mood-music

# 2. Install JS dependencies
npm install

# 3. Run in development
npm run app:dev

# 4. Build a release DMG
npm run app:build
```

On first launch the app will walk you through:
1. Choosing a music service (YouTube works with no credentials)
2. Downloading the DreamShaper 8 Core ML model (~1.5 GB, one-time)
3. Compiling the model for Apple Silicon (~5–10 min, one-time, no Xcode required)

After that, image generation is fully offline.

---

## Rebuilding the Swift sidecar (optional)

The `sd-swift` binary is pre-built and committed. You only need to rebuild it if you modify `sd-swift/Sources/sd-swift/main.swift`.

```bash
# Clone the Apple ML Stable Diffusion Swift package (required as local dependency)
git clone https://github.com/apple/ml-stable-diffusion
# Place it at the repo root: mood-music/ml-stable-diffusion/

# Build sd-swift
cd sd-swift
swift build -c release

# Copy to Tauri binaries
cp .build/release/sd-swift ../src-tauri/binaries/sd-swift-aarch64-apple-darwin
```

Requires macOS 14+ and Swift 5.9+ (included with Xcode Command Line Tools on macOS 14).

---

## Services

### YouTube Music (no account required)

Works out of the box — no sign-in, no API key needed.

**Optional:** add a YouTube Data API key in settings for faster music search (~2 s vs ~12 s). Get one free at [console.cloud.google.com](https://console.cloud.google.com).

### Spotify

Requires a free Spotify developer app (Client ID) and **Spotify Premium** for in-app playback. The setup wizard walks through creating one at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).

If Premium is unavailable, the app offers a direct link to open the mood playlist in the Spotify desktop app instead.

---

## Image generation settings

Accessible via the ⚙️ settings panel on the mood editor:

| Setting | Options | Default | Effect |
|---|---|---|---|
| **Steps** | 10 / 15 / 20 / 25 | 15 | More steps = higher quality, slower |
| **CFG scale** | 5.0 – 12.0 | 7.5 | Higher = more prompt-adherent |
| **Scheduler** | DPM-Solver++ / PNDM | DPM-Solver++ | DPM is faster at equivalent quality |

Settings are persisted to `~/Library/Application Support/com.wbarahona.mood-music/mood-music.json`.

---

## Logs

```bash
tail -f "$HOME/Library/Logs/com.wbarahona.mood-music/mood-music.log"
```

Covers: YouTube search & yt-dlp output, CDN proxy, Spotify token exchange and refresh, Core ML model download/compile/generation.

---

## Project structure

```
src/
  screens/
    SetupScreen.tsx         Combined onboarding: model download + service wizard
    MoodEditorScreen.tsx    Theme tiles, mood sentence, settings cog
    PlaybackScreen.tsx      AI background, particle field, audio controls
  components/
    ModelStatusPanel.tsx    Inline model download/compile progress panel
    ParticleField.tsx       CSS animated aurora + particle placeholder
  context/
    AppContext.tsx           Global state: screen routing, image settings, audio pre-warm
  utils/
    audioPlayer.ts          Module-level Audio singleton (survives screen transitions)
    spotifyAuth.ts          PKCE OAuth flow
    theme.ts                M3 palette extraction from generated image
    storage.ts              Tauri Store / localStorage with image settings support
  data/
    themes.ts               Theme definitions and mood token word banks

src-tauri/src/
  lib.rs                    Tauri commands: model download/compile, image generation,
                            yt-dlp stream extraction, Tokio TCP proxy, Spotify OAuth,
                            CDN URL cache, file logging

sd-swift/
  Sources/sd-swift/
    main.swift              Swift CLI: Core ML pipeline, auto-compile .mlpackage→.mlmodelc,
                            --compile-only mode, configurable steps/CFG/scheduler

src-tauri/binaries/
  yt-dlp-aarch64-apple-darwin     Pre-built yt-dlp (committed)
  sd-swift-aarch64-apple-darwin   Pre-built Swift image generation CLI (committed)
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Tauri v2 |
| Frontend | React 19, TypeScript, Vite |
| Styling | Material Design 3 dark, dynamic color via `@material/material-color-utilities` |
| Icons | Material Symbols Rounded |
| Image generation | DreamShaper 8 via Core ML + Apple Neural Engine (`sd-swift` sidecar) |
| Audio (YouTube) | yt-dlp + Rust TCP proxy with Range support |
| Audio (Spotify) | Spotify Web Playback SDK + PKCE OAuth |
| Persistence | `tauri-plugin-store` with localStorage fallback |
| Logging | `tauri-plugin-log` → `~/Library/Logs/` |
| HTTP (Rust) | reqwest with streaming |
| Async (Rust) | Tokio |
