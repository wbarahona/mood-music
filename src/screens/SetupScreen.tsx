import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import type { ServiceOption } from "../data/themes";
import { services } from "../data/themes";
import { serviceIcons } from "../utils/serviceIcons";
import { openUrl } from "../utils/openUrl";
import { startSpotifyOAuth } from "../utils/spotifyAuth";
import { ModelStatusPanel } from "../components/ModelStatusPanel";

type Step = 1 | 2 | 3;
type CredState = "question" | "tutorial" | "form";

const accountTutorials: Record<
  ServiceOption,
  { url: string; linkLabel: string; steps: string[] }
> = {
  spotify: {
    url: "https://www.spotify.com/signup",
    linkLabel: "Open Spotify Signup",
    steps: [
      "Click the button below to open the Spotify signup page.",
      "Create a free account — you do not need Spotify Premium to set up the app.",
      "Verify your email address when prompted.",
      'Come back here and click "I have an account" below.',
    ],
  },
  youtube: {
    url: "https://accounts.google.com/signup",
    linkLabel: "Open Google Account Signup",
    steps: [
      "Click the button below to open the Google account creation page.",
      "Fill in your name, choose a Gmail address, and set a password.",
      "Complete the phone or email verification step.",
      'Come back here and click "I have an account" below.',
    ],
  },
};

const credTutorials: Record<
  ServiceOption,
  { url: string; linkLabel: string; steps: string[] }
> = {
  spotify: {
    url: "https://developer.spotify.com/dashboard",
    linkLabel: "Open Spotify Developer Dashboard",
    steps: [
      "Click the button below to open the Spotify Developer Dashboard and log in.",
      'Click "Create app" in the top-right corner.',
      'Fill in App name: "Mood Music". Add Redirect URI: http://localhost:8888/callback.',
      'Check the Developer Terms of Service box, then click "Save".',
      "On your new app's page, copy the Client ID shown at the top.",
      "No client secret is needed — we use the secure PKCE flow.",
    ],
  },
  youtube: {
    url: "https://console.cloud.google.com",
    linkLabel: "Open Google Cloud Console",
    steps: [
      "Click the button below to open Google Cloud Console and sign in.",
      'Click "Select a project" → "New Project" → name it "Mood Music" → Create.',
      "In the left menu, go to: APIs & Services → Library.",
      'Search "YouTube Data API v3", click it, then click "Enable".',
      "Go to: APIs & Services → Credentials → Create Credentials → API key.",
      "Copy the generated API key — paste it into the field above.",
    ],
  },
};

function WizardProgress({ step }: { step: Step }) {
  return (
    <div className="wizard-progress">
      {([1, 2, 3] as Step[]).map((n, i) => (
        <span key={n} style={{ display: "contents" }}>
          {i > 0 && (
            <span className={`wizard-line${step > n - 1 ? " done" : ""}`} />
          )}
          <span
            className={`wizard-dot${step === n ? " active" : step > n ? " done" : ""}`}
          >
            {step > n ? "✓" : n}
          </span>
        </span>
      ))}
    </div>
  );
}

