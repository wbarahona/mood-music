import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

// Uses Tauri's native opener inside the desktop app, falls back to window.open in browser dev mode.
export async function openUrl(url: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    await tauriOpenUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
