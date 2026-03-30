import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

interface PDV {
  id: string;
  name: string;
  code: string | null;
  city: string;
  state: string;
  is_active: boolean;
}

interface Camera {
  id: string;
  name: string;
  stream_key: string;
  model: string;
  camera_group: string;
  camera_purpose: string;
  capture_face: boolean;
  location_description: string | null;
  status: string;
  pdv_id: string;
  pdv_name: string;
  pdv_code: string | null;
  recording_mode: string;
  retention_days: number;
  motion_sensitivity: number;
  rtmp_url?: string;
  hls_url?: string;
  storage_quota_gb: number | null;
  rtmp_public_url?: string;
  hls_public_url?: string;
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
  recording_mode: string;
  retention_days: number;
  motion_sensitivity: number;
  storage_quota_gb: string; // string for input handling, "" = null/unlimited
  camera_purpose: string;
  capture_face: boolean;
}

interface DiskUsageEntry {
  total_bytes: string;
  recording_bytes: string;
  recording_count: number;
  face_bytes: string;
  face_count: number;
  oldest_recording_at: string | null;
}

interface DiskUsageMap {
  [cameraId: string]: DiskUsageEntry;
}

const emptyForm: CameraForm = {
  name: "",
  model: "iM5 SC",
  pdv_id: "",
  location_description: "",
  recording_mode: "continuous",
  retention_days: 21,
  motion_sensitivity: 5,
  storage_quota_gb: "",
  camera_purpose: "environment",
  capture_face: true,
};

function formatBytes(bytes: number) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " B";
}

