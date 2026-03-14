import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

interface PDV {
  id: string;
  name: string;
  camera_count: number;
}

interface PdvBreakdown {
  pdv_id: string;
  pdv_name: string;
  count: number;
}

interface VisitorDay {
  visit_date: string;
  total_visitors: number;
  by_pdv?: PdvBreakdown[];
}

function dateToYMD(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Parse visit_date safely — handles "YYYY-MM-DD", ISO timestamps, or Date objects */
function parseVisitDate(raw: unknown): string {
  const s = String(raw).split("T")[0]; // "2026-03-14T..." → "2026-03-14"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s; // fallback
}

function formatDateLabel(ymd: string): string {
  const parts = ymd.split("-");
  if (parts.length !== 3) return ymd;
  const [y, m, d] = parts.map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0);
  if (isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function formatDateFull(ymd: string): string {
  const parts = ymd.split("-");
  if (parts.length !== 3) return ymd;
  const [y, m, d] = parts.map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0);
  if (isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString("pt-BR");
}

function Visitors() {
  const { apiFetch } = useAuth();
  const [pdvs, setPdvs] = useState<PDV[]>([]);
  const [selectedPdv, setSelectedPdv] = useState("all");
  const [days, setDays] = useState<VisitorDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState(7);

  useEffect(() => {
    apiFetch("/api/pdvs")
      .then((r) => r.json())
      .then((data: PDV[]) => {
        setPdvs(data);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedPdv) return;
    setLoading(true);

    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - period);

    apiFetch(`/api/pdvs/${selectedPdv}/visitors?from=${dateToYMD(from)}&to=${dateToYMD(now)}`)
      .then((r) => r.json())
      .then((data) => {
        // Normalize: ensure total_visitors is a number and visit_date is clean
        const normalized = (data.days || []).map((d: VisitorDay) => ({
          ...d,
          visit_date: parseVisitDate(d.visit_date),
          total_visitors: Number(d.total_visitors) || 0,
        }));
        setDays(normalized);
        setLoading(false);
      })
      .catch(() => {
        setDays([]);
        setLoading(false);
      });
  }, [selectedPdv, period]);

  const maxVisitors = Math.max(1, ...days.map((d) => d.total_visitors));
  const totalPeriod = days.reduce((acc, d) => acc + d.total_visitors, 0);
  const avgPerDay = days.length > 0 ? Math.round(totalPeriod / days.length) : 0;

  const card: React.CSSProperties = { background: "#fff", borderRadius: "8px", border: "1px solid #ddd", padding: "1rem" };

  return (
    <div style={{ maxWidth: "900px" }}>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem" }}>Visitantes Distintos</h2>

      {/* Controls */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <select
          value={selectedPdv}
          onChange={(e) => setSelectedPdv(e.target.value)}
          style={{ padding: "0.4rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.85rem", minWidth: "200px" }}
        >
          <option value="all">TODOS</option>
          {pdvs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div style={{ display: "flex", gap: "0.25rem" }}>
          {[7, 14, 30].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: "0.35rem 0.75rem", borderRadius: "4px", border: "1px solid #ccc",
                background: period === p ? "#1a1a2e" : "#fff", color: period === p ? "#fff" : "#333",
                cursor: "pointer", fontSize: "0.8rem",
              }}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1a1a2e" }}>{totalPeriod}</div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>Total no período</div>
        </div>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#2e7d32" }}>{avgPerDay}</div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>Média/dia</div>
        </div>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1565c0" }}>{days.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>Dias com dados</div>
        </div>
      </div>

      {/* Chart (simple bar chart) */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "#999" }}>Carregando...</div>
      ) : days.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "#999", padding: "2rem" }}>
          {selectedPdv ? "Nenhum dado de visitantes para este período." : "Selecione um PDV ou TODOS."}
          <div style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>
            Os dados de visitantes são gerados automaticamente pelo reconhecimento facial.
          </div>
        </div>
      ) : (
        <div style={card}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.75rem" }}>Visitantes por dia</div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {days.map((d) => {
              const dayLabel = formatDateLabel(d.visit_date);
              const pct = (d.total_visitors / maxVisitors) * 100;

              return (
                <div key={d.visit_date} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <div style={{ width: "90px", fontSize: "0.75rem", color: "#555", textAlign: "right", flexShrink: 0 }}>
                    {dayLabel}
                  </div>
                  <div style={{ flex: 1, background: "#f5f5f5", borderRadius: "3px", height: "22px", position: "relative", overflow: "hidden" }}>
                    <div style={{
                      width: `${pct}%`, height: "100%", background: "#4caf50",
                      borderRadius: "3px", transition: "width 0.3s",
                      minWidth: d.total_visitors > 0 ? "2px" : 0,
                    }} />
                  </div>
                  <div style={{ width: "40px", fontSize: "0.8rem", fontWeight: 600, textAlign: "right", flexShrink: 0 }}>
                    {d.total_visitors}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Per-PDV breakdown for latest day (only when viewing "all") */}
          {selectedPdv === "all" && days.length > 0 && days[0].by_pdv && days[0].by_pdv.length > 1 && (
            <div style={{ marginTop: "1rem", borderTop: "1px solid #eee", paddingTop: "0.75rem" }}>
              <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: "0.35rem" }}>
                Por loja ({formatDateFull(days[0].visit_date)})
              </div>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                {days[0].by_pdv.map((p) => (
                  <div key={p.pdv_id} style={{ fontSize: "0.8rem" }}>
                    <span style={{ color: "#333", fontWeight: 600 }}>{Number(p.count)}</span>
                    <span style={{ color: "#999", marginLeft: "0.25rem" }}>{p.pdv_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Visitors;
