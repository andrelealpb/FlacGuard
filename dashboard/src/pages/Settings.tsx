import { useEffect, useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";

interface PulseConfig {
  api_url: string;
  email: string;
  has_password: boolean;
}

interface BuildServiceInfo {
  name: string;
  build_status: string;
  build_started_at?: string;
  build_finished_at?: string;
}

interface ContainerInfo {
  name: string;
  state: string;
  health?: string;
}

interface ServiceHealth {
  healthy: boolean;
  response?: Record<string, unknown>;
}

interface DeployStatus {
  status: string;
  commit?: string;
  commit_message?: string;
  commit_author?: string;
  branch?: string;
  started_at?: string;
  finished_at?: string;
  built_at?: string;
  message?: string;
  elapsed_seconds?: number;
  stuck?: boolean;
  build?: {
    timestamp: string;
    services: BuildServiceInfo[];
  };
  services?: {
    api?: ServiceHealth;
    nginx_rtmp?: ServiceHealth;
    face_service?: ServiceHealth;
  };
  containers?: ContainerInfo[];
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

  // Server/RTMP config
  const [serverForm, setServerForm] = useState({ rtmp_public_host: "", rtmp_public_port: "1935" });
  const [savingServer, setSavingServer] = useState(false);
  const [serverMsg, setServerMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [deployElapsed, setDeployElapsed] = useState(0);
  const deployTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deployPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDeploy = () => {
    apiFetch("/api/deploy-status")
      .then((r) => r.json())
      .then((data: DeployStatus) => {
        setDeploy(data);
        // Start/stop timer based on deploy status
        if (data.status === "deploying" && data.elapsed_seconds != null) {
          setDeployElapsed(data.elapsed_seconds);
        }
      })
      .catch(console.error);
  };

  // Auto-refresh and live timer when deploying
  useEffect(() => {
    if (deploy?.status === "deploying") {
      // Live timer - tick every second
      if (!deployTimerRef.current) {
        deployTimerRef.current = setInterval(() => {
          setDeployElapsed((prev) => prev + 1);
        }, 1000);
      }
      // Poll deploy status every 10s
      if (!deployPollRef.current) {
        deployPollRef.current = setInterval(loadDeploy, 10000);
      }
    } else {
      // Not deploying - clear timers
      if (deployTimerRef.current) { clearInterval(deployTimerRef.current); deployTimerRef.current = null; }
      if (deployPollRef.current) { clearInterval(deployPollRef.current); deployPollRef.current = null; }
    }
    return () => {
      if (deployTimerRef.current) clearInterval(deployTimerRef.current);
      if (deployPollRef.current) clearInterval(deployPollRef.current);
    };
  }, [deploy?.status]);

  useEffect(() => {
    loadDeploy();
    if (!isAdmin) return;
    apiFetch("/api/settings/server")
      .then((r) => r.json())
      .then((data) => {
        setServerForm({ rtmp_public_host: data.rtmp_public_host || "", rtmp_public_port: data.rtmp_public_port || "1935" });
      })
      .catch(console.error);
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

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingServer(true);
    setServerMsg(null);
    try {
      const res = await apiFetch("/api/settings/server", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverForm),
      });
      const data = await res.json();
      if (res.ok) {
        setServerMsg({ type: "ok", text: data.message });
      } else {
        setServerMsg({ type: "error", text: data.error });
      }
    } catch {
      setServerMsg({ type: "error", text: "Erro de conexão" });
    } finally {
      setSavingServer(false);
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
          <>
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
                          deploy.status === "success" || deploy.status === "ok" ? "#e8f5e9"
                          : deploy.status === "deploying" ? "#fff3e0"
                          : deploy.status === "failed" ? "#ffebee"
                          : deploy.status === "degraded" ? "#ffebee"
                          : "#f5f5f5",
                        color:
                          deploy.status === "success" || deploy.status === "ok" ? "#2e7d32"
                          : deploy.status === "deploying" ? "#e65100"
                          : deploy.status === "failed" ? "#c62828"
                          : deploy.status === "degraded" ? "#c62828"
                          : "#666",
                      }}
                    >
                      {deploy.status === "success" || deploy.status === "ok" ? "OK"
                        : deploy.status === "deploying" ? `Deployando... ${Math.floor(deployElapsed / 60)}m ${deployElapsed % 60}s`
                        : deploy.status === "failed" ? (deploy.stuck ? "Travou" : "Falhou")
                        : deploy.status === "degraded" ? "Degradado"
                        : deploy.status}
                    </span>
                  </td>
                </tr>
                {deploy.message && (
                  <tr>
                    <td style={{ padding: "0.4rem 0", fontWeight: 600 }}>Mensagem</td>
                    <td style={{ color: deploy.status === "failed" ? "#c62828" : "#666", fontSize: "0.85rem" }}>
                      {deploy.message}
                    </td>
                  </tr>
                )}
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
                {deploy.started_at && deploy.status === "deploying" && (
                  <tr>
                    <td style={{ padding: "0.4rem 0", fontWeight: 600 }}>Iniciou</td>
                    <td>{new Date(deploy.started_at).toLocaleString("pt-BR")}</td>
                  </tr>
                )}
                {(deploy.finished_at || deploy.built_at) && (
                  <tr>
                    <td style={{ padding: "0.4rem 0", fontWeight: 600 }}>Quando</td>
                    <td>
                      {new Date(deploy.finished_at || deploy.built_at!).toLocaleString("pt-BR")}
                      {deploy.started_at && deploy.finished_at && (() => {
                        const dur = Math.round((new Date(deploy.finished_at).getTime() - new Date(deploy.started_at).getTime()) / 1000);
                        return <span style={{ color: "#999", marginLeft: "0.5rem" }}>({Math.floor(dur / 60)}m {dur % 60}s)</span>;
                      })()}
                    </td>
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

            {/* Build Status per Service */}
            {deploy.build?.services && deploy.build.services.length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem" }}>Build</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.5rem" }}>
                  {deploy.build.services.map((svc) => (
                    <div
                      key={svc.name}
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "6px",
                        border: "1px solid",
                        borderColor: svc.build_status === "success" ? "#c8e6c9" : "#ffcdd2",
                        background: svc.build_status === "success" ? "#f1f8e9" : "#fce4ec",
                      }}
                    >
                      <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{svc.name}</div>
                      <div style={{
                        fontSize: "0.75rem",
                        color: svc.build_status === "success" ? "#2e7d32" : "#c62828",
                        fontWeight: 600,
                      }}>
                        {svc.build_status === "success" ? "Build OK" : "Build falhou"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Service Health Status */}
            {deploy.services && (
              <div style={{ marginTop: "1rem" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem" }}>Saúde dos Serviços</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.5rem" }}>
                  {Object.entries(deploy.services).map(([key, svc]) => {
                    const name = key === "api" ? "API" : key === "nginx_rtmp" ? "RTMP" : key === "face_service" ? "Face Service" : key;
                    return (
                      <div
                        key={key}
                        style={{
                          padding: "0.5rem 0.75rem",
                          borderRadius: "6px",
                          border: "1px solid",
                          borderColor: svc.healthy ? "#c8e6c9" : "#ffcdd2",
                          background: svc.healthy ? "#f1f8e9" : "#fce4ec",
                        }}
                      >
                        <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{name}</div>
                        <div style={{
                          fontSize: "0.75rem",
                          color: svc.healthy ? "#2e7d32" : "#c62828",
                          fontWeight: 600,
                        }}>
                          {svc.healthy ? "Saudável" : "Com erro"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Container Status */}
            {deploy.containers && deploy.containers.length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.85rem" }}>Containers Docker</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.5rem" }}>
                  {deploy.containers.map((c) => {
                    const isRunning = c.state === "running";
                    return (
                      <div
                        key={c.name}
                        style={{
                          padding: "0.5rem 0.75rem",
                          borderRadius: "6px",
                          border: "1px solid",
                          borderColor: isRunning ? "#c8e6c9" : "#ffcdd2",
                          background: isRunning ? "#f1f8e9" : "#fce4ec",
                        }}
                      >
                        <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{c.name}</div>
                        <div style={{
                          fontSize: "0.75rem",
                          color: isRunning ? "#2e7d32" : "#c62828",
                          fontWeight: 600,
                        }}>
                          {isRunning ? "Rodando" : c.state === "not_found" ? "Não encontrado" : c.state}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <p style={{ fontSize: "0.875rem", color: "#666" }}>Carregando...</p>
        )}
      </div>

      {/* Server / RTMP Config */}
      {isAdmin && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Servidor RTMP</h3>
          <p style={{ fontSize: "0.8rem", color: "#666", marginTop: 0 }}>
            Configure o IP ou domínio público do servidor. Este endereço será usado nas instruções de configuração das câmeras.
          </p>

          {serverMsg && (
            <div
              style={{
                padding: "0.6rem 1rem",
                marginBottom: "1rem",
                borderRadius: "6px",
                fontSize: "0.85rem",
                background: serverMsg.type === "ok" ? "#e8f5e9" : "#ffebee",
                color: serverMsg.type === "ok" ? "#2e7d32" : "#c62828",
              }}
            >
              {serverMsg.text}
            </div>
          )}

          <form onSubmit={handleSaveServer}>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <label style={labelStyle}>IP ou domínio público do servidor</label>
                <input
                  type="text"
                  value={serverForm.rtmp_public_host}
                  onChange={(e) => setServerForm({ ...serverForm, rtmp_public_host: e.target.value })}
                  placeholder="Ex: 147.93.7.251 ou guard.flacguard.com.br"
                  required
                  style={inputStyle}
                />
                <span style={{ fontSize: "0.75rem", color: "#888" }}>
                  O IP público da VPS ou domínio apontando para ela. As câmeras vão se conectar neste endereço.
                </span>
              </div>

              <div>
                <label style={labelStyle}>Porta RTMP</label>
                <input
                  type="text"
                  value={serverForm.rtmp_public_port}
                  onChange={(e) => setServerForm({ ...serverForm, rtmp_public_port: e.target.value })}
                  placeholder="1935"
                  style={inputStyle}
                />
                <span style={{ fontSize: "0.75rem", color: "#888" }}>
                  Padrão: 1935. Só altere se tiver redirecionamento de porta no firewall.
                </span>
              </div>
            </div>

            {serverForm.rtmp_public_host && (
              <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "#f5f5f5", borderRadius: "6px" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#333", marginBottom: "0.3rem" }}>
                  URL RTMP que aparecerá nas câmeras:
                </div>
                <code style={{ fontSize: "0.8rem" }}>
                  rtmp://{serverForm.rtmp_public_host}:{serverForm.rtmp_public_port}/live/&lt;stream_key&gt;
                </code>
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" disabled={savingServer} style={btnPrimary}>
                {savingServer ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}

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
