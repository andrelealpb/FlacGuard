import { execSync } from 'child_process';
import { pool } from '../db/pool.js';

const DISK_WARNING_PERCENT = 85;
const DISK_CRITICAL_PERCENT = 90;

/**
 * Get disk usage for the recordings partition.
 * Returns { total, used, available, percent, mount }
 */
function getRecordingsDiskUsage() {
  try {
    const out = execSync("df -B1 /data 2>/dev/null || df -B1 /", { encoding: 'utf8', timeout: 5000 });
    const lines = out.trim().split('\n').slice(1);
    if (lines.length === 0) return null;
    const parts = lines[0].trim().split(/\s+/);
    if (parts.length < 6) return null;
    const total = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    const available = parseInt(parts[3], 10);
    return {
      total,
      used,
      available,
      percent: total > 0 ? Math.round((used / total) * 100) : 0,
      mount: parts[5],
    };
  } catch {
    return null;
  }
}

/**
 * Create a system alert if one doesn't already exist (unresolved) for the same type.
 */
async function createAlertIfNew(type, severity, title, message, metadata = {}, cameraId = null) {
  // Check for existing unresolved alert of same type (and same camera if applicable)
  const conditions = ['type = $1', 'resolved = false'];
  const params = [type];
  if (cameraId) {
    conditions.push(`camera_id = $${params.length + 1}`);
    params.push(cameraId);
  } else {
    conditions.push('camera_id IS NULL');
  }

  const { rows: existing } = await pool.query(
    `SELECT id FROM system_alerts WHERE ${conditions.join(' AND ')}`,
    params
  );

  if (existing.length > 0) {
    // Update existing alert with latest data
    await pool.query(
      `UPDATE system_alerts SET message = $1, metadata = $2, created_at = now() WHERE id = $3`,
      [message, JSON.stringify(metadata), existing[0].id]
    );
    return existing[0].id;
  }

  const { rows } = await pool.query(
    `INSERT INTO system_alerts (type, severity, title, message, camera_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [type, severity, title, message, cameraId, JSON.stringify(metadata)]
  );
  console.log(`[DiskMonitor] Alert created: ${severity} - ${title}`);
  return rows[0].id;
}

/**
 * Auto-resolve alerts that are no longer applicable.
 */
async function autoResolveAlerts(type, cameraId = null) {
  const conditions = ['type = $1', 'resolved = false'];
  const params = [type];
  if (cameraId) {
    conditions.push(`camera_id = $${params.length + 1}`);
    params.push(cameraId);
  } else {
    conditions.push('camera_id IS NULL');
  }

  await pool.query(
    `UPDATE system_alerts SET resolved = true, resolved_at = now()
     WHERE ${conditions.join(' AND ')}`,
    params
  );
}

/**
 * Check disk usage and create alerts at 85% (warning) and 90% (critical).
 */
async function checkDiskUsage() {
  const disk = getRecordingsDiskUsage();
  if (!disk) return;

  const { percent, total, used, available } = disk;
  const totalGB = (total / 1073741824).toFixed(1);
  const usedGB = (used / 1073741824).toFixed(1);
  const availGB = (available / 1073741824).toFixed(1);

  if (percent >= DISK_CRITICAL_PERCENT) {
    await createAlertIfNew(
      'disk_critical',
      'critical',
      `Disco em ${percent}% — espaço crítico`,
      `O disco de gravações está em ${percent}% de uso (${usedGB} GB de ${totalGB} GB). Restam apenas ${availGB} GB livres. As gravações podem falhar se o disco encher. Considere aumentar o disco ou reduzir a retenção das câmeras.`,
      { disk_percent: percent, total_bytes: total, used_bytes: used, available_bytes: available }
    );
    // Also resolve the warning if a critical exists
    await autoResolveAlerts('disk_warning');
  } else if (percent >= DISK_WARNING_PERCENT) {
    await createAlertIfNew(
      'disk_warning',
      'warning',
      `Disco em ${percent}% — atenção`,
      `O disco de gravações está em ${percent}% de uso (${usedGB} GB de ${totalGB} GB). Restam ${availGB} GB livres. Monitore o crescimento do uso.`,
      { disk_percent: percent, total_bytes: total, used_bytes: used, available_bytes: available }
    );
    // Resolve critical if we dropped back below 90%
    await autoResolveAlerts('disk_critical');
  } else {
    // Disk is fine — resolve any existing alerts
    await autoResolveAlerts('disk_warning');
    await autoResolveAlerts('disk_critical');
  }
}

/**
 * Check per-camera storage quotas and create alerts for cameras exceeding their quota.
 */
async function checkStorageQuotas() {
  // Get cameras with quotas defined
  const { rows: cameras } = await pool.query(
    `SELECT c.id, c.name, c.storage_quota_gb,
            COALESCE(SUM(r.file_size), 0)::bigint as used_bytes
     FROM cameras c
     LEFT JOIN recordings r ON r.camera_id = c.id
     WHERE c.storage_quota_gb IS NOT NULL
     GROUP BY c.id, c.name, c.storage_quota_gb`
  );

  for (const cam of cameras) {
    const quotaBytes = cam.storage_quota_gb * 1073741824;
    const usedGB = (Number(cam.used_bytes) / 1073741824).toFixed(2);
    const percent = quotaBytes > 0 ? Math.round((Number(cam.used_bytes) / quotaBytes) * 100) : 0;

    if (percent >= 90) {
      await createAlertIfNew(
        'quota_exceeded',
        'warning',
        `${cam.name}: ${percent}% da franquia de ${cam.storage_quota_gb} GB`,
        `A câmera "${cam.name}" está usando ${usedGB} GB de ${cam.storage_quota_gb} GB de franquia (${percent}%). Considere aumentar a franquia ou reduzir a retenção.`,
        { used_bytes: Number(cam.used_bytes), quota_gb: cam.storage_quota_gb, percent },
        cam.id
      );
    } else {
      await autoResolveAlerts('quota_exceeded', cam.id);
    }
  }
}

/**
 * Run all disk monitoring checks.
 * Called periodically from index.js.
 */
export async function runDiskMonitor() {
  try {
    await checkDiskUsage();
    await checkStorageQuotas();
  } catch (err) {
    console.error('[DiskMonitor] Error:', err.message);
  }
}
