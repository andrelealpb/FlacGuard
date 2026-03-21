import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";

interface DiskBreakdownItem {
  name: string;
  path?: string;
  bytes?: number;
  size?: string;
  reclaimable?: string;
  category: string;
}

interface SystemStats {
  cpu: { percent: number; load1: number; load5: number; load15: number };
  memory: { total: number; used: number; available: number; cached: number; buffers: number; swap_total: number; swap_used: number } | null;
  disks: { filesystem: string; total: number; used: number; available: number; mount: string }[];
  network: { name: string; rx_bytes: number; tx_bytes: number; rx_packets: number; tx_packets: number }[];
  uptime: number;
  database: { size: number; active_connections: number };
  recordings: { total: number; total_size: number; local_size: number; local_count: number; cameras_with_recordings: number };
  faces: { total_embeddings: number };
  cameras: Record<string, number>;
  services: { name: string; status: string; ports: string }[];
  s3?: {
    configured: boolean;
    status: string;
    recordings_in_s3: number;
    recordings_local: number;
    s3_size: number;
    local_size: number;
    bucket_objects: number;
    bucket_size: number;
    bucket_quota: number;
    endpoint: string | null;
    bucket: string | null;
    error: string | null;
    migration: {
      running: boolean;
      paused: boolean;
      total: number;
      completed: number;
      failed: number;
      skipped: number;
      bytes_uploaded: number;
      elapsed_seconds: number;
      speed_mbps: number;
      remaining: number;
      percent: number;
      current_file: string | null;
      errors: { id: number; file: string; error: string }[];
      delete_local: boolean;
    } | null;
  };
  disk_breakdown?: DiskBreakdownItem[];
  docker_disk?: { images: any[]; containers: any[] } | null;
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
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<{ success: boolean; results: any[] } | null>(null);
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

