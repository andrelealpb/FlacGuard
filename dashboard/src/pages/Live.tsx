import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import HlsPlayer from "../components/HlsPlayer";

interface Camera {
  id: string;
  name: string;
  stream_key: string;
  status: "online" | "offline" | "error";
  pdv_name: string;
  recording_mode: string;
}

type GridSize = "auto" | "2" | "3" | "4";

function Live() {
  const { apiFetch } = useAuth();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [filter, setFilter] = useState<"all" | "online" | "offline">("all");
  const [gridSize, setGridSize] = useState<GridSize>("auto");

  useEffect(() => {
    apiFetch("/api/cameras")
      .then((res) => res.json())
      .then(setCameras)
      .catch(console.error);

    // Auto-refresh camera status every 10s
    const interval = setInterval(() => {
      apiFetch("/api/cameras")
        .then((res) => res.json())
        .then(setCameras)
        .catch(() => {});
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const filtered = cameras.filter((c) =>
    filter === "all" ? true : c.status === filter
  );

  const onlineCount = cameras.filter((c) => c.status === "online").length;

  const gridTemplateColumns: Record<GridSize, string> = {
    auto: `repeat(auto-fill, minmax(280px, 1fr))`,
    "2": "repeat(2, 1fr)",
    "3": "repeat(3, 1fr)",
    "4": "repeat(4, 1fr)",
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
          Ao Vivo ({onlineCount}/{cameras.length} online)
        </h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {/* Grid size selector */}
          <div
            style={{
              display: "flex",
              gap: "0.25rem",
              background: "#eee",
              borderRadius: "4px",
              padding: "2px",
            }}
          >
            {(
              [
                { value: "auto", label: "Auto" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" },
              ] as const
            ).map((g) => (
              <button
                key={g.value}
                onClick={() => setGridSize(g.value)}
                style={{
                  padding: "0.25rem 0.5rem",
                  border: "none",
                  borderRadius: "3px",
                  background:
                    gridSize === g.value ? "#1a1a2e" : "transparent",
                  color: gridSize === g.value ? "#fff" : "#666",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: gridSize === g.value ? 600 : 400,
                }}
              >
                {g.label}
              </button>
            ))}
          </div>

          {/* Status filter */}
          {(["all", "online", "offline"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "0.3rem 0.6rem",
                border: "1px solid #ccc",
                borderRadius: "4px",
                background: filter === f ? "#1a1a2e" : "#fff",
                color: filter === f ? "#fff" : "#333",
                cursor: "pointer",
                fontSize: "0.8rem",
              }}
            >
              {f === "all" ? "Todas" : f === "online" ? "Online" : "Offline"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "4rem", color: "#666" }}>
          <p>Nenhuma câmera encontrada.</p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridTemplateColumns[gridSize],
            gap: "0.5rem",
          }}
        >
          {filtered.map((camera) => (
            <div
              key={camera.id}
              style={{
                border: "1px solid #333",
                borderRadius: "4px",
                overflow: "hidden",
                background: "#000",
              }}
            >
              {camera.status === "online" ? (
                <HlsPlayer
                  src={`/hls/${camera.stream_key}.m3u8`}
                  autoPlay
                  muted
                />
              ) : (
                <div
                  style={{
                    aspectRatio: "16/9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#666",
                    fontSize: "0.8rem",
                  }}
                >
                  Câmera offline
                </div>
              )}
              <div
                style={{
                  padding: "0.3rem 0.6rem",
                  background: "#1a1a2e",
                  color: "#fff",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: "0.8rem",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {camera.name}
                  </div>
                  <div
                    style={{
                      fontSize: "0.65rem",
                      opacity: 0.7,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {camera.pdv_name}
                    {camera.recording_mode === "motion" && (
                      <span
                        style={{
                          marginLeft: "0.4rem",
                          background: "rgba(255,152,0,0.3)",
                          padding: "0 0.25rem",
                          borderRadius: "2px",
                          fontSize: "0.6rem",
                        }}
                      >
                        MOV
                      </span>
                    )}
                  </div>
                </div>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background:
                      camera.status === "online" ? "#4caf50" : "#f44336",
                    display: "inline-block",
                    flexShrink: 0,
                    marginLeft: "0.3rem",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Live;
