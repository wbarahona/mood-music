import { useApp } from "../context/AppContext";
import { services } from "../data/themes";

export function SetupScreen() {
  const { service, clientId, clientSecret, setService, setClientId, setClientSecret, goToMood } = useApp();

  const isSetupComplete = clientId.trim().length > 0 && clientSecret.trim().length > 0;

  return (
    <section className="card">
      <div className="section-title">Welcome to Mood Music</div>
      <p className="section-description">
        Connect a streaming service to get started. You'll need developer credentials from
        Spotify or Google to allow the app to fetch music based on your mood.
      </p>

      <div className="field-group">
        <label>Choose a streaming service</label>
        <div className="service-options">
          {services.map((option) => (
            <button
              key={option.id}
              type="button"
              className={option.id === service ? "service-button active" : "service-button"}
              onClick={() => setService(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <label>How to connect</label>
        <p className="help-text">
          {services.find((item) => item.id === service)?.help}
        </p>
      </div>

      <div className="field-grid">
        <div className="field-group">
          <label>Client ID</label>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.currentTarget.value)}
            placeholder="Enter client ID"
          />
        </div>
        <div className="field-group">
          <label>Client secret</label>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.currentTarget.value)}
            placeholder="Enter client secret"
          />
        </div>
      </div>

      <div className="actions-row">
        <button
          type="button"
          className="primary-button"
          onClick={goToMood}
          disabled={!isSetupComplete}
        >
          Continue to mood editor
        </button>
      </div>
    </section>
  );
}
