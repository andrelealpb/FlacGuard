import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface Camera {
  id: string;
  name: string;
  pdv_id: string;
  pdv_name: string;
  recording_mode: string;
}

interface SimultaneousVideo {
  camera: Camera;
  recording: Recording;
  /** Seconds from parent recording start until this sibling recording starts.
   *  Positive = sibling starts later than parent. Can be negative if sibling starts before. */
  delayFromParent: number;
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

interface PersonSummary {
  id: string;
  name: string;
  embedding_count: number;
}

type PlaybackSpeed = 0.5 | 1 | 2 | 4;

// ─── Helpers ───

// Parse PG timestamp string "2026-03-15 18:11:00-03" → extract local time parts
function parseLocalTime(raw: string): { h: number; m: number; s: number } {
  // Handle both "2026-03-15 18:11:00-03" and ISO "2026-03-15T18:11:00.000-03:00"
  const match = raw.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (match) return { h: parseInt(match[1]), m: parseInt(match[2]), s: parseInt(match[3]) };
  const d = new Date(raw);
  return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
}

function formatTime(dateOrStr: Date | string) {
  if (typeof dateOrStr === "string") {
    const { h, m } = parseLocalTime(dateOrStr);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return dateOrStr.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatTimeSeconds(dateOrStr: Date | string) {
  if (typeof dateOrStr === "string") {
    const { h, m, s } = parseLocalTime(dateOrStr);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return dateOrStr.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(dateOrStr: Date | string) {
  const d = typeof dateOrStr === "string" ? new Date(dateOrStr) : dateOrStr;
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
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

  const secOfDayStr = (raw: string) => { const t = parseLocalTime(raw); return t.h * 3600 + t.m * 60 + t.s; };
  const timeToPctStr = (raw: string) => (secOfDayStr(raw) / 86400) * 100;

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
      const s = secOfDayStr(r.started_at);
      const en = r.ended_at ? secOfDayStr(r.ended_at) : s + (r.duration || 0);
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
          const leftPct = timeToPctStr(r.started_at);
          const endPct = r.ended_at ? timeToPctStr(r.ended_at) : leftPct + ((r.duration || 60) / 86400) * 100;
          const widthPct = Math.max(endPct - leftPct, 0.15);
          const isMot = r.recording_type === "motion";
          const isSel = selectedRecording?.id === r.id;
          return (
            <div key={r.id} title={`${formatTimeSeconds(r.started_at)} — ${formatTimeSeconds(r.ended_at || r.started_at)}`}
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
  recording, recordings, onSelectRecording, token, apiFetch, onFaceClick, onFaceDetected, onFaceDetectToggle, cameraName, pdvName,
  cameras, selectedCameraId, onSwitchToCamera,
}: {
  recording: Recording; recordings: Recording[]; onSelectRecording: (r: Recording) => void; token: string;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onFaceClick: (embedding: number[]) => void;
  onFaceDetected: (faces: DetectedFace[]) => void;
  onFaceDetectToggle?: (on: boolean) => void;
  cameraName: string; pdvName: string;
  cameras: Camera[]; selectedCameraId: string;
  onSwitchToCamera: (cameraId: string, timestamp: string) => void;
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
  const runDetectionRef = useRef<(t: number) => void>(() => {});

  const [faceServiceOk, setFaceServiceOk] = useState<boolean | null>(null);

  // Simultaneous multi-camera playback
  const [showMultiCam, setShowMultiCam] = useState(false);
  const [multiCamVideos, setMultiCamVideos] = useState<SimultaneousVideo[]>([]);
  const [multiCamLoading, setMultiCamLoading] = useState(false);

  const currentCamera = cameras.find((c) => c.id === selectedCameraId);
  const siblingCameras = currentCamera
    ? cameras.filter((c) => c.pdv_id === currentCamera.pdv_id && c.id !== currentCamera.id)
    : [];
  const hasMultiCam = siblingCameras.length > 0;

  const siblingVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const loadMultiCamVideos = useCallback(async () => {
    if (!hasMultiCam || !recording) return;
    setMultiCamLoading(true);
    setMultiCamVideos([]);
    siblingVideoRefs.current.clear();
    const parentStartLocal = parseLocalTime(recording.started_at);
    const parentStartSec = parentStartLocal.h * 3600 + parentStartLocal.m * 60 + parentStartLocal.s;
    const currentPlaySec = parentStartSec + Math.floor(videoRef.current?.currentTime || 0);
    // Build ISO timestamp from the recording date + current play position
    const dateMatch = recording.started_at.match(/(\d{4}-\d{2}-\d{2})/);
    const dateStr = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
    const h = Math.floor(currentPlaySec / 3600) % 24;
    const m = Math.floor((currentPlaySec % 3600) / 60);
    const s = currentPlaySec % 60;
    const tzMatch = recording.started_at.match(/([+-]\d{2}(?::\d{2})?)$/);
    const tzSuffix = tzMatch ? tzMatch[1] : '';
    const ts = `${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${tzSuffix}`;

    const results: SimultaneousVideo[] = [];
    const toCheck = siblingCameras.slice(0, 4);
    await Promise.all(
      toCheck.map(async (cam) => {
        try {
          const res = await apiFetch(`/api/cameras/${cam.id}/recording?timestamp=${encodeURIComponent(ts)}&duration=30`);
          if (res.ok) {
            const rec = await res.json();
            if (rec && !rec.error) {
              const sibStart = parseLocalTime(rec.started_at);
              const sibStartSec = sibStart.h * 3600 + sibStart.m * 60 + sibStart.s;
              // delayFromParent: how many seconds after parent start does sibling start
              // Example: parent=14:59:39 sibling=15:00:38 → delay = 59
              const delayFromParent = sibStartSec - parentStartSec;
              results.push({ camera: cam, recording: rec, delayFromParent });
            }
          }
        } catch { /* skip */ }
      })
    );
    setMultiCamVideos(results);
    setMultiCamLoading(false);
  }, [hasMultiCam, recording?.id, siblingCameras.length]);

  // Auto-load multi-cam videos when showMultiCam is active
  const loadMultiCamRef = useRef(loadMultiCamVideos);
  loadMultiCamRef.current = loadMultiCamVideos;
  const multiCamFoundRef = useRef(false);
  multiCamFoundRef.current = multiCamVideos.length > 0;
  useEffect(() => {
    if (!showMultiCam || !hasMultiCam) return;
    multiCamFoundRef.current = false;
    // Load immediately
    loadMultiCamRef.current();
    // Retry every 1s until videos are found
    const interval = setInterval(() => {
      if (!multiCamFoundRef.current) loadMultiCamRef.current();
    }, 1000);
    return () => clearInterval(interval);
  }, [showMultiCam, hasMultiCam, recording.id]);

  // Check face service health periodically (every 15s if not ok, stop once ok)
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      apiFetch("/api/faces/status")
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setFaceServiceOk(d.service_available === true); })
        .catch(() => { if (!cancelled) setFaceServiceOk(false); });
    };
    check();
    const interval = setInterval(() => {
      if (faceServiceOk !== true) check();
    }, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [faceServiceOk]);

  const streamUrl = `/api/recordings/${recording.id}/stream?token=${encodeURIComponent(token)}`;

  useEffect(() => {
    setCurrent(0); setDuration(0); setError(""); setDetectedFaces([]); setFaceError(""); lastDetectTime.current = -999;
    const v = videoRef.current;
    if (v) { v.playbackRate = speed; v.load(); v.play().catch(() => {}); }
  }, [recording.id]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);

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
        const faces = data.faces || [];
        setDetectedFaces(faces);
        if (faces.length > 0) onFaceDetected(faces);
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

  // Keep ref updated so the interval always calls the latest runDetection (avoids stale closures)
  runDetectionRef.current = runDetection;

  // Detect faces every ~3 seconds while playing
  useEffect(() => {
    if (!faceDetectOn) { setDetectedFaces([]); setFaceError(""); return; }

    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || detectingRef.current) return;
      const t = v.currentTime;
      if (Math.abs(t - lastDetectTime.current) < 2.5) return;
      lastDetectTime.current = t;
      runDetectionRef.current(t);
    }, 3000);

    return () => clearInterval(interval);
  }, [faceDetectOn, recording.id]);

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

