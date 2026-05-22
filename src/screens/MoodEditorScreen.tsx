import { useApp } from "../context/AppContext";
import { themeOptions } from "../data/themes";

export function MoodEditorScreen() {
  const {
    selectedTheme,
    tokens,
    activeTokenId,
    moodSentence,
    selectTheme,
    setActiveTokenId,
    updateTokenValue,
    goToPlayback,
  } = useApp();

  const activeToken = tokens.find((t) => t.id === activeTokenId) ?? tokens[0];

  return (
    <section className="card">
      <div className="section-title">Mood editor</div>
      <p className="section-description">
        Choose a theme, then tap a word to change the mood. The sentence becomes the
        search query sent to your music service.
      </p>

      <div className="tiles-grid">
        {themeOptions.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={theme.id === selectedTheme ? "theme-tile selected" : "theme-tile"}
            onClick={() => selectTheme(theme.id)}
          >
            <strong>{theme.label}</strong>
            <span>{theme.description}</span>
          </button>
        ))}
      </div>

      <div className="sentence-block">
        <span className="sentence-label">Mood sentence</span>
        <div className="sentence-line">
          {tokens.map((token) => (
            <button
              key={token.id}
              type="button"
              className={token.id === activeTokenId ? "sentence-token active" : "sentence-token"}
              onClick={() => setActiveTokenId(token.id)}
            >
              {token.value}
            </button>
          ))}
        </div>
      </div>

      <div className="token-actions">
        <div className="token-label">Change "{activeToken?.value}"</div>
        <div className="pill-row">
          {activeToken?.options.map((option) => (
            <button
              key={option}
              type="button"
              className={option === activeToken.value ? "pill active" : "pill"}
              onClick={() => updateTokenValue(activeToken.id, option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="preview-card">
        <div className="preview-label">Preview</div>
        <div className="preview-content">{moodSentence}</div>
      </div>

      <div className="actions-row">
        <button type="button" className="primary-button" onClick={goToPlayback}>
          Go to playback
        </button>
      </div>
    </section>
  );
}
