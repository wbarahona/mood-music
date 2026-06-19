import type { ServiceOption } from "../data/themes";

export type StoredSetup = {
  service: ServiceOption;
  clientId: string;
  clientSecret: string;
};

export type StoredSpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

// ── Store singleton ────────────────────────────────────────────────────────────
// We lazy-init the Tauri store once and reuse the same instance.
// Outside Tauri (browser dev with `npm run dev`), we fall back to localStorage.

const isTauri = () => "__TAURI_INTERNALS__" in window;

let _storePromise: Promise<import("@tauri-apps/plugin-store").Store> | null = null;

async function getStore() {
  if (!isTauri()) return null;
  if (!_storePromise) {
    const { load } = await import("@tauri-apps/plugin-store");
    _storePromise = load("mood-music.json", { defaults: {}, autoSave: true });
  }
  return _storePromise;
}

// ── Setup ──────────────────────────────────────────────────────────────────────

function isValidSetup(s: StoredSetup): boolean {
  return s.service === "youtube" || Boolean(s.clientId);
}

export async function loadSetup(): Promise<StoredSetup | null> {
  const store = await getStore();
  try {
    if (store) {
      const val = await store.get<StoredSetup>("setup");
      return val && isValidSetup(val) ? val : null;
    }
    // localStorage fallback
    const raw = localStorage.getItem("mood-music-setup");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSetup;
    return isValidSetup(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSetup(data: StoredSetup): Promise<void> {
  const store = await getStore();
  try {
    if (store) { await store.set("setup", data); return; }
    localStorage.setItem("mood-music-setup", JSON.stringify(data));
  } catch {}
}

// ── Spotify tokens ─────────────────────────────────────────────────────────────

export async function loadSpotifyTokens(): Promise<StoredSpotifyTokens | null> {
  const store = await getStore();
  try {
    if (store) return await store.get<StoredSpotifyTokens>("spotifyTokens") ?? null;
    const raw = localStorage.getItem("mood-music-spotify-tokens");
    return raw ? (JSON.parse(raw) as StoredSpotifyTokens) : null;
  } catch {
    return null;
  }
}

export async function saveSpotifyTokens(tokens: StoredSpotifyTokens): Promise<void> {
  const store = await getStore();
  try {
    if (store) { await store.set("spotifyTokens", tokens); return; }
    localStorage.setItem("mood-music-spotify-tokens", JSON.stringify(tokens));
  } catch {}
}

// ── Image generation settings ──────────────────────────────────────────────────

export type Scheduler = "dpm" | "pndm";

export type ImageSettings = {
  steps: number;      // 10 | 15 | 20 | 25
  cfgScale: number;   // 5–12
  scheduler: Scheduler;
};

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  steps: 15,
  cfgScale: 7.5,
  scheduler: "dpm",
};

export async function loadImageSettings(): Promise<ImageSettings> {
  const store = await getStore();
  try {
    if (store) {
      const val = await store.get<ImageSettings>("imageSettings");
      return val ?? DEFAULT_IMAGE_SETTINGS;
    }
    const raw = localStorage.getItem("mood-music-image-settings");
    return raw ? (JSON.parse(raw) as ImageSettings) : DEFAULT_IMAGE_SETTINGS;
  } catch {
    return DEFAULT_IMAGE_SETTINGS;
  }
}

export async function saveImageSettings(s: ImageSettings): Promise<void> {
  const store = await getStore();
  try {
    if (store) { await store.set("imageSettings", s); return; }
    localStorage.setItem("mood-music-image-settings", JSON.stringify(s));
  } catch {}
}

export async function clearAll(): Promise<void> {
  const store = await getStore();
  try {
    if (store) {
      await store.delete("setup");
      await store.delete("spotifyTokens");
      await store.delete("imageSettings");
      return;
    }
    localStorage.removeItem("mood-music-setup");
    localStorage.removeItem("mood-music-spotify-tokens");
    localStorage.removeItem("mood-music-image-settings");
  } catch {}
}
