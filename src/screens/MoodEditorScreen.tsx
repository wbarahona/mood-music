import { useState } from "react";
import { useApp } from "../context/AppContext";
import type { ServiceOption } from "../data/themes";
import { themeOptions, services } from "../data/themes";
import { startSpotifyOAuth } from "../utils/spotifyAuth";
import { serviceIcons } from "../utils/serviceIcons";

function CogPanel({ onClose }: { onClose: () => void }) {
  const { service, clientId, commitCredentials, setSpotifyTokens } = useApp();

  const [localService, setLocalService] = useState<ServiceOption>(service);
  const [localClientId, setLocalClientId] = useState(clientId);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  const isValid = localService === "youtube" || localClientId.trim().length > 0;

  async function handleSave() {
    if (localService === "youtube") {
      commitCredentials("youtube", "", "");
      onClose();
      return;
    }

    // Spotify: always re-run OAuth so the token is fresh for the current Client ID
    setIsConnecting(true);
    setConnectError("");
    try {
      const tokens = await startSpotifyOAuth(localClientId.trim());
      commitCredentials("spotify", localClientId.trim(), "");
      setSpotifyTokens(tokens);
      onClose();
    } catch (err) {
      setConnectError(
        err instanceof Error
          ? err.message
          : "Connection failed. Please try again.",
      );
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className="cog-panel">
      <div className="cog-panel-header">
        <span className="cog-panel-title">Service settings</span>
        <button
          type="button"
          className="cog-close"
          onClick={onClose}
          aria-label="Close"
        >
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>

      <div className="service-options" style={{ marginBottom: "16px" }}>
        {services.map((s) => (
          <button
            key={s.id}
            type="button"
            data-service={s.id}
            className={
              localService === s.id ? "service-button active" : "service-button"
            }
            onClick={() => {
              setLocalService(s.id);
              setConnectError("");
            }}
          >
            {serviceIcons[s.id]}
            {s.label}
          </button>
        ))}
      </div>

      {localService === "youtube" ? (
        <div className="service-inline-note" style={{ marginBottom: "16px" }}>
          <span className="service-inline-note-icon">✓</span>
          <span>
            YouTube Music streams via <strong>yt-dlp</strong> — no credentials
            needed.
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
              disabled={isConnecting}
            />
          </div>
        </div>
      )}

      {connectError && (
        <p className="playback-error" style={{ marginTop: "8px" }}>
          {connectError}
        </p>
      )}
      {isConnecting && (
        <p className="oauth-hint">Waiting for Spotify in your browser…</p>
      )}

      <div className="cog-panel-actions">
        <button
          type="button"
          className="primary-button"
          onClick={handleSave}
          disabled={!isValid || isConnecting}
        >
          {localService === "spotify"
            ? isConnecting
              ? "Connecting…"
              : "Connect with Spotify"
            : "Save changes"}
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
    selectTheme,
    setActiveTokenId,
    updateTokenValue,
    goToPlayback,
  } = useApp();

  const [showCog, setShowCog] = useState(false);

  const currentTheme = themeOptions.find((t) => t.id === selectedTheme)!;
  const activeToken = activeTokenId
    ? (tokens.find((t) => t.id === activeTokenId) ?? null)
    : null;

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
        <div className="section-title">Set your mood</div>
        <button
          type="button"
          className={showCog ? "cog-button active" : "cog-button"}
          onClick={() => setShowCog((v) => !v)}
          title="Service settings"
          aria-label="Service settings"
        >
          <span className="material-symbols-rounded">settings</span>
        </button>
      </div>

      {showCog && <CogPanel onClose={() => setShowCog(false)} />}

      <p className="section-description">
        Choose a theme, then tap any highlighted word to swap it for an
        alternative.
      </p>

      <div className="tiles-grid">
        {themeOptions.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={
              theme.id === selectedTheme ? "theme-tile selected" : "theme-tile"
            }
            style={{ borderLeftColor: theme.accentColor }}
            onClick={() => selectTheme(theme.id)}
          >
            <strong>{theme.label}</strong>
            <span>{theme.description}</span>
          </button>
        ))}
      </div>

      <div
        className="theme-stage"
        style={{ background: currentTheme.gradient }}
      >
        <div className="sentence-line">
          <span className="sentence-prefix">Blend mood to an</span>
          {tokens.map((token) => (
            <button
              key={token.id}
              type="button"
              className={
                token.id === activeTokenId
                  ? "stage-token active"
                  : "stage-token"
              }
              onClick={() => handleTokenClick(token.id)}
            >
              {token.value}
            </button>
          ))}
        </div>

        {activeToken && (
          <div className="inline-pills">
            {activeToken.options.map((option) => (
              <button
                key={option}
                type="button"
                className={
                  option === activeToken.value
                    ? "stage-pill active"
                    : "stage-pill"
                }
                onClick={() => handleOptionClick(activeToken.id, option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="actions-row">
        <button type="button" className="primary-button" onClick={goToPlayback}>
          Enter into the zone
        </button>
      </div>
    </section>
  );
}
