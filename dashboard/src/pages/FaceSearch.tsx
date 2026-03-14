import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface Appearance {
  id: string;
  camera_id: string;
  camera_name: string;
  pdv_id: string;
  pdv_name: string;
  similarity: number;
  confidence: number;
  detected_at: string;
  face_image: string | null;
}

interface SearchResult {
  query_confidence: number;
  total: number;
  appearances: Appearance[];
}

interface WatchlistEntry {
  id: string;
  name: string;
  description: string | null;
  alert_type: string;
  is_active: boolean;
  photo_url: string | null;
  created_at: string;
}

interface FaceStatus {
  service_available: boolean;
  total_embeddings: number;
  active_watchlist: number;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function FaceSearch() {
  const { apiFetch, token } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const wlFileRef = useRef<HTMLInputElement>(null);

  // Search state
  const [preview, setPreview] = useState<string | null>(null);
  const [photoB64, setPhotoB64] = useState<string>("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  // Watchlist state
  const [tab, setTab] = useState<"search" | "watchlist" | "alerts">("search");
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [wlLoading, setWlLoading] = useState(false);
  const [wlName, setWlName] = useState("");
  const [wlDesc, setWlDesc] = useState("");
  const [wlType, setWlType] = useState("suspect");
  const [wlPhoto, setWlPhoto] = useState<string>("");
  const [wlPreview, setWlPreview] = useState<string | null>(null);
  const [wlAdding, setWlAdding] = useState(false);

  // Status
  const [status, setStatus] = useState<FaceStatus | null>(null);

  const loadStatus = async () => {
    try {
      const res = await apiFetch("/api/faces/status");
      setStatus(await res.json());
    } catch { /* ignore */ }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>, forWatchlist = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const b64 = dataUrl.split(",")[1];
      if (forWatchlist) {
        setWlPreview(dataUrl);
        setWlPhoto(b64);
      } else {
        setPreview(dataUrl);
        setPhotoB64(b64);
      }
    };
    reader.readAsDataURL(file);
  };

  const doSearch = async () => {
    if (!photoB64) return;
    setSearching(true);
    setError("");
    setResult(null);

    try {
      const res = await apiFetch("/api/faces/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: photoB64, reason, limit: 100 }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erro na busca");
        return;
      }

      setResult(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const loadWatchlist = async () => {
    setWlLoading(true);
    try {
      const res = await apiFetch("/api/faces/watchlist");
      setWatchlist(await res.json());
    } catch { /* ignore */ }
    setWlLoading(false);
  };

  const addToWatchlist = async () => {
    if (!wlName || !wlPhoto) return;
    setWlAdding(true);
    try {
      const res = await apiFetch("/api/faces/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: wlName, description: wlDesc, photo: wlPhoto, alert_type: wlType }),
      });
      if (res.ok) {
        setWlName(""); setWlDesc(""); setWlPhoto(""); setWlPreview(null);
        loadWatchlist();
      }
    } catch { /* ignore */ }
    setWlAdding(false);
  };

  const removeFromWatchlist = async (id: string) => {
    if (!confirm("Remover da watchlist?")) return;
    await apiFetch(`/api/faces/watchlist/${id}`, { method: "DELETE" });
    loadWatchlist();
  };

  // Load data on tab change
  const switchTab = (t: typeof tab) => {
    setTab(t);
    if (t === "watchlist") loadWatchlist();
    loadStatus();
  };

  const card: React.CSSProperties = { background: "#fff", borderRadius: "8px", border: "1px solid #ddd", padding: "1rem" };
  const btn: React.CSSProperties = { padding: "0.4rem 1rem", borderRadius: "4px", border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    ...btn,
    background: active ? "#1a1a2e" : "#eee",
    color: active ? "#fff" : "#333",
  });

  const alertTypeLabels: Record<string, { label: string; color: string; bg: string }> = {
    suspect: { label: "Suspeito", color: "#c62828", bg: "#ffebee" },
    banned: { label: "Banido", color: "#b71c1c", bg: "#ffcdd2" },
    employee: { label: "Funcionário", color: "#1565c0", bg: "#e3f2fd" },
    vip: { label: "VIP", color: "#2e7d32", bg: "#e8f5e9" },
  };

  return (
    <div style={{ maxWidth: "1100px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Reconhecimento Facial</h2>
        {status && (
          <div style={{ fontSize: "0.75rem", color: "#666", display: "flex", gap: "1rem" }}>
            <span style={{ color: status.service_available ? "#2e7d32" : "#c62828" }}>
              {status.service_available ? "Serviço ativo" : "Serviço offline"}
            </span>
            <span>{status.total_embeddings.toLocaleString()} faces indexadas</span>
            <span>{status.active_watchlist} na watchlist</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button onClick={() => switchTab("search")} style={tabBtn(tab === "search")}>Buscar Suspeito</button>
        <button onClick={() => switchTab("watchlist")} style={tabBtn(tab === "watchlist")}>Watchlist</button>
      </div>

      {/* Search Tab */}
      {tab === "search" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1rem", alignItems: "start" }}>
          {/* Upload panel */}
          <div style={card}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Foto do suspeito</div>

            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: "2px dashed #ccc", borderRadius: "6px", padding: "1.5rem", textAlign: "center",
                cursor: "pointer", marginBottom: "0.75rem", background: "#fafafa",
              }}
            >
              {preview ? (
                <img src={preview} alt="Preview" style={{ maxWidth: "100%", maxHeight: "200px", borderRadius: "4px" }} />
              ) : (
                <div style={{ color: "#999", fontSize: "0.8rem" }}>Clique para selecionar uma foto</div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => handleFile(e)} />

            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motivo da busca (LGPD)"
              style={{ width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.8rem", marginBottom: "0.5rem", boxSizing: "border-box" }}
            />

            <button
              onClick={doSearch}
              disabled={!photoB64 || searching}
              style={{ ...btn, background: "#c62828", color: "#fff", width: "100%", opacity: !photoB64 || searching ? 0.5 : 1 }}
            >
              {searching ? "Buscando..." : "Buscar nas gravações"}
            </button>

            {error && <div style={{ color: "#c62828", fontSize: "0.8rem", marginTop: "0.5rem" }}>{error}</div>}
          </div>

          {/* Results */}
          <div>
            {result && (
              <>
                <div style={{ fontSize: "0.85rem", marginBottom: "0.5rem", color: "#555" }}>
                  {result.total} aparição(ões) encontrada(s) — confiança da query: {(result.query_confidence * 100).toFixed(0)}%
                </div>

                {result.appearances.length === 0 ? (
                  <div style={{ ...card, textAlign: "center", color: "#999" }}>Nenhuma aparição encontrada.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "0.5rem" }}>
                    {result.appearances.map((a) => (
                      <div key={a.id} style={{ ...card, padding: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        {a.face_image && token && (
                          <img
                            src={`${a.face_image}&token=${encodeURIComponent(token)}`}
                            alt="Face"
                            style={{ width: 56, height: 56, objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "0.8rem" }}>
                            {(a.similarity * 100).toFixed(1)}% match
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "#666" }}>{a.pdv_name}</div>
                          <div style={{ fontSize: "0.7rem", color: "#666" }}>{a.camera_name}</div>
                          <div style={{ fontSize: "0.7rem", color: "#999" }}>{formatDateTime(a.detected_at)}</div>
                          <button
                            onClick={() => navigate(`/playback?camera_id=${a.camera_id}&timestamp=${encodeURIComponent(a.detected_at)}`)}
                            style={{ marginTop: "0.3rem", padding: "0.2rem 0.5rem", borderRadius: "3px", border: "1px solid #1a1a2e",
                              background: "#1a1a2e", color: "#fff", cursor: "pointer", fontSize: "0.7rem", fontWeight: 600 }}
                          >
                            &#9654; Ver vídeo
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {!result && !searching && (
              <div style={{ ...card, textAlign: "center", color: "#999", padding: "3rem" }}>
                Faça upload de uma foto para buscar aparições nas câmeras
              </div>
            )}
          </div>
        </div>
      )}

      {/* Watchlist Tab */}
      {tab === "watchlist" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1rem", alignItems: "start" }}>
          {/* Add form */}
          <div style={card}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Adicionar à Watchlist</div>

            <div
              onClick={() => wlFileRef.current?.click()}
              style={{
                border: "2px dashed #ccc", borderRadius: "6px", padding: "1rem", textAlign: "center",
                cursor: "pointer", marginBottom: "0.5rem", background: "#fafafa",
              }}
            >
              {wlPreview ? (
                <img src={wlPreview} alt="Preview" style={{ maxWidth: "100%", maxHeight: "120px", borderRadius: "4px" }} />
              ) : (
                <div style={{ color: "#999", fontSize: "0.8rem" }}>Foto</div>
              )}
            </div>
            <input ref={wlFileRef} type="file" accept="image/*" hidden onChange={(e) => handleFile(e, true)} />

            <input
              value={wlName} onChange={(e) => setWlName(e.target.value)}
              placeholder="Nome"
              style={{ width: "100%", padding: "0.35rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.8rem", marginBottom: "0.35rem", boxSizing: "border-box" }}
            />
            <input
              value={wlDesc} onChange={(e) => setWlDesc(e.target.value)}
              placeholder="Descrição (opcional)"
              style={{ width: "100%", padding: "0.35rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.8rem", marginBottom: "0.35rem", boxSizing: "border-box" }}
            />
            <select
              value={wlType} onChange={(e) => setWlType(e.target.value)}
              style={{ width: "100%", padding: "0.35rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.8rem", marginBottom: "0.5rem", boxSizing: "border-box" }}
            >
              <option value="suspect">Suspeito</option>
              <option value="banned">Banido</option>
              <option value="employee">Funcionário</option>
              <option value="vip">VIP</option>
            </select>

            <button
              onClick={addToWatchlist}
              disabled={!wlName || !wlPhoto || wlAdding}
              style={{ ...btn, background: "#1a1a2e", color: "#fff", width: "100%", opacity: !wlName || !wlPhoto || wlAdding ? 0.5 : 1 }}
            >
              {wlAdding ? "Adicionando..." : "Adicionar"}
            </button>
          </div>

          {/* List */}
          <div>
            {wlLoading ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "#999" }}>Carregando...</div>
            ) : watchlist.length === 0 ? (
              <div style={{ ...card, textAlign: "center", color: "#999" }}>Nenhuma entrada na watchlist.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {watchlist.map((w) => {
                  const at = alertTypeLabels[w.alert_type] || alertTypeLabels.suspect;
                  return (
                    <div key={w.id} style={{ ...card, padding: "0.5rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      {w.photo_url && token && (
                        <img
                          src={`${w.photo_url}&token=${encodeURIComponent(token)}`}
                          alt={w.name}
                          style={{ width: 48, height: 48, objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                        />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{w.name}</div>
                        {w.description && <div style={{ fontSize: "0.7rem", color: "#666" }}>{w.description}</div>}
                        <div style={{ fontSize: "0.65rem", color: "#999" }}>Adicionado em {formatDateTime(w.created_at)}</div>
                      </div>
                      <span style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem", borderRadius: "3px", background: at.bg, color: at.color, fontWeight: 600 }}>
                        {at.label}
                      </span>
                      <button
                        onClick={() => removeFromWatchlist(w.id)}
                        style={{ ...btn, background: "#ffebee", color: "#c62828", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                      >
                        Remover
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default FaceSearch;
