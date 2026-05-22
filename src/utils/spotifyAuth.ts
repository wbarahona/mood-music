import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "./openUrl";
import { saveSpotifyTokens, type StoredSpotifyTokens } from "./storage";

const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
].join(" ");

function generateVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export async function startSpotifyOAuth(clientId: string): Promise<StoredSpotifyTokens> {
  const verifier = generateVerifier();
  const challenge = await generateChallenge(verifier);
  const state = crypto.randomUUID();

  // Start the local callback server before opening the URL
  await invoke("start_oauth_server");

  // Set up the promise resolvers so we can resolve/reject from within the listener
  let resolveAuth!: (tokens: StoredSpotifyTokens) => void;
  let rejectAuth!: (error: Error) => void;
  const authPromise = new Promise<StoredSpotifyTokens>((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });

  // Register listener *before* opening the URL to avoid any race condition
  const unlisten = await listen<{ code?: string; state?: string; error?: string }>(
    "spotify-callback",
    async (event) => {
      unlisten(); // one-shot
      const { code, error } = event.payload;
      if (error || !code) {
        rejectAuth(new Error(error ?? "OAuth cancelled or denied"));
        return;
      }
      try {
        const raw = await invoke<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
        }>("exchange_spotify_code", { code, verifier, clientId });

        const tokens: StoredSpotifyTokens = {
          accessToken: raw.access_token,
          refreshToken: raw.refresh_token,
          expiresAt: Date.now() + raw.expires_in * 1000,
        };
        await saveSpotifyTokens(tokens);
        resolveAuth(tokens);
      } catch (err) {
        rejectAuth(new Error(typeof err === "string" ? err : "Token exchange failed"));
      }
    }
  );

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: "http://localhost:8888/callback",
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });

  await openUrl(`https://accounts.spotify.com/authorize?${params.toString()}`);

  return authPromise;
}

export async function refreshSpotifyTokens(
  refreshToken: string,
  clientId: string
): Promise<StoredSpotifyTokens> {
  const raw = await invoke<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>("refresh_spotify_token", { refreshToken, clientId });

  const tokens: StoredSpotifyTokens = {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? refreshToken,
    expiresAt: Date.now() + raw.expires_in * 1000,
  };
  saveSpotifyTokens(tokens);
  return tokens;
}
