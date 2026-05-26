import "./App.css";
import { AppProvider, useApp } from "./context/AppContext";
import { SetupScreen } from "./screens/SetupScreen";
import { MoodEditorScreen } from "./screens/MoodEditorScreen";
import { PlaybackScreen } from "./screens/PlaybackScreen";

function Router() {
  const { screen, isReady } = useApp();

  if (!isReady) return <div className="app-loading" />;

  return (
    <main className="app-shell">
      {screen === "setup" && <SetupScreen />}
      {screen === "mood" && <MoodEditorScreen />}
      {screen === "playback" && <PlaybackScreen />}
    </main>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
