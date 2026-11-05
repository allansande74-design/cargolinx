import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Boundary from "./Boundary.jsx";
import { watchForFailures } from "./lib/report.js";
import "./styles.css";
import "./landing.css";
import "./shell.css";

watchForFailures("desk");

// A crash screen that survives a route change is a trap: the old failure masks the
// new page. Key the Boundary on the address so moving to any route auto-resets it.
function Root() {
  const [routeKey, setRouteKey] = React.useState(window.location.hash || "#/");
  React.useEffect(() => {
    const onHash = () => setRouteKey(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <Boundary resetKey={routeKey}>
      <App key={routeKey} />
    </Boundary>
  );
}

createRoot(document.getElementById("root")).render(<Root />);
