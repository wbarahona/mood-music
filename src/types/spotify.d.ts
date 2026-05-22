// Minimal type declarations for the Spotify Web Playback SDK
// https://developer.spotify.com/documentation/web-playback-sdk

interface Window {
  Spotify: typeof Spotify;
  onSpotifyWebPlaybackSDKReady: () => void;
}

declare namespace Spotify {
  interface PlayerOptions {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }

  interface WebPlaybackError {
    message: string;
  }

  interface WebPlaybackInstance {
    device_id: string;
  }

  interface WebPlaybackTrack {
    id: string;
    uri: string;
    name: string;
    artists: { name: string; uri: string }[];
    album: { name: string; uri: string; images: { url: string }[] };
    duration_ms: number;
  }

  interface WebPlaybackState {
    paused: boolean;
    position: number;
    duration: number;
    track_window: {
      current_track: WebPlaybackTrack;
      previous_tracks: WebPlaybackTrack[];
      next_tracks: WebPlaybackTrack[];
    };
  }

  class Player {
    constructor(options: PlayerOptions);
    connect(): Promise<boolean>;
    disconnect(): void;
    togglePlay(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    nextTrack(): Promise<void>;
    previousTrack(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    getVolume(): Promise<number>;
    setVolume(volume: number): Promise<void>;
    getCurrentState(): Promise<WebPlaybackState | null>;
    addListener(event: "ready", cb: (instance: WebPlaybackInstance) => void): boolean;
    addListener(event: "not_ready", cb: (instance: WebPlaybackInstance) => void): boolean;
    addListener(event: "player_state_changed", cb: (state: WebPlaybackState | null) => void): boolean;
    addListener(event: "initialization_error" | "authentication_error" | "account_error" | "playback_error", cb: (error: WebPlaybackError) => void): boolean;
    removeListener(event: string, cb?: (...args: unknown[]) => void): boolean;
  }
}
