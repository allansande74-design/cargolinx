import React from "react";
import { reportError } from "./lib/report.js";

// A screen that breaks should say so in English and offer a way back, and the failure should be
// recorded. Nothing here hides the fault; it just stops a blank white page from being the answer.
export default class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, key: props.resetKey || null };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== undefined && props.resetKey !== state.key) {
      return { failed: false, key: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error, info) {
    const frame = String(info?.componentStack || "").split("\n").find((line) => line.trim().startsWith("at"));
    reportError(error, `react ${String(frame || "").trim().slice(0, 80)}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0d1b2a",
          color: "#e8eef6",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "left" }}>
          <div style={{ fontSize: 12, letterSpacing: 1.2, color: "#8fb3d9", textTransform: "uppercase" }}>
            Altovex CargoLinx
          </div>
          <h1 style={{ fontSize: 24, margin: "10px 0 8px" }}>This screen stopped working</h1>
          <p style={{ color: "#b9c9da", lineHeight: 1.55, margin: "0 0 18px" }}>
            The fault has been recorded for the desk owner. What you typed is kept on this device, so
            reloading picks up where you left off — nothing you entered is lost.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#f0a02a",
              color: "#1b1206",
              border: 0,
              borderRadius: 10,
              padding: "12px 20px",
              fontSize: 15,
              fontWeight: 600,
              minHeight: 44,
              cursor: "pointer",
            }}
          >
            Reload the desk
          </button>
        </div>
      </div>
    );
  }
}
