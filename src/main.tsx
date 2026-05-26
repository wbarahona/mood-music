import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyM3Theme } from "./utils/theme";

applyM3Theme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