  // ─── Sibling video sync ───
  // Sync all sibling videos to match the parent's current absolute time.
  // Called on every parent timeUpdate, play, pause, seek, and speed change.
  const syncSiblings = useCallback((parentCurrentTime: number, action?: 'play' | 'pause' | 'seek') => {
    if (multiCamVideos.length === 0) return;
    const parentVideo = videoRef.current;
    if (!parentVideo) return;

    for (const mv of multiCamVideos) {
      const sibVid = siblingVideoRefs.current.get(mv.camera.id);
      if (!sibVid) continue;

      // How far into the sibling's timeline is the parent?
      // siblingTime = parentCurrentTime - delayFromParent
      // If negative, sibling hasn't started yet
      const siblingTime = parentCurrentTime - mv.delayFromParent;

      if (siblingTime < 0) {
        // Sibling recording hasn't started yet at this parent time
        if (!sibVid.paused) sibVid.pause();
        sibVid.currentTime = 0;
        continue;
      }

      if (siblingTime > sibVid.duration && sibVid.duration > 0) {
        // Past the end of sibling recording
        if (!sibVid.paused) sibVid.pause();
        continue;
      }

      // Sync position — only seek if drift > 1 second (avoid constant micro-seeks)
      const drift = Math.abs(sibVid.currentTime - siblingTime);
      if (drift > 1 || action === 'seek') {
        sibVid.currentTime = siblingTime;
      }

      // Sync play/pause state
      if (action === 'pause' || parentVideo.paused) {
        if (!sibVid.paused) sibVid.pause();
      } else if (action === 'play' || !parentVideo.paused) {
        if (sibVid.paused && siblingTime >= 0) sibVid.play().catch(() => {});
      }

      // Sync playback rate
      if (sibVid.playbackRate !== parentVideo.playbackRate) {
        sibVid.playbackRate = parentVideo.playbackRate;
      }
    }
  }, [multiCamVideos]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      syncSiblings(v.currentTime, 'play');
    } else {
      v.pause();
      syncSiblings(v.currentTime, 'pause');
    }
  }, [syncSiblings]);

  const skip = useCallback((sec: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + sec));
    syncSiblings(v.currentTime, 'seek');
  }, [syncSiblings]);

  const goToPrev = useCallback(() => {
    const idx = recordings.findIndex((r) => r.id === recording.id);
    if (idx > 0) onSelectRecording(recordings[idx - 1]);
  }, [recording.id, recordings, onSelectRecording]);

  const goToNext = useCallback(() => {
    const idx = recordings.findIndex((r) => r.id === recording.id);
    if (idx < recordings.length - 1) onSelectRecording(recordings[idx + 1]);
  }, [recording.id, recordings, onSelectRecording]);

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFs = useCallback(() => {
    const c = containerRef.current; if (!c) return;
    document.fullscreenElement ? document.exitFullscreen() : c.requestFullscreen().catch(() => {});
  }, []);

  // Build current timestamp string in camera local time
  const recStartLocal = parseLocalTime(recording.started_at);
  const recStartSec = recStartLocal.h * 3600 + recStartLocal.m * 60 + recStartLocal.s;
  const currentTotalSec = recStartSec + Math.floor(currentTime);
  const curH = Math.floor(currentTotalSec / 3600) % 24;
  const curM = Math.floor((currentTotalSec % 3600) / 60);
  const curS = currentTotalSec % 60;
  const currentTsStr = `${String(curH).padStart(2, "0")}:${String(curM).padStart(2, "0")}:${String(curS).padStart(2, "0")}`;
  const speeds: PlaybackSpeed[] = [0.5, 1, 2, 4];

  // Build download filename: AAAAMMDDHHMMSS-CAMERA-LOJA.mp4
  const buildDownloadName = () => {
    const t = parseLocalTime(recording.started_at);
    // Extract date part (YYYY-MM-DD) from the raw PG string
    const dateMatch = recording.started_at.match(/(\d{4})-(\d{2})-(\d{2})/);
    const [y, mo, d] = dateMatch ? [dateMatch[1], dateMatch[2], dateMatch[3]] : ["0000", "00", "00"];
    const ts = `${y}${mo}${d}${String(t.h).padStart(2, "0")}${String(t.m).padStart(2, "0")}${String(t.s).padStart(2, "0")}`;
    const cam = cameraName.replace(/[^a-zA-Z0-9À-ú ]/g, "").replace(/\s+/g, "-");
    const pdv = pdvName.replace(/[^a-zA-Z0-9À-ú ]/g, "").replace(/\s+/g, "-");
    return `${ts}-${cam}-${pdv}.mp4`;
  };

  const cb: React.CSSProperties = { background: "none", border: "none", color: "#fff", cursor: "pointer", padding: "0.25rem 0.35rem", fontSize: "0.95rem", lineHeight: 1, opacity: 0.85 };

  // Determine grid layout: 1 cam = full, 2 cams = 1x2, 3-4 cams = 2x2
  const multiCamActive = showMultiCam && multiCamVideos.length > 0 && !isFullscreen;
  const totalCams = multiCamActive ? 1 + multiCamVideos.length : 1;
  const useGrid = totalCams >= 2;
  const gridCols = totalCams <= 2 ? "1fr 1fr" : "1fr 1fr";

  return (
    <>
    {useGrid && (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#1565c0", display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="8" height="7" rx="1"/><rect x="14" y="3" width="8" height="7" rx="1"/>
            <rect x="2" y="14" width="8" height="7" rx="1"/><rect x="14" y="14" width="8" height="7" rx="1"/>
          </svg>
          Playback Simultâneo — {currentCamera?.pdv_name} ({totalCams} câmeras)
        </div>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          <button onClick={loadMultiCamVideos}
            style={{ background: "none", border: "1px solid #ccc", borderRadius: "4px", padding: "0.1rem 0.4rem",
              cursor: "pointer", fontSize: "0.6rem", color: "#666" }}>Atualizar</button>
          <button onClick={() => setShowMultiCam(false)}
            style={{ background: "none", border: "1px solid #ccc", borderRadius: "4px", padding: "0.1rem 0.4rem",
              cursor: "pointer", fontSize: "0.6rem", color: "#666" }}>Fechar</button>
        </div>
      </div>
    )}
    <div style={useGrid ? { display: "grid", gridTemplateColumns: gridCols, gap: "0.3rem" } : {}}>
    <div ref={containerRef} style={{
      background: "#000", borderRadius: isFullscreen ? 0 : "6px", overflow: "hidden", border: isFullscreen ? "none" : "1px solid #333",
      ...(isFullscreen ? { display: "flex", flexDirection: "column" as const, height: "100vh" } : {}),
    }}>
      {/* Video + Canvas overlay container */}
      <div style={{ position: "relative", flex: isFullscreen ? 1 : undefined, display: isFullscreen ? "flex" : undefined,
        alignItems: isFullscreen ? "center" : undefined, justifyContent: isFullscreen ? "center" : undefined, overflow: "hidden" }}>
        <video ref={videoRef} src={streamUrl}
          style={{ width: "100%", display: "block", background: "#000",
            ...(isFullscreen ? { maxHeight: "100%", objectFit: "contain" } : { maxHeight: "75vh" }) }}
          onTimeUpdate={() => {
            const t = videoRef.current?.currentTime || 0;
            setCurrent(t);
            syncSiblings(t);
          }}
          onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
          onPlay={() => { setPlaying(true); syncSiblings(videoRef.current?.currentTime || 0, 'play'); }}
          onPause={() => { handlePause(); syncSiblings(videoRef.current?.currentTime || 0, 'pause'); }}
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
        <span>{currentTsStr}</span>
        <span style={{ color: "#999" }}>
          {recording.camera_name} | {recording.recording_type === "motion" ? "Mov" : "Rec"}
          {recording.file_size ? ` | ${formatBytes(recording.file_size)}` : ""}
        </span>
      </div>

      {/* Progress */}
      <div style={{ padding: "0 0.4rem", background: "#111" }}>
        <input type="range" min={0} max={duration || 1} step={0.1} value={currentTime}
          onChange={(e) => { if (videoRef.current) { const t = parseFloat(e.target.value); videoRef.current.currentTime = t; syncSiblings(t, 'seek'); } }}
          style={{ width: "100%", height: "4px", cursor: "pointer", accentColor: "#4caf50" }} />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.25rem 0.5rem", background: "#111", color: "#fff", fontSize: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.15rem" }}>
          <button onClick={goToPrev} style={cb} title="Anterior">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button onClick={() => skip(-10)} style={cb} title="-10s">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="10" y="16.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fontFamily="sans-serif" fill="currentColor">10</text></svg>
          </button>
          <button onClick={togglePlay} style={{ ...cb, padding: "0.25rem 0.45rem" }}>
            {playing
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>}
          </button>
          <button onClick={() => skip(10)} style={cb} title="+10s">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z"/><text x="13" y="16.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fontFamily="sans-serif" fill="currentColor">10</text></svg>
          </button>
          <button onClick={goToNext} style={cb} title="Próxima">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: "monospace" }}>
          <span>{formatDuration(currentTime)}/{formatDuration(duration)}</span>
          <div style={{ display: "flex", gap: "1px", background: "rgba(255,255,255,0.05)", borderRadius: "3px" }}>
            {speeds.map((s) => (
              <button key={s} onClick={() => { setSpeed(s); if (videoRef.current) { videoRef.current.playbackRate = s; syncSiblings(videoRef.current.currentTime); } }}
                style={{ ...cb, fontSize: "0.65rem", fontWeight: speed === s ? 700 : 400, opacity: speed === s ? 1 : 0.5,
                  background: speed === s ? "rgba(255,255,255,0.15)" : "none", borderRadius: "2px", padding: "0.15rem 0.3rem" }}>
                {s}x
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
          {/* Face detection toggle */}
          <button
            onClick={() => {
              if (faceServiceOk === false) return;
              const next = !faceDetectOn;
              setFaceDetectOn(next);
              onFaceDetectToggle?.(next);
              if (next && videoRef.current) runDetection(videoRef.current.currentTime);
            }}
            style={{
              ...cb,
              background: faceDetectOn ? "rgba(76,175,80,0.3)" : faceServiceOk === false ? "rgba(198,40,40,0.3)" : "none",
              borderRadius: "3px",
              padding: "0.2rem 0.35rem",
              opacity: faceServiceOk === false ? 0.4 : 0.85,
              cursor: faceServiceOk === false ? "not-allowed" : "pointer",
            }}
            title={faceServiceOk === false ? "Serviço de detecção facial indisponível" : faceDetectOn ? "Desativar detecção facial" : "Ativar detecção facial"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <a href={`/api/recordings/${recording.id}/thumbnail?token=${encodeURIComponent(token)}&filename=${encodeURIComponent(buildDownloadName().replace('.mp4', '.jpg'))}`}
            download={buildDownloadName().replace('.mp4', '.jpg')}
            title="Baixar imagem (snapshot)"
            style={{ ...cb, textDecoration: "none", color: "#fff", display: "flex", alignItems: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
            </svg>
          </a>
          <a href={`/api/recordings/${recording.id}/stream?token=${encodeURIComponent(token)}&download=1&filename=${encodeURIComponent(buildDownloadName())}`}
            download={buildDownloadName()}
            title="Baixar vídeo"
            style={{ ...cb, textDecoration: "none", color: "#fff", display: "flex", alignItems: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </a>
          {/* Multi-camera simultaneous playback */}
          <button
            onClick={() => {
              if (!hasMultiCam) return;
              const next = !showMultiCam;
              setShowMultiCam(next);
              if (next) loadMultiCamVideos();
            }}
            style={{
              ...cb,
              background: showMultiCam ? "rgba(33,150,243,0.3)" : "none",
              borderRadius: "3px",
              padding: "0.2rem 0.35rem",
              opacity: hasMultiCam ? 0.85 : 0.3,
              cursor: hasMultiCam ? "pointer" : "not-allowed",
            }}
            title={hasMultiCam ? `Playback simultâneo (${siblingCameras.length} câmera(s) no PDV)` : "Sem outras câmeras neste PDV"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="8" height="7" rx="1"/><rect x="14" y="3" width="8" height="7" rx="1"/>
              <rect x="2" y="14" width="8" height="7" rx="1"/><rect x="14" y="14" width="8" height="7" rx="1"/>
            </svg>
          </button>
          <button onClick={() => { setMuted(!muted); if (videoRef.current) videoRef.current.muted = !muted; }} style={cb}>
            {muted
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14"/><path d="M15.54 8.46a5 5 0 010 7.07"/>
                </svg>}
          </button>
          <button onClick={toggleFs} style={cb} title="Tela cheia">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    {/* Multi-camera simultaneous playback - sibling videos in grid */}
    {multiCamActive && multiCamVideos.map((mv) => {
      // Is the sibling video currently before its start time?
      const siblingTime = currentTime - mv.delayFromParent;
      const notStartedYet = siblingTime < 0;
      const waitSec = Math.ceil(-siblingTime);
      return (
        <div key={mv.camera.id}
          onClick={() => onSwitchToCamera(mv.camera.id, mv.recording.started_at)}
          style={{ background: "#000", borderRadius: "6px", overflow: "hidden", border: "1px solid #333", cursor: "pointer", position: "relative" }}
          title={`Abrir ${mv.camera.name} como vídeo principal`}
        >
          <div style={{ padding: "0.15rem 0.4rem", background: "#1565c0", color: "#fff",
            fontSize: "0.6rem", fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
            <span>{mv.camera.name}</span>
            <span style={{ opacity: 0.8 }}>{formatTime(mv.recording.started_at)} — {formatTime(mv.recording.ended_at || mv.recording.started_at)}</span>
          </div>
          <div style={{ position: "relative" }}>
            <video
              ref={(el) => { if (el) siblingVideoRefs.current.set(mv.camera.id, el); else siblingVideoRefs.current.delete(mv.camera.id); }}
              src={`/api/recordings/${mv.recording.id}/stream?token=${encodeURIComponent(token)}`}
              style={{ width: "100%", display: "block", pointerEvents: "none" }}
              muted playsInline preload="auto"
            />
            {notStartedYet && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex",
                flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                <div style={{ fontSize: "0.7rem", opacity: 0.7, marginBottom: "0.2rem" }}>Aguardando sincronização</div>
                <div style={{ fontSize: "1.2rem", fontFamily: "monospace", fontWeight: 700 }}>
                  {formatDuration(waitSec)}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    })}
    {showMultiCam && !multiCamActive && !multiCamLoading && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: "0.75rem", padding: "1rem",
        background: "#000", borderRadius: "6px", border: "1px solid #333" }}>
        Nenhum vídeo simultâneo encontrado.
      </div>
    )}
    {showMultiCam && multiCamLoading && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: "0.75rem", padding: "1rem",
        background: "#000", borderRadius: "6px", border: "1px solid #333" }}>
        Buscando vídeos...
      </div>
    )}
    </div>
    {/* Non-grid multi-cam controls when active but no videos */}
    {showMultiCam && !multiCamActive && !isFullscreen && (
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.3rem", marginTop: "0.2rem" }}>
        <button onClick={loadMultiCamVideos}
          style={{ background: "none", border: "1px solid #ccc", borderRadius: "4px", padding: "0.1rem 0.4rem",
            cursor: "pointer", fontSize: "0.6rem", color: "#666" }}>Atualizar</button>
        <button onClick={() => setShowMultiCam(false)}
          style={{ background: "none", border: "1px solid #ccc", borderRadius: "4px", padding: "0.1rem 0.4rem",
            cursor: "pointer", fontSize: "0.6rem", color: "#666" }}>Fechar</button>
      </div>
    )}
    </>
  );
}

// ─── Recording List ───

function RecordingList({ recordings, selectedRecording, onSelect }: {
  recordings: Recording[]; selectedRecording: Recording | null; onSelect: (r: Recording) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedRecording || !ref.current) return;
    ref.current.querySelector(`[data-id="${selectedRecording.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedRecording?.id]);

  if (!recordings.length) return <div style={{ textAlign: "center", padding: "1.5rem 0.5rem", color: "#999", fontSize: "0.8rem" }}>Nenhuma gravação neste dia.</div>;

  return (
    <div ref={ref} style={{ maxHeight: "70vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      {recordings.map((r) => {
        const sel = selectedRecording?.id === r.id;
        const mot = r.recording_type === "motion";
        return (
          <div key={r.id} data-id={r.id} onClick={() => onSelect(r)}
            style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.35rem 0.5rem", borderRadius: "4px", cursor: "pointer",
              background: sel ? "#e8f5e9" : "#fff", border: sel ? "1px solid #4caf50" : "1px solid #f0f0f0" }}>
            <div style={{ width: 3, minHeight: 28, borderRadius: "2px", background: mot ? "#ff9800" : "#4caf50", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: "0.8rem" }}>{formatTime(r.started_at)}{r.ended_at ? ` — ${formatTime(r.ended_at)}` : ""}</span>
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

  // Face search state (manual click)
  const [faceSearchResults, setFaceSearchResults] = useState<FaceAppearance[] | null>(null);
  const [faceSearching, setFaceSearching] = useState(false);
  const [searchPdvOnly, setSearchPdvOnly] = useState(true);
  const searchPdvOnlyRef = useRef(true);
  searchPdvOnlyRef.current = searchPdvOnly;
  const currentPdvIdRef = useRef<string | undefined>(undefined);

  // Add-to-person picker state
  const [personPickerForId, setPersonPickerForId] = useState<string | null>(null); // embedding id being added
  const [personsList, setPersonsList] = useState<PersonSummary[]>([]);
  const [personsLoading, setPersonsLoading] = useState(false);

  // Auto cross-reference state (accumulated during playback)
  const [autoCrossRef, setAutoCrossRef] = useState<FaceAppearance[]>([]);
  const [autoCrossRefOn, setAutoCrossRefOn] = useState(false);
  const autoCrossRefOnRef = useRef(false);
  autoCrossRefOnRef.current = autoCrossRefOn;
  const autoCrossRefSearching = useRef(false);
  const searchedEmbeddings = useRef<Set<string>>(new Set());

  // Reset auto cross-ref when recording changes
  useEffect(() => {
    setAutoCrossRef([]);
    searchedEmbeddings.current.clear();
  }, [selectedRecording?.id]);

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);
  currentPdvIdRef.current = selectedCamera?.pdv_id;

  const handleFaceClick = async (embedding: number[]) => {
    setFaceSearching(true);
    setFaceSearchResults(null);
    try {
      const body: Record<string, unknown> = { embedding, limit: 50, min_similarity: 0.45 };
      if (searchPdvOnly && selectedCamera?.pdv_id) body.pdv_id = selectedCamera.pdv_id;
      const res = await apiFetch("/api/recordings/search-by-embedding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setFaceSearchResults(data.appearances || []);
      }
    } catch { /* ignore */ }
    setFaceSearching(false);
  };

  // Auto cross-reference: when faces are detected, search for each unique face
  const handleFaceDetected = useCallback(async (faces: DetectedFace[]) => {
    if (!autoCrossRefOnRef.current || autoCrossRefSearching.current) return;
    // Only search faces with reasonable confidence (skip very partial detections)
    const goodFaces = faces.filter((f) => f.confidence >= 0.4 && f.embedding && f.embedding.length >= 10);
    for (const face of goodFaces) {
      const fingerprint = face.embedding.slice(0, 8).map((v) => v.toFixed(2)).join(",");
      if (searchedEmbeddings.current.has(fingerprint)) continue;
      searchedEmbeddings.current.add(fingerprint);

      autoCrossRefSearching.current = true;
      try {
        const res = await apiFetch("/api/recordings/search-by-embedding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embedding: face.embedding, limit: 50, min_similarity: 0.45,
            ...(searchPdvOnlyRef.current && currentPdvIdRef.current ? { pdv_id: currentPdvIdRef.current } : {}),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const appearances: FaceAppearance[] = data.appearances || [];
          if (appearances.length > 0) {
            setAutoCrossRef((prev) => {
              // Deduplicate by camera + 5-min window (same camera within 5 min = same visit)
              const TIME_GAP_MS = 5 * 60 * 1000;
              const getTs = (a: FaceAppearance) => new Date(a.first_seen || a.detected_at).getTime();
              const isNearExisting = (a: FaceAppearance) =>
                prev.some((e) => e.camera_id === a.camera_id && Math.abs(getTs(e) - getTs(a)) < TIME_GAP_MS);
              const newItems = appearances.filter((a) => !isNearExisting(a));
              if (newItems.length === 0) return prev;
              const merged = [...prev, ...newItems];
              merged.sort((a, b) => new Date(b.first_seen || b.detected_at).getTime() - new Date(a.first_seen || a.detected_at).getTime());
              return merged;
            });
          }
        }
      } catch { /* ignore */ }
      autoCrossRefSearching.current = false;
    }
  }, [apiFetch]);

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

  const switchToCamera = (cameraId: string, timestamp: string) => {
    // Reset tools when switching via multi-cam click
    setAutoCrossRef([]);
    setAutoCrossRefOn(false);
    searchedEmbeddings.current.clear();
    setFaceSearchResults(null);
    jumpToMoment(cameraId, timestamp);
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
      const t = parseLocalTime(r.started_at);
      const dist = Math.abs(t.h * 3600 + t.m * 60 + t.s - targetSec);
      if (dist < closestDist) { closestDist = dist; closest = r; }
    }
    if (closest) setSelectedRecording(closest);
  };

  const displayDate = new Date(selectedDate + "T12:00:00");
  const today = isSameDay(displayDate);

  const btn: React.CSSProperties = { padding: "0.25rem 0.5rem", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem", background: "#fff" };

  return (
    <div style={{ maxWidth: "1600px" }}>
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
        <div style={{ display: "grid", gridTemplateColumns: recordings.length > 0 ? "1fr 220px" : "1fr", gap: "0.75rem", alignItems: "start" }}>
          <div>
            {selectedRecording && token ? (
              <VideoPlayer recording={selectedRecording} recordings={recordings} onSelectRecording={setSelectedRecording}
                token={token} apiFetch={apiFetch} onFaceClick={handleFaceClick} onFaceDetected={handleFaceDetected}
                onFaceDetectToggle={(on) => { if (on) setAutoCrossRefOn(true); }}
                cameraName={selectedCamera?.name || ""} pdvName={selectedCamera?.pdv_name || ""}
                cameras={cameras} selectedCameraId={selectedCameraId} onSwitchToCamera={switchToCamera} />
            ) : (
              <div style={{ background: "#000", borderRadius: "6px", aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center",
                color: "#666", fontSize: "0.85rem", maxHeight: "75vh" }}>
                {recordings.length > 0 ? "Selecione uma gravação na timeline ou na lista" : selectedCameraId ? "Nenhuma gravação neste dia" : "Selecione uma câmera"}
              </div>
            )}

            {/* Face search results panel */}
            {(faceSearching || faceSearchResults) && (
              <div style={{ background: "#fff", borderRadius: "6px", border: "1px solid #ddd", padding: "0.75rem", marginTop: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                      {faceSearching ? "Buscando aparições..." : `${faceSearchResults?.length || 0} momento(s) distinto(s)`}
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.65rem", color: "#666", cursor: "pointer" }}>
                      <input type="checkbox" checked={searchPdvOnly} onChange={(e) => setSearchPdvOnly(e.target.checked)}
                        style={{ width: 12, height: 12, cursor: "pointer" }} />
                      Apenas este PDV
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    {faceSearchResults && faceSearchResults.length > 0 && (
                      <button
                        onClick={async () => {
                          const personName = prompt("Nome para esta pessoa:");
                          if (!personName) return;
                          try {
                            const ids = faceSearchResults.map((a) => a.id);
                            const r = await apiFetch("/api/faces/persons", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ name: personName, face_embedding_ids: ids }),
                            });
                            if (r.ok) {
                              const data = await r.json();
                              alert(`Pessoa "${personName}" criada com ${data.embedding_count} embeddings!`);
                            } else {
                              const e = await r.json();
                              alert(e.error || "Erro ao criar pessoa");
                            }
                          } catch { alert("Erro ao criar pessoa"); }
                        }}
                        style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: "4px", padding: "0.15rem 0.5rem",
                          cursor: "pointer", fontSize: "0.7rem", fontWeight: 600 }}
                      >
                        Criar Pessoa
                      </button>
                    )}
                    <button
                      onClick={() => { setFaceSearchResults(null); setFaceSearching(false); }}
                      style={{ background: "none", border: "1px solid #ccc", borderRadius: "4px", padding: "0.15rem 0.5rem",
                        cursor: "pointer", fontSize: "0.75rem", color: "#666" }}
                    >
                      Fechar
                    </button>
                  </div>
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
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flexShrink: 0 }}>
                          <button
                            onClick={() => jumpToMoment(a.camera_id, a.first_seen || a.detected_at)}
                            style={{ padding: "0.15rem 0.35rem", borderRadius: "3px", border: "1px solid #1a1a2e",
                              background: "#1a1a2e", color: "#fff", cursor: "pointer", fontSize: "0.6rem", fontWeight: 600 }}
                            title="Ver este momento"
                          >
                            &#9654;
                          </button>
                          <button
                            onClick={async () => {
                              const entryName = prompt("Nome para a lista de suspeitos:", "Suspeito");
                              if (!entryName) return;
                              try {
                                const r = await apiFetch("/api/faces/watchlist/from-appearance", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ face_embedding_id: a.id, name: entryName }),
                                });
                                if (r.ok) { alert("Adicionado à lista de suspeitos!"); }
                                else { const e = await r.json(); alert(e.error || "Erro ao adicionar"); }
                              } catch { alert("Erro ao adicionar à lista de suspeitos"); }
                            }}
                            style={{ padding: "0.15rem 0.35rem", borderRadius: "3px", border: "1px solid #c62828",
                              background: "#c62828", color: "#fff", cursor: "pointer", fontSize: "0.55rem", fontWeight: 600 }}
                            title="Adicionar à lista de suspeitos"
                          >
                            &#9888;
                          </button>
                          <div style={{ position: "relative" }}>
                            <button
                              onClick={async () => {
                                if (personPickerForId === a.id) { setPersonPickerForId(null); return; }
                                setPersonPickerForId(a.id);
                                setPersonsLoading(true);
                                try {
                                  const r = await apiFetch("/api/faces/persons");
                                  if (r.ok) { const data = await r.json(); setPersonsList(data); }
                                } catch { /* ignore */ }
                                setPersonsLoading(false);
                              }}
                              style={{ padding: "0.15rem 0.35rem", borderRadius: "3px", border: "1px solid #1565c0",
                                background: "#1565c0", color: "#fff", cursor: "pointer", fontSize: "0.55rem", fontWeight: 600 }}
                              title="Adicionar a uma pessoa existente"
                            >
                              &#128100;+
                            </button>
                            {personPickerForId === a.id && (
                              <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 100, background: "#fff",
                                border: "1px solid #ccc", borderRadius: "4px", boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                                minWidth: "180px", maxHeight: "200px", overflowY: "auto", marginTop: "2px" }}>
                                {personsLoading ? (
                                  <div style={{ padding: "0.5rem", fontSize: "0.7rem", color: "#999", textAlign: "center" }}>Carregando...</div>
                                ) : personsList.length === 0 ? (
                                  <div style={{ padding: "0.5rem", fontSize: "0.7rem", color: "#999", textAlign: "center" }}>Nenhuma pessoa cadastrada</div>
                                ) : (
                                  personsList.map((p) => (
                                    <div key={p.id}
                                      onClick={async () => {
                                        try {
                                          const r = await apiFetch(`/api/faces/persons/${p.id}/add-embeddings`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ face_embedding_ids: [a.id] }),
                                          });
                                          if (r.ok) {
                                            const data = await r.json();
                                            alert(`Embedding adicionado a "${p.name}" (${data.embedding_count} total)`);
                                          } else {
                                            const e = await r.json();
                                            alert(e.error || "Erro ao adicionar");
                                          }
                                        } catch { alert("Erro ao adicionar embedding"); }
                                        setPersonPickerForId(null);
                                      }}
                                      style={{ padding: "0.35rem 0.5rem", cursor: "pointer", fontSize: "0.7rem",
                                        borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#e3f2fd"; }}
                                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ""; }}
                                    >
                                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                                      <span style={{ fontSize: "0.6rem", color: "#999" }}>{p.embedding_count} emb</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </div>
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

            {/* Auto cross-reference panel */}
            {selectedRecording && (
              <div style={{ background: "#fff", borderRadius: "6px", border: autoCrossRefOn ? "1px solid #7b1fa2" : "1px solid #ddd", padding: "0.5rem 0.75rem", marginTop: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, color: autoCrossRefOn ? "#7b1fa2" : "#666", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={autoCrossRefOn ? "#7b1fa2" : "#999"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                    Busca Cruzada
                    {autoCrossRefOn && autoCrossRef.length > 0 && (
                      <span style={{ fontSize: "0.6rem", background: "#f3e5f5", color: "#7b1fa2", padding: "0.05rem 0.35rem", borderRadius: "3px", fontWeight: 600 }}>
                        {autoCrossRef.length}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                    {autoCrossRefOn && autoCrossRef.length > 0 && (
                      <button
                        onClick={() => { setAutoCrossRef([]); searchedEmbeddings.current.clear(); }}
                        style={{ background: "none", border: "1px solid #ccc", borderRadius: "4px", padding: "0.1rem 0.4rem",
                          cursor: "pointer", fontSize: "0.65rem", color: "#666" }}>
                        Limpar
                      </button>
                    )}
                    <button
                      onClick={() => setAutoCrossRefOn(!autoCrossRefOn)}
                      style={{
                        padding: "0.15rem 0.5rem", borderRadius: "4px", cursor: "pointer", fontSize: "0.7rem", fontWeight: 600,
                        background: autoCrossRefOn ? "#7b1fa2" : "#f5f5f5",
                        color: autoCrossRefOn ? "#fff" : "#666",
                        border: autoCrossRefOn ? "1px solid #7b1fa2" : "1px solid #ccc",
                      }}>
                      {autoCrossRefOn ? "ON" : "OFF"}
                    </button>
                  </div>
                </div>

                {autoCrossRefOn && autoCrossRef.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.4rem", maxHeight: "250px", overflowY: "auto", marginTop: "0.4rem" }}>
                    {autoCrossRef.map((a, i) => (
                      <div key={`${a.id}-${i}`} style={{ display: "flex", gap: "0.4rem", alignItems: "center", padding: "0.35rem",
                        background: "#faf5ff", borderRadius: "4px", border: "1px solid #e8daef" }}>
                        {a.face_image && token && (
                          <img
                            src={`${a.face_image}&token=${encodeURIComponent(token)}`}
                            alt="Face"
                            style={{ width: 44, height: 44, objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "0.75rem", color: "#7b1fa2", display: "flex", alignItems: "center", gap: "0.3rem" }}>
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
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flexShrink: 0 }}>
                          <button
                            onClick={() => jumpToMoment(a.camera_id, a.first_seen || a.detected_at)}
                            style={{ padding: "0.15rem 0.35rem", borderRadius: "3px", border: "1px solid #1a1a2e",
                              background: "#1a1a2e", color: "#fff", cursor: "pointer", fontSize: "0.6rem", fontWeight: 600 }}
                            title="Ver este momento"
                          >
                            &#9654;
                          </button>
                          <button
                            onClick={async () => {
                              const entryName = prompt("Nome para a lista de suspeitos:", "Suspeito");
                              if (!entryName) return;
                              try {
                                const r = await apiFetch("/api/faces/watchlist/from-appearance", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ face_embedding_id: a.id, name: entryName }),
                                });
                                if (r.ok) { alert("Adicionado à lista de suspeitos!"); }
                                else { const e = await r.json(); alert(e.error || "Erro ao adicionar"); }
                              } catch { alert("Erro ao adicionar à lista de suspeitos"); }
                            }}
                            style={{ padding: "0.15rem 0.35rem", borderRadius: "3px", border: "1px solid #c62828",
                              background: "#c62828", color: "#fff", cursor: "pointer", fontSize: "0.55rem", fontWeight: 600 }}
                            title="Adicionar à lista de suspeitos"
                          >
                            &#9888;
                          </button>
                          <div style={{ position: "relative" }}>
                            <button
                              onClick={async () => {
                                if (personPickerForId === a.id) { setPersonPickerForId(null); return; }
                                setPersonPickerForId(a.id);
                                setPersonsLoading(true);
                                try {
                                  const r = await apiFetch("/api/faces/persons");
                                  if (r.ok) { const data = await r.json(); setPersonsList(data); }
                                } catch { /* ignore */ }
                                setPersonsLoading(false);
                              }}
                              style={{ padding: "0.15rem 0.35rem", borderRadius: "3px", border: "1px solid #1565c0",
                                background: "#1565c0", color: "#fff", cursor: "pointer", fontSize: "0.55rem", fontWeight: 600 }}
                              title="Adicionar a uma pessoa existente"
                            >
                              &#128100;+
                            </button>
                            {personPickerForId === a.id && (
                              <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 100, background: "#fff",
                                border: "1px solid #ccc", borderRadius: "4px", boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                                minWidth: "180px", maxHeight: "200px", overflowY: "auto", marginTop: "2px" }}>
                                {personsLoading ? (
                                  <div style={{ padding: "0.5rem", fontSize: "0.7rem", color: "#999", textAlign: "center" }}>Carregando...</div>
                                ) : personsList.length === 0 ? (
                                  <div style={{ padding: "0.5rem", fontSize: "0.7rem", color: "#999", textAlign: "center" }}>Nenhuma pessoa cadastrada</div>
                                ) : (
                                  personsList.map((p) => (
                                    <div key={p.id}
                                      onClick={async () => {
                                        try {
                                          const r = await apiFetch(`/api/faces/persons/${p.id}/add-embeddings`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ face_embedding_ids: [a.id] }),
                                          });
                                          if (r.ok) {
                                            const data = await r.json();
                                            alert(`Embedding adicionado a "${p.name}" (${data.embedding_count} total)`);
                                          } else {
                                            const e = await r.json();
                                            alert(e.error || "Erro ao adicionar");
                                          }
                                        } catch { alert("Erro ao adicionar embedding"); }
                                        setPersonPickerForId(null);
                                      }}
                                      style={{ padding: "0.35rem 0.5rem", cursor: "pointer", fontSize: "0.7rem",
                                        borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#e3f2fd"; }}
                                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ""; }}
                                    >
                                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                                      <span style={{ fontSize: "0.6rem", color: "#999" }}>{p.embedding_count} emb</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {autoCrossRefOn && autoCrossRef.length === 0 && (
                  <div style={{ fontSize: "0.7rem", color: "#999", marginTop: "0.3rem" }}>
                    Ative a detecção facial e reproduza o vídeo. Cruzamentos aparecerão aqui automaticamente.
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
              <RecordingList recordings={recordings} selectedRecording={selectedRecording} onSelect={setSelectedRecording} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Playback;
