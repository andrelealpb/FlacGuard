import { Router } from 'express';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { pool } from '../db/pool.js';
import { authenticate, authorize } from '../services/auth.js';

const router = Router();

// Helper: parse /proc/stat for CPU usage
function getCpuUsage() {
  try {
    const stat = readFileSync('/proc/stat', 'utf8');
    const line = stat.split('\n').find(l => l.startsWith('cpu '));
    if (!line) return null;
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
    const total = user + nice + system + idle + iowait + irq + softirq + steal;
    const busy = total - idle - iowait;
    return { total, busy, idle: idle + iowait, user, system, iowait };
  } catch { return null; }
}

// Helper: parse /proc/meminfo
function getMemoryInfo() {
  try {
    const info = readFileSync('/proc/meminfo', 'utf8');
    const get = (key) => {
      const m = info.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? parseInt(m[1], 10) * 1024 : 0; // Convert kB to bytes
    };
    const total = get('MemTotal');
    const available = get('MemAvailable');
    const buffers = get('Buffers');
    const cached = get('Cached');
    const swapTotal = get('SwapTotal');
    const swapFree = get('SwapFree');
    return {
      total, available,
      used: total - available,
      buffers, cached,
      swap_total: swapTotal,
      swap_used: swapTotal - swapFree,
    };
  } catch { return null; }
}

// Helper: parse /proc/net/dev for network stats
function getNetworkStats() {
  try {
    const dev = readFileSync('/proc/net/dev', 'utf8');
    const lines = dev.split('\n').slice(2);
    const interfaces = [];
    for (const line of lines) {
      const parts = line.trim().split(/[\s:]+/);
      if (parts.length < 11) continue;
      const name = parts[0];
      if (name === 'lo') continue;
      interfaces.push({
        name,
        rx_bytes: parseInt(parts[1], 10),
        rx_packets: parseInt(parts[2], 10),
        tx_bytes: parseInt(parts[9], 10),
        tx_packets: parseInt(parts[10], 10),
      });
    }
    return interfaces;
  } catch { return []; }
}

// Helper: disk usage via df
function getDiskUsage() {
  try {
    const out = execSync("df -B1 / /data 2>/dev/null || df -B1 /", { encoding: 'utf8', timeout: 5000 });
    const lines = out.trim().split('\n').slice(1);
    const disks = [];
    const seen = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const mount = parts[5];
      if (seen.has(mount)) continue;
      seen.add(mount);
      disks.push({
        filesystem: parts[0],
        total: parseInt(parts[1], 10),
        used: parseInt(parts[2], 10),
        available: parseInt(parts[3], 10),
        mount,
      });
    }
    return disks;
  } catch { return []; }
}

