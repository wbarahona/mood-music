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
