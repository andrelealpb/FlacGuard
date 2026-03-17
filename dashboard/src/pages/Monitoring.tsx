import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";

interface SystemStats {
  cpu: { percent: number; load1: number; load5: number; load15: number };
  memory: { total: number; used: number; available: number; cached: number; buffers: number; swap_total: number; swap_used: number } | null;
  disks: { filesystem: string; total: number; used: number; available: number; mount: string }[];
  network: { name: string; rx_bytes: number; tx_bytes: number; rx_packets: number; tx_packets: number }[];
  uptime: number;
  database: { size: number; active_connections: number };
  recordings: { total: number; total_size: number; cameras_with_recordings: number };
  faces: { total_embeddings: number };
  cameras: Record<string, number>;
  services: { name: string; status: string; ports: string }[];
}

function formatBytes(b: number): string {
  if (b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Simple bar/gauge component
function Gauge({ value, max, label, color, detail }: { value: number; max: number; label: string; color: string; detail?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.2rem" }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color: "#666" }}>{detail || `${pct.toFixed(1)}%`}</span>
      </div>
      <div style={{ background: "#e8e8e8", borderRadius: "4px", height: "10px", overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: pct > 90 ? "#c62828" : pct > 70 ? "#ff9800" : color,
          borderRadius: "4px", transition: "width 0.5s ease",
        }} />
      </div>
    </div>
  );
}

// Mini sparkline chart using SVG
function Sparkline({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 200;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - (v / max) * (height - 4)}`).join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

const card: React.CSSProperties = {
  background: "#fff", borderRadius: "6px", border: "1px solid #ddd",
  padding: "0.75rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
};

function Monitoring() {
  const { apiFetch } = useAuth();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState("");
  const cpuHistory = useRef<number[]>([]);
  const memHistory = useRef<number[]>([]);
  const netRxHistory = useRef<number[]>([]);
  const netTxHistory = useRef<number[]>([]);
  const prevNet = useRef<{ rx: number; tx: number } | null>(null);
  const [, forceUpdate] = useState(0);

  const fetchStats = async () => {
    try {
      const res = await apiFetch("/api/monitor/stats");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SystemStats = await res.json();
      setStats(data);
      setError("");

      // Update histories
      cpuHistory.current = [...cpuHistory.current.slice(-59), data.cpu.percent];

      if (data.memory) {
        const memPct = (data.memory.used / data.memory.total) * 100;
        memHistory.current = [...memHistory.current.slice(-59), memPct];
      }

      // Network: calculate rates from deltas
      const totalRx = data.network.reduce((s, n) => s + n.rx_bytes, 0);
      const totalTx = data.network.reduce((s, n) => s + n.tx_bytes, 0);
      if (prevNet.current) {
        const rxRate = Math.max(0, totalRx - prevNet.current.rx);
        const txRate = Math.max(0, totalTx - prevNet.current.tx);
        netRxHistory.current = [...netRxHistory.current.slice(-59), rxRate];
        netTxHistory.current = [...netTxHistory.current.slice(-59), txRate];
      }
      prevNet.current = { rx: totalRx, tx: totalTx };

      forceUpdate(n => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar");
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error && !stats) {
    return <div style={{ color: "red", padding: "2rem" }}>Erro: {error}</div>;
  }
  if (!stats) {
    return <div style={{ padding: "2rem", color: "#999" }}>Carregando...</div>;
  }

  const memPct = stats.memory ? (stats.memory.used / stats.memory.total) * 100 : 0;
  const onlineCams = stats.cameras["online"] || 0;
  const totalCams = Object.values(stats.cameras).reduce((a, b) => a + b, 0);

  return (
    <div style={{ maxWidth: "1100px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Monitoramento do Servidor</h2>
        <span style={{ fontSize: "0.7rem", color: "#999" }}>
          Uptime: {formatUptime(stats.uptime)} | Atualiza a cada 5s
        </span>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem", marginBottom: "1rem" }}>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: stats.cpu.percent > 80 ? "#c62828" : "#1565c0" }}>
            {stats.cpu.percent}%
          </div>
          <div style={{ fontSize: "0.7rem", color: "#999" }}>CPU</div>
        </div>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: memPct > 85 ? "#c62828" : "#2e7d32" }}>
            {memPct.toFixed(0)}%
          </div>
          <div style={{ fontSize: "0.7rem", color: "#999" }}>Memória</div>
        </div>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#e65100" }}>
            {formatBytes(stats.recordings.total_size)}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#999" }}>Gravações</div>
        </div>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: onlineCams === totalCams ? "#2e7d32" : "#ff9800" }}>
            {onlineCams}/{totalCams}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#999" }}>Câmeras online</div>
        </div>
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "#6a1b9a" }}>
            {stats.faces.total_embeddings}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#999" }}>Face embeddings</div>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
        {/* CPU */}
        <div style={card}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.3rem" }}>CPU</div>
          <Gauge value={stats.cpu.percent} max={100} label="Uso" color="#1565c0" detail={`${stats.cpu.percent}%`} />
          <div style={{ fontSize: "0.65rem", color: "#999", marginBottom: "0.3rem" }}>
            Load: {stats.cpu.load1.toFixed(2)} / {stats.cpu.load5.toFixed(2)} / {stats.cpu.load15.toFixed(2)}
          </div>
          <Sparkline data={cpuHistory.current} color="#1565c0" />
        </div>

        {/* Memory */}
        <div style={card}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.3rem" }}>Memória</div>
          {stats.memory && (
            <>
              <Gauge value={stats.memory.used} max={stats.memory.total} label="RAM" color="#2e7d32"
                detail={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`} />
              {stats.memory.swap_total > 0 && (
                <Gauge value={stats.memory.swap_used} max={stats.memory.swap_total} label="Swap" color="#ff9800"
                  detail={`${formatBytes(stats.memory.swap_used)} / ${formatBytes(stats.memory.swap_total)}`} />
              )}
              <Sparkline data={memHistory.current} color="#2e7d32" />
            </>
          )}
        </div>

        {/* Disk */}
        <div style={card}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.3rem" }}>Disco</div>
          {stats.disks.map((d) => (
            <Gauge key={d.mount} value={d.used} max={d.total} label={d.mount} color="#e65100"
              detail={`${formatBytes(d.used)} / ${formatBytes(d.total)}`} />
          ))}
          <div style={{ fontSize: "0.65rem", color: "#999", marginTop: "0.3rem" }}>
            Gravações: {formatBytes(stats.recordings.total_size)} ({stats.recordings.total} arquivos)
            {" | "}DB: {formatBytes(stats.database.size)}
          </div>
        </div>

        {/* Network */}
        <div style={card}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.3rem" }}>Rede</div>
          {stats.network.map((n) => (
            <div key={n.name} style={{ fontSize: "0.7rem", marginBottom: "0.3rem" }}>
              <span style={{ fontWeight: 600 }}>{n.name}</span>
              <span style={{ color: "#666", marginLeft: "0.5rem" }}>
                RX: {formatBytes(n.rx_bytes)} | TX: {formatBytes(n.tx_bytes)}
              </span>
            </div>
          ))}
          {netRxHistory.current.length > 1 && (
            <>
              <div style={{ fontSize: "0.6rem", color: "#999", marginTop: "0.3rem" }}>Download (5s)</div>
              <Sparkline data={netRxHistory.current} color="#1565c0" height={30} />
              <div style={{ fontSize: "0.6rem", color: "#999", marginTop: "0.2rem" }}>Upload (5s)</div>
              <Sparkline data={netTxHistory.current} color="#c62828" height={30} />
            </>
          )}
        </div>
      </div>

      {/* Services table */}
      <div style={card}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Serviços</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #eee", textAlign: "left" }}>
              <th style={{ padding: "0.4rem 0.75rem" }}>Serviço</th>
              <th style={{ padding: "0.4rem 0.75rem" }}>Status</th>
              <th style={{ padding: "0.4rem 0.75rem" }}>Portas</th>
            </tr>
          </thead>
          <tbody>
            {stats.services.map((s) => {
              const isOk = s.status.includes("running") || s.status.includes("Up");
              return (
                <tr key={s.name} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "0.4rem 0.75rem", fontWeight: 600 }}>{s.name}</td>
                  <td style={{ padding: "0.4rem 0.75rem" }}>
                    <span style={{
                      display: "inline-block", width: "8px", height: "8px", borderRadius: "50%",
                      background: isOk ? "#4caf50" : "#c62828", marginRight: "0.4rem",
                    }} />
                    {s.status}
                  </td>
                  <td style={{ padding: "0.4rem 0.75rem", color: "#666" }}>{s.ports}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Database info */}
        <div style={{ marginTop: "0.75rem", paddingTop: "0.5rem", borderTop: "1px solid #eee", fontSize: "0.7rem", color: "#666" }}>
          <strong>Banco de dados:</strong> {formatBytes(stats.database.size)} | {stats.database.active_connections} conexões ativas |{" "}
          {stats.recordings.total} gravações | {stats.faces.total_embeddings} face embeddings
        </div>
      </div>
    </div>
  );
}

export default Monitoring;