  const runCleanup = async () => {
    if (!confirm("Isso vai remover imagens Docker não utilizadas, containers parados, cache de build e logs antigos. Continuar?")) return;
    setCleaning(true);
    setCleanResult(null);
    try {
      const res = await apiFetch("/api/monitor/cleanup", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCleanResult(data);
      // Refresh stats after cleanup
      setTimeout(fetchStats, 2000);
    } catch (err) {
      setCleanResult({ success: false, results: [{ action: "Erro", error: err instanceof Error ? err.message : "Falha" }] });
    } finally {
      setCleaning(false);
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
          <div style={{ fontSize: "0.7rem", color: "#999" }}>Gravações (total)</div>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>Disco</div>
            <button
              onClick={runCleanup}
              disabled={cleaning}
              style={{
                fontSize: "0.65rem", padding: "0.2rem 0.5rem", borderRadius: "4px",
                border: "1px solid #e65100", background: cleaning ? "#ccc" : "#fff3e0",
                color: "#e65100", cursor: cleaning ? "not-allowed" : "pointer", fontWeight: 600,
              }}
            >
              {cleaning ? "Limpando..." : "Limpar Docker"}
            </button>
          </div>
          {stats.disks.map((d) => (
            <Gauge key={d.mount} value={d.used} max={d.total} label={d.mount} color="#e65100"
              detail={`${formatBytes(d.used)} / ${formatBytes(d.total)}`} />
          ))}
          <div style={{ fontSize: "0.65rem", color: "#999", marginTop: "0.3rem", marginBottom: "0.5rem" }}>
            Gravações no disco: {formatBytes(stats.recordings.local_size || stats.recordings.total_size)} ({stats.recordings.local_count ?? stats.recordings.total} arquivos)
            {" | "}DB: {formatBytes(stats.database.size)}
          </div>

          {/* Disk breakdown */}
          {stats.disk_breakdown && stats.disk_breakdown.length > 0 && (
            <div style={{ borderTop: "1px solid #eee", paddingTop: "0.5rem" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, marginBottom: "0.3rem", color: "#555" }}>
                Detalhamento do uso de disco
              </div>
              <table style={{ width: "100%", fontSize: "0.65rem", borderCollapse: "collapse" }}>
                <tbody>
                  {stats.disk_breakdown
                    .filter((d: DiskBreakdownItem) => {
                      // Show docker items with size string, and system items > 10MB
                      if (d.category === 'docker') return !!d.size;
                      return d.bytes && d.bytes > 10 * 1024 * 1024;
                    })
                    // Keep backend order: Docker group first, then other dirs
                    .map((d: DiskBreakdownItem, i: number) => {
                      const diskTotal = stats.disks[0]?.total || 1;
                      const pct = d.bytes ? ((d.bytes / diskTotal) * 100).toFixed(1) : '—';
                      const isChild = d.name.startsWith('  ');
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                          <td style={{
                            padding: "0.2rem 0",
                            color: isChild ? "#777" : "#333",
                            paddingLeft: isChild ? "0.8rem" : "0",
                            fontSize: isChild ? "0.6rem" : undefined,
                          }}>
                            {d.name.trim()}
                          </td>
                          <td style={{ padding: "0.2rem 0", textAlign: "right", fontWeight: 600, color: isChild ? "#999" : "#e65100" }}>
                            {d.bytes ? formatBytes(d.bytes) : d.size || '—'}
                          </td>
                          <td style={{ padding: "0.2rem 0 0.2rem 0.5rem", textAlign: "right", color: "#999" }}>
                            {pct}%
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {stats.disk_breakdown.filter((d: DiskBreakdownItem) => d.category === 'docker' && d.reclaimable).length > 0 && (
                <div style={{ fontSize: "0.6rem", color: "#e65100", marginTop: "0.3rem", fontStyle: "italic" }}>
                  Docker recuperável: {stats.disk_breakdown.filter((d: DiskBreakdownItem) => d.category === 'docker').map((d: DiskBreakdownItem) => `${d.name}: ${d.reclaimable}`).join(' | ')}
                </div>
              )}
            </div>
          )}

          {/* Cleanup results */}
          {cleanResult && (
            <div style={{
              marginTop: "0.5rem", padding: "0.5rem", borderRadius: "4px",
              background: cleanResult.success ? "#e8f5e9" : "#ffebee",
              fontSize: "0.65rem",
            }}>
              <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>
                {cleanResult.success ? "Limpeza concluída" : "Limpeza com erros"}
              </div>
              {cleanResult.results.map((r: any, i: number) => (
                <div key={i} style={{ color: r.error ? "#c62828" : "#2e7d32" }}>
                  {r.action}{r.output && r.output !== 'OK' ? `: ${r.output.slice(0, 100)}` : ''}
                  {r.error ? `: ${r.error}` : ''}
                </div>
              ))}
              <button onClick={() => setCleanResult(null)} style={{
                marginTop: "0.3rem", fontSize: "0.6rem", border: "none",
                background: "transparent", color: "#999", cursor: "pointer", textDecoration: "underline",
              }}>fechar</button>
            </div>
          )}
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

      {/* S3 Storage */}
      <S3Card stats={stats} apiFetch={apiFetch} />
    </div>
  );
}

function S3Card({ stats, apiFetch }: { stats: SystemStats; apiFetch: (url: string, opts?: any) => Promise<Response> }) {
  const [migrating, setMigrating] = useState(false);
  const [migrationMsg, setMigrationMsg] = useState("");

  const startMigration = async () => {
    if (!confirm("Iniciar migração de todas as gravações locais para o S3? Os arquivos locais serão removidos após upload bem-sucedido.")) return;
    setMigrating(true);
    setMigrationMsg("");
    try {
      const res = await apiFetch("/api/monitor/s3/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency: 5, delete_local: true }),
      });
      const data = await res.json();
      if (data.error) setMigrationMsg(data.error);
      else setMigrationMsg(data.message);
    } catch (err) {
      setMigrationMsg(err instanceof Error ? err.message : "Erro");
    } finally {
      setMigrating(false);
    }
  };

  const migrationAction = async (action: "pause" | "resume" | "cancel") => {
    try {
      await apiFetch(`/api/monitor/s3/migrate/${action}`, { method: "POST" });
    } catch { /* ignore */ }
  };

  const s3 = stats.s3;
  const mig = s3?.migration;

  return (
    <div style={{ ...card, marginTop: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>Object Storage (S3)</div>
        <span style={{
          fontSize: "0.65rem", padding: "0.15rem 0.5rem", borderRadius: "10px", fontWeight: 600,
          background: s3?.status === 'healthy' ? "#e8f5e9" : s3?.configured ? "#ffebee" : "#fff3e0",
          color: s3?.status === 'healthy' ? "#2e7d32" : s3?.configured ? "#c62828" : "#e65100",
        }}>
          {s3?.status === 'healthy' ? "Conectado" : s3?.configured ? "Erro" : "Não configurado"}
        </span>
      </div>
      {s3?.configured ? (
        <div style={{ fontSize: "0.7rem", color: "#666" }}>
          <div style={{ marginBottom: "0.3rem" }}>
            <strong>Endpoint:</strong> {s3.endpoint} | <strong>Bucket:</strong> {s3.bucket}
          </div>

          {/* S3 error */}
          {s3.error && (
            <div style={{
              marginBottom: "0.4rem", padding: "0.3rem 0.5rem", borderRadius: "4px",
              background: "#ffebee", color: "#c62828", fontSize: "0.65rem",
            }}>
              Erro S3: {s3.error}
            </div>
          )}

          {/* S3 quota gauge (like VPS disk) */}
          {s3.bucket_quota > 0 && (
            <Gauge
              value={s3.bucket_size || 0}
              max={s3.bucket_quota}
              label="Espaço S3"
              color="#1565c0"
              detail={`${formatBytes(s3.bucket_size || 0)} / ${formatBytes(s3.bucket_quota)}`}
            />
          )}

          {/* Bucket usage grid */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem",
            marginBottom: "0.4rem", padding: "0.4rem", background: "#f5f5f5", borderRadius: "4px",
          }}>
            <div>
              <div style={{ fontSize: "0.6rem", color: "#999" }}>Armazenamento S3</div>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "#1565c0" }}>
                {formatBytes(s3.bucket_size || 0)}
              </div>
              <div style={{ fontSize: "0.6rem", color: "#999" }}>{s3.bucket_objects || 0} objetos no bucket</div>
            </div>
            <div>
              <div style={{ fontSize: "0.6rem", color: "#999" }}>Armazenamento local</div>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "#e65100" }}>
                {formatBytes(s3.local_size || 0)}
              </div>
              <div style={{ fontSize: "0.6rem", color: "#999" }}>{s3.recordings_local || 0} gravações no disco</div>
            </div>
          </div>

          {/* Migration progress */}
          <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.3rem" }}>
            <div>
              <span style={{ fontWeight: 600, color: "#2e7d32" }}>{s3.recordings_in_s3}</span> gravações no S3
            </div>
            <div>
              <span style={{ fontWeight: 600, color: "#e65100" }}>{s3.recordings_local}</span> gravações locais
            </div>
          </div>
          {(s3.recordings_local > 0 || s3.recordings_in_s3 > 0) && (
            <Gauge
              value={s3.recordings_in_s3}
              max={s3.recordings_in_s3 + s3.recordings_local}
              label="Migração para S3"
              color="#2e7d32"
              detail={`${(s3.recordings_in_s3 + s3.recordings_local) > 0 ? Math.round((s3.recordings_in_s3 / (s3.recordings_in_s3 + s3.recordings_local)) * 100) : 0}%`}
            />
          )}

          {/* Active migration status */}
          {mig?.running && (
            <div style={{
              marginTop: "0.5rem", padding: "0.5rem", borderRadius: "4px",
              background: mig.paused ? "#fff3e0" : "#e3f2fd", fontSize: "0.7rem",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                <strong>{mig.paused ? "Migração pausada" : "Migrando..."}</strong>
                <span style={{ color: "#999" }}>
                  {mig.speed_mbps.toFixed(1)} MB/s | {mig.elapsed_seconds}s
                </span>
              </div>
              <Gauge
                value={mig.completed + mig.skipped}
                max={mig.total}
                label={mig.current_file || "Processando..."}
                color="#1565c0"
                detail={`${mig.completed}/${mig.total} (${mig.percent}%)`}
              />
              <div style={{ fontSize: "0.6rem", color: "#999", marginBottom: "0.3rem" }}>
                Enviados: {formatBytes(mig.bytes_uploaded)} | Falhas: {mig.failed} | Ignorados: {mig.skipped}
              </div>
              <div style={{ display: "flex", gap: "0.3rem" }}>
                {!mig.paused ? (
                  <button onClick={() => migrationAction("pause")} style={{
                    fontSize: "0.65rem", padding: "0.2rem 0.5rem", borderRadius: "4px",
                    border: "1px solid #ff9800", background: "#fff3e0", color: "#e65100",
                    cursor: "pointer", fontWeight: 600,
                  }}>Pausar</button>
                ) : (
                  <button onClick={() => migrationAction("resume")} style={{
                    fontSize: "0.65rem", padding: "0.2rem 0.5rem", borderRadius: "4px",
                    border: "1px solid #2e7d32", background: "#e8f5e9", color: "#2e7d32",
                    cursor: "pointer", fontWeight: 600,
                  }}>Retomar</button>
                )}
                <button onClick={() => { if (confirm("Cancelar migração?")) migrationAction("cancel"); }} style={{
                  fontSize: "0.65rem", padding: "0.2rem 0.5rem", borderRadius: "4px",
                  border: "1px solid #c62828", background: "#ffebee", color: "#c62828",
                  cursor: "pointer", fontWeight: 600,
                }}>Cancelar</button>
              </div>
              {mig.errors.length > 0 && (
                <div style={{ marginTop: "0.3rem", fontSize: "0.6rem", color: "#c62828" }}>
                  Erros recentes: {mig.errors.slice(-3).map(e => e.file).join(", ")}
                </div>
              )}
            </div>
          )}

          {/* Start migration button (only if not running and there are local recordings) */}
          {!mig?.running && s3.recordings_local > 0 && (
            <div style={{ marginTop: "0.5rem" }}>
              <button
                onClick={startMigration}
                disabled={migrating}
                style={{
                  fontSize: "0.7rem", padding: "0.3rem 0.8rem", borderRadius: "4px",
                  border: "1px solid #1565c0", background: migrating ? "#ccc" : "#e3f2fd",
                  color: "#1565c0", cursor: migrating ? "not-allowed" : "pointer", fontWeight: 600,
                }}
              >
                {migrating ? "Iniciando..." : `Migrar ${s3.recordings_local} gravações para S3`}
              </button>
              {migrationMsg && (
                <span style={{ marginLeft: "0.5rem", fontSize: "0.65rem", color: "#666" }}>{migrationMsg}</span>
              )}
            </div>
          )}

          {/* Migration completed summary */}
          {mig && !mig.running && mig.total > 0 && (
            <div style={{
              marginTop: "0.5rem", padding: "0.4rem", borderRadius: "4px",
              background: "#e8f5e9", fontSize: "0.65rem", color: "#2e7d32",
            }}>
              Migração concluída: {mig.completed} enviados, {mig.failed} falhas, {mig.skipped} ignorados
              ({formatBytes(mig.bytes_uploaded)} em {mig.elapsed_seconds}s)
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: "0.7rem", color: "#999" }}>
          Gravações armazenadas no disco local. Configure as variáveis S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY e S3_SECRET_KEY para ativar.
        </div>
      )}
    </div>
  );
}

export default Monitoring;
