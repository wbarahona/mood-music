import "./App.css";
import { AppProvider, useApp } from "./context/AppContext";
import { SetupScreen } from "./screens/SetupScreen";
import { MoodEditorScreen } from "./screens/MoodEditorScreen";
import { PlaybackScreen } from "./screens/PlaybackScreen";

function Router() {
  const { screen } = useApp();
  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Mood Music</h1>
        <p>Build a mood sentence, connect a service, then play or edit it again.</p>
      </header>
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
