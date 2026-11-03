import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Boundary from "./Boundary.jsx";
import { watchForFailures } from "./lib/report.js";
import "./styles.css";
import "./landing.css";
import "./shell.css";

watchForFailures("desk");

createRoot(document.getElementById("root")).render(
  <Boundary>
    <App />
  </Boundary>,
);
