import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

interface PulseConfig {
  api_url: string;
  email: string;
  has_password: boolean;
}

interface DeployStatus {
  status: string;
  commit?: string;
  commit_message?: string;
  commit_author?: string;
  branch?: string;
  started_at?: string;
  finished_at?: string;
  message?: string;
}

function Settings() {
  const { apiFetch, user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [pulse, setPulse] = useState<PulseConfig | null>(null);
  const [deploy, setDeploy] = useState<DeployStatus | null>(null);
  const [form, setForm] = useState({ api_url: "", email: "", password: "" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const loadDeploy = () => {
    apiFetch("/api/deploy-status")
      .then((r) => r.json())
      .then(setDeploy)
      .catch(console.error);
  };

  useEffect(() => {
    loadDeploy();
    if (!isAdmin) return;
    apiFetch("/api/settings/pulse")
      .then((r) => r.json())
      .then((data) => {
        setPulse(data);
        setForm({ api_url: data.api_url, email: data.email, password: "" });
      })
      .catch(console.error);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, string> = { api_url: form.api_url, email: form.email };
      if (form.password) body.password = form.password;

      const res = await apiFetch("/api/settings/pulse", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "ok", text: data.message });
        setPulse((prev) => prev ? { ...prev, email: form.email, api_url: form.api_url, has_password: form.password ? true : prev.has_password } : prev);
        setForm((f) => ({ ...f, password: "" }));
      } else {
        setMessage({ type: "error", text: data.error });
      }
    } catch {
      setMessage({ type: "error", text: "Erro de conexão" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/settings/pulse/test", { method: "POST" });
      const data = await res.json();
      setMessage({ type: data.ok ? "ok" : "error", text: data.message });
    } catch {
      setMessage({ type: "error", text: "Erro de conexão" });
    } finally {
      setTesting(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "0.5rem",
    borderRadius: "4px",
    border: "1px solid #ccc",
    boxSizing: "border-box" as const,
    fontSize: "0.875rem",
  };

  const labelStyle = {
    display: "block" as const,
    fontSize: "0.8rem",
    fontWeight: 600 as const,
    marginBottom: "0.25rem",
  };

  const btnStyle = {
    padding: "0.4rem 0.8rem",
    border: "1px solid #ccc",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.8rem",
    background: "#fff",
  };

  const btnPrimary = {
    ...btnStyle,
    background: "#1a1a2e",
    color: "#fff",
    border: "1px solid #1a1a2e",
  };

  const cardStyle = {
    background: "#fff",
    border: "1px solid #ddd",
    borderRadius: "8px",
    padding: "1.5rem",
    maxWidth: "600px",
    marginBottom: "1.5rem",
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Configurações</h2>

      {/* Pulse Integration */}
      {isAdmin && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Integração HappyDo Pulse</h3>
          <p style={{ fontSize: "0.8rem", color: "#666", marginTop: 0 }}>
            Configure as credenciais para sincronizar os PDVs automaticamente do HappyDo Pulse.
          </p>

          {message && (
            <div
              style={{
                padding: "0.6rem 1rem",
                marginBottom: "1rem",
                borderRadius: "6px",
                fontSize: "0.85rem",
                background: message.type === "ok" ? "#e8f5e9" : "#ffebee",
                color: message.type === "ok" ? "#2e7d32" : "#c62828",
              }}
            >
              {message.text}
            </div>
          )}

          <form onSubmit={handleSave}>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <label style={labelStyle}>URL da API</label>
                <input
                  type="url"
                  value={form.api_url}
                  onChange={(e) => setForm({ ...form, api_url: e.target.value })}
                  placeholder="https://happydopulse-production.up.railway.app/api"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="usuario@empresa.com"
                  required
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>
                  Senha
                  {pulse?.has_password && (
                    <span style={{ fontWeight: 400, color: "#666", marginLeft: "0.5rem" }}>
                      (já configurada — deixe em branco para manter)
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={pulse?.has_password ? "••••••••" : "Senha do Pulse"}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" disabled={saving} style={btnPrimary}>
                {saving ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                style={btnStyle}
              >
                {testing ? "Testando..." : "Testar Conexão"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Deploy Status */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>Status do Deploy</h3>
          <button onClick={loadDeploy} style={{ ...btnStyle, fontSize: "0.75rem" }}>
            Atualizar
          </button>
        </div>
        {deploy ? (
          <table style={{ width: "100%", fontSize: "0.875rem", marginTop: "0.75rem" }}>
            <tbody>
              <tr>
                <td style={{ padding: "0.4rem 0", fontWeight: 600, width: "120px" }}>Status</td>
                <td>
                  <span
                    style={{
                      padding: "0.15rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      background:
                        deploy.status === "success" ? "#e8f5e9"
                        : deploy.status === "deploying" ? "#fff3e0"
                        : deploy.status === "degraded" ? "#ffebee"
                        : "#f5f5f5",
                      color:
                        deploy.status === "success" ? "#2e7d32"
                        : deploy.status === "deploying" ? "#e65100"
                        : deploy.status === "degraded" ? "#c62828"
                        : "#666",
                    }}
                  >
                    {deploy.status === "success" ? "OK" : deploy.status === "deploying" ? "Deployando..." : deploy.status === "degraded" ? "Degradado" : deploy.status}
                  </span>
                </td>
              </tr>
              {deploy.commit && (
                <tr>
                  <td style={{ padding: "0.4rem 0", fontWeight: 600 }}>Commit</td>
                  <td>
                    <code style={{ fontSize: "0.8rem", background: "#f5f5f5", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>
                      {deploy.commit}
                    </code>
                    {" "}<span style={{ color: "#666" }}>{deploy.commit_message}</span>
                  </td>
                </tr>
              )}
              {deploy.commit_author && (
                <tr>
                  <td style={{ padding: "0.4rem 0", fontWeight: 600 }}>Autor</td>
                  <td>{deploy.commit_author}</td>
                </tr>
              )}
              {deploy.branch && (
                <tr>
                  <td style={{ padding: "0.4rem 0", fontWeight: 600 }}>Branch</td>
                  <td><code style={{ fontSize: "0.8rem" }}>{deploy.branch}</code></td>
                </tr>
              )}
              {deploy.finished_at && (
                <tr>
                  <td style={{ padding: "0.4rem 0", fontWeight: 600 }}>Quando</td>
                  <td>{new Date(deploy.finished_at).toLocaleString("pt-BR")}</td>
                </tr>
              )}
              {deploy.message && (
                <tr>
                  <td style={{ padding: "0.4rem 0", fontWeight: 600 }}>Info</td>
                  <td style={{ color: "#666" }}>{deploy.message}</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: "0.875rem", color: "#666" }}>Carregando...</p>
        )}
      </div>

      {/* RTMP Info */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Servidor RTMP</h3>
        <table style={{ width: "100%", fontSize: "0.875rem" }}>
          <tbody>
            <tr>
              <td style={{ padding: "0.5rem 0", fontWeight: 600 }}>Ingest URL</td>
              <td style={{ fontFamily: "monospace" }}>rtmp://servidor:1935/live/</td>
            </tr>
            <tr>
              <td style={{ padding: "0.5rem 0", fontWeight: 600 }}>HLS Playback</td>
              <td style={{ fontFamily: "monospace" }}>http://servidor:8080/hls/</td>
            </tr>
            <tr>
              <td style={{ padding: "0.5rem 0", fontWeight: 600 }}>Stats</td>
              <td>
                <a
                  href="/hls/../stat"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#1a1a2e" }}
                >
                  Nginx-RTMP Stats (XML)
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* System */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Sistema</h3>
        <p style={{ fontSize: "0.875rem", color: "#666", margin: 0 }}>
          Gestão de usuários, API keys e webhooks será implementada nas próximas fases.
        </p>
      </div>
    </div>
  );
}

export default Settings;
