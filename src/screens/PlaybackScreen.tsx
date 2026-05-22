import { useApp } from "../context/AppContext";

export function PlaybackScreen() {
  const { service, moodSentence, playing, setPlaying, goToMood } = useApp();

  const serviceLabel = service === "spotify" ? "Spotify" : "YouTube Music";

  return (
    <section className="card">
      <div className="section-title">Playback</div>
      <p className="section-description">
        Play the mood-based stream or go back and edit your prompt.
      </p>

      <div className="playback-panel">
        <div className="mood-summary">
          <span>Current mood</span>
          <strong>{moodSentence}</strong>
        </div>

        <div className="playback-actions">
          <button
            type="button"
            className="pill"
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="pill" onClick={goToMood}>
            ✏ Edit mood
          </button>
        </div>
      </div>

      <div className="service-note">
        <span>Service:</span> {serviceLabel}
      </div>
    </section>
  );
}
