export type MoodToken = {
  id: string;
  label: string;
  value: string;
  options: string[];
};

export type ThemeOption = {
  id: string;
  label: string;
  description: string;
};

export type ServiceOption = "spotify" | "youtube";

export const themeOptions: ThemeOption[] = [
  { id: "imaginary", label: "Imaginary", description: "Dream-like and surreal moods." },
  { id: "painting", label: "Painting", description: "Artful, colorful, and expressive." },
  { id: "mineral", label: "Mineral", description: "Earthy, textured, grounded sounds." },
  { id: "night-terrain", label: "Night Terrain", description: "Mysterious midnight landscapes." },
];

export const themeTokens: Record<string, MoodToken[]> = {
  imaginary: [
    { id: "a", label: "surreal", value: "surreal", options: ["surreal", "dreamy", "ethereal"] },
    { id: "b", label: "cliffs", value: "cliffs", options: ["cliffs", "waves", "skies"] },
    { id: "c", label: "yellow", value: "yellow", options: ["yellow", "violet", "shadowy"] },
  ],
  painting: [
    { id: "a", label: "painterly", value: "painterly", options: ["painterly", "bold", "soft"] },
    { id: "b", label: "brushstrokes", value: "brushstrokes", options: ["brushstrokes", "textures", "glows"] },
    { id: "c", label: "warm", value: "warm", options: ["warm", "cool", "luminous"] },
  ],
  mineral: [
    { id: "a", label: "crystalline", value: "crystalline", options: ["crystalline", "rough", "polished"] },
    { id: "b", label: "terrain", value: "terrain", options: ["terrain", "canyon", "beds"] },
    { id: "c", label: "golden", value: "golden", options: ["golden", "iron", "glittering"] },
  ],
  "night-terrain": [
    { id: "a", label: "moonlit", value: "moonlit", options: ["moonlit", "dark", "mysterious"] },
    { id: "b", label: "hills", value: "hills", options: ["hills", "valleys", "paths"] },
    { id: "c", label: "midnight", value: "midnight", options: ["midnight", "twilight", "velvet"] },
  ],
};

export const services: { id: ServiceOption; label: string; help: string }[] = [
  {
    id: "spotify",
    label: "Spotify",
    help: "Use your Spotify developer app credentials to connect and fetch mood-based music.",
  },
  {
    id: "youtube",
    label: "YouTube Music",
    help: "Use Google Cloud / YouTube API credentials to connect and fetch mood-based music results.",
  },
];
