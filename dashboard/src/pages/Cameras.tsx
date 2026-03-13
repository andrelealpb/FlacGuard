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
    </div>
  );
}

export default Cameras;
