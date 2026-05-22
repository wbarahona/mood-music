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
  gradient: string;
  accentColor: string;
};

export type ServiceOption = "spotify" | "youtube";

export const themeOptions: ThemeOption[] = [
  {
    id: "imaginary",
    label: "Imaginary",
    description: "Dream-like and surreal moods.",
    gradient: "linear-gradient(150deg, #0d0221 0%, #1a0a4f 40%, #0f1f5c 70%, #061225 100%)",
    accentColor: "#7b5ea7",
  },
  {
    id: "painting",
    label: "Painting",
    description: "Artful, colorful, and expressive.",
    gradient: "linear-gradient(150deg, #1a0800 0%, #5c1e00 35%, #9c4400 65%, #6b3300 100%)",
    accentColor: "#c45c00",
  },
  {
    id: "mineral",
    label: "Mineral",
    description: "Earthy, textured, grounded sounds.",
    gradient: "linear-gradient(150deg, #0e0b08 0%, #2d1a0a 35%, #5c3010 60%, #7a4f00 100%)",
    accentColor: "#8b6914",
  },
  {
    id: "night-terrain",
    label: "Night Terrain",
    description: "Mysterious midnight landscapes.",
    gradient: "linear-gradient(150deg, #020408 0%, #060d1f 40%, #0a1530 70%, #050c1e 100%)",
    accentColor: "#1f4a8a",
  },
];

// Token values intentionally embed prepositions so the joined sentence reads naturally.
// e.g. imaginary → "surreal cliffs in violet haze at dusk"
export const themeTokens: Record<string, MoodToken[]> = {
  imaginary: [
    { id: "a", label: "mood", value: "surreal", options: ["surreal", "dreamy", "ethereal", "haunting", "still"] },
    { id: "b", label: "landscape", value: "cliffs", options: ["cliffs", "waves", "skies", "ruins", "fields"] },
    { id: "c", label: "shade", value: "in violet", options: ["in violet", "in golden", "in silver", "in shadow", "in pale blue"] },
    { id: "d", label: "texture", value: "haze", options: ["haze", "mist", "glow", "fog", "shimmer"] },
    { id: "e", label: "moment", value: "at dusk", options: ["at dusk", "at dawn", "at midnight", "in silence", "in the rain"] },
  ],
  painting: [
    { id: "a", label: "style", value: "bold", options: ["bold", "soft", "loose", "thick", "fine"] },
    { id: "b", label: "subject", value: "brushstrokes", options: ["brushstrokes", "textures", "shapes", "forms", "layers"] },
    { id: "c", label: "palette", value: "with warm", options: ["with warm", "with cool", "with muted", "with vivid", "with rich"] },
    { id: "d", label: "texture", value: "depth", options: ["depth", "rhythm", "motion", "weight", "grain"] },
    { id: "e", label: "light", value: "in golden light", options: ["in golden light", "in soft light", "in sharp light", "in dim light", "in clear light"] },
  ],
  mineral: [
    { id: "a", label: "surface", value: "crystalline", options: ["crystalline", "rough", "polished", "fractured", "smooth"] },
    { id: "b", label: "terrain", value: "canyon", options: ["canyon", "terrain", "beds", "cliffs", "flats"] },
    { id: "c", label: "vein", value: "veined with amber", options: ["veined with amber", "veined with iron", "veined with quartz", "veined with silver", "veined with obsidian"] },
    { id: "d", label: "mood", value: "in still", options: ["in still", "in cold", "in pale", "in warm", "in harsh"] },
    { id: "e", label: "light", value: "light", options: ["light", "glow", "shade", "dark", "gleam"] },
  ],
  "night-terrain": [
    { id: "a", label: "light", value: "moonlit", options: ["moonlit", "dark", "dim", "stark", "cold"] },
    { id: "b", label: "landscape", value: "hills", options: ["hills", "valleys", "paths", "ridges", "terrain"] },
    { id: "c", label: "sky", value: "under vast sky", options: ["under vast sky", "under stormy sky", "under clear sky", "under heavy sky", "under open sky"] },
    { id: "d", label: "depth", value: "in deep", options: ["in deep", "in hollow", "in quiet", "in endless", "in vast"] },
    { id: "e", label: "mood", value: "silence", options: ["silence", "darkness", "space", "calm", "drift"] },
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
    help: "Use a YouTube Data API v3 key from Google Cloud Console to search for music.",
  },
];
