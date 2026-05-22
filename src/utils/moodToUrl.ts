import type { ServiceOption } from "../data/themes";

export function moodToUrl(sentence: string, service: ServiceOption): string {
  const q = encodeURIComponent(sentence);
  if (service === "spotify") {
    return `https://open.spotify.com/search/${q}`;
  }
  return `https://music.youtube.com/search?q=${q}`;
}