// Helper: detailed disk breakdown using du for key directories
function getDiskBreakdown() {
  const breakdown = [];
  try {
    // Docker images/containers/volumes
    const dockerDf = execSync("docker system df --format '{{.Type}}\\t{{.Size}}\\t{{.Reclaimable}}' 2>/dev/null", { encoding: 'utf8', timeout: 15000 });
    for (const line of dockerDf.trim().split('\n').filter(Boolean)) {
      const [type, size, reclaimable] = line.split('\t');
      breakdown.push({ name: `Docker ${type}`, size, reclaimable: reclaimable || '0B', category: 'docker' });
    }
  } catch {
    // Docker not accessible from inside container - try via host paths
  }

  // Check common large directories
  const dirs = [
    { path: '/var/log', name: 'Logs do sistema' },
    { path: '/var/lib/docker', name: 'Docker (total)' },
    { path: '/var/lib/docker/overlay2', name: 'Docker layers' },
    { path: '/var/lib/docker/volumes', name: 'Docker volumes' },
    { path: '/var/cache', name: 'Cache do sistema' },
    { path: '/tmp', name: 'Arquivos temporários' },
    { path: '/var/lib/apt', name: 'Pacotes APT' },
    { path: '/usr', name: 'Sistema (/usr)' },
    { path: '/opt', name: 'Aplicações (/opt)' },
    { path: '/snap', name: 'Snap packages' },
  ];

  for (const dir of dirs) {
    try {
      const out = execSync(`du -sb ${dir.path} 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
      const bytes = parseInt(out.trim().split('\t')[0], 10);
      if (bytes > 0) {
        breakdown.push({ name: dir.name, path: dir.path, bytes, category: 'system' });
      }
    } catch {
      // skip inaccessible dirs
    }
  }

  return breakdown;
}

// Helper: get Docker disk usage summary
function getDockerDiskUsage() {
  try {
    const out = execSync("docker system df -v --format json 2>/dev/null", { encoding: 'utf8', timeout: 15000 });
    // docker system df -v outputs JSON lines
    const lines = out.trim().split('\n').filter(Boolean);
    const images = [];
    const containers = [];
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.Repository) images.push(item);
        if (item.Container) containers.push(item);
      } catch { /* skip non-json */ }
    }
    return { images, containers };
  } catch {
    return null;
  }
}

// Helper: system uptime
function getUptime() {
  try {
    const up = readFileSync('/proc/uptime', 'utf8');
    return parseFloat(up.split(' ')[0]);
  } catch { return 0; }
}

// Helper: load average
function getLoadAverage() {
  try {
    const load = readFileSync('/proc/loadavg', 'utf8');
    const parts = load.split(' ');
    return { load1: parseFloat(parts[0]), load5: parseFloat(parts[1]), load15: parseFloat(parts[2]) };
  } catch { return { load1: 0, load5: 0, load15: 0 }; }
}

// Store previous CPU reading for delta calculation
let prevCpu = null;

// Cache disk breakdown (expensive operation - cache for 60s)
let diskBreakdownCache = null;
let diskBreakdownCacheTime = 0;
function getDiskBreakdownCached() {
  const now = Date.now();
  if (!diskBreakdownCache || now - diskBreakdownCacheTime > 60000) {
    diskBreakdownCache = getDiskBreakdown();
    diskBreakdownCacheTime = now;
  }
  return diskBreakdownCache;
}

let dockerDiskCache = null;
let dockerDiskCacheTime = 0;
function getDockerDiskCached() {
  const now = Date.now();
  if (!dockerDiskCache || now - dockerDiskCacheTime > 60000) {
    dockerDiskCache = getDockerDiskUsage();
    dockerDiskCacheTime = now;
  }
  return dockerDiskCache;
}

// GET /api/monitor/stats — Full system stats
router.get('/stats', authenticate, authorize('admin'), async (_req, res) => {
  try {
    const cpu = getCpuUsage();
    let cpuPercent = 0;
    if (cpu && prevCpu) {
      const dTotal = cpu.total - prevCpu.total;
      const dBusy = cpu.busy - prevCpu.busy;
      cpuPercent = dTotal > 0 ? Math.round((dBusy / dTotal) * 100) : 0;
    }
    prevCpu = cpu;

    const memory = getMemoryInfo();
    const network = getNetworkStats();
    const disks = getDiskUsage();
    const uptime = getUptime();
    const load = getLoadAverage();

    // Database stats
    const { rows: dbSize } = await pool.query("SELECT pg_database_size(current_database())::text as size");
    const { rows: dbConns } = await pool.query("SELECT count(*)::int as active FROM pg_stat_activity WHERE state = 'active'");

    // Recordings stats
    const { rows: recStats } = await pool.query(`
      SELECT
        count(*)::int as total_recordings,
        COALESCE(SUM(file_size), 0)::text as total_size,
        count(DISTINCT camera_id)::int as cameras_with_recordings
      FROM recordings
    `);

    // Face embeddings count
    const { rows: faceStats } = await pool.query('SELECT count(*)::int as total FROM face_embeddings');

    // Camera status
    const { rows: camStats } = await pool.query(`
      SELECT status, count(*)::int as count FROM cameras GROUP BY status
    `);

    // Docker service status
    let services = [];
    try {
      const dockerPs = execSync(
        "docker ps --format '{{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null | grep -i flac-guard || true",
        { encoding: 'utf8', timeout: 5000 }
      );
      services = dockerPs.trim().split('\n').filter(Boolean).map(line => {
        const [name, status, ports] = line.split('\t');
        return { name: name || '', status: status || '', ports: ports || '' };
      });
    } catch {
      // Docker not available from inside container, use process info instead
      services = [
        { name: 'api', status: 'running', ports: '8000' },
      ];
      // Check face service
      try {
        const fRes = await fetch(`${process.env.FACE_SERVICE_URL || 'http://face-service:8001'}/health`, { signal: AbortSignal.timeout(2000) });
        const fData = await fRes.json();
        services.push({ name: 'face-service', status: fData.model_loaded ? 'running (model loaded)' : 'starting', ports: '8001' });
      } catch { services.push({ name: 'face-service', status: 'offline', ports: '8001' }); }
      // Check nginx-rtmp
      try {
        const nRes = await fetch('http://nginx-rtmp:8080/rtmp-stat', { signal: AbortSignal.timeout(2000) });
        services.push({ name: 'nginx-rtmp', status: nRes.ok ? 'running' : 'error', ports: '1935, 8080' });
      } catch { services.push({ name: 'nginx-rtmp', status: 'offline', ports: '1935, 8080' }); }
      // DB is alive since we queried it
      services.push({ name: 'postgresql', status: 'running', ports: '5432' });
    }

    // Disk breakdown (only calculate on first call and cache for 60s)
    let diskBreakdown = getDiskBreakdownCached();
    let dockerDisk = getDockerDiskCached();

    res.json({
      cpu: { percent: cpuPercent, ...load },
      memory,
      disks,
      network,
      uptime,
      database: {
        size: parseInt(dbSize[0].size, 10),
        active_connections: dbConns[0].active,
      },
      recordings: {
        total: recStats[0].total_recordings,
        total_size: parseInt(recStats[0].total_size, 10),
        cameras_with_recordings: recStats[0].cameras_with_recordings,
      },
      faces: { total_embeddings: faceStats[0].total },
      cameras: camStats.reduce((acc, r) => { acc[r.status] = r.count; return acc; }, {}),
      services,
      disk_breakdown: diskBreakdown,
      docker_disk: dockerDisk,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/monitor/cleanup — Run Docker cleanup to free disk space
router.post('/cleanup', authenticate, authorize('admin'), async (_req, res) => {
  try {
    const results = [];

    // Prune stopped containers
    try {
      const containers = execSync('docker container prune -f 2>&1', { encoding: 'utf8', timeout: 30000 });
      results.push({ action: 'Containers parados removidos', output: containers.trim() });
    } catch (e) { results.push({ action: 'Container prune', error: e.message }); }

    // Prune dangling images
    try {
      const images = execSync('docker image prune -f 2>&1', { encoding: 'utf8', timeout: 30000 });
      results.push({ action: 'Imagens não utilizadas removidas', output: images.trim() });
    } catch (e) { results.push({ action: 'Image prune', error: e.message }); }

    // Prune build cache
    try {
      const buildCache = execSync('docker builder prune -f 2>&1', { encoding: 'utf8', timeout: 60000 });
      results.push({ action: 'Cache de build removido', output: buildCache.trim() });
    } catch (e) { results.push({ action: 'Builder prune', error: e.message }); }

    // Prune unused volumes (NOT all - only dangling)
    try {
      const volumes = execSync('docker volume prune -f 2>&1', { encoding: 'utf8', timeout: 30000 });
      results.push({ action: 'Volumes não utilizados removidos', output: volumes.trim() });
    } catch (e) { results.push({ action: 'Volume prune', error: e.message }); }

    // Clear old log files
    try {
      const logs = execSync('find /var/log -name "*.gz" -o -name "*.old" -o -name "*.1" 2>/dev/null | head -50', { encoding: 'utf8', timeout: 10000 });
      if (logs.trim()) {
        execSync('find /var/log -name "*.gz" -o -name "*.old" -o -name "*.1" -delete 2>/dev/null || true', { encoding: 'utf8', timeout: 10000 });
        const count = logs.trim().split('\n').length;
        results.push({ action: `${count} logs antigos removidos`, output: 'OK' });
      }
    } catch { /* ignore */ }

    // Clear APT cache
    try {
      execSync('apt-get clean 2>/dev/null || true', { encoding: 'utf8', timeout: 15000 });
      results.push({ action: 'Cache APT limpo', output: 'OK' });
    } catch { /* ignore */ }

    // Invalidate disk caches
    diskBreakdownCache = null;
    dockerDiskCache = null;

    // Get updated disk info
    const disks = getDiskUsage();

    res.json({ success: true, results, disks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
