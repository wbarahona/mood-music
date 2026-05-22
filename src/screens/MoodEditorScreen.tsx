import { useState } from "react";
import { useApp } from "../context/AppContext";
import type { ServiceOption } from "../data/themes";
import { themeOptions, services } from "../data/themes";

function CogPanel({ onClose }: { onClose: () => void }) {
  const { service, clientId, clientSecret, commitCredentials } = useApp();

  const [localService, setLocalService] = useState<ServiceOption>(service);
  const [localClientId, setLocalClientId] = useState(clientId);
  const [localSecret, setLocalSecret] = useState(clientSecret);

  const isValid = localService === "youtube" || localClientId.trim().length > 0;

  function handleSave() {
    commitCredentials(localService, localClientId, localSecret);
    onClose();
  }

  return (
    <div className="cog-panel">
      <div className="cog-panel-header">
        <span className="cog-panel-title">Service settings</span>
        <button type="button" className="cog-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="service-options" style={{ marginBottom: "16px" }}>
        {services.map((s) => (
          <button
            key={s.id}
            type="button"
            className={localService === s.id ? "service-button active" : "service-button"}
            onClick={() => setLocalService(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {localService === "youtube" ? (
        <div className="service-inline-note" style={{ marginBottom: "16px" }}>
          <span className="service-inline-note-icon">✓</span>
          <span>
            YouTube Music streams via <strong>yt-dlp</strong> — no credentials needed.
          </span>
        </div>
      ) : (
        <div className="field-grid">
          <div className="field-group">
            <label>Client ID</label>
            <input
              value={localClientId}
              onChange={(e) => setLocalClientId(e.currentTarget.value)}
              placeholder="Paste client ID"
            />
          </div>
          <div className="field-group">
            <label>Client secret</label>
            <input
              type="password"
              value={localSecret}
              onChange={(e) => setLocalSecret(e.currentTarget.value)}
              placeholder="Paste client secret"
            />
          </div>
        </div>
      )}

      <div className="cog-panel-actions">
        <button type="button" className="primary-button" onClick={handleSave} disabled={!isValid}>
          Save changes
        </button>
      </div>
    </div>
  );
}

export function MoodEditorScreen() {
  const {
    selectedTheme,
    tokens,
    activeTokenId,
    isModified,
    selectTheme,
    setActiveTokenId,
    updateTokenValue,
    goToPlayback,
  } = useApp();

  const [showCog, setShowCog] = useState(false);

  const currentTheme = themeOptions.find((t) => t.id === selectedTheme)!;
  const activeToken = activeTokenId ? (tokens.find((t) => t.id === activeTokenId) ?? null) : null;

  function handleTokenClick(tokenId: string) {
    setActiveTokenId(tokenId === activeTokenId ? "" : tokenId);
  }

  function handleOptionClick(tokenId: string, option: string) {
    updateTokenValue(tokenId, option);
    setActiveTokenId("");
  }

  return (
    <section className="card">
      <div className="card-header-row">
        <div className="section-title">Mood editor</div>
        <button
          type="button"
          className={showCog ? "cog-button active" : "cog-button"}
          onClick={() => setShowCog((v) => !v)}
          title="Service settings"
          aria-label="Service settings"
        >
          ⚙
        </button>
      </div>

      {showCog && <CogPanel onClose={() => setShowCog(false)} />}

      <p className="section-description">
        Choose a theme, then tap any highlighted word to swap it for an alternative.
      </p>

      <div className="tiles-grid">
        {themeOptions.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={theme.id === selectedTheme ? "theme-tile selected" : "theme-tile"}
            style={{ borderLeftColor: theme.accentColor }}
            onClick={() => selectTheme(theme.id)}
          >
            <strong>{theme.label}</strong>
            <span>{theme.description}</span>
          </button>
        ))}
      </div>

      <div className="theme-stage" style={{ background: currentTheme.gradient }}>
        <div className="sentence-line">
          {tokens.map((token) => (
            <button
              key={token.id}
              type="button"
              className={token.id === activeTokenId ? "stage-token active" : "stage-token"}
              onClick={() => handleTokenClick(token.id)}
            >
              {token.value}
            </button>
          ))}
        </div>

        {activeToken ? (
          <div className="inline-pills">
            {activeToken.options.map((option) => (
              <button
                key={option}
                type="button"
                className={option === activeToken.value ? "stage-pill active" : "stage-pill"}
                onClick={() => handleOptionClick(activeToken.id, option)}
              >
                {option}
              </button>
            ))}
          </div>
        ) : (
          <p className="stage-hint">Tap any word above to explore alternatives</p>
        )}
      </div>

      <div className="actions-row">
        <button
          type="button"
          className="primary-button"
          onClick={goToPlayback}
          disabled={!isModified}
        >
          {isModified ? "Go to playback" : "Change a word to build your mood"}
        </button>
      </div>
    </section>
  );
}
