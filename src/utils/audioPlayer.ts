// Single Audio instance that persists across PlaybackScreen mount/unmount cycles.
// Using new Audio() (not a DOM element) means it keeps playing even when the
// component that controls it navigates away.
export const sharedAudio = new Audio();

// Minimal persistent state so PlaybackScreen can restore itself on re-mount.
export const audioPlayerState = {
  phase: "local" as "local" | "youtube",
  nextUrl: null as string | null,
  playingForMood: "",
};
