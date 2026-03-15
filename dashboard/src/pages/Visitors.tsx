import { useEffect, useState, useRef } from "react";
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

function parseVisitDate(raw: unknown): string {
  return String(raw).split("T")[0];
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
  const [selectedPdvIds, setSelectedPdvIds] = useState<string[]>([]);
  const [days, setDays] = useState<VisitorDay[]>([]);
  const [loading, setLoading] = useState(false);

  // Date range
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 7);
  const [dateFrom, setDateFrom] = useState(dateToYMD(defaultFrom));
  const [dateTo, setDateTo] = useState(dateToYMD(now));

  // Dropdown open state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    apiFetch("/api/pdvs")
      .then((r) => r.json())
      .then((data: PDV[]) => setPdvs(data))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);

    const isAll = selectedPdvIds.length === 0;
    const pdvParam = isAll ? "" : `&pdv_ids=${selectedPdvIds.join(",")}`;

    apiFetch(`/api/pdvs/all/visitors?from=${dateFrom}&to=${dateTo}${pdvParam}`)
      .then((r) => r.json())
      .then((data) => {
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
  }, [selectedPdvIds, dateFrom, dateTo]);

  const togglePdv = (id: string) => {
    setSelectedPdvIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelectedPdvIds([]);

  const setPeriod = (numDays: number) => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - numDays);
    setDateFrom(dateToYMD(from));
    setDateTo(dateToYMD(to));
  };


  const maxVisitors = Math.max(1, ...days.map((d) => d.total_visitors));
  const totalPeriod = days.reduce((acc, d) => acc + d.total_visitors, 0);
  const avgPerDay = days.length > 0 ? Math.round(totalPeriod / days.length) : 0;

  const card: React.CSSProperties = { background: "#fff", borderRadius: "8px", border: "1px solid #ddd", padding: "1rem" };
  const btn: React.CSSProperties = { padding: "0.35rem 0.75rem", borderRadius: "4px", border: "1px solid #ccc", cursor: "pointer", fontSize: "0.8rem" };

  const pdvLabel = selectedPdvIds.length === 0
    ? "Todas as lojas"
    : selectedPdvIds.length === 1
      ? pdvs.find((p) => p.id === selectedPdvIds[0])?.name || "1 loja"
      : `${selectedPdvIds.length} lojas`;

  return (
    <div style={{ maxWidth: "1000px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Visitantes Distintos</h2>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        {/* PDV multi-select dropdown */}
        <div ref={dropdownRef} style={{ position: "relative", minWidth: "220px" }}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{
              ...btn, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between",
              width: "100%", gap: "0.5rem", fontWeight: 500,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pdvLabel}</span>
            <span style={{ fontSize: "0.6rem" }}>{dropdownOpen ? "\u25B2" : "\u25BC"}</span>
          </button>

          {dropdownOpen && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
              background: "#fff", border: "1px solid #ccc", borderRadius: "4px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              maxHeight: "250px", overflowY: "auto", marginTop: "2px",
            }}>
              <label
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.6rem",
                  cursor: "pointer", borderBottom: "1px solid #eee", fontWeight: 600, fontSize: "0.8rem" }}
              >
                <input
                  type="checkbox"
                  checked={selectedPdvIds.length === 0}
                  onChange={selectAll}
                  style={{ accentColor: "#1a1a2e" }}
                />
                Todas as lojas
              </label>
              {pdvs.map((p) => (
                <label
                  key={p.id}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0.6rem",
                    cursor: "pointer", fontSize: "0.8rem", background: selectedPdvIds.includes(p.id) ? "#f0f4ff" : "transparent" }}
                >
                  <input
                    type="checkbox"
                    checked={selectedPdvIds.includes(p.id)}
                    onChange={() => togglePdv(p.id)}
                    style={{ accentColor: "#1a1a2e" }}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Period shortcuts */}
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {[7, 14, 30].map((p) => {
            const isActive = (() => {
              const to = new Date();
              const from = new Date(to);
              from.setDate(from.getDate() - p);
              return dateFrom === dateToYMD(from) && dateTo === dateToYMD(to);
            })();
            return (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{ ...btn, background: isActive ? "#1a1a2e" : "#fff", color: isActive ? "#fff" : "#333" }}
              >
                {p}d
              </button>
            );
          })}
        </div>

        {/* Date range pickers */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: "0.3rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.8rem" }}
          />
          <span style={{ fontSize: "0.8rem", color: "#999" }}>a</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: "0.3rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.8rem" }}
          />
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

      {/* Chart */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "#999" }}>Carregando...</div>
      ) : days.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "#999", padding: "2rem" }}>
          Nenhum dado de visitantes para este período.
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

          {/* Per-PDV breakdown for each day */}
          {days.map((d) => {
            const byPdv = d.by_pdv?.filter((p) => Number(p.count) > 0);
            if (!byPdv || byPdv.length <= 1) return null;
            return (
              <div key={`pdv-${d.visit_date}`} style={{ marginTop: "0.5rem", borderTop: "1px solid #eee", paddingTop: "0.5rem" }}>
                <div style={{ fontSize: "0.7rem", color: "#666", marginBottom: "0.25rem" }}>
                  Por loja ({formatDateFull(d.visit_date)})
                </div>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  {byPdv.map((p) => (
                    <div key={p.pdv_id} style={{ fontSize: "0.8rem" }}>
                      <span style={{ color: "#333", fontWeight: 600 }}>{Number(p.count)}</span>
                      <span style={{ color: "#999", marginLeft: "0.25rem" }}>{p.pdv_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Visitors;