function TutorialSteps({
  steps,
  url,
  linkLabel,
}: {
  steps: string[];
  url: string;
  linkLabel: string;
}) {
  return (
    <>
      <ol className="tutorial-step-list">
        {steps.map((text, i) => (
          <li key={i} className="tutorial-step-item">
            <span className="tutorial-step-num">{i + 1}</span>
            <span className="tutorial-step-text">{text}</span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="link-button"
        onClick={() => openUrl(url)}
      >
        <span className="material-symbols-rounded">open_in_new</span>{" "}
        {linkLabel}
      </button>
    </>
  );
}

function SpotifyConnectForm({
  clientId,
  onClientIdChange,
  onConnect,
  isConnecting,
  connectError,
  modelReady,
}: {
  clientId: string;
  onClientIdChange: (v: string) => void;
  onConnect: () => void;
  isConnecting: boolean;
  connectError: string;
  modelReady: boolean;
}) {
  const isValid = clientId.trim().length > 0;
  return (
    <>
      <div className="divider" />
      <div className="cred-form-title">Enter your Spotify Client ID</div>
      <div className="field-grid">
        <div className="field-group">
          <label>Client ID</label>
          <input
            value={clientId}
            onChange={(e) => onClientIdChange(e.currentTarget.value)}
            placeholder="Paste client ID here"
            disabled={isConnecting}
          />
        </div>
      </div>
      {connectError && (
        <p className="playback-error" style={{ marginTop: "8px" }}>
          {connectError}
        </p>
      )}
      {isConnecting && (
        <p className="oauth-hint">
          Waiting for Spotify authorization in your browser…
        </p>
      )}
      <div className="actions-row" style={{ flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          className="primary-button"
          onClick={onConnect}
          disabled={!isValid || isConnecting || !modelReady}
        >
          {isConnecting ? "Connecting…" : "Connect with Spotify"}
        </button>
        {!modelReady && (
          <p className="model-cta-hint">Waiting for AI model…</p>
        )}
      </div>
    </>
  );
}

export function SetupScreen() {
  const {
    service: savedService,
    clientId: savedClientId,
    commitCredentials,
    setSpotifyTokens,
    goToMood,
  } = useApp();

  const [localService, setLocalService] = useState<ServiceOption>(savedService);
  const [localClientId, setLocalClientId] = useState(savedClientId);

  const [step, setStep] = useState<Step>(1);
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [credState, setCredState] = useState<CredState>("question");
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [showYtInstructions, setShowYtInstructions] = useState(false);

  const [modelReady, setModelReady] = useState(false);
  const [credsSaved, setCredsSaved] = useState(false);

  // Auto-navigate once both model and credentials are ready
  useEffect(() => {
    if (modelReady && credsSaved) goToMood();
  }, [modelReady, credsSaved, goToMood]);

  const serviceName = localService === "spotify" ? "Spotify" : "YouTube Music";
  const accountTutorial = accountTutorials[localService];
  const credTutorial = credTutorials[localService];

  function handleServiceChange(next: ServiceOption) {
    setLocalService(next);
    setHasAccount(null);
    setCredState("question");
    setConnectError("");
  }

  function handleHasAccount(yes: boolean) {
    setHasAccount(yes);
    if (yes) setStep(3);
  }

  function handleStep1Continue() {
    if (localService === "youtube") {
      commitCredentials("youtube", localClientId.trim(), "");
      setCredsSaved(true);
    } else {
      setStep(2);
    }
  }

  async function handleSpotifyConnect() {
    if (!localClientId.trim()) return;
    setIsConnecting(true);
    setConnectError("");
    try {
      const tokens = await startSpotifyOAuth(localClientId.trim());
      commitCredentials("spotify", localClientId.trim(), "");
      setSpotifyTokens(tokens);
      setCredsSaved(true);
    } catch (err) {
      setConnectError(
        err instanceof Error
          ? err.message
          : "Connection failed. Please try again.",
      );
    } finally {
      setIsConnecting(false);
    }
  }

  function goBack() {
    if (step === 3) {
      setStep(2);
      setHasAccount(null);
      setCredState("question");
      setConnectError("");
    } else if (step === 2) {
      setStep(1);
      setHasAccount(null);
    }
  }

  const ctaDisabled = !modelReady;
  const ctaHint = !modelReady ? "Waiting for AI model…" : null;

  return (
    <section className="card">
      <ModelStatusPanel onReady={() => setModelReady(true)} />
      <div className="divider" style={{ margin: "16px 0" }} />

      {/* ── Step 1: Pick a service ── */}
      {step === 1 && (
        <>
          <div className="section-title">Welcome to Mood Music</div>
          <p className="section-description">
            This app builds a mood sentence and uses it to find music that
            matches how you feel. Choose the streaming service you'd like to
            connect.
          </p>
          <div className="field-group">
            <div className="service-options">
              {services.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-service={option.id}
                  className={
                    option.id === localService
                      ? "service-button active"
                      : "service-button"
                  }
                  onClick={() => handleServiceChange(option.id)}
                >
                  {serviceIcons[option.id]}
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {localService === "spotify" && <WizardProgress step={step} />}

          {localService === "youtube" && (
            <>
              <div className="yt-api-key-box">
                <p className="yt-api-key-label">
                  <span className="material-symbols-rounded">bolt</span>
                  Optional: add a YouTube Data API key for faster music search
                  (~2 s vs ~12 s)
                </p>
                <div className="field-group" style={{ marginBottom: 8 }}>
                  <input
                    value={localClientId}
                    onChange={(e) => setLocalClientId(e.currentTarget.value)}
                    placeholder="AIzaSy… (leave blank to skip)"
                  />
                </div>
                <button
                  type="button"
                  className="yt-instructions-toggle"
                  onClick={() => setShowYtInstructions((v) => !v)}
                >
                  <span className="material-symbols-rounded">
                    {showYtInstructions ? "expand_less" : "expand_more"}
                  </span>
                  {showYtInstructions
                    ? "Hide instructions"
                    : "How do I get an API key?"}
                </button>
                {showYtInstructions && (
                  <div className="yt-instructions-body">
                    <TutorialSteps
                      steps={credTutorials.youtube.steps}
                      url={credTutorials.youtube.url}
                      linkLabel={credTutorials.youtube.linkLabel}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {localService === "spotify" && (
            <div className="service-inline-note">
              <span className="service-inline-note-icon">ℹ</span>
              <span>
                Spotify requires a free developer account and{" "}
                <strong>Spotify Premium</strong> for in-app audio playback.
              </span>
            </div>
          )}

          <div className="actions-row" style={{ flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className="primary-button"
              onClick={handleStep1Continue}
              disabled={localService === "youtube" ? ctaDisabled : false}
            >
              {localService === "youtube"
                ? "Get started — no sign-in needed"
                : `Continue with ${serviceName}`}
            </button>
            {localService === "youtube" && ctaHint && (
              <p className="model-cta-hint">{ctaHint}</p>
            )}
          </div>
        </>
      )}

      {/* ── Step 2: Account check ── */}
      {step === 2 && (
        <>
          <button type="button" className="back-link" onClick={goBack}>
            <span className="material-symbols-rounded">arrow_back</span> Back
          </button>
          <WizardProgress step={step} />
          <div className="section-title">
            Do you have a {serviceName} account?
          </div>

          {hasAccount === null && (
            <div className="answer-buttons">
              <button
                type="button"
                className="answer-button"
                onClick={() => handleHasAccount(true)}
              >
                <span className="answer-title">Yes, I have one</span>
                <span className="answer-desc">
                  Take me straight to the setup steps
                </span>
              </button>
              <button
                type="button"
                className="answer-button"
                onClick={() => handleHasAccount(false)}
              >
                <span className="answer-title">No, I need to create one</span>
                <span className="answer-desc">
                  Show me how to sign up for free
                </span>
              </button>
            </div>
          )}

          {hasAccount === false && (
            <>
              <p className="tutorial-intro">
                Follow these steps to create a free {serviceName} account:
              </p>
              <TutorialSteps
                steps={accountTutorial.steps}
                url={accountTutorial.url}
                linkLabel={accountTutorial.linkLabel}
              />
              <button
                type="button"
                className="primary-button"
                onClick={() => setStep(3)}
              >
                I have an account — continue
              </button>
            </>
          )}
        </>
      )}

      {/* ── Step 3: Developer credentials + OAuth ── */}
      {step === 3 && (
        <>
          <button type="button" className="back-link" onClick={goBack}>
            <span className="material-symbols-rounded">arrow_back</span> Back
          </button>
          <WizardProgress step={step} />
          <div className="section-title">
            Do you have {serviceName} developer credentials?
          </div>
          <p className="section-description">
            To search for music the app needs a Client ID from {serviceName}'s
            developer portal. This is free and takes about 5 minutes.
          </p>

          {credState === "question" && (
            <div className="answer-buttons">
              <button
                type="button"
                className="answer-button"
                onClick={() => setCredState("form")}
              >
                <span className="answer-title">Yes, I have a Client ID</span>
                <span className="answer-desc">
                  Take me to the connect screen
                </span>
              </button>
              <button
                type="button"
                className="answer-button"
                onClick={() => setCredState("tutorial")}
              >
                <span className="answer-title">No, I need to get one</span>
                <span className="answer-desc">
                  Show me how to get it for free
                </span>
              </button>
            </div>
          )}

          {credState === "tutorial" && (
            <>
              <p className="tutorial-intro">
                Follow these steps to create your free {serviceName} developer
                credentials:
              </p>
              <TutorialSteps
                steps={credTutorial.steps}
                url={credTutorial.url}
                linkLabel={credTutorial.linkLabel}
              />
              <SpotifyConnectForm
                clientId={localClientId}
                onClientIdChange={setLocalClientId}
                onConnect={handleSpotifyConnect}
                isConnecting={isConnecting}
                connectError={connectError}
                modelReady={modelReady}
              />
            </>
          )}

          {credState === "form" && (
            <SpotifyConnectForm
              clientId={localClientId}
              onClientIdChange={setLocalClientId}
              onConnect={handleSpotifyConnect}
              isConnecting={isConnecting}
              connectError={connectError}
              modelReady={modelReady}
            />
          )}
        </>
      )}
    </section>
  );
}