function CameraInfoModal({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const rtmpPublicUrl = camera.rtmp_public_url || "";
  const hlsPublicUrl = camera.hls_public_url || "";
  const serverConfigured = !!rtmpPublicUrl;
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
          Instruções para configurar <strong>{camera.name}</strong> no PDV <strong>{camera.pdv_name}</strong>.
        </p>

        {/* Dados da câmera */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1rem", marginTop: "0.5rem" }}>
          <div>
            <div style={sectionTitle}>Modelo</div>
            <div style={fieldStyle}>
              <span style={{ flex: 1 }}>{camera.model} ({camera.camera_group.toUpperCase()})</span>
            </div>
          </div>
          <div>
            <div style={sectionTitle}>PDV</div>
            <div style={fieldStyle}>
              <span style={{ flex: 1 }}>{camera.pdv_code ? `[${camera.pdv_code}] ` : ""}{camera.pdv_name}</span>
            </div>
          </div>
        </div>

        {/* Camera purpose & face capture */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1rem", marginTop: "0.5rem" }}>
          <div>
            <div style={sectionTitle}>Tipo</div>
            <div style={fieldStyle}>
              <span style={{ flex: 1 }}>
                {camera.camera_purpose === "face" ? "Captura de face" : "Ambiente"}
              </span>
            </div>
          </div>
          <div>
            <div style={sectionTitle}>Detecção facial</div>
            <div style={fieldStyle}>
              <span style={{ flex: 1, color: camera.capture_face ? "#2e7d32" : "#999" }}>
                {camera.capture_face ? "Ativa" : "Desativada"}
              </span>
            </div>
          </div>
        </div>

        {/* Recording settings summary */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem 1rem", marginTop: "0.5rem" }}>
          <div>
            <div style={sectionTitle}>Gravação</div>
            <div style={fieldStyle}>
              <span style={{ flex: 1 }}>
                {camera.recording_mode === "motion" ? "Por movimento" : "Contínua"}
              </span>
            </div>
          </div>
          <div>
            <div style={sectionTitle}>Retenção</div>
            <div style={fieldStyle}>
              <span style={{ flex: 1 }}>{camera.retention_days} dias</span>
            </div>
          </div>
          {camera.recording_mode === "motion" && (
            <div>
              <div style={sectionTitle}>Sensibilidade</div>
              <div style={fieldStyle}>
                <span style={{ flex: 1 }}>{camera.motion_sensitivity}%</span>
              </div>
            </div>
          )}
        </div>

        {camera.location_description && (
          <>
            <div style={sectionTitle}>Localização</div>
            <div style={fieldStyle}>
              <span style={{ flex: 1 }}>{camera.location_description}</span>
            </div>
          </>
        )}

        {/* Seção principal — URL RTMP para colar na câmera */}
        {serverConfigured ? (
          <div style={{
            marginTop: "1.5rem",
            padding: "1.25rem",
            background: "#e8f5e9",
            borderRadius: "8px",
            border: "1px solid #c8e6c9",
          }}>
            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", color: "#2e7d32" }}>
              Cole no campo "URL RTMP" da câmera
            </h4>
            <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.8rem", color: "#555" }}>
              No app Intelbras: <strong>Configuração RTMP</strong> &rarr; <strong>Personalizado</strong> &rarr; campo <strong>URL RTMP</strong>
            </p>

            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              background: "#fff",
              padding: "0.75rem 1rem",
              borderRadius: "6px",
              fontFamily: "monospace",
              fontSize: "0.85rem",
              wordBreak: "break-all",
              border: "2px solid #4caf50",
            }}>
              <span style={{ flex: 1 }}>{rtmpPublicUrl}</span>
              <button onClick={() => copyToClipboard(rtmpPublicUrl)} style={{ ...copyBtn, background: "#4caf50", color: "#fff", border: "1px solid #4caf50", padding: "0.3rem 0.75rem", fontSize: "0.8rem" }}>
                Copiar
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            marginTop: "1.5rem",
            padding: "1.25rem",
            background: "#fff3e0",
            borderRadius: "8px",
            border: "1px solid #ffe0b2",
          }}>
            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", color: "#e65100" }}>
              Servidor RTMP não configurado
            </h4>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#555" }}>
              Para gerar a URL RTMP da câmera, primeiro configure o IP público do servidor
              em <strong>Configurações &rarr; Servidor RTMP</strong>.
            </p>
          </div>
        )}

        {/* Stream Key separada para referência */}
        <div style={sectionTitle}>Stream Key (referência)</div>
        <div style={fieldStyle}>
          <span style={{ flex: 1 }}>{camera.stream_key}</span>
          <button onClick={() => copyToClipboard(camera.stream_key)} style={copyBtn}>Copiar</button>
        </div>

        {/* HLS URL */}
        <div style={sectionTitle}>URL HLS (visualização ao vivo)</div>
        <div style={fieldStyle}>
          <span style={{ flex: 1 }}>{hlsPublicUrl}</span>
          <button onClick={() => copyToClipboard(hlsPublicUrl)} style={copyBtn}>Copiar</button>
        </div>

        {/* Instruções passo a passo */}
        <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#f8f9fa", borderRadius: "8px", border: "1px solid #e0e0e0" }}>
          <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem" }}>
            Passo a passo {isIC ? "(modelo IC — com Pi Zero 2W)" : ""}
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
                  ffmpeg -rtsp_transport tcp -i rtsp://IP_CAMERA:554/... -c copy -f flv {rtmpPublicUrl}
                </div>
              </li>
              <li>
                <strong>Teste:</strong> Verifique no dashboard se o status muda para <strong style={{ color: "#4caf50" }}>online</strong>.
              </li>
            </ol>
          ) : (
            <ol style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.82rem", color: "#333", lineHeight: 1.7 }}>
              <li>
                Abra o <strong>app Intelbras</strong> ou a <strong>interface web</strong> da câmera.
              </li>
              <li>
                Acesse <strong>Configuração RTMP</strong>.
              </li>
              <li>
                Em <strong>Stream</strong>, selecione <strong>Econômica</strong> (recomendado) ou <strong>Principal</strong> (melhor qualidade).
              </li>
              <li>
                Selecione <strong>Personalizado</strong>.
              </li>
              <li>
                No campo <strong>URL RTMP</strong>, cole a URL acima:
                <div style={{ ...fieldStyle, marginTop: "0.4rem", fontSize: "0.75rem" }}>
                  <span style={{ flex: 1 }}>{rtmpPublicUrl}</span>
                  <button onClick={() => copyToClipboard(rtmpPublicUrl)} style={copyBtn}>Copiar</button>
                </div>
              </li>
              <li>
                Clique em <strong>Salvar</strong> e aguarde. O status mudará para{" "}
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

interface SystemAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  camera_id: string | null;
  camera_name: string | null;
  metadata: Record<string, unknown>;
  resolved: boolean;
  created_at: string;
}

