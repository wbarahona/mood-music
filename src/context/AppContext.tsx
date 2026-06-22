import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MoodToken, ServiceOption } from "../data/themes";
import { themeOptions, themeTokens } from "../data/themes";
import { loadSetup, saveSetup, loadSpotifyTokens, saveSpotifyTokens, loadImageSettings, saveImageSettings, clearAll, type StoredSpotifyTokens, type ImageSettings, DEFAULT_IMAGE_SETTINGS } from "../utils/storage";

export type Screen = "setup" | "mood" | "playback";

type AppState = {
  isReady: boolean;
  screen: Screen;
  service: ServiceOption;
  clientId: string;
  clientSecret: string;
  spotifyTokens: StoredSpotifyTokens | null;
  selectedTheme: string;
  tokens: MoodToken[];
  activeTokenId: string;
  moodSentence: string;
  isModified: boolean;
  // YouTube audio stream pre-warming
  audioStreamUrl: string | null;
  isStreamLoading: boolean;
  streamError: string;
  retryAudioStream: () => void;
  imageSettings: ImageSettings;
  setImageSettings: (s: ImageSettings) => void;
  resetApp: () => void;
  commitCredentials: (service: ServiceOption, clientId: string, clientSecret: string) => void;
  setSpotifyTokens: (tokens: StoredSpotifyTokens | null) => void;
  selectTheme: (themeId: string) => void;
  setActiveTokenId: (id: string) => void;
  updateTokenValue: (tokenId: string, newValue: string) => void;
  goToMood: () => void;
  goToPlayback: () => void;
  goToSetup: () => void;
};

const AppContext = createContext<AppState | null>(null);

const initialThemeId = themeOptions[0].id;
const initialTokens = themeTokens[initialThemeId];
const initialDefaults: Record<string, string> = Object.fromEntries(
  initialTokens.map((t) => [t.id, t.value])
);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("setup");
  const [service, setService] = useState<ServiceOption>("spotify");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [spotifyTokens, setSpotifyTokensState] = useState<StoredSpotifyTokens | null>(null);
  const [selectedTheme, setSelectedTheme] = useState(initialThemeId);
  const [tokens, setTokens] = useState<MoodToken[]>(initialTokens);
  const [activeTokenId, setActiveTokenId] = useState<string>("");
  const [defaultValues, setDefaultValues] = useState<Record<string, string>>(initialDefaults);

  const [imageSettings, setImageSettingsState] = useState<ImageSettings>(DEFAULT_IMAGE_SETTINGS);

  // YouTube audio stream pre-warming
  const [audioStreamUrl, setAudioStreamUrl] = useState<string | null>(null);
  const [isStreamLoading, setIsStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState("");
  const [streamRetry, setStreamRetry] = useState(0);
  const pendingQueryRef = useRef("");

  // Load persisted data from the Tauri store (or localStorage fallback) on mount
  useEffect(() => {
    async function init() {
      const [stored, storedTokens, modelExists, storedImageSettings] = await Promise.all([
        loadSetup(),
        loadSpotifyTokens(),
        invoke<boolean>("check_model").catch(() => false),
        loadImageSettings(),
      ]);
      if (stored) {
        setService(stored.service);
        setClientId(stored.clientId);
        setClientSecret(stored.clientSecret);
      }
      if (storedTokens) {
        setSpotifyTokensState(storedTokens);
      }
      setImageSettingsState(storedImageSettings);
      if (modelExists && stored) {
        setScreen("playback");
      }
      // otherwise stay on "setup" (default) — SetupScreen handles model download inline
      setIsReady(true);
    }
    init();
  }, []);

  const moodSentence = useMemo(() => tokens.map((t) => t.value).join(" "), [tokens]);

  const isModified = useMemo(
    () => tokens.some((t) => t.value !== defaultValues[t.id]),
    [tokens, defaultValues]
  );

  function commitCredentials(newService: ServiceOption, newClientId: string, newClientSecret: string) {
    setService(newService);
    setClientId(newClientId);
    setClientSecret(newClientSecret);
    saveSetup({ service: newService, clientId: newClientId, clientSecret: newClientSecret });
  }

  function handleSetSpotifyTokens(tokens: StoredSpotifyTokens | null) {
    setSpotifyTokensState(tokens);
    if (tokens) saveSpotifyTokens(tokens);
  }

  function selectTheme(themeId: string) {
    setSelectedTheme(themeId);
    const nextTokens = themeTokens[themeId] ?? [];
    setTokens(nextTokens);
    setActiveTokenId("");
    setDefaultValues(Object.fromEntries(nextTokens.map((t) => [t.id, t.value])));
  }

  function updateTokenValue(tokenId: string, newValue: string) {
    setTokens((current) =>
      current.map((token) => (token.id === tokenId ? { ...token, value: newValue } : token))
    );
  }

  // Pre-warm the YouTube audio stream whenever the mood or service changes.
  // Debounced 600 ms so rapid token edits don't fire cascading yt-dlp processes.
  // Passes the stored API key so Rust can use YouTube Data API for faster search.
  useEffect(() => {
    if (!isReady || service !== "youtube") return;

    pendingQueryRef.current = moodSentence;
    setAudioStreamUrl(null);
    setIsStreamLoading(true);
    setStreamError("");

    let cancelled = false;
    const timer = setTimeout(() => {
      invoke<string>("prepare_audio_stream", { query: moodSentence, apiKey: clientId })
        .then((url) => {
          if (cancelled || pendingQueryRef.current !== moodSentence) return;
          setAudioStreamUrl(url);
          setIsStreamLoading(false);
        })
        .catch((err) => {
          if (cancelled || pendingQueryRef.current !== moodSentence) return;
          setStreamError(typeof err === "string" ? err : "Failed to load audio.");
          setIsStreamLoading(false);
        });
    }, 600);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [isReady, service, moodSentence, clientId, streamRetry]);

  function retryAudioStream() {
    setStreamRetry((n) => n + 1);
  }

  function setImageSettings(s: ImageSettings) {
    setImageSettingsState(s);
    saveImageSettings(s);
  }

  async function resetApp() {
    await clearAll();
    await invoke("delete_model").catch(() => {});
    setService("spotify");
    setClientId("");
    setClientSecret("");
    setSpotifyTokensState(null);
    setAudioStreamUrl(null);
    setIsStreamLoading(false);
    setStreamError("");
    setStreamRetry(0);
    setScreen("setup");
  }

  return (
    <AppContext.Provider
      value={{
        isReady,
        screen,
        service,
        clientId,
        clientSecret,
        spotifyTokens,
        selectedTheme,
        tokens,
        activeTokenId,
        moodSentence,
        isModified,
        audioStreamUrl,
        isStreamLoading,
        streamError,
        retryAudioStream,
        imageSettings,
        setImageSettings,
        resetApp,
        commitCredentials,
        setSpotifyTokens: handleSetSpotifyTokens,
        selectTheme,
        setActiveTokenId,
        updateTokenValue,
        goToMood: () => setScreen("mood"),
        goToPlayback: () => setScreen("playback"),
        goToSetup: () => setScreen("setup"),
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
