import { createContext, useContext, useMemo, useState } from "react";
import type { MoodToken, ServiceOption } from "../data/themes";
import { themeOptions, themeTokens } from "../data/themes";

export type Screen = "setup" | "mood" | "playback";

type AppState = {
  screen: Screen;
  service: ServiceOption;
  clientId: string;
  clientSecret: string;
  selectedTheme: string;
  tokens: MoodToken[];
  activeTokenId: string;
  playing: boolean;
  moodSentence: string;
  setService: (s: ServiceOption) => void;
  setClientId: (v: string) => void;
  setClientSecret: (v: string) => void;
  setPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;
  selectTheme: (themeId: string) => void;
  setActiveTokenId: (id: string) => void;
  updateTokenValue: (tokenId: string, newValue: string) => void;
  goToMood: () => void;
  goToPlayback: () => void;
  goToSetup: () => void;
};

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [screen, setScreen] = useState<Screen>("setup");
  const [service, setService] = useState<ServiceOption>("spotify");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [selectedTheme, setSelectedTheme] = useState(themeOptions[0].id);
  const [tokens, setTokens] = useState<MoodToken[]>(themeTokens[themeOptions[0].id]);
  const [activeTokenId, setActiveTokenId] = useState<string>(themeTokens[themeOptions[0].id][0].id);
  const [playing, setPlaying] = useState(false);

  const moodSentence = useMemo(() => tokens.map((t) => t.value).join(" "), [tokens]);

  function selectTheme(themeId: string) {
    setSelectedTheme(themeId);
    const nextTokens = themeTokens[themeId] ?? [];
    setTokens(nextTokens);
    setActiveTokenId(nextTokens[0]?.id ?? "");
  }

  function updateTokenValue(tokenId: string, newValue: string) {
    setTokens((current) =>
      current.map((token) => (token.id === tokenId ? { ...token, value: newValue } : token))
    );
  }

  return (
    <AppContext.Provider
      value={{
        screen,
        service,
        clientId,
        clientSecret,
        selectedTheme,
        tokens,
        activeTokenId,
        playing,
        moodSentence,
        setService,
        setClientId,
        setClientSecret,
        setPlaying,
        selectTheme,
        setActiveTokenId,
        updateTokenValue,
        goToMood: () => setScreen("mood"),
        goToPlayback: () => { setPlaying(false); setScreen("playback"); },
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
