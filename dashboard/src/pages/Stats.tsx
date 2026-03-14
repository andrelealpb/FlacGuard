import { useEffect, useState } from "react";

interface StreamInfo {
  name: string;
  nclients: string;
  bw_in: string;
  bw_out: string;
  time: string;
  video?: { width: string; height: string; frame_rate: string; codec: string };
  audio?: { codec: string; sample_rate: string };
}

interface RtmpStats {
  nginx_version: string;
  nginx_rtmp_version: string;
  uptime: string;
  naccepted: string;
  bw_in: string;
  bw_out: string;
  bytes_in: string;
  bytes_out: string;
  streams: StreamInfo[];
}

function parseStats(xml: string): RtmpStats | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const get = (tag: string) => doc.querySelector(`:scope > ${tag}`)?.textContent || "0";

    const streams: StreamInfo[] = [];
    doc.querySelectorAll("application > live > stream").forEach((s) => {
      const sGet = (tag: string) => s.querySelector(tag)?.textContent || "0";
      const video = s.querySelector("meta > video");
      const audio = s.querySelector("meta > audio");
      streams.push({
        name: sGet("name"),
        nclients: sGet("nclients"),
        bw_in: sGet("bw_in"),
        bw_out: sGet("bw_out"),
        time: sGet("time"),
        video: video
          ? {
              width: video.querySelector("width")?.textContent || "",
              height: video.querySelector("height")?.textContent || "",
              frame_rate: video.querySelector("frame_rate")?.textContent || "",
              codec: video.querySelector("codec")?.textContent || "",
            }
          : undefined,
        audio: audio
          ? {
              codec: audio.querySelector("codec")?.textContent || "",
              sample_rate: audio.querySelector("sample_rate")?.textContent || "",
            }
          : undefined,
      });
    });

    return {
      nginx_version: doc.querySelector("nginx_version")?.textContent || "",
      nginx_rtmp_version: doc.querySelector("nginx_rtmp_version")?.textContent || "",
      uptime: get("uptime"),
      naccepted: get("naccepted"),
      bw_in: get("bw_in"),
      bw_out: get("bw_out"),
      bytes_in: get("bytes_in"),
      bytes_out: get("bytes_out"),
      streams,
    };
  } catch {
    return null;
  }
}

function formatBw(bw: string) {
  const n = parseInt(bw);
  if (n >= 1048576) return (n / 1048576).toFixed(2) + " Mbps";
  if (n >= 1024) return (n / 1024).toFixed(1) + " Kbps";
  return n + " bps";
}

function formatBytes(b: string) {
  const n = parseInt(b);
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(2) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}

function formatUptime(sec: string) {
  const s = parseInt(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (d > 0 ? d + "d " : "") + pad(h) + ":" + pad(m) + ":" + pad(ss);
}

function formatStreamTime(ms: string) {
  return formatUptime(String(Math.floor(parseInt(ms) / 1000)));
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: "8px",
  padding: "1rem 1.25rem",
  minWidth: "130px",
};

function Stats() {
  const [stats, setStats] = useState<RtmpStats | null>(null);
  const [error, setError] = useState("");

  const fetchStats = () => {
    fetch("/rtmp-stat")
      .then((res) => res.text())
      .then((xml) => {
        const parsed = parseStats(xml);
        if (parsed) {
          setStats(parsed);
          setError("");
        } else {
          setError("Erro ao processar stats");
        }
      })
      .catch(() => setError("Erro ao conectar com RTMP server"));
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>RTMP Stats</h2>
        {stats && (
          <span style={{ fontSize: "0.8rem", color: "#999" }}>
            Nginx {stats.nginx_version} | RTMP {stats.nginx_rtmp_version} | Uptime: {formatUptime(stats.uptime)} | Auto-refresh: 5s
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: "1rem", background: "#ffebee", color: "#c62828", borderRadius: "8px", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {stats && (
        <>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
            <div style={cardStyle}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase" }}>Conexões</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1a1a2e" }}>{stats.naccepted}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase" }}>BW In</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1a1a2e", fontFamily: "monospace" }}>{formatBw(stats.bw_in)}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase" }}>BW Out</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1a1a2e", fontFamily: "monospace" }}>{formatBw(stats.bw_out)}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase" }}>Total In</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1a1a2e", fontFamily: "monospace" }}>{formatBytes(stats.bytes_in)}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase" }}>Total Out</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1a1a2e", fontFamily: "monospace" }}>{formatBytes(stats.bytes_out)}</div>
            </div>
          </div>

          <h3 style={{ marginBottom: "0.75rem" }}>Streams Ativos</h3>
          {stats.streams.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "#999", background: "#fff", borderRadius: "8px", border: "1px solid #ddd" }}>
              Nenhum stream ativo
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: "8px", overflow: "hidden", border: "1px solid #ddd" }}>
              <thead>
                <tr style={{ background: "#1a1a2e", color: "#fff" }}>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem" }}>Stream</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem" }}>Clients</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem" }}>BW In</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem" }}>BW Out</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem" }}>Video</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem" }}>Audio</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem" }}>Uptime</th>
                </tr>
              </thead>
              <tbody>
                {stats.streams.map((s) => (
                  <tr key={s.name} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "0.75rem 1rem", fontWeight: 600, color: "#2e7d32" }}>{s.name}</td>
                    <td style={{ padding: "0.75rem 1rem" }}>{s.nclients}</td>
                    <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace" }}>{formatBw(s.bw_in)}</td>
                    <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace" }}>{formatBw(s.bw_out)}</td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.85rem" }}>
                      {s.video ? `${s.video.width}x${s.video.height} ${s.video.frame_rate}fps ${s.video.codec}` : "—"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.85rem" }}>
                      {s.audio ? `${s.audio.codec} ${s.audio.sample_rate}Hz` : "—"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace" }}>{formatStreamTime(s.time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

export default Stats;
