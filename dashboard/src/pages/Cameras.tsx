import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

interface PDV {
  id: string;
  name: string;
  code: string | null;
  city: string;
  state: string;
}

interface Camera {
  id: string;
  name: string;
  stream_key: string;
  model: string;
  camera_group: string;
  location_description: string | null;
  status: string;
  pdv_id: string;
  pdv_name: string;
  pdv_code: string | null;
  rtmp_url?: string;
  hls_url?: string;
  created_at: string;
}

interface CameraModel {
  model: string;
  group: string;
  has_rtmp: boolean;
  description: string;
}

interface CameraForm {
  name: string;
  model: string;
  pdv_id: string;
  location_description: string;
}

const emptyForm: CameraForm = {
  name: "",
  model: "iM5 SC",
  pdv_id: "",
  location_description: "",
};

function CameraInfoModal({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const rtmpUrl = camera.rtmp_url || `rtmp://<SERVIDOR>:1935/live/${camera.stream_key}`;
  const hlsUrl = camera.hls_url || `http://<SERVIDOR>:8080/hls/${camera.stream_key}.m3u8`;
  const isIC = camera.camera_group === "ic";

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const fieldStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    background: "#f5f5f5",
    padding: "0.5rem 0.75rem",
    borderRadius: "4px",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    wordBreak: "break-all",
  };

  const copyBtn: React.CSSProperties = {
    padding: "0.2rem 0.5rem",
    border: "1px solid #ccc",
    borderRadius: "3px",
    cursor: "pointer",
    fontSize: "0.7rem",
    background: "#fff",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: "0.8rem",
    fontWeight: 600,
    marginBottom: "0.3rem",
    marginTop: "1rem",
    color: "#333",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: "10px",
          padding: "2rem",
          maxWidth: "640px",
          width: "90%",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <h3 style={{ margin: 0 }}>Configuração da Câmera</h3>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#666", lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        <p style={{ color: "#666", fontSize: "0.85rem", margin: "0 0 0.5rem 0" }}>
          Instruções completas para configurar <strong>{camera.name}</strong> no PDV <strong>{camera.pdv_name}</strong>.
        </p>

        {/* Dados da câmera */}
        <div style={sectionTitle}>Nome da Câmera</div>
        <div style={fieldStyle}>
          <span style={{ flex: 1 }}>{camera.name}</span>
        </div>

        <div style={sectionTitle}>Modelo</div>
        <div style={fieldStyle}>
          <span style={{ flex: 1 }}>{camera.model} ({camera.camera_group.toUpperCase()})</span>
        </div>

        <div style={sectionTitle}>PDV</div>
        <div style={fieldStyle}>
          <span style={{ flex: 1 }}>{camera.pdv_code ? `[${camera.pdv_code}] ` : ""}{camera.pdv_name}</span>
        </div>

        {camera.location_description && (
          <>
            <div style={sectionTitle}>Localização</div>
            <div style={fieldStyle}>
              <span style={{ flex: 1 }}>{camera.location_description}</span>
            </div>
          </>
        )}

        {/* Stream Key */}
        <div style={{ ...sectionTitle, marginTop: "1.5rem", color: "#1a1a2e", fontSize: "0.9rem" }}>
          Stream Key (chave de transmissão)
        </div>
        <div style={fieldStyle}>
          <span style={{ flex: 1 }}>{camera.stream_key}</span>
          <button onClick={() => copyToClipboard(camera.stream_key)} style={copyBtn}>Copiar</button>
        </div>

        {/* RTMP URL */}
        <div style={sectionTitle}>URL RTMP (destino do stream)</div>
        <div style={fieldStyle}>
          <span style={{ flex: 1 }}>{rtmpUrl}</span>
          <button onClick={() => copyToClipboard(rtmpUrl)} style={copyBtn}>Copiar</button>
        </div>

        {/* HLS URL */}
        <div style={sectionTitle}>URL HLS (visualização ao vivo)</div>
        <div style={fieldStyle}>
          <span style={{ flex: 1 }}>{hlsUrl}</span>
          <button onClick={() => copyToClipboard(hlsUrl)} style={copyBtn}>Copiar</button>
        </div>

        {/* Instruções */}
        <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#f8f9fa", borderRadius: "8px", border: "1px solid #e0e0e0" }}>
          <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem" }}>
            Instruções de Configuração {isIC ? "(com Pi Zero 2W)" : "(RTMP nativo)"}
          </h4>

          {isIC ? (
            <ol style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.82rem", color: "#333", lineHeight: 1.7 }}>
              <li>
                <strong>Câmera (rede local):</strong> Acesse a interface web da câmera pelo IP local
                (ex: <code>http://192.168.x.x</code>). Ative o stream RTSP em{" "}
                <strong>Configurações &gt; Rede &gt; RTSP</strong>. Anote a URL RTSP
                (geralmente <code>rtsp://IP:554/cam/realmonitor?channel=1&subtype=0</code>).
              </li>
              <li>
                <strong>Pi Zero 2W (bridge):</strong> Conecte o Pi Zero à mesma rede do PDV.
                Configure o FFmpeg para converter o stream RTSP para RTMP:
                <div style={{ ...fieldStyle, marginTop: "0.4rem", fontSize: "0.75rem" }}>
                  ffmpeg -rtsp_transport tcp -i rtsp://IP_CAMERA:554/... -c copy -f flv {rtmpUrl}
                </div>
              </li>
              <li>
                <strong>Teste:</strong> Verifique no dashboard se o status muda para <strong style={{ color: "#4caf50" }}>online</strong>.
              </li>
            </ol>
          ) : (
            <ol style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.82rem", color: "#333", lineHeight: 1.7 }}>
              <li>
                <strong>Acesse a câmera:</strong> Abra a interface web da câmera pelo IP local
                (ex: <code>http://192.168.x.x</code>).
              </li>
              <li>
                <strong>Configuração RTMP:</strong> Navegue até{" "}
                <strong>Configurações &gt; Rede &gt; Serviços &gt; RTMP</strong>.
              </li>
              <li>
                <strong>Ative</strong> o serviço RTMP.
              </li>
              <li>
                <strong>URL do Servidor:</strong> Insira a URL RTMP abaixo (sem a stream key):
                <div style={{ ...fieldStyle, marginTop: "0.4rem", fontSize: "0.75rem" }}>
                  <span style={{ flex: 1 }}>{rtmpUrl.substring(0, rtmpUrl.lastIndexOf("/") + 1)}</span>
                  <button onClick={() => copyToClipboard(rtmpUrl.substring(0, rtmpUrl.lastIndexOf("/") + 1))} style={copyBtn}>Copiar</button>
                </div>
              </li>
              <li>
                <strong>Stream Key:</strong> Insira a chave de transmissão:
                <div style={{ ...fieldStyle, marginTop: "0.4rem", fontSize: "0.75rem" }}>
                  <span style={{ flex: 1 }}>{camera.stream_key}</span>
                  <button onClick={() => copyToClipboard(camera.stream_key)} style={copyBtn}>Copiar</button>
                </div>
              </li>
              <li>
                <strong>Codec de vídeo:</strong> Selecione <strong>H.264</strong> (obrigatório).
              </li>
              <li>
                <strong>Resolução recomendada:</strong> 1280×720 (720p) ou 1920×1080 (1080p).
              </li>
              <li>
                <strong>Bitrate recomendado:</strong> 1500–3000 kbps para 720p, 3000–5000 kbps para 1080p.
              </li>
              <li>
                <strong>Salve</strong> e aguarde a câmera conectar. O status mudará para{" "}
                <strong style={{ color: "#4caf50" }}>online</strong> no dashboard.
              </li>
            </ol>
          )}
        </div>

        <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fff3e0", borderRadius: "6px", fontSize: "0.8rem", color: "#e65100" }}>
          <strong>Importante:</strong> A Stream Key é única e não pode ser alterada. Não compartilhe
          com terceiros. Qualquer pessoa com essa chave pode transmitir vídeo neste canal.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
          <button onClick={onClose} style={{ padding: "0.5rem 1.5rem", border: "1px solid #1a1a2e", borderRadius: "4px", cursor: "pointer", background: "#1a1a2e", color: "#fff", fontSize: "0.85rem" }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function Cameras() {
  const { apiFetch } = useAuth();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [pdvs, setPdvs] = useState<PDV[]>([]);
  const [models, setModels] = useState<CameraModel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CameraForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterPdv, setFilterPdv] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState("");
  const [infoCamera, setInfoCamera] = useState<Camera | null>(null);

  const loadData = () => {
    Promise.all([
      apiFetch("/api/cameras").then((r) => r.json()),
      apiFetch("/api/pdvs").then((r) => r.json()),
      apiFetch("/api/cameras/models").then((r) => r.json()),
    ])
      .then(([cams, pdvList, modelList]) => {
        setCameras(cams);
        setPdvs(pdvList);
        setModels(modelList);
      })
      .catch(console.error);
  };

  useEffect(loadData, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult("");
    try {
      const res = await apiFetch("/api/pdvs/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(
          `Sincronizado: ${data.created} novos, ${data.updated} atualizados (${data.total_from_pulse} do Pulse)`
        );
        loadData();
      } else {
        setSyncResult(`Erro: ${data.error}`);
      }
    } catch (err) {
      setSyncResult("Erro de conexão ao sincronizar");
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const url = editingId ? `/api/cameras/${editingId}` : "/api/cameras";
      const method = editingId ? "PATCH" : "POST";
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao salvar");
        return;
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      loadData();
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (camera: Camera) => {
    setForm({
      name: camera.name,
      model: camera.model,
      pdv_id: camera.pdv_id,
      location_description: camera.location_description || "",
    });
    setEditingId(camera.id);
    setShowForm(true);
    setError("");
  };

  const handleDelete = async (camera: Camera) => {
    if (!confirm(`Excluir câmera "${camera.name}"?`)) return;
    try {
      const res = await apiFetch(`/api/cameras/${camera.id}`, { method: "DELETE" });
      if (res.ok) {
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || "Erro ao excluir");
      }
    } catch {
      alert("Erro de conexão");
    }
  };

  const handleInfo = async (camera: Camera) => {
    try {
      const res = await apiFetch(`/api/cameras/${camera.id}`);
      const full = await res.json();
      setInfoCamera(full);
    } catch {
      setInfoCamera(camera);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  };

  const filtered = filterPdv
    ? cameras.filter((c) => c.pdv_id === filterPdv)
    : cameras;

  const groupBadge = (group: string) => ({
    padding: "0.15rem 0.4rem",
    borderRadius: "3px",
    fontSize: "0.7rem",
    fontWeight: 600 as const,
    background: group === "im" ? "#e3f2fd" : "#fff3e0",
    color: group === "im" ? "#1565c0" : "#e65100",
  });

  const statusDot = (status: string) => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block" as const,
    background: status === "online" ? "#4caf50" : status === "error" ? "#ff9800" : "#bdbdbd",
    marginRight: "0.4rem",
  });

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

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>
          Câmeras ({cameras.length})
        </h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button onClick={handleSync} disabled={syncing} style={btnStyle}>
            {syncing ? "Sincronizando..." : "Sincronizar PDVs do Pulse"}
          </button>
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); setError(""); }}
            style={btnPrimary}
          >
            + Nova Câmera
          </button>
        </div>
      </div>

      {syncResult && (
        <div style={{
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          borderRadius: "6px",
          background: syncResult.startsWith("Erro") ? "#ffebee" : "#e8f5e9",
          color: syncResult.startsWith("Erro") ? "#c62828" : "#2e7d32",
          fontSize: "0.875rem",
        }}>
          {syncResult}
        </div>
      )}

      {/* Filter by PDV */}
      <div style={{ marginBottom: "1rem" }}>
        <select
          value={filterPdv}
          onChange={(e) => setFilterPdv(e.target.value)}
          style={{ padding: "0.4rem 0.6rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.875rem" }}
        >
          <option value="">Todos os PDVs</option>
          {pdvs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code ? `[${p.code}] ` : ""}{p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div style={{
          background: "#fff",
          border: "1px solid #ddd",
          borderRadius: "8px",
          padding: "1.5rem",
          marginBottom: "1.5rem",
          maxWidth: "600px",
        }}>
          <h3 style={{ margin: "0 0 1rem 0" }}>
            {editingId ? "Editar Câmera" : "Nova Câmera"}
          </h3>

          {error && (
            <div style={{ padding: "0.5rem", marginBottom: "0.75rem", background: "#ffebee", color: "#c62828", borderRadius: "4px", fontSize: "0.875rem" }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {/* PDV */}
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  PDV *
                </label>
                <select
                  value={form.pdv_id}
                  onChange={(e) => setForm({ ...form, pdv_id: e.target.value })}
                  required
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc" }}
                >
                  <option value="">Selecione o PDV...</option>
                  {pdvs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code ? `[${p.code}] ` : ""}{p.name} — {p.city}/{p.state}
                    </option>
                  ))}
                </select>
                {pdvs.length === 0 && (
                  <div style={{ fontSize: "0.75rem", color: "#e65100", marginTop: "0.25rem" }}>
                    Nenhum PDV cadastrado. Sincronize com o Pulse primeiro.
                  </div>
                )}
              </div>

              {/* Nome */}
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Nome da câmera *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Câmera 1 — Entrada"
                  required
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc", boxSizing: "border-box" }}
                />
              </div>

              {/* Modelo */}
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Modelo *
                </label>
                <select
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  required
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc" }}
                >
                  {models.map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.model} — {m.has_rtmp ? "RTMP nativo" : "Requer Pi Zero"}
                    </option>
                  ))}
                </select>
                {models.find((m) => m.model === form.model && !m.has_rtmp) && (
                  <div style={{ fontSize: "0.75rem", color: "#e65100", marginTop: "0.25rem" }}>
                    Este modelo requer um Pi Zero 2W como bridge RTSP→RTMP no PDV.
                  </div>
                )}
              </div>

              {/* Localização */}
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Descrição da localização
                </label>
                <input
                  type="text"
                  value={form.location_description}
                  onChange={(e) => setForm({ ...form, location_description: e.target.value })}
                  placeholder="Ex: Câmera apontada para a prateleira de bebidas"
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" disabled={loading} style={btnPrimary}>
                {loading ? "Salvando..." : editingId ? "Salvar" : "Cadastrar"}
              </button>
              <button type="button" onClick={handleCancel} style={btnStyle}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Camera List */}
      {filtered.length === 0 ? (
        <p style={{ color: "#666" }}>
          {cameras.length === 0
            ? "Nenhuma câmera cadastrada. Clique em \"+ Nova Câmera\" para começar."
            : "Nenhuma câmera encontrada para o filtro selecionado."}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: "8px", overflow: "hidden", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
                <th style={{ padding: "0.75rem 1rem" }}>Status</th>
                <th style={{ padding: "0.75rem 1rem" }}>Nome</th>
                <th style={{ padding: "0.75rem 1rem" }}>Modelo</th>
                <th style={{ padding: "0.75rem 1rem" }}>PDV</th>
                <th style={{ padding: "0.75rem 1rem" }}>Localização</th>
                <th style={{ padding: "0.75rem 1rem" }}>Stream Key</th>
                <th style={{ padding: "0.75rem 1rem" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cam) => (
                <tr key={cam.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <span style={statusDot(cam.status)} />
                    {cam.status}
                  </td>
                  <td style={{ padding: "0.6rem 1rem", fontWeight: 500 }}>{cam.name}</td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <span style={groupBadge(cam.camera_group)}>{cam.camera_group.toUpperCase()}</span>
                    {" "}{cam.model}
                  </td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    {cam.pdv_code ? `[${cam.pdv_code}] ` : ""}{cam.pdv_name}
                  </td>
                  <td style={{ padding: "0.6rem 1rem", color: "#666" }}>
                    {cam.location_description || "—"}
                  </td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <code style={{ fontSize: "0.75rem", background: "#f5f5f5", padding: "0.15rem 0.4rem", borderRadius: "3px" }}>
                      {cam.stream_key.slice(0, 12)}...
                    </code>
                  </td>
                  <td style={{ padding: "0.6rem 1rem" }}>
                    <div style={{ display: "flex", gap: "0.3rem" }}>
                      <button
                        onClick={() => handleInfo(cam)}
                        title="Instruções de configuração"
                        style={{ ...btnStyle, fontSize: "0.75rem", padding: "0.25rem 0.5rem", color: "#1565c0" }}
                      >
                        &#9432; Config
                      </button>
                      <button onClick={() => handleEdit(cam)} style={{ ...btnStyle, fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>
                        Editar
                      </button>
                      <button onClick={() => handleDelete(cam)} style={{ ...btnStyle, fontSize: "0.75rem", padding: "0.25rem 0.5rem", color: "#c62828" }}>
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Camera Info Modal */}
      {infoCamera && (
        <CameraInfoModal camera={infoCamera} onClose={() => setInfoCamera(null)} />
      )}
    </div>
  );
}

export default Cameras;
