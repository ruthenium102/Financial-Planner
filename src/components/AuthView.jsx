import { useState } from "react";
import { C, VERSION } from "../theme.js";
import { supabase } from "../storage.js";

// =================================================================
// AuthView — sign in / sign up screen, shown when not authenticated
// =================================================================
function AuthView({ onSignedIn }) {
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSignedIn?.();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user && !data.session) {
          setInfo("Check your email for a confirmation link, then come back and sign in.");
        } else {
          onSignedIn?.();
        }
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setInfo("If an account exists for that email, a reset link has been sent.");
      }
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    background: "#0f0d0a", border: `1px solid ${C.line}`, color: C.text,
    padding: "10px 12px", fontSize: 13, width: "100%", boxSizing: "border-box",
    fontFamily: "Inter Tight",
  };

  // Link-styled buttons (real buttons so they're keyboard-focusable)
  const authLinkStyle = {
    background: "none", border: "none", padding: 0, font: "inherit",
    color: C.accent, cursor: "pointer", textDecoration: "underline",
  };

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: "'Inter Tight', system-ui, sans-serif",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <style>{`
        body { margin: 0; }
        .serif { font-family: 'EB Garamond', Georgia, serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        select, input { font-family: 'Inter Tight', system-ui, sans-serif; }
        input:focus { outline: none; border-color: ${C.accent}; }
      `}</style>
      <div style={{
        background: C.panel, border: `1px solid ${C.line}`, padding: "40px 36px",
        maxWidth: 380, width: "100%",
      }}>
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "baseline", gap: 10 }}>
            <div className="serif" style={{ fontSize: 30, fontStyle: "italic", fontWeight: 500, letterSpacing: "-0.01em" }}>
              The Ledger
            </div>
            <div className="mono" style={{ fontSize: 10, color: C.textMute, letterSpacing: "0.1em", opacity: 0.6 }}>{VERSION}</div>
          </div>
          <div style={{ color: C.textMute, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 6 }}>
            Long-range financial scenarios
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
              Email
            </div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={inputStyle}
            />
          </div>
          {mode !== "forgot" && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: C.textMute, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
                Password
              </div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                style={inputStyle}
              />
              {mode === "signup" && (
                <div style={{ fontSize: 10, color: C.textMute, marginTop: 6 }}>
                  Minimum 6 characters
                </div>
              )}
            </div>
          )}
          {error && (
            <div style={{ background: "#2a1818", border: `1px solid ${C.danger}`, color: C.danger, padding: "8px 10px", fontSize: 11, marginBottom: 12 }}>
              {error}
            </div>
          )}
          {info && (
            <div style={{ background: "#1a2418", border: `1px solid ${C.good}`, color: C.good, padding: "8px 10px", fontSize: 11, marginBottom: 12 }}>
              {info}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%", padding: "10px 14px", background: C.accent, color: C.bg,
              border: "none", fontSize: 12, letterSpacing: "0.05em",
              textTransform: "uppercase", cursor: busy ? "wait" : "pointer",
              fontFamily: "Inter Tight", fontWeight: 500,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Working…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: 11, color: C.textMute, textAlign: "center" }}>
          {mode === "signin" && (
            <>
              <button type="button" onClick={() => { setMode("signup"); setError(null); setInfo(null); }} style={authLinkStyle}>Create account</button>
              <span style={{ margin: "0 8px" }}>·</span>
              <button type="button" onClick={() => { setMode("forgot"); setError(null); setInfo(null); }} style={authLinkStyle}>Forgot password?</button>
            </>
          )}
          {mode !== "signin" && (
            <button type="button" onClick={() => { setMode("signin"); setError(null); setInfo(null); }} style={authLinkStyle}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { AuthView };
