import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { MoodToken, ServiceOption } from "../data/themes";
import { themeOptions, themeTokens } from "../data/themes";
import { loadSetup, saveSetup, loadSpotifyTokens, saveSpotifyTokens, type StoredSpotifyTokens } from "../utils/storage";

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

  // Load persisted data from the Tauri store (or localStorage fallback) on mount
  useEffect(() => {
    async function init() {
      const [stored, storedTokens] = await Promise.all([loadSetup(), loadSpotifyTokens()]);
      if (stored) {
        setService(stored.service);
        setClientId(stored.clientId);
        setClientSecret(stored.clientSecret);
        setScreen("playback");
      }
      if (storedTokens) {
        setSpotifyTokensState(storedTokens);
      }
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
