import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type ModelPhase =
  | "checking"
  | "ready"
  | "needs_download"
  | "downloading"
  | "extracting"
  | "compiling"
  | "error";

function formatBytes(bytes: number) {
  const gb = bytes / 1024 ** 3;
  if (gb >= 0.1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function compileLabel(msg: string) {
  if (msg.includes("compiling TextEncoder")) return "Compiling text encoder…";
  if (msg.includes("compiling UnetChunk1")) return "Compiling UNet part 1…";
  if (msg.includes("compiling UnetChunk2")) return "Compiling UNet part 2…";
  if (msg.includes("compiling VAEDecoder")) return "Compiling image decoder…";
  if (msg.includes("all models ready")) return "Finalizing…";
  return msg.replace("[sd-swift] ", "");
}

interface Props {
  onReady: () => void;
}

export function ModelStatusPanel({ onReady }: Props) {
  const [phase, setPhase] = useState<ModelPhase>("checking");
  const [percent, setPercent] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [compileMsg, setCompileMsg] = useState("");
  const [error, setError] = useState("");
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    listen<{ percent: number; downloaded: number; total: number; status?: string }>(
      "model-download-progress",
      (e) => {
        setPercent(e.payload.percent);
        setDownloaded(e.payload.downloaded);
        setTotal(e.payload.total);
        setPhase(e.payload.status === "extracting" ? "extracting" : "downloading");
      },
    ).then((fn) => unsubs.push(fn));

    listen<{ message: string }>("model-compile-progress", (e) => {
      setCompileMsg(compileLabel(e.payload.message));
    }).then((fn) => unsubs.push(fn));

    async function init() {
      const [compiled, dled] = await Promise.all([
        invoke<boolean>("check_model").catch(() => false),
        invoke<boolean>("is_model_downloaded").catch(() => false),
      ]);
      if (compiled) {
        setPhase("ready");
        onReadyRef.current();
      } else if (dled) {
        runCompile();
      } else {
        setPhase("needs_download");
      }
    }

    init();
    return () => unsubs.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runCompile() {
    setPhase("compiling");
    setCompileMsg("Starting…");
    try {
      await invoke("compile_models");
      setPhase("ready");
      onReadyRef.current();
    } catch (e) {
      setError(typeof e === "string" ? e : "Compilation failed — restart the app to retry.");
      setPhase("error");
    }
  }

  async function startDownload() {
    setPhase("downloading");
    setError("");
    setPercent(0);
    setDownloaded(0);
    setTotal(0);
    try {
      await invoke("download_model");
      await runCompile();
    } catch (e) {
      setError(typeof e === "string" ? e : "Download failed — check your connection.");
      setPhase("error");
    }
  }

  const isBusy = phase === "downloading" || phase === "extracting" || phase === "compiling";
  const showBar = isBusy || phase === "ready";

  return (
    <div className={`model-status-panel${phase === "ready" ? " ready" : ""}`}>
      <div className="model-status-row">
        <span className="material-symbols-rounded model-status-icon">
          {phase === "ready" ? "check_circle" : phase === "error" ? "error" : "auto_awesome"}
        </span>

        <div className="model-status-body">
          <span className="model-status-label">
            {phase === "checking" && "Checking AI model…"}
            {phase === "ready" && "AI model ready"}
            {phase === "needs_download" && "AI image model — one-time download"}
            {phase === "downloading" && (
              <>
                Downloading model
                {total > 0 && (
                  <span className="model-status-sub">
                    {" "}{formatBytes(downloaded)} / {formatBytes(total)}
                  </span>
                )}
              </>
            )}
            {phase === "extracting" && "Extracting model files…"}
            {phase === "compiling" && (
              <>
                Compiling for Apple Silicon
                {compileMsg && (
                  <span className="model-status-sub"> — {compileMsg}</span>
                )}
              </>
            )}
            {phase === "error" && (
              <span className="model-status-error">{error}</span>
            )}
          </span>

          {showBar && (
            <div className="model-status-bar">
              <div
                className={`model-status-fill${phase === "ready" ? " done" : isBusy && phase !== "downloading" ? " indeterminate" : ""}`}
                style={phase === "downloading" && total > 0 ? { width: `${percent}%` } : undefined}
              />
            </div>
          )}
        </div>

        {phase === "needs_download" && (
          <button
            type="button"
            className="model-status-dl-btn"
            onClick={startDownload}
          >
            <span className="material-symbols-rounded">download</span>
            Download
          </button>
        )}

        {phase === "error" && (
          <button
            type="button"
            className="model-status-dl-btn"
            onClick={startDownload}
          >
            Retry
          </button>
        )}
      </div>

      {phase === "needs_download" && (
        <p className="model-status-hint">
          ~1.5 GB · DreamShaper 8 · Apple Neural Engine · one-time · fully offline after
        </p>
      )}
      {phase === "compiling" && (
        <p className="model-status-hint">
          Compiling takes 5–10 min and only happens once.
        </p>
      )}
    </div>
  );
}