function AlertsBox({ apiFetch }: { apiFetch: (url: string, opts?: RequestInit) => Promise<Response> }) {
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [expanded, setExpanded] = useState(true);

  const loadAlerts = () => {
    apiFetch("/api/alerts?resolved=false&limit=20")
      .then((r) => {
        if (!r.ok) return;
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setAlerts(data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleResolve = async (alertId: string) => {
    try {
      await apiFetch(`/api/alerts/${alertId}/resolve`, { method: "PATCH" });
      loadAlerts();
    } catch {}
  };

  if (alerts.length === 0) return null;

  const severityColors: Record<string, { bg: string; border: string; icon: string }> = {
    critical: { bg: "#ffebee", border: "#ef9a9a", icon: "\u26A0" },
    warning: { bg: "#fff8e1", border: "#ffe082", icon: "\u26A0" },
    info: { bg: "#e3f2fd", border: "#90caf9", icon: "\u2139" },
  };

  return (
    <div style={{
      marginBottom: "1rem",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      overflow: "hidden",
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "0.6rem 1rem",
          background: alerts.some(a => a.severity === "critical") ? "#ffebee" : "#fff8e1",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontWeight: 600,
          fontSize: "0.85rem",
        }}
      >
        <span>
          Alertas do Sistema ({alerts.length})
        </span>
        <span style={{ fontSize: "0.75rem", color: "#666" }}>
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </div>
      {expanded && (
        <div style={{ background: "#fff" }}>
          {alerts.map((alert) => {
            const colors = severityColors[alert.severity] || severityColors.info;
            return (
              <div
                key={alert.id}
                style={{
                  padding: "0.75rem 1rem",
                  borderBottom: "1px solid #f0f0f0",
                  background: colors.bg,
                  borderLeft: `4px solid ${colors.border}`,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                }}
              >
                <span style={{ fontSize: "1.1rem", flexShrink: 0, marginTop: "0.1rem" }}>
                  {colors.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.2rem" }}>
                    {alert.title}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#555", lineHeight: 1.4 }}>
                    {alert.message}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#999", marginTop: "0.3rem" }}>
                    {new Date(alert.created_at).toLocaleString("pt-BR")}
                    {alert.camera_name && ` \u2014 ${alert.camera_name}`}
                  </div>
                </div>
                <button
                  onClick={() => handleResolve(alert.id)}
                  title="Resolver alerta"
                  style={{
                    padding: "0.25rem 0.6rem",
                    border: "1px solid #ccc",
                    borderRadius: "4px",
                    background: "#fff",
                    cursor: "pointer",
                    fontSize: "0.7rem",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  Resolver
                </button>
              </div>
            );
          })}
        </div>
      )}
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
  const [infoCamera, setInfoCamera] = useState<Camera | null>(null);
  const [diskUsage, setDiskUsage] = useState<DiskUsageMap>({});

  const loadData = () => {
    Promise.all([
      apiFetch("/api/cameras").then((r) => r.json()),
      apiFetch("/api/pdvs").then((r) => r.json()),
      apiFetch("/api/cameras/models").then((r) => r.json()),
      apiFetch("/api/cameras/disk-usage").then((r) => r.json()),
    ])
      .then(([cams, pdvList, modelList, usage]) => {
        setCameras(cams);
        setPdvs(pdvList);
        setModels(modelList);
        const usageMap: DiskUsageMap = {};
        for (const u of usage) {
          usageMap[u.camera_id] = {
            total_bytes: u.total_bytes,
            recording_bytes: u.recording_bytes || "0",
            recording_count: u.recording_count || 0,
            face_bytes: u.face_bytes || "0",
            face_count: u.face_count || 0,
            oldest_recording_at: u.oldest_recording_at || null,
          };
        }
        setDiskUsage(usageMap);
      })
      .catch(console.error);
  };

  useEffect(loadData, []);

  // PDV sync is now automatic via flac-guard-control (non-blocking on GET /api/pdvs)

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
        body: JSON.stringify({
          ...form,
          storage_quota_gb: form.storage_quota_gb ? parseFloat(form.storage_quota_gb) : null,
        }),
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
      recording_mode: camera.recording_mode || "continuous",
      retention_days: camera.retention_days || 21,
      motion_sensitivity: camera.motion_sensitivity || 5,
      storage_quota_gb: camera.storage_quota_gb != null ? String(camera.storage_quota_gb) : "",
      camera_purpose: camera.camera_purpose || "environment",
      capture_face: camera.capture_face !== undefined ? camera.capture_face : true,
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

  const recModeBadge = (mode: string) => ({
    padding: "0.15rem 0.4rem",
    borderRadius: "3px",
    fontSize: "0.65rem",
    fontWeight: 600 as const,
    background: mode === "motion" ? "#fff3e0" : "#e8f5e9",
    color: mode === "motion" ? "#e65100" : "#2e7d32",
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
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); setError(""); }}
            style={btnPrimary}
          >
            + Nova Câmera
          </button>
        </div>
      </div>


      {/* System Alerts */}
      <AlertsBox apiFetch={apiFetch} />

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
          maxWidth: "700px",
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
                  {pdvs.filter((p) => p.is_active).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code ? `[${p.code}] ` : ""}{p.name} — {p.city}/{p.state}
                    </option>
                  ))}
                </select>
                {pdvs.length === 0 && (
                  <div style={{ fontSize: "0.75rem", color: "#e65100", marginTop: "0.25rem" }}>
                    Nenhum PDV cadastrado. Os PDVs são sincronizados automaticamente do Control.
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

              {/* Camera Purpose + Face Capture */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                    Tipo da câmera
                  </label>
                  <select
                    value={form.camera_purpose}
                    onChange={(e) => setForm({ ...form, camera_purpose: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc" }}
                  >
                    <option value="environment">Ambiente</option>
                    <option value="face">Captura de face</option>
                  </select>
                  <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "0.2rem" }}>
                    {form.camera_purpose === "face"
                      ? "Posicionada para captura frontal de rostos. Prioridade na contagem de visitantes."
                      : "Câmera de ambiente / visão geral do PDV."}
                  </div>
                </div>

                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.capture_face}
                      onChange={(e) => setForm({ ...form, capture_face: e.target.checked })}
                      style={{ accentColor: "#1a1a2e" }}
                    />
                    Capturar faces
                  </label>
                  <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "0.2rem" }}>
                    {form.capture_face
                      ? "Detecção facial ativa. Usada para contagem de visitantes e busca."
                      : "Detecção facial desativada. Não contribui para contagem de visitantes."}
                  </div>
                  {form.camera_purpose === "environment" && form.capture_face && (
                    <div style={{ fontSize: "0.7rem", color: "#1565c0", marginTop: "0.15rem" }}>
                      Câmera de ambiente com captura de face ativa (fallback para contagem se não houver câmera face no PDV).
                    </div>
                  )}
                </div>
              </div>

              {/* Recording Mode + Retention + Sensitivity + Quota row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.75rem" }}>
                {/* Recording Mode */}
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                    Modo de gravação
                  </label>
                  <select
                    value={form.recording_mode}
                    onChange={(e) => setForm({ ...form, recording_mode: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc" }}
                  >
                    <option value="continuous">Contínua (24/7)</option>
                    <option value="motion">Por movimento</option>
                  </select>
                  <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "0.2rem" }}>
                    {form.recording_mode === "motion"
                      ? "Grava apenas quando detecta movimento (~80-90% economia)"
                      : "Grava continuamente enquanto online"}
                  </div>
                </div>

                {/* Retention Days */}
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                    Retenção (dias)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={form.retention_days}
                    onChange={(e) => setForm({ ...form, retention_days: Math.min(60, Math.max(1, parseInt(e.target.value) || 21)) })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc", boxSizing: "border-box" }}
                  />
                  <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "0.2rem" }}>
                    Padrão: 21 dias | Máximo: 60 dias
                  </div>
                </div>

                {/* Motion Sensitivity (only when motion mode) */}
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                    Sensibilidade (%)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={form.motion_sensitivity}
                    onChange={(e) => setForm({ ...form, motion_sensitivity: Math.min(100, Math.max(1, parseInt(e.target.value) || 5)) })}
                    disabled={form.recording_mode !== "motion"}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "4px",
                      border: "1px solid #ccc",
                      boxSizing: "border-box",
                      opacity: form.recording_mode !== "motion" ? 0.5 : 1,
                    }}
                  />
                  <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "0.2rem" }}>
                    {form.recording_mode === "motion"
                      ? "Menor = mais sensível"
                      : "Disponível no modo movimento"}
                  </div>
                </div>

                {/* Storage Quota */}
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                    Franquia (GB)
                  </label>
                  <input
                    type="number"
                    min={0.1}
                    max={1000}
                    step={0.1}
                    value={form.storage_quota_gb}
                    onChange={(e) => setForm({ ...form, storage_quota_gb: e.target.value })}
                    placeholder="Ilimitado"
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc", boxSizing: "border-box" }}
                  />
                  <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "0.2rem" }}>
                    Vazio = sem limite de espaço
                  </div>
                </div>
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
                <th style={{ padding: "0.75rem 1rem" }}>Tipo</th>
                <th style={{ padding: "0.75rem 1rem" }}>PDV</th>
                <th style={{ padding: "0.75rem 1rem" }}>Gravação</th>
                <th style={{ padding: "0.75rem 1rem" }}>Retenção</th>
                <th style={{ padding: "0.75rem 1rem" }}>Disco</th>
                <th style={{ padding: "0.75rem 1rem" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cam) => {
                const usage = diskUsage[cam.id];
                const totalBytes = usage ? parseInt(usage.total_bytes) : 0;
                return (
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
                      <span style={{
                        padding: "0.15rem 0.4rem",
                        borderRadius: "3px",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        background: cam.camera_purpose === "face" ? "#e8f5e9" : "#f5f5f5",
                        color: cam.camera_purpose === "face" ? "#2e7d32" : "#666",
                      }}>
                        {cam.camera_purpose === "face" ? "Face" : "Ambiente"}
                      </span>
                      {cam.capture_face && cam.camera_purpose !== "face" && (
                        <span style={{ fontSize: "0.6rem", color: "#1565c0", marginLeft: "0.3rem" }}>
                          +face
                        </span>
                      )}
                      {!cam.capture_face && (
                        <span style={{ fontSize: "0.6rem", color: "#999", marginLeft: "0.3rem" }}>
                          sem face
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "0.6rem 1rem" }}>
                      {cam.pdv_code ? `[${cam.pdv_code}] ` : ""}{cam.pdv_name}
                    </td>
                    <td style={{ padding: "0.6rem 1rem" }}>
                      <span style={recModeBadge(cam.recording_mode)}>
                        {cam.recording_mode === "motion" ? "Movimento" : "Contínua"}
                      </span>
                    </td>
                    <td style={{ padding: "0.6rem 1rem", fontSize: "0.8rem" }}>
                      <div>{cam.retention_days}d</div>
                      {usage?.oldest_recording_at && (
                        <div style={{ fontSize: "0.65rem", color: "#999", marginTop: "0.15rem" }}>
                          desde {new Date(usage.oldest_recording_at).toLocaleDateString("pt-BR")}{" "}
                          {new Date(usage.oldest_recording_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                      {cam.storage_quota_gb != null && (
                        <div style={{ fontSize: "0.65rem", color: "#1565c0", marginTop: "0.1rem" }}>
                          franquia: {cam.storage_quota_gb} GB
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "0.6rem 1rem" }}>
                      <div style={{ fontSize: "0.8rem", fontFamily: "monospace", fontWeight: 600 }}>
                        {totalBytes > 0 ? formatBytes(totalBytes) : "—"}
                      </div>
                      {usage && parseInt(usage.recording_bytes) > 0 && (
                        <div style={{ fontSize: "0.65rem", color: "#999" }}>
                          {formatBytes(parseInt(usage.recording_bytes))} gravações ({usage.recording_count})
                        </div>
                      )}
                      {usage && parseInt(usage.face_bytes) > 0 && (
                        <div style={{ fontSize: "0.65rem", color: "#999" }}>
                          {formatBytes(parseInt(usage.face_bytes))} faciais ({usage.face_count})
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "0.6rem 1rem" }}>
                      <div style={{ display: "flex", gap: "0.3rem" }}>
                        <button
                          onClick={() => handleInfo(cam)}
                          title="Instruções de configuração"
                          style={{ ...btnStyle, fontSize: "0.75rem", padding: "0.25rem 0.5rem", color: "#1565c0" }}
                        >
                          Config
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
                );
              })}
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
