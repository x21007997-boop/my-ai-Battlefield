import React from "react";
import { createRoot } from "react-dom/client";
// This entrypoint intentionally exposes the legacy political prototype and the
// battlefield migration prototype as separate surfaces. The formal game client
// is the Godot project under /godot.
import { App } from "./prototype/political/App.jsx";
import { BattlefieldPrototype } from "./prototype/battlefield/BattlefieldPrototype.jsx";
import "./styles.css";

const battleMode = new URLSearchParams(window.location.search).get("battle");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {battleMode === "fixture" || battleMode === "changping" ? <BattlefieldPrototype mode={battleMode} /> : <App />}
  </React.StrictMode>,
);
