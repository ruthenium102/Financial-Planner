import React from "react";

// Top-level error boundary. A render error anywhere in the tree would otherwise
// blank the screen with no recovery. Here we catch it and show a calm fallback
// that reassures the user their data is still safe in localStorage, plus a way
// to recover (reload) and the error details for debugging.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface to the console so it's visible in dev tools / native logs.
    console.error("Render error caught by ErrorBoundary:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          background: "#0B0D10",
          color: "#E8E6E1",
          fontFamily: "Inter Tight, system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 520, width: "100%" }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#C96B6B",
              marginBottom: 12,
            }}
          >
            Something broke
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 12px" }}>
            The Ledger hit an unexpected error
          </h1>
          <p style={{ color: "#8A8F97", lineHeight: 1.6, margin: "0 0 20px" }}>
            Your scenarios are still saved locally (and in the cloud if you're
            signed in) — nothing has been lost. Reloading usually clears this.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#D4A574",
                color: "#0B0D10",
                border: "none",
                borderRadius: 4,
                padding: "10px 18px",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Reload app
            </button>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                background: "transparent",
                color: "#E8E6E1",
                border: "1px solid #2E3640",
                borderRadius: 4,
                padding: "10px 18px",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Try again
            </button>
          </div>
          <details style={{ color: "#5A6069", fontSize: 12 }}>
            <summary style={{ cursor: "pointer" }}>Error details</summary>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                marginTop: 10,
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
                color: "#8A8F97",
              }}
            >
              {String(error?.stack || error?.message || error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
