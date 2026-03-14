import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
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

interface DetectedFace {
  id: number;
  bbox: { x: number; y: number; w: number; h: number }; // 0-1 relative
  confidence: number;
  embedding: number[];
}

interface FaceAppearance {
  id: string;
  camera_id: string;
  camera_name: string;
  pdv_id: string;
  pdv_name: string;
  similarity: number;
  confidence: number;
  detected_at: string;
  face_image: string | null;
  first_seen: string;
  last_seen: string;
  detections: number;
}

type PlaybackSpeed = 0.5 | 1 | 2 | 4;

// ─── Helpers ───

function formatTime(date: Date) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatTimeSeconds(date: Date) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(date: Date) {
  return date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
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

function isSameDay(date: Date) {
  return dateToYMD(date) === dateToYMD(new Date());
}

// ─── Timeline ───

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
  const barRef = useRef<HTMLDivElement>(null);
  const [hoveredTime, setHoveredTime] = useState<string | null>(null);
  const [hoveredX, setHoveredX] = useState(0);

  const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

  const timeToPct = (date: Date) => ((date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()) / 86400) * 100;

  const secOfDay = (date: Date) => date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const sec = Math.floor((x / rect.width) * 86400);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    setHoveredTime(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    setHoveredX(x);
  };

  const handleClick = (e: React.MouseEvent) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const totalSec = Math.floor(((e.clientX - rect.left) / rect.width) * 86400);

    const clicked = recordings.find((r) => {
      const s = secOfDay(new Date(r.started_at));
      const en = r.ended_at ? secOfDay(new Date(r.ended_at)) : s + (r.duration || 0);
      return totalSec >= s && totalSec <= en;
    });

    if (clicked) { onSelectRecording(clicked); return; }
    const d = new Date(); d.setHours(Math.floor(totalSec / 3600), Math.floor((totalSec % 3600) / 60), totalSec % 60, 0);
    onSelectTime(d);
  };

  return (
    <div style={{ position: "relative", userSelect: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6rem", color: "#aaa", marginBottom: "1px" }}>
        {HOUR_LABELS.filter((_, i) => i % 3 === 0).map((l) => <span key={l}>{l}h</span>)}
      </div>
      <div
        ref={barRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredTime(null)}
        onClick={handleClick}
        style={{ position: "relative", height: "28px", background: "#1a1a2e", borderRadius: "3px", cursor: "pointer", overflow: "hidden" }}
      >
        {HOUR_LABELS.map((_, i) => (
          <div key={i} style={{ position: "absolute", left: `${(i / 24) * 100}%`, top: 0, bottom: 0, width: "1px", background: "rgba(255,255,255,0.08)" }} />
        ))}
        {recordings.map((r) => {
          const start = new Date(r.started_at);
          const end = r.ended_at ? new Date(r.ended_at) : new Date(start.getTime() + (r.duration || 60) * 1000);
          const leftPct = timeToPct(start);
          const widthPct = Math.max(timeToPct(end) - leftPct, 0.15);
          const isMot = r.recording_type === "motion";
          const isSel = selectedRecording?.id === r.id;
          return (
            <div key={r.id} title={`${formatTimeSeconds(start)} — ${formatTimeSeconds(end)}`}
              style={{ position: "absolute", left: `${leftPct}%`, width: `${widthPct}%`, top: isMot ? "2px" : "5px", bottom: isMot ? "2px" : "5px",
                background: isMot ? (isSel ? "#ff9800" : "#ff980088") : (isSel ? "#4caf50" : "#4caf5088"),
                borderRadius: "2px", border: isSel ? "1px solid #fff" : "none" }} />
          );
        })}
        {hoveredTime && (
          <>
            <div style={{ position: "absolute", left: hoveredX, top: 0, bottom: 0, width: "1px", background: "#fff", pointerEvents: "none" }} />
            <div style={{ position: "absolute", left: Math.max(0, Math.min(hoveredX - 25, (barRef.current?.clientWidth || 300) - 55)),
              top: "-20px", background: "#333", color: "#fff", padding: "1px 5px", borderRadius: "3px", fontSize: "0.65rem", pointerEvents: "none" }}>{hoveredTime}</div>
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "2px", fontSize: "0.65rem", color: "#999" }}>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#4caf50", borderRadius: "2px", marginRight: 3, verticalAlign: "middle" }} />Contínua</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#ff9800", borderRadius: "2px", marginRight: 3, verticalAlign: "middle" }} />Movimento</span>
        <span style={{ marginLeft: "auto" }}>{recordings.length} gravações</span>
      </div>
    </div>
  );
}

// ─── Video Player with Face Detection Overlay ───

function VideoPlayer({
  recording, recordings, onSelectRecording, token, apiFetch, onFaceClick,
}: {
  recording: Recording; recordings: Recording[]; onSelectRecording: (r: Recording) => void; token: string;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onFaceClick: (embedding: number[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [currentTime, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [faceDetectOn, setFaceDetectOn] = useState(false);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [hoveredFace, setHoveredFace] = useState<number | null>(null);
  const [faceError, setFaceError] = useState("");
  const lastDetectTime = useRef(-999);
  const detectingRef = useRef(false);

  const [faceServiceOk, setFaceServiceOk] = useState<boolean | null>(null);

  // Check face service health once on mount
  useEffect(() => {
    apiFetch("/api/faces/status")
      .then((r) => r.json())
      .then((d) => setFaceServiceOk(d.service_available === true))
      .catch(() => setFaceServiceOk(false));
  }, []);

  const streamUrl = `/api/recordings/${recording.id}/stream?token=${encodeURIComponent(token)}`;

  useEffect(() => {
    setCurrent(0); setDuration(0); setError(""); setDetectedFaces([]); setFaceError(""); lastDetectTime.current = -999;
    const v = videoRef.current;
    if (v) { v.playbackRate = speed; v.load(); v.play().catch(() => {}); }
  }, [recording.id]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);

  // Detect faces when video is paused or every ~3 seconds
  useEffect(() => {
    if (!faceDetectOn) { setDetectedFaces([]); setFaceError(""); return; }

    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || detectingRef.current) return;
      const t = v.currentTime;
      if (Math.abs(t - lastDetectTime.current) < 2.5) return; // debounce
      lastDetectTime.current = t;
      runDetection(t);
    }, 3000);

    return () => clearInterval(interval);
  }, [faceDetectOn, recording.id]);

  const runDetection = async (timestamp: number) => {
    setDetecting(true);
    detectingRef.current = true;
    setFaceError("");
    try {
      const res = await apiFetch(`/api/recordings/${recording.id}/detect-faces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestamp }),
      });
      if (res.ok) {
        const data = await res.json();
        setDetectedFaces(data.faces || []);
      } else {
        const err = await res.json().catch(() => ({ error: `Erro ${res.status}` }));
        setFaceError(err.error || `Erro ${res.status}`);
        setDetectedFaces([]);
      }
    } catch {
      setFaceError("Serviço de detecção indisponível");
      setDetectedFaces([]);
    }
    setDetecting(false);
    detectingRef.current = false;
  };

  // Manual detection on pause
  const handlePause = () => {
    setPlaying(false);
    if (faceDetectOn && videoRef.current) {
      runDetection(videoRef.current.currentTime);
    }
  };

  // Draw face rectangles on canvas overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const draw = () => {
      const rect = video.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!faceDetectOn || detectedFaces.length === 0) return;

      for (const face of detectedFaces) {
        const x = face.bbox.x * canvas.width;
        const y = face.bbox.y * canvas.height;
        const w = face.bbox.w * canvas.width;
        const h = face.bbox.h * canvas.height;
        const isHovered = hoveredFace === face.id;

        ctx.strokeStyle = isHovered ? "#ffeb3b" : "#4caf50";
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.strokeRect(x, y, w, h);

        // Confidence label
        ctx.fillStyle = isHovered ? "rgba(255,235,59,0.8)" : "rgba(76,175,80,0.8)";
        const label = `${(face.confidence * 100).toFixed(0)}%`;
        ctx.font = `${Math.max(10, canvas.width * 0.015)}px monospace`;
        const textW = ctx.measureText(label).width;
        ctx.fillRect(x, y - 16, textW + 6, 16);
        ctx.fillStyle = "#000";
        ctx.fillText(label, x + 3, y - 3);
      }
    };

    draw();
    const resizeObs = new ResizeObserver(draw);
    resizeObs.observe(video);
    return () => resizeObs.disconnect();
  }, [detectedFaces, faceDetectOn, hoveredFace]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || detectedFaces.length === 0) { togglePlay(); return; }

    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    const clicked = detectedFaces.find((f) =>
      mx >= f.bbox.x && mx <= f.bbox.x + f.bbox.w &&
      my >= f.bbox.y && my <= f.bbox.y + f.bbox.h
    );

    if (clicked) {
      onFaceClick(clicked.embedding);
    } else {
      togglePlay();
    }
  };

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || detectedFaces.length === 0) { setHoveredFace(null); return; }

    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    const hovered = detectedFaces.find((f) =>
      mx >= f.bbox.x && mx <= f.bbox.x + f.bbox.w &&
      my >= f.bbox.y && my <= f.bbox.y + f.bbox.h
    );

    setHoveredFace(hovered ? hovered.id : null);
    canvas.style.cursor = hovered ? "pointer" : "default";
  };

  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
  }, []);

  const skip = useCallback((sec: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + sec));
  }, []);

  const goToPrev = useCallback(() => {
    const idx = recordings.findIndex((r) => r.id === recording.id);
    if (idx > 0) onSelectRecording(recordings[idx - 1]);
  }, [recording.id, recordings, onSelectRecording]);

  const goToNext = useCallback(() => {
    const idx = recordings.findIndex((r) => r.id === recording.id);
    if (idx < recordings.length - 1) onSelectRecording(recordings[idx + 1]);
  }, [recording.id, recordings, onSelectRecording]);

  const toggleFs = useCallback(() => {
    const c = containerRef.current; if (!c) return;
    document.fullscreenElement ? document.exitFullscreen() : c.requestFullscreen().catch(() => {});
  }, []);

  const recStart = new Date(recording.started_at);
  const currentTs = new Date(recStart.getTime() + currentTime * 1000);
  const speeds: PlaybackSpeed[] = [0.5, 1, 2, 4];

  const cb: React.CSSProperties = { background: "none", border: "none", color: "#fff", cursor: "pointer", padding: "0.25rem 0.35rem", fontSize: "0.95rem", lineHeight: 1, opacity: 0.85 };

  return (
    <div ref={containerRef} style={{ background: "#000", borderRadius: "6px", overflow: "hidden", border: "1px solid #333" }}>
      {/* Video + Canvas overlay container */}
      <div style={{ position: "relative" }}>
        <video ref={videoRef} src={streamUrl}
          style={{ width: "100%", display: "block", background: "#000", maxHeight: "45vh" }}
          onTimeUpdate={() => setCurrent(videoRef.current?.currentTime || 0)}
          onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
          onPlay={() => setPlaying(true)} onPause={handlePause}
          onEnded={() => { setPlaying(false); goToNext(); }}
          onError={() => setError("Erro ao carregar vídeo")}
          playsInline />
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMove}
          onMouseLeave={() => setHoveredFace(null)}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: faceDetectOn ? "auto" : "none" }}
        />
        {/* Face detection indicator */}
        {faceDetectOn && (
          <div style={{ position: "absolute", top: 6, left: 6, display: "flex", gap: "0.35rem", alignItems: "center" }}>
            <div style={{
              background: faceError ? "rgba(198,40,40,0.9)" : detecting ? "rgba(255,235,59,0.9)" : "rgba(76,175,80,0.9)",
              color: faceError ? "#fff" : "#000", padding: "0.15rem 0.4rem", borderRadius: "3px",
              fontSize: "0.65rem", fontWeight: 600, fontFamily: "monospace",
              maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {faceError ? faceError : detecting ? "Detectando..." : `${detectedFaces.length} face(s)`}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: "#c62828", color: "#fff", padding: "0.3rem 0.6rem", fontSize: "0.75rem", textAlign: "center" }}>{error}</div>
      )}

      {/* Info bar */}
      <div style={{ background: "rgba(0,0,0,0.8)", color: "#4caf50", padding: "0.15rem 0.5rem", fontSize: "0.7rem", fontFamily: "monospace",
        display: "flex", justifyContent: "space-between" }}>
        <span>{formatTimeSeconds(currentTs)}</span>
        <span style={{ color: "#999" }}>
          {recording.camera_name} | {recording.recording_type === "motion" ? "Mov" : "Rec"}
          {recording.file_size ? ` | ${formatBytes(recording.file_size)}` : ""}
        </span>
      </div>

      {/* Progress */}
      <div style={{ padding: "0 0.4rem", background: "#111" }}>
        <input type="range" min={0} max={duration || 1} step={0.1} value={currentTime}
          onChange={(e) => { if (videoRef.current) videoRef.current.currentTime = parseFloat(e.target.value); }}
          style={{ width: "100%", height: "4px", cursor: "pointer", accentColor: "#4caf50" }} />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.2rem 0.4rem", background: "#111", color: "#fff", fontSize: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.1rem" }}>
          <button onClick={goToPrev} style={cb} title="Anterior">&#9198;</button>
          <button onClick={() => skip(-10)} style={cb} title="-10s">&#8634;</button>
          <button onClick={togglePlay} style={{ ...cb, fontSize: "1.15rem" }}>{playing ? "\u23F8" : "\u25B6"}</button>
          <button onClick={() => skip(10)} style={cb} title="+10s">&#8635;</button>
          <button onClick={goToNext} style={cb} title="Próxima">&#9197;</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: "monospace" }}>
          <span>{formatDuration(currentTime)}/{formatDuration(duration)}</span>
          <div style={{ display: "flex", gap: "1px", background: "rgba(255,255,255,0.05)", borderRadius: "3px" }}>
            {speeds.map((s) => (
              <button key={s} onClick={() => { setSpeed(s); if (videoRef.current) videoRef.current.playbackRate = s; }}
                style={{ ...cb, fontSize: "0.65rem", fontWeight: speed === s ? 700 : 400, opacity: speed === s ? 1 : 0.5,
                  background: speed === s ? "rgba(255,255,255,0.15)" : "none", borderRadius: "2px", padding: "0.15rem 0.3rem" }}>
                {s}x
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.15rem" }}>
          {/* Face detection toggle */}
          <button
            onClick={() => {
              if (faceServiceOk === false) return;
              const next = !faceDetectOn;
              setFaceDetectOn(next);
              if (next && videoRef.current) runDetection(videoRef.current.currentTime);
            }}
            style={{
              ...cb,
              fontSize: "0.75rem",
              background: faceDetectOn ? "rgba(76,175,80,0.3)" : faceServiceOk === false ? "rgba(198,40,40,0.3)" : "none",
              borderRadius: "3px",
              padding: "0.2rem 0.4rem",
              opacity: faceServiceOk === false ? 0.4 : 0.85,
              cursor: faceServiceOk === false ? "not-allowed" : "pointer",
            }}
            title={faceServiceOk === false ? "Serviço de detecção facial indisponível" : faceDetectOn ? "Desativar detecção facial" : "Ativar detecção facial"}
          >
            &#128065;
          </button>
          <a href={`/api/recordings/${recording.id}/thumbnail?token=${encodeURIComponent(token)}`}
            download={`thumb-${recording.id}.jpg`}
            title="Baixar imagem"
            style={{ ...cb, textDecoration: "none", color: "#fff" }}>&#128247;</a>
          <button onClick={() => { setMuted(!muted); if (videoRef.current) videoRef.current.muted = !muted; }} style={cb}>
            {muted ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
          </button>
          <button onClick={toggleFs} style={cb} title="Tela cheia">&#x26F6;</button>
        </div>
      </div>
    </div>
  );
}

// ─── Recording List ───

function RecordingList({ recordings, selectedRecording, onSelect, token }: {
  recordings: Recording[]; selectedRecording: Recording | null; onSelect: (r: Recording) => void; token: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedRecording || !ref.current) return;
    ref.current.querySelector(`[data-id="${selectedRecording.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedRecording?.id]);

  if (!recordings.length) return <div style={{ textAlign: "center", padding: "1.5rem 0.5rem", color: "#999", fontSize: "0.8rem" }}>Nenhuma gravação neste dia.</div>;

  return (
    <div ref={ref} style={{ maxHeight: "350px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      {recordings.map((r) => {
        const start = new Date(r.started_at);
        const end = r.ended_at ? new Date(r.ended_at) : null;
        const sel = selectedRecording?.id === r.id;
        const mot = r.recording_type === "motion";
        return (
          <div key={r.id} data-id={r.id} onClick={() => onSelect(r)}
            style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.35rem 0.5rem", borderRadius: "4px", cursor: "pointer",
              background: sel ? "#e8f5e9" : "#fff", border: sel ? "1px solid #4caf50" : "1px solid #f0f0f0" }}>
            <div style={{ width: 3, minHeight: 28, borderRadius: "2px", background: mot ? "#ff9800" : "#4caf50", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: "0.8rem" }}>{formatTime(start)}{end ? ` — ${formatTime(end)}` : ""}</span>
                <span style={{ fontSize: "0.6rem", padding: "0.05rem 0.25rem", borderRadius: "2px",
                  background: mot ? "#fff3e0" : "#e8f5e9", color: mot ? "#e65100" : "#2e7d32", fontWeight: 600, flexShrink: 0 }}>
                  {mot ? "MOV" : "REC"}
                </span>
              </div>
              <div style={{ fontSize: "0.65rem", color: "#999", display: "flex", gap: "0.4rem" }}>
                {r.duration ? <span>{formatDuration(r.duration)}</span> : null}
                {r.file_size ? <span>{formatBytes(r.file_size)}</span> : null}
              </div>
            </div>
            <a href={`/api/recordings/${r.id}/thumbnail?token=${encodeURIComponent(token)}`}
              onClick={(e) => e.stopPropagation()}
              download={`thumb-${r.id}.jpg`}
              title="Baixar imagem"
              style={{ flexShrink: 0, padding: "0.2rem 0.35rem", borderRadius: "3px", background: "#f5f5f5",
                border: "1px solid #ddd", cursor: "pointer", fontSize: "0.75rem", color: "#555", textDecoration: "none",
                display: "flex", alignItems: "center" }}>
              &#128247;
            </a>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Playback Page ───

function Playback() {
  const { apiFetch, token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [selectedDate, setSelectedDate] = useState(dateToYMD(new Date()));
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTimestamp, setSearchTimestamp] = useState("");
  const deepLinkHandled = useRef(false);

  // Face search state
  const [faceSearchResults, setFaceSearchResults] = useState<FaceAppearance[] | null>(null);
  const [faceSearching, setFaceSearching] = useState(false);

  const handleFaceClick = async (embedding: number[]) => {
    setFaceSearching(true);
    setFaceSearchResults(null);
    try {
      const res = await apiFetch("/api/recordings/search-by-embedding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embedding, limit: 30, min_similarity: 0.6 }),
      });
      if (res.ok) {
        const data = await res.json();
        setFaceSearchResults(data.appearances || []);
      }
    } catch { /* ignore */ }
    setFaceSearching(false);
  };

  useEffect(() => {
    apiFetch("/api/cameras").then((r) => r.json()).then((cams: Camera[]) => {
      setCameras(cams);
      // Check for deep-link query params (e.g. from face search)
      const qCameraId = searchParams.get("camera_id");
      const qTimestamp = searchParams.get("timestamp");
      if (qCameraId && qTimestamp && !deepLinkHandled.current) {
        deepLinkHandled.current = true;
        setSelectedCameraId(qCameraId);
        const ts = new Date(qTimestamp);
        setSelectedDate(dateToYMD(ts));
        // Clear query params from URL
        setSearchParams({}, { replace: true });
        // Find the recording that contains this timestamp
        apiFetch(`/api/cameras/${qCameraId}/recording?timestamp=${encodeURIComponent(qTimestamp)}`)
          .then((r) => r.json())
          .then((rec) => {
            if (rec && !rec.error) {
              setSelectedRecording(rec);
            }
          })
          .catch(console.error);
      } else if (cams.length > 0 && !selectedCameraId && !qCameraId) {
        setSelectedCameraId(cams[0].id);
      }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedCameraId || !selectedDate) return;
    setLoading(true); setSelectedRecording(null);
    apiFetch(`/api/recordings/by-day?camera_id=${selectedCameraId}&date=${selectedDate}`)
      .then((r) => r.json()).then((data: Recording[]) => { setRecordings(data); setLoading(false); })
      .catch(() => { setRecordings([]); setLoading(false); });
  }, [selectedCameraId, selectedDate]);

  const changeDay = (delta: number) => { const d = new Date(selectedDate + "T12:00:00"); d.setDate(d.getDate() + delta); setSelectedDate(dateToYMD(d)); };
  const goToToday = () => setSelectedDate(dateToYMD(new Date()));

  const searchByTimestamp = () => {
    if (!selectedCameraId || !searchTimestamp) return;
    apiFetch(`/api/cameras/${selectedCameraId}/recording?timestamp=${searchTimestamp}`)
      .then((r) => r.json()).then((data) => {
        if (data && !data.error) { setSelectedDate(dateToYMD(new Date(data.started_at))); setTimeout(() => setSelectedRecording(data), 500); }
      }).catch(console.error);
  };

  const jumpToMoment = (cameraId: string, timestamp: string) => {
    const ts = new Date(timestamp);
    setSelectedCameraId(cameraId);
    setSelectedDate(dateToYMD(ts));
    apiFetch(`/api/cameras/${cameraId}/recording?timestamp=${encodeURIComponent(timestamp)}`)
      .then((r) => r.json())
      .then((rec) => {
        if (rec && !rec.error) {
          // Need a short delay so recordings list updates first
          setTimeout(() => setSelectedRecording(rec), 300);
        }
      })
      .catch(console.error);
  };

  const handleSelectTime = (time: Date) => {
    const targetSec = time.getHours() * 3600 + time.getMinutes() * 60 + time.getSeconds();
    let closest: Recording | null = null, closestDist = Infinity;
    for (const r of recordings) {
      const s = new Date(r.started_at);
      const dist = Math.abs(s.getHours() * 3600 + s.getMinutes() * 60 + s.getSeconds() - targetSec);
      if (dist < closestDist) { closestDist = dist; closest = r; }
    }
    if (closest) setSelectedRecording(closest);
  };

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);
  const displayDate = new Date(selectedDate + "T12:00:00");
  const today = isSameDay(displayDate);

  const btn: React.CSSProperties = { padding: "0.25rem 0.5rem", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem", background: "#fff" };

  return (
    <div style={{ maxWidth: "1200px" }}>
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Gravações</h2>

      {/* Controls */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <select value={selectedCameraId} onChange={(e) => setSelectedCameraId(e.target.value)}
          style={{ padding: "0.35rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.8rem", minWidth: "180px" }}>
          <option value="">Selecione a câmera</option>
          {cameras.map((c) => <option key={c.id} value={c.id}>{c.pdv_name} — {c.name}</option>)}
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: "0.15rem", background: "#fff", border: "1px solid #ccc", borderRadius: "4px", padding: "1px" }}>
          <button onClick={() => changeDay(-1)} style={{ ...btn, border: "none", padding: "0.25rem 0.4rem" }}>&#9664;</button>
          <button onClick={goToToday} style={{ ...btn, border: "none", fontWeight: today ? 700 : 400, minWidth: "120px", textAlign: "center", fontSize: "0.75rem" }}>
            {today ? "Hoje" : formatDate(displayDate)}
          </button>
          <button onClick={() => changeDay(1)} disabled={today} style={{ ...btn, border: "none", padding: "0.25rem 0.4rem", opacity: today ? 0.3 : 1 }}>&#9654;</button>
        </div>

        <input type="date" value={selectedDate} max={dateToYMD(new Date())} onChange={(e) => setSelectedDate(e.target.value)}
          style={{ padding: "0.3rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.8rem" }} />

        <div style={{ width: "1px", height: "24px", background: "#ddd" }} />

        <input type="datetime-local" value={searchTimestamp} onChange={(e) => setSearchTimestamp(e.target.value)}
          style={{ padding: "0.3rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "0.8rem" }} />
        <button onClick={searchByTimestamp} disabled={!searchTimestamp || !selectedCameraId}
          style={{ ...btn, background: "#1a1a2e", color: "#fff", border: "1px solid #1a1a2e", opacity: !searchTimestamp || !selectedCameraId ? 0.5 : 1 }}>
          Buscar
        </button>
      </div>

      {/* Timeline */}
      {selectedCameraId && (
        <div style={{ background: "#fff", borderRadius: "6px", border: "1px solid #ddd", padding: "0.5rem 0.75rem", marginBottom: "0.75rem" }}>
          <Timeline recordings={recordings} selectedRecording={selectedRecording} onSelectRecording={setSelectedRecording} onSelectTime={handleSelectTime} />
        </div>
      )}

      {/* Player + List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "#999", fontSize: "0.85rem" }}>Carregando...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: recordings.length > 0 ? "1fr 280px" : "1fr", gap: "0.75rem", alignItems: "start" }}>
          <div>
            {selectedRecording && token ? (
              <VideoPlayer recording={selectedRecording} recordings={recordings} onSelectRecording={setSelectedRecording}
                token={token} apiFetch={apiFetch} onFaceClick={handleFaceClick} />
            ) : (
              <div style={{ background: "#000", borderRadius: "6px", aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center",
                color: "#666", fontSize: "0.85rem", maxHeight: "45vh" }}>
                {recordings.length > 0 ? "Selecione uma gravação na timeline ou na lista" : selectedCameraId ? "Nenhuma gravação neste dia" : "Selecione uma câmera"}
              </div>
            )}

            {/* Face search results panel */}
            {(faceSearching || faceSearchResults) && (
              <div style={{ background: "#fff", borderRadius: "6px", border: "1px solid #ddd", padding: "0.75rem", marginTop: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    {faceSearching ? "Buscando aparições..." : `${faceSearchResults?.length || 0} momento(s) distinto(s)`}
                  </div>
                  <button
                    onClick={() => { setFaceSearchResults(null); setFaceSearching(false); }}
                    style={{ background: "none", border: "1px solid #ccc", borderRadius: "4px", padding: "0.15rem 0.5rem",
                      cursor: "pointer", fontSize: "0.75rem", color: "#666" }}
                  >
                    Fechar
                  </button>
                </div>

                {faceSearchResults && faceSearchResults.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.4rem", maxHeight: "250px", overflowY: "auto" }}>
                    {faceSearchResults.map((a) => (
                      <div key={a.id} style={{ display: "flex", gap: "0.4rem", alignItems: "center", padding: "0.35rem",
                        background: "#fafafa", borderRadius: "4px", border: "1px solid #eee" }}>
                        {a.face_image && token && (
                          <img
                            src={`${a.face_image}&token=${encodeURIComponent(token)}`}
                            alt="Face"
                            style={{ width: 44, height: 44, objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "0.75rem", color: "#2e7d32", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                            {(a.similarity * 100).toFixed(0)}% match
                            {a.detections > 1 && (
                              <span style={{ fontSize: "0.6rem", background: "#e3f2fd", color: "#1565c0", padding: "0.05rem 0.3rem", borderRadius: "3px", fontWeight: 600 }}>
                                {a.detections}x
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: "0.65rem", color: "#666" }}>{a.pdv_name} — {a.camera_name}</div>
                          <div style={{ fontSize: "0.65rem", color: "#999" }}>
                            {new Date(a.first_seen || a.detected_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            {a.first_seen && a.last_seen && a.first_seen !== a.last_seen && (
                              <> → {new Date(a.last_seen).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => jumpToMoment(a.camera_id, a.first_seen || a.detected_at)}
                          style={{ flexShrink: 0, padding: "0.15rem 0.35rem", borderRadius: "3px", border: "1px solid #1a1a2e",
                            background: "#1a1a2e", color: "#fff", cursor: "pointer", fontSize: "0.6rem", fontWeight: 600 }}
                          title="Ver este momento"
                        >
                          &#9654;
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {faceSearchResults && faceSearchResults.length === 0 && (
                  <div style={{ textAlign: "center", color: "#999", fontSize: "0.8rem", padding: "0.5rem" }}>
                    Nenhuma outra aparição encontrada para esta pessoa.
                  </div>
                )}
              </div>
            )}
          </div>

          {recordings.length > 0 && (
            <div style={{ background: "#fff", borderRadius: "6px", border: "1px solid #ddd", padding: "0.4rem" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#333", padding: "0.2rem 0.4rem 0.35rem", borderBottom: "1px solid #eee", marginBottom: "0.35rem" }}>
                {formatDate(displayDate)} — {selectedCamera?.name}
              </div>
              <RecordingList recordings={recordings} selectedRecording={selectedRecording} onSelect={setSelectedRecording} token={token || ""} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Playback;
