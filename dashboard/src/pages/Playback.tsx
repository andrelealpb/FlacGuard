import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

interface Camera {
  id: string;
  name: string;
  pdv_name: string;
  recording_mode: string;
}

interface Recording {
  id: string;
  camera_name: string;
  file_path: string;
  file_size: number | null;
  duration: number | null;
  started_at: string;
  ended_at: string | null;
  recording_type: string;
  thumbnail_path: string | null;
}

type PlaybackSpeed = 0.5 | 1 | 2 | 4;

// ─── Helpers ───

function formatTime(date: Date) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatTimeSeconds(date: Date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function formatBytes(bytes: number) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1024).toFixed(0) + " KB";
}

function dateToYMD(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isToday(date: Date) {
  const now = new Date();
  return dateToYMD(date) === dateToYMD(now);
}

// ─── Timeline Component ───

function Timeline({
  recordings,
  selectedRecording,
  onSelectRecording,
  onSelectTime,
}: {
  recordings: Recording[];
  selectedRecording: Recording | null;
  onSelectRecording: (r: Recording) => void;
  onSelectTime: (time: Date) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [hoveredTime, setHoveredTime] = useState<string | null>(null);
  const [hoveredX, setHoveredX] = useState(0);

  // 24 hours in the timeline
  const HOURS = 24;
  const HOUR_LABELS = Array.from({ length: HOURS }, (_, i) =>
    String(i).padStart(2, "0") + ":00"
  );

  const getTimePercent = (date: Date) => {
    const h = date.getHours();
    const m = date.getMinutes();
    const s = date.getSeconds();
    return ((h * 3600 + m * 60 + s) / 86400) * 100;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    const totalSec = Math.floor(pct * 86400);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    setHoveredTime(
      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    );
    setHoveredX(x);
  };

  const handleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    const totalSec = Math.floor(pct * 86400);

    // Find recording at this time
    const clickedRec = recordings.find((r) => {
      const startSec = getSecOfDay(new Date(r.started_at));
      const endSec = r.ended_at
        ? getSecOfDay(new Date(r.ended_at))
        : startSec + (r.duration || 0);
      return totalSec >= startSec && totalSec <= endSec;
    });

    if (clickedRec) {
      onSelectRecording(clickedRec);
    } else {
      // Navigate to closest recording
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const d = new Date();
      d.setHours(h, m, s, 0);
      onSelectTime(d);
    }
  };

  const getSecOfDay = (date: Date) =>
    date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();

  return (
    <div style={{ position: "relative", userSelect: "none" }}>
      {/* Hour labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.65rem",
          color: "#999",
          marginBottom: "2px",
          paddingLeft: "0",
        }}
      >
        {HOUR_LABELS.filter((_, i) => i % 2 === 0).map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>

      {/* Timeline bar */}
      <div
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredTime(null)}
        onClick={handleClick}
        style={{
          position: "relative",
          height: "36px",
          background: "#1a1a2e",
          borderRadius: "4px",
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {/* Hour grid lines */}
        {HOUR_LABELS.map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(i / 24) * 100}%`,
              top: 0,
              bottom: 0,
              width: "1px",
              background: "rgba(255,255,255,0.1)",
            }}
          />
        ))}

        {/* Recording segments */}
        {recordings.map((r) => {
          const start = new Date(r.started_at);
          const end = r.ended_at ? new Date(r.ended_at) : new Date(start.getTime() + (r.duration || 60) * 1000);
          const startPct = getTimePercent(start);
          const endPct = getTimePercent(end);
          const widthPct = Math.max(endPct - startPct, 0.2); // min 0.2% width for visibility
          const isMotion = r.recording_type === "motion";
          const isSelected = selectedRecording?.id === r.id;

          return (
            <div
              key={r.id}
              title={`${formatTimeSeconds(start)} — ${formatTimeSeconds(end)}${isMotion ? " (movimento)" : ""}`}
              style={{
                position: "absolute",
                left: `${startPct}%`,
                width: `${widthPct}%`,
                top: isMotion ? "2px" : "6px",
                bottom: isMotion ? "2px" : "6px",
                background: isMotion
                  ? isSelected ? "#ff9800" : "#ff980099"
                  : isSelected ? "#4caf50" : "#4caf5099",
                borderRadius: "2px",
                transition: "background 0.15s",
                border: isSelected ? "1px solid #fff" : "none",
              }}
            />
          );
        })}

        {/* Hover indicator */}
        {hoveredTime && (
          <>
            <div
              style={{
                position: "absolute",
                left: hoveredX,
                top: 0,
                bottom: 0,
                width: "1px",
                background: "#fff",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: Math.min(hoveredX - 25, (canvasRef.current?.clientWidth || 300) - 60),
                top: "-22px",
                background: "#333",
                color: "#fff",
                padding: "2px 6px",
                borderRadius: "3px",
                fontSize: "0.7rem",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {hoveredTime}
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginTop: "4px",
          fontSize: "0.7rem",
          color: "#888",
        }}
      >
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "#4caf50",
              borderRadius: "2px",
              marginRight: "4px",
              verticalAlign: "middle",
            }}
          />
          Contínua
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "#ff9800",
              borderRadius: "2px",
              marginRight: "4px",
              verticalAlign: "middle",
            }}
          />
          Movimento
        </span>
        <span style={{ marginLeft: "auto" }}>
          {recordings.length} gravações
        </span>
      </div>
    </div>
  );
}

// ─── Video Player Component ───

function VideoPlayer({
  recording,
  recordings,
  onSelectRecording,
}: {
  recording: Recording;
  recordings: Recording[];
  onSelectRecording: (r: Recording) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const streamUrl = `/api/recordings/${recording.id}/stream`;

  // Reset state on recording change
  useEffect(() => {
    setPlaying(false);
    setSpeed(1);
    setCurrent(0);
    setDuration(0);
  }, [recording.id]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
  }, [speed]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, []);

  const skipBack10 = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, v.currentTime - 10);
  }, []);

  const skipForward10 = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(v.duration, v.currentTime + 10);
  }, []);

  const goToPrev = useCallback(() => {
    const idx = recordings.findIndex((r) => r.id === recording.id);
    if (idx > 0) onSelectRecording(recordings[idx - 1]);
  }, [recording.id, recordings, onSelectRecording]);

  const goToNext = useCallback(() => {
    const idx = recordings.findIndex((r) => r.id === recording.id);
    if (idx < recordings.length - 1) onSelectRecording(recordings[idx + 1]);
  }, [recording.id, recordings, onSelectRecording]);

  const toggleFullscreen = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      v.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = parseFloat(e.target.value);
  }, []);

  const speeds: PlaybackSpeed[] = [0.5, 1, 2, 4];

  const recStart = new Date(recording.started_at);

  // Computed current timestamp in real time
  const currentTimestamp = new Date(
    recStart.getTime() + currentTime * 1000
  );

  const controlBtn: React.CSSProperties = {
    background: "none",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    fontSize: "1rem",
    padding: "0.4rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.9,
  };

  const speedBtn = (s: PlaybackSpeed): React.CSSProperties => ({
    ...controlBtn,
    fontSize: "0.75rem",
    fontWeight: speed === s ? 700 : 400,
    opacity: speed === s ? 1 : 0.6,
    background: speed === s ? "rgba(255,255,255,0.15)" : "none",
    borderRadius: "3px",
    padding: "0.2rem 0.4rem",
  });

  return (
    <div
      style={{
        background: "#000",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid #333",
      }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        src={streamUrl}
        style={{ width: "100%", aspectRatio: "16/9", background: "#000", display: "block" }}
        onTimeUpdate={() => setCurrent(videoRef.current?.currentTime || 0)}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          // Auto-play next recording
          goToNext();
        }}
        onClick={togglePlay}
        playsInline
      />

      {/* Timestamp overlay */}
      <div
        style={{
          background: "rgba(0,0,0,0.7)",
          color: "#4caf50",
          padding: "0.2rem 0.6rem",
          fontSize: "0.8rem",
          fontFamily: "monospace",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{formatTimeSeconds(currentTimestamp)}</span>
        <span style={{ color: "#999", fontSize: "0.7rem" }}>
          {recording.camera_name} |{" "}
          {recording.recording_type === "motion" ? "Movimento" : "Contínua"}
          {recording.file_size ? ` | ${formatBytes(recording.file_size)}` : ""}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ padding: "0 0.5rem", background: "#111" }}>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          style={{
            width: "100%",
            height: "6px",
            cursor: "pointer",
            accentColor: "#4caf50",
          }}
        />
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.3rem 0.5rem",
          background: "#111",
          color: "#fff",
          gap: "0.25rem",
          flexWrap: "wrap",
        }}
      >
        {/* Left: playback controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.15rem" }}>
          {/* Prev */}
          <button onClick={goToPrev} style={controlBtn} title="Gravação anterior">
            &#9198;
          </button>

          {/* Back 10s */}
          <button onClick={skipBack10} style={controlBtn} title="Voltar 10s">
            <span style={{ fontSize: "0.7rem", position: "relative" }}>
              <span style={{ fontSize: "1.1rem" }}>&#8634;</span>
              <span
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%,-50%)",
                  fontSize: "0.45rem",
                  fontWeight: 700,
                }}
              >
                10
              </span>
            </span>
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            style={{ ...controlBtn, fontSize: "1.3rem" }}
            title={playing ? "Pausar" : "Reproduzir"}
          >
            {playing ? "\u23F8" : "\u25B6"}
          </button>

          {/* Forward 10s */}
          <button onClick={skipForward10} style={controlBtn} title="Avançar 10s">
            <span style={{ fontSize: "0.7rem", position: "relative" }}>
              <span style={{ fontSize: "1.1rem" }}>&#8635;</span>
              <span
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%,-50%)",
                  fontSize: "0.45rem",
                  fontWeight: 700,
                }}
              >
                10
              </span>
            </span>
          </button>

          {/* Next */}
          <button onClick={goToNext} style={controlBtn} title="Próxima gravação">
            &#9197;
          </button>
        </div>

        {/* Center: time / speed */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.8rem",
            fontFamily: "monospace",
          }}
        >
          <span>
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
          <div
            style={{
              display: "flex",
              gap: "2px",
              background: "rgba(255,255,255,0.05)",
              borderRadius: "4px",
              padding: "1px",
            }}
          >
            {speeds.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSpeed(s);
                  if (videoRef.current) videoRef.current.playbackRate = s;
                }}
                style={speedBtn(s)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Right: volume + fullscreen */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
          <button
            onClick={() => {
              setMuted(!muted);
              if (videoRef.current) videoRef.current.muted = !muted;
            }}
            style={controlBtn}
          >
            {muted ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              setMuted(v === 0);
              if (videoRef.current) {
                videoRef.current.volume = v;
                videoRef.current.muted = v === 0;
              }
            }}
            style={{ width: "60px", accentColor: "#4caf50" }}
          />
          <button onClick={toggleFullscreen} style={controlBtn} title="Tela cheia">
            &#x26F6;
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Recording List (sidebar) ───

function RecordingList({
  recordings,
  selectedRecording,
  onSelect,
}: {
  recordings: Recording[];
  selectedRecording: Recording | null;
  onSelect: (r: Recording) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to selected
  useEffect(() => {
    if (!selectedRecording || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-id="${selectedRecording.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedRecording?.id]);

  if (recordings.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "2rem 1rem",
          color: "#999",
          fontSize: "0.85rem",
        }}
      >
        Nenhuma gravação neste dia.
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      style={{
        maxHeight: "400px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      {recordings.map((r) => {
        const start = new Date(r.started_at);
        const end = r.ended_at ? new Date(r.ended_at) : null;
        const isSelected = selectedRecording?.id === r.id;
        const isMotion = r.recording_type === "motion";

        return (
          <div
            key={r.id}
            data-id={r.id}
            onClick={() => onSelect(r)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 0.75rem",
              borderRadius: "6px",
              cursor: "pointer",
              background: isSelected ? "#e8f5e9" : "#fff",
              border: isSelected ? "1px solid #4caf50" : "1px solid #eee",
              transition: "background 0.15s",
            }}
          >
            {/* Color indicator */}
            <div
              style={{
                width: 4,
                minHeight: 32,
                borderRadius: "2px",
                background: isMotion ? "#ff9800" : "#4caf50",
                flexShrink: 0,
              }}
            />

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                  {formatTime(start)}
                  {end && ` — ${formatTime(end)}`}
                </span>
                <span
                  style={{
                    fontSize: "0.65rem",
                    padding: "0.1rem 0.3rem",
                    borderRadius: "3px",
                    background: isMotion ? "#fff3e0" : "#e8f5e9",
                    color: isMotion ? "#e65100" : "#2e7d32",
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {isMotion ? "MOV" : "REC"}
                </span>
              </div>
              <div
                style={{
                  fontSize: "0.7rem",
                  color: "#888",
                  display: "flex",
                  gap: "0.5rem",
                }}
              >
                {r.duration && <span>{formatDuration(r.duration)}</span>}
                {r.file_size && <span>{formatBytes(r.file_size)}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Playback Page ───

function Playback() {
  const { apiFetch } = useAuth();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [selectedDate, setSelectedDate] = useState(dateToYMD(new Date()));
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTimestamp, setSearchTimestamp] = useState("");

  // Load cameras
  useEffect(() => {
    apiFetch("/api/cameras")
      .then((res) => res.json())
      .then((cams: Camera[]) => {
        setCameras(cams);
        if (cams.length > 0 && !selectedCameraId) {
          setSelectedCameraId(cams[0].id);
        }
      })
      .catch(console.error);
  }, []);

  // Load recordings when camera or date changes
  useEffect(() => {
    if (!selectedCameraId || !selectedDate) return;
    setLoading(true);
    setSelectedRecording(null);

    apiFetch(
      `/api/recordings/by-day?camera_id=${selectedCameraId}&date=${selectedDate}`
    )
      .then((res) => res.json())
      .then((data: Recording[]) => {
        setRecordings(data);
        setLoading(false);
      })
      .catch(() => {
        setRecordings([]);
        setLoading(false);
      });
  }, [selectedCameraId, selectedDate]);

  const changeDay = (delta: number) => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setSelectedDate(dateToYMD(d));
  };

  const goToToday = () => {
    setSelectedDate(dateToYMD(new Date()));
  };

  const searchByTimestamp = () => {
    if (!selectedCameraId || !searchTimestamp) return;
    apiFetch(
      `/api/cameras/${selectedCameraId}/recording?timestamp=${searchTimestamp}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data && !data.error) {
          // Navigate to the day of the result
          const d = new Date(data.started_at);
          setSelectedDate(dateToYMD(d));
          // After recordings load, select this one
          setTimeout(() => setSelectedRecording(data), 500);
        }
      })
      .catch(console.error);
  };

  const handleSelectTime = (time: Date) => {
    // Find the closest recording to this time
    const targetSec =
      time.getHours() * 3600 + time.getMinutes() * 60 + time.getSeconds();
    let closest: Recording | null = null;
    let closestDist = Infinity;

    for (const r of recordings) {
      const start = new Date(r.started_at);
      const startSec =
        start.getHours() * 3600 + start.getMinutes() * 60 + start.getSeconds();
      const dist = Math.abs(startSec - targetSec);
      if (dist < closestDist) {
        closestDist = dist;
        closest = r;
      }
    }

    if (closest) setSelectedRecording(closest);
  };

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);
  const displayDate = new Date(selectedDate + "T12:00:00");

  const btnStyle: React.CSSProperties = {
    padding: "0.3rem 0.6rem",
    border: "1px solid #ccc",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.85rem",
    background: "#fff",
  };

  return (
    <div>
      {/* Header */}
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
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Gravações</h2>
      </div>

      {/* Controls row: camera + date + timestamp search */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        {/* Camera selector */}
        <select
          value={selectedCameraId}
          onChange={(e) => setSelectedCameraId(e.target.value)}
          style={{
            padding: "0.5rem",
            borderRadius: "4px",
            border: "1px solid #ccc",
            fontSize: "0.85rem",
            minWidth: "200px",
          }}
        >
          <option value="">Selecione a câmera</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.pdv_name} — {c.name}
            </option>
          ))}
        </select>

        {/* Day navigation */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.25rem",
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: "4px",
            padding: "0.2rem",
          }}
        >
          <button
            onClick={() => changeDay(-1)}
            style={{ ...btnStyle, border: "none", padding: "0.3rem 0.5rem" }}
          >
            &#9664;
          </button>
          <button
            onClick={goToToday}
            style={{
              ...btnStyle,
              border: "none",
              fontWeight: isToday(displayDate) ? 700 : 400,
              minWidth: "140px",
              textAlign: "center",
            }}
          >
            {isToday(displayDate) ? "Hoje" : formatDate(displayDate)}
          </button>
          <button
            onClick={() => changeDay(1)}
            disabled={isToday(displayDate)}
            style={{
              ...btnStyle,
              border: "none",
              padding: "0.3rem 0.5rem",
              opacity: isToday(displayDate) ? 0.3 : 1,
            }}
          >
            &#9654;
          </button>
        </div>

        <input
          type="date"
          value={selectedDate}
          max={dateToYMD(new Date())}
          onChange={(e) => setSelectedDate(e.target.value)}
          style={{
            padding: "0.4rem",
            borderRadius: "4px",
            border: "1px solid #ccc",
            fontSize: "0.85rem",
          }}
        />

        {/* Divider */}
        <div
          style={{ width: "1px", height: "28px", background: "#ddd" }}
        />

        {/* Timestamp search */}
        <input
          type="datetime-local"
          value={searchTimestamp}
          onChange={(e) => setSearchTimestamp(e.target.value)}
          placeholder="Momento exato"
          style={{
            padding: "0.4rem",
            borderRadius: "4px",
            border: "1px solid #ccc",
            fontSize: "0.85rem",
          }}
        />
        <button
          onClick={searchByTimestamp}
          disabled={!searchTimestamp || !selectedCameraId}
          style={{
            ...btnStyle,
            background: "#1a1a2e",
            color: "#fff",
            border: "1px solid #1a1a2e",
            opacity: !searchTimestamp || !selectedCameraId ? 0.5 : 1,
          }}
        >
          Buscar momento
        </button>
      </div>

      {/* Timeline bar */}
      {selectedCameraId && (
        <div
          style={{
            background: "#fff",
            borderRadius: "8px",
            border: "1px solid #ddd",
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
          }}
        >
          <Timeline
            recordings={recordings}
            selectedRecording={selectedRecording}
            onSelectRecording={setSelectedRecording}
            onSelectTime={handleSelectTime}
          />
        </div>
      )}

      {/* Main content: player + list */}
      {loading ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem",
            color: "#999",
          }}
        >
          Carregando gravações...
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: selectedRecording ? "1fr 320px" : "1fr",
            gap: "1rem",
            alignItems: "start",
          }}
        >
          {/* Video Player */}
          <div>
            {selectedRecording ? (
              <VideoPlayer
                recording={selectedRecording}
                recordings={recordings}
                onSelectRecording={setSelectedRecording}
              />
            ) : (
              <div
                style={{
                  background: "#000",
                  borderRadius: "8px",
                  aspectRatio: "16/9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#666",
                  fontSize: "0.9rem",
                }}
              >
                {recordings.length > 0
                  ? "Selecione uma gravação na timeline ou na lista"
                  : selectedCameraId
                    ? "Nenhuma gravação neste dia"
                    : "Selecione uma câmera"}
              </div>
            )}
          </div>

          {/* Recording list (sidebar) */}
          {recordings.length > 0 && (
            <div
              style={{
                background: "#fff",
                borderRadius: "8px",
                border: "1px solid #ddd",
                padding: "0.5rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: "#333",
                  padding: "0.25rem 0.5rem 0.5rem",
                  borderBottom: "1px solid #eee",
                  marginBottom: "0.5rem",
                }}
              >
                {formatDate(displayDate)} — {selectedCamera?.name}
              </div>
              <RecordingList
                recordings={recordings}
                selectedRecording={selectedRecording}
                onSelect={setSelectedRecording}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Playback;
