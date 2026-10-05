import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";
import "./styles/motion.css";
import "./styles/depth.css";
import "./styles/kinds.css";
import App from "./App";
import { startBootClock } from "./boot";
import { applyTheme, readTheme } from "./theme";

applyTheme(readTheme());
startBootClock();

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
