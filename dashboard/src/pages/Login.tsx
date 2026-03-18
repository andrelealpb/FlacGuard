import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";

function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((res) => {
        // 403 means users exist → show login. 400 means no users → show setup
        setIsSetup(res.status === 400);
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao fazer login");
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, full_name: fullName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Setup done, now login
      await login(email, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro no setup");
    } finally {
      setLoading(false);
    }
  };

  if (checking) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1a1a2e",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <form
        onSubmit={isSetup ? handleSetup : handleLogin}
        style={{
          background: "#fff",
          padding: "2.5rem",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "380px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
        <h1 style={{ margin: "0 0 0.25rem", fontSize: "1.5rem", color: "#1a1a2e" }}>
          Flac Guard
        </h1>
        <p style={{ margin: "0 0 1.5rem", color: "#666", fontSize: "0.875rem" }}>
          {isSetup ? "Configure o primeiro administrador" : "Faça login para acessar o painel"}
        </p>

        {error && (
          <div
            style={{
              padding: "0.75rem",
              background: "#ffebee",
              color: "#c62828",
              borderRadius: "6px",
              marginBottom: "1rem",
              fontSize: "0.875rem",
            }}
          >
            {error}
          </div>
        )}

        {isSetup && (
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 600 }}>
              Nome completo
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "0.6rem",
                border: "1px solid #ddd",
                borderRadius: "6px",
                fontSize: "0.875rem",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 600 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: "100%",
              padding: "0.6rem",
              border: "1px solid #ddd",
              borderRadius: "6px",
              fontSize: "0.875rem",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 600 }}>
            Senha
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              width: "100%",
              padding: "0.6rem",
              border: "1px solid #ddd",
              borderRadius: "6px",
              fontSize: "0.875rem",
              boxSizing: "border-box",
            }}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "0.75rem",
            background: loading ? "#999" : "#1a1a2e",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Aguarde..." : isSetup ? "Criar Admin" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

export default Login;
