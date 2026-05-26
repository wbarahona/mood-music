import {
  themeFromSourceColor,
  argbFromHex,
  applyTheme as m3ApplyTheme,
  hexFromArgb,
} from "@material/material-color-utilities";

const SEED = "#9333EA";

function applyAdditionalTokens(
  theme: ReturnType<typeof themeFromSourceColor>,
  target: HTMLElement
) {
  const { neutral } = theme.palettes;
  const extra: [string, number][] = [
    ["--md-sys-color-surface-container-lowest", neutral.tone(4)],
    ["--md-sys-color-surface-container-low", neutral.tone(10)],
    ["--md-sys-color-surface-container", neutral.tone(12)],
    ["--md-sys-color-surface-container-high", neutral.tone(17)],
    ["--md-sys-color-surface-container-highest", neutral.tone(22)],
    ["--md-sys-color-surface-dim", neutral.tone(6)],
    ["--md-sys-color-surface-bright", neutral.tone(24)],
  ];
  for (const [token, argb] of extra) {
    target.style.setProperty(token, `#${hexFromArgb(argb)}`);
  }
}

export function applyM3Theme(hexColor: string = SEED) {
  const argb = argbFromHex(hexColor);
  const theme = themeFromSourceColor(argb);
  const target = document.documentElement;
  m3ApplyTheme(theme, { target, dark: true });
  applyAdditionalTokens(theme, target);
}

export async function applyM3ThemeFromImage(imgEl: HTMLImageElement): Promise<void> {
  try {
    const { themeFromImage } = await import("@material/material-color-utilities");
    const theme = await themeFromImage(imgEl);
    const target = document.documentElement;
    m3ApplyTheme(theme, { target, dark: true });
    applyAdditionalTokens(theme, target);
  } catch {
    // silently keep current theme on CORS or canvas error
  }
}

// Fetch the image as a blob, draw it on a same-origin canvas, then extract
// the dominant color. This bypasses WKWebView's crossOrigin img restrictions.
export async function applyM3ThemeFromUrl(url: string): Promise<void> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    const img = new Image();
    img.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("img load failed"));
    });

    await applyM3ThemeFromImage(img);
    URL.revokeObjectURL(objectUrl);
  } catch {
    // silently keep current theme
  }
}
