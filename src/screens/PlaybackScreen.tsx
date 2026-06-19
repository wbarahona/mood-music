import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../context/AppContext";
import { sharedAudio, audioPlayerState } from "../utils/audioPlayer";
import { refreshSpotifyTokens } from "../utils/spotifyAuth";
import { openUrl } from "../utils/openUrl";
import { moodToUrl } from "../utils/moodToUrl";
import { applyM3ThemeFromImage, applyM3Theme } from "../utils/theme";
import { ParticleField } from "../components/ParticleField";

type SpotifyState = "loading" | "ready" | "playing" | "paused" | "error";

export function PlaybackScreen() {
  const {
    service,
    moodSentence,
    clientId,
    spotifyTokens,
    setSpotifyTokens,
    goToMood,
    audioStreamUrl,
    streamError,
    retryAudioStream,
    imageSettings,
  } = useApp();

  const isYoutube = service === "youtube";

  // ── Local AI background ────────────────────────────────────────────────────
  const bgImgRef = useRef<HTMLImageElement>(null);
  const [bgSrc, setBgSrc] = useState<string | null>(null);
  const [bgLoaded, setBgLoaded] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);

  useEffect(() => {
    setBgLoaded(false);
    setBgFailed(false);
    setBgSrc(null);
    applyM3Theme();

    let cancelled = false;
    invoke<string>("generate_image_local", {
      prompt: moodSentence,
      steps: imageSettings.steps,
      cfgScale: imageSettings.cfgScale,
      scheduler: imageSettings.scheduler,
    })
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
    if (bgImgRef.current) applyM3ThemeFromImage(bgImgRef.current);
  }

  function handleBgError() {
    setBgFailed(true);
    applyM3Theme();
  }

  // ── YouTube audio state ────────────────────────────────────────────────────
  //
  // Uses sharedAudio (module-level singleton) so playback survives
  // PlaybackScreen unmounting when the user navigates to the mood editor.
  //
  // Phase machine:
  //   "local"   → playing a bundled MP3 immediately on mount
  //   "youtube" → playing the yt-dlp stream
  //
  // Pre-fetch starts the moment YouTube begins playing and at T-20s as a
  // safety net. On track end the pre-fetched URL plays immediately; if not
  // ready yet we bridge with a local track and switch the moment it arrives.

  const [audioPlaying, setAudioPlaying] = useState(() => !sharedAudio.paused);
  const [playError, setPlayError] = useState("");
  const [_, setPhase] = useState<"local" | "youtube">(
    () => audioPlayerState.phase,
  );

  const phaseRef = useRef<"local" | "youtube">(audioPlayerState.phase);
  const audioStreamUrlRef = useRef<string | null>(null);
  useEffect(() => {
    audioStreamUrlRef.current = audioStreamUrl;
  }, [audioStreamUrl]);

  const nextStreamUrlRef = useRef<string | null>(audioPlayerState.nextUrl);
  const prefetchingRef = useRef(false);
  const seedRef = useRef(0);

  const waitingForFirstRef = useRef(false);
  const waitingForNextRef = useRef(false);

  const [localSrc] = useState(
    () => `/defo-music/defo-music-${Math.floor(Math.random() * 4) + 1}.mp3`,
  );

  const TRACK_VARIATIONS = [
    "mix",
    "playlist",
    "session",
    "extended",
    "deep cuts",
    "vibes",
  ];

  // Stable handler refs — listeners on sharedAudio always call the latest closure
  const handleEndedRef = useRef<() => void>(() => {});
  const handleTimeupdateRef = useRef<() => void>(() => {});
  const handleErrorRef = useRef<() => void>(() => {});

  // Register / deregister listeners on the shared audio element
  useEffect(() => {
    if (!isYoutube) return;
    const onEnded = () => handleEndedRef.current();
    const onTimeupdate = () => handleTimeupdateRef.current();
    const onError = () => handleErrorRef.current();
    sharedAudio.addEventListener("ended", onEnded);
    sharedAudio.addEventListener("timeupdate", onTimeupdate);
    sharedAudio.addEventListener("error", onError);
    return () => {
      sharedAudio.removeEventListener("ended", onEnded);
      sharedAudio.removeEventListener("timeupdate", onTimeupdate);
      sharedAudio.removeEventListener("error", onError);
    };
  }, [isYoutube]);

  // On mount: resume if same mood is already playing; else start fresh
  useEffect(() => {
    if (!isYoutube) return;
    if (audioPlayerState.playingForMood === moodSentence && sharedAudio.src) {
      setAudioPlaying(!sharedAudio.paused);
      setPhase(audioPlayerState.phase);
      phaseRef.current = audioPlayerState.phase;
      nextStreamUrlRef.current = audioPlayerState.nextUrl;
      return;
    }
    audioPlayerState.playingForMood = moodSentence;
    audioPlayerState.phase = "local";
    audioPlayerState.nextUrl = null;
    phaseRef.current = "local";
    setPhase("local");
    nextStreamUrlRef.current = null;
    seedRef.current = 0;
    prefetchingRef.current = false;
    waitingForFirstRef.current = false;
    waitingForNextRef.current = false;
    playLocalTrack(localSrc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYoutube, moodSentence]);

  // When the initial YouTube URL arrives, hand off if local already ended
  useEffect(() => {
    if (!isYoutube || !audioStreamUrl) return;
    if (waitingForFirstRef.current) switchToYoutube(audioStreamUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYoutube, audioStreamUrl]);

  function prefetchNextTrack() {
    if (prefetchingRef.current || nextStreamUrlRef.current) return;
    prefetchingRef.current = true;
    seedRef.current += 1;
    const variation =
      TRACK_VARIATIONS[(seedRef.current - 1) % TRACK_VARIATIONS.length];
    invoke<string>("prepare_audio_stream", {
      query: `${moodSentence} ${variation}`,
      apiKey: clientId,
    })
      .then((url) => {
        if (waitingForNextRef.current) {
          waitingForNextRef.current = false;
          switchToYoutube(url);
        } else {
          nextStreamUrlRef.current = url;
          audioPlayerState.nextUrl = url;
        }
      })
      .catch(() => {})
      .finally(() => {
        prefetchingRef.current = false;
      });
  }

  function switchToYoutube(url: string) {
    phaseRef.current = "youtube";
    audioPlayerState.phase = "youtube";
    setPhase("youtube");
    waitingForFirstRef.current = false;
    setPlayError("");
    sharedAudio.src = url;
    sharedAudio.load();
    sharedAudio
      .play()
      .then(() => setAudioPlaying(true))
      .catch(() => setAudioPlaying(false));
    prefetchNextTrack();
  }

  function playLocalTrack(src?: string) {
    phaseRef.current = "local";
    audioPlayerState.phase = "local";
    setPhase("local");
    sharedAudio.src =
      src ?? `/defo-music/defo-music-${Math.floor(Math.random() * 4) + 1}.mp3`;
    sharedAudio.load();
    sharedAudio
      .play()
      .then(() => setAudioPlaying(true))
      .catch(() => setAudioPlaying(false));
  }

  function handleTimeUpdate() {
    if (
      phaseRef.current !== "youtube" ||
      !sharedAudio.duration ||
      !isFinite(sharedAudio.duration)
    )
      return;
    if (sharedAudio.duration - sharedAudio.currentTime <= 20)
      prefetchNextTrack();
  }
  handleTimeupdateRef.current = handleTimeUpdate;

  function handleEnded() {
    setAudioPlaying(false);
    if (phaseRef.current === "local") {
      if (audioStreamUrlRef.current) {
        switchToYoutube(audioStreamUrlRef.current);
      } else {
        waitingForFirstRef.current = true;
        playLocalTrack();
      }
    } else {
      if (nextStreamUrlRef.current) {
        const url = nextStreamUrlRef.current;
        nextStreamUrlRef.current = null;
        audioPlayerState.nextUrl = null;
        switchToYoutube(url);
      } else {
        waitingForNextRef.current = true;
        playLocalTrack();
      }
    }
  }
  handleEndedRef.current = handleEnded;

  function handleAudioError() {
    setPlayError("Stream error — please try again.");
    setAudioPlaying(false);
  }
  handleErrorRef.current = handleAudioError;

  function togglePlay() {
    if (audioPlaying) {
      sharedAudio.pause();
      setAudioPlaying(false);
    } else {
      sharedAudio
        .play()
        .then(() => setAudioPlaying(true))
        .catch(() => {
          setPlayError("Playback failed — the stream may have expired.");
          setAudioPlaying(false);
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
  const isPlaying = isYoutube ? audioPlaying : spotifyState === "playing";
  const eyebrowText = bgLoaded || bgFailed ? "Mood" : "Generating image…";

  const youtubeError = streamError || playError;

  return (
    <section className="playback-screen">
      <div
        className="playback-loading-bg"
        style={{ opacity: bgLoaded ? 0 : 1, transition: "opacity 1.4s ease" }}
      />

      <ParticleField visible={!bgLoaded} />

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
              {youtubeError && (
                <div className="playback-error-block">
                  <p className="playback-error">{youtubeError}</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setPlayError("");
                      retryAudioStream();
                    }}
                  >
                    Try again
                  </button>
                </div>
              )}
              <button
                type="button"
                className={`play-fab${isPlaying ? " playing" : ""}`}
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                <span className="material-symbols-rounded play-fab-icon">
                  {isPlaying ? "pause" : "play_arrow"}
                </span>
              </button>
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
