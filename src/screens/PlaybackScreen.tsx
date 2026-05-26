import { useState, useEffect, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useApp } from "../context/AppContext";
import { refreshSpotifyTokens } from "../utils/spotifyAuth";
import { openUrl } from "../utils/openUrl";
import { moodToUrl } from "../utils/moodToUrl";
import { applyM3ThemeFromImage, applyM3Theme } from "../utils/theme";

type AudioState = "loading" | "ready" | "playing" | "error";
type SpotifyState = "loading" | "ready" | "playing" | "paused" | "error";

export function PlaybackScreen() {
  const {
    service,
    moodSentence,
    clientId,
    spotifyTokens,
    setSpotifyTokens,
    goToMood,
  } = useApp();

  const isYoutube = service === "youtube";

  // ── Pollinations background ────────────────────────────────────────────────
  const bgImgRef = useRef<HTMLImageElement>(null);
  const [bgSrc, setBgSrc] = useState<string | null>(null);
  const [bgLoaded, setBgLoaded] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);

  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    moodSentence + " music mood aesthetic cinematic",
  )}?width=900&height=680&nologo=true`;

  // Fetch via Rust backend — bypasses the 403 that browser Origin header triggers
  useEffect(() => {
    setBgLoaded(false);
    setBgFailed(false);
    setBgSrc(null);
    applyM3Theme();

    let cancelled = false;
    invoke<string>("fetch_image_base64", { url: pollinationsUrl })
      .then((dataUrl) => {
        if (cancelled) return;
        setBgSrc(dataUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setBgFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [moodSentence]);

  function handleBgLoad() {
    setBgLoaded(true);
    // data URLs are same-origin — canvas.getImageData works without CORS issues
    if (bgImgRef.current) applyM3ThemeFromImage(bgImgRef.current);
  }

  function handleBgError() {
    setBgFailed(true);
    applyM3Theme();
  }

  // ── YouTube state ──────────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioState, setAudioState] = useState<AudioState>(
    isYoutube ? "loading" : "ready",
  );
  const [audioError, setAudioError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isYoutube) return;
    setAudioState("loading");
    setAudioError("");
    invoke<string>("get_audio_url", { query: moodSentence })
      .then((filePath) => {
        const audio = audioRef.current;
        if (audio) {
          audio.src = convertFileSrc(filePath);
          audio.load();
        }
        setAudioState("ready");
      })
      .catch((err) => {
        setAudioError(typeof err === "string" ? err : "Failed to load audio.");
        setAudioState("error");
      });
    return () => {
      audioRef.current?.pause();
    };
  }, [moodSentence, isYoutube, retryCount]);

  function toggleYoutubePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioState === "playing") {
      audio.pause();
      setAudioState("ready");
    } else {
      setAudioState("playing");
      audio.play().catch(() => {
        setAudioError(
          "Playback failed — the stream may have expired. Go back and try again.",
        );
        setAudioState("error");
      });
    }
  }

  // ── Spotify state ──────────────────────────────────────────────────────────
  const playerRef = useRef<Spotify.Player | null>(null);
  const deviceIdRef = useRef("");
  const tokenRef = useRef(spotifyTokens?.accessToken ?? "");
  const hasStartedRef = useRef(false);

  const [spotifyState, setSpotifyState] = useState<SpotifyState>("loading");
  const [spotifyError, setSpotifyError] = useState("");
  const [isPremiumError, setIsPremiumError] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<{
    name: string;
    artist: string;
  } | null>(null);

  useEffect(() => {
    tokenRef.current = spotifyTokens?.accessToken ?? "";
  }, [spotifyTokens]);

  useEffect(() => {
    if (isYoutube) return;
    if (!spotifyTokens) {
      setSpotifyState("error");
      setSpotifyError(
        "No Spotify session found. Please reconnect in settings.",
      );
      return;
    }

    let cancelled = false;

    async function init() {
      let tokens = spotifyTokens!;
      if (tokens.expiresAt - Date.now() < 5 * 60 * 1000) {
        try {
          tokens = await refreshSpotifyTokens(tokens.refreshToken, clientId);
          if (!cancelled) setSpotifyTokens(tokens);
        } catch {
          if (!cancelled) {
            setSpotifyState("error");
            setSpotifyError(
              "Your Spotify session expired. Please reconnect in settings.",
            );
          }
          return;
        }
      }
      tokenRef.current = tokens.accessToken;

      function initPlayer() {
        if (cancelled) return;
        const player = new window.Spotify.Player({
          name: "Mood Music",
          getOAuthToken: (cb) => cb(tokenRef.current),
          volume: 0.8,
        });
        player.addListener("initialization_error", ({ message }) => {
          if (!cancelled) {
            setSpotifyError(`Player error: ${message}`);
            setSpotifyState("error");
          }
        });
        player.addListener("authentication_error", ({ message }) => {
          if (!cancelled) {
            setSpotifyError(
              `Auth error: ${message}. Try reconnecting Spotify.`,
            );
            setSpotifyState("error");
          }
        });
        player.addListener("account_error", ({ message }) => {
          const premium = /premium/i.test(message);
          if (!cancelled) {
            setSpotifyError(
              premium
                ? "Spotify Premium is required for in-app playback."
                : `Account error: ${message}`,
            );
            setIsPremiumError(premium);
            setSpotifyState("error");
          }
        });
        player.addListener("ready", ({ device_id }) => {
          deviceIdRef.current = device_id;
          if (!cancelled) setSpotifyState("ready");
        });
        player.addListener("not_ready", () => {
          if (!cancelled) setSpotifyState("loading");
        });
        player.addListener("player_state_changed", (state) => {
          if (!state || cancelled) return;
          const track = state.track_window.current_track;
          setCurrentTrack({
            name: track.name,
            artist: track.artists.map((a) => a.name).join(", "),
          });
          setSpotifyState(state.paused ? "paused" : "playing");
        });
        player.connect();
        playerRef.current = player;
      }

      window.onSpotifyWebPlaybackSDKReady = initPlayer;
      if (window.Spotify) {
        initPlayer();
      } else if (!document.querySelector('script[src*="spotify-player"]')) {
        const script = document.createElement("script");
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.body.appendChild(script);
      }
    }

    init();
    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYoutube]);

  async function searchAndPlay() {
    if (!deviceIdRef.current) return;
    setIsSearching(true);
    try {
      const searchRes = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(moodSentence)}&type=playlist&limit=1`,
        { headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      if (!searchRes.ok) throw new Error("Spotify search failed");
      const searchData = (await searchRes.json()) as {
        playlists?: { items: { uri: string }[] };
      };
      const contextUri = searchData.playlists?.items?.[0]?.uri;
      if (!contextUri) throw new Error("No playlist found for this mood");
      const playRes = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${tokenRef.current}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ context_uri: contextUri }),
        },
      );
      if (!playRes.ok && playRes.status !== 204) {
        const err = (await playRes.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? "Playback failed");
      }
      hasStartedRef.current = true;
    } catch (err) {
      setSpotifyError(err instanceof Error ? err.message : "Playback failed");
      setSpotifyState("error");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSpotifyToggle() {
    if (!hasStartedRef.current) await searchAndPlay();
    else await playerRef.current?.togglePlay();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const isPlaying = isYoutube
    ? audioState === "playing"
    : spotifyState === "playing";

  const eyebrowText = bgFailed
    ? "Mood"
    : bgLoaded
      ? "Mood"
      : "Generating image…";

  return (
    <section className="playback-screen">
      {/* Animated gradient shown while AI image loads */}
      <div className="playback-loading-bg" />

      {/* AI-generated backdrop fades in over the gradient */}
      {bgSrc && (
        <img
          ref={bgImgRef}
          className={`playback-bg${bgLoaded ? " loaded" : ""}`}
          src={bgSrc}
          alt=""
          aria-hidden="true"
          onLoad={handleBgLoad}
          onError={handleBgError}
        />
      )}
      <div className="playback-scrim" />

      <div className="playback-content">
        {/* Mood header */}
        <div className="playback-mood-header">
          <p className="mood-eyebrow">{eyebrowText}</p>
          <p className="mood-headline">{moodSentence}</p>
        </div>

        {/* Controls */}
        <div className="playback-center">
          {isYoutube ? (
            <>
              <audio
                ref={audioRef}
                onEnded={() => setAudioState("ready")}
                onError={() => {
                  setAudioError(
                    "Playback error — the stream may have expired. Go back and try again.",
                  );
                  setAudioState("error");
                }}
              />
              {audioState === "loading" && (
                <p className="playback-status">
                  Downloading audio for your mood…
                </p>
              )}
              {audioState === "error" && (
                <div className="playback-error-block">
                  <p className="playback-error">{audioError}</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setAudioState("loading");
                      setRetryCount((n) => n + 1);
                    }}
                  >
                    Try again
                  </button>
                </div>
              )}
              {(audioState === "ready" || audioState === "playing") && (
                <button
                  type="button"
                  className={`play-fab${isPlaying ? " playing" : ""}`}
                  onClick={toggleYoutubePlay}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  <span className="material-symbols-rounded play-fab-icon">
                    {isPlaying ? "pause" : "play_arrow"}
                  </span>
                </button>
              )}
            </>
          ) : (
            <>
              {spotifyState === "loading" && (
                <p className="playback-status">Connecting to Spotify…</p>
              )}
              {spotifyState === "error" && (
                <div className="playback-error-block">
                  <p className="playback-error">{spotifyError}</p>
                  {isPremiumError && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        openUrl(moodToUrl(moodSentence, "spotify"))
                      }
                    >
                      Open in Spotify instead
                    </button>
                  )}
                </div>
              )}
              {(spotifyState === "ready" ||
                spotifyState === "playing" ||
                spotifyState === "paused") && (
                <>
                  {currentTrack && (
                    <div className="track-info">
                      <span className="track-name">{currentTrack.name}</span>
                      <span className="track-artist">
                        {currentTrack.artist}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    className={`play-fab${spotifyState === "playing" ? " playing" : ""}`}
                    onClick={handleSpotifyToggle}
                    disabled={isSearching}
                    aria-label={spotifyState === "playing" ? "Pause" : "Play"}
                  >
                    <span className="material-symbols-rounded play-fab-icon">
                      {isSearching
                        ? "more_horiz"
                        : spotifyState === "playing"
                          ? "pause"
                          : "play_arrow"}
                    </span>
                  </button>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="playback-footer">
          <button
            type="button"
            className="playback-edit-btn"
            onClick={goToMood}
          >
            <span className="material-symbols-rounded">edit</span>
            Edit mood
          </button>
        </div>
      </div>
    </section>
  );
}
