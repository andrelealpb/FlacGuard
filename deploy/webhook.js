// Flac Guard — Auto-deploy webhook v4
// v4: anti-stall protection, deploy process tracking, auto-reset
const http = require('http');
const crypto = require('crypto');
const { execFile, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.WEBHOOK_PORT || 9000;
const SECRET = process.env.WEBHOOK_SECRET || '';
const DEPLOY_SCRIPT = process.env.DEPLOY_SCRIPT || path.join(__dirname, 'deploy.sh');
const BRANCH = process.env.DEPLOY_BRANCH || 'main';
const LOG_FILE = process.env.DEPLOY_LOG || '/opt/FlacGuard/deploy.log';

// Deploy timeout: 15 minutes max
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;
// Stall check interval: every 60 seconds
const STALL_CHECK_INTERVAL_MS = 60 * 1000;

let deploying = false;
let deployStartedAt = null;
let deployProcess = null;  // track the child process
let pendingDeploy = null;  // queued deploy info (if push arrives during deploy)

function verifySignature(payload, signature) {
  if (!SECRET) return true;
  const hmac = crypto.createHmac('sha256', SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature || ''));
  } catch {
    return false;
  }
}

function checkBearerAuth(req) {
  if (!SECRET) return true;
  const auth = req.headers['authorization'];
  return auth === `Bearer ${SECRET}`;
}

// Read last N lines of a file efficiently using tail
function readTail(filePath, lines) {
  try {
    return execSync(`tail -n ${lines} ${JSON.stringify(filePath)}`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch (e) {
    return 'No deploy log found: ' + e.message;
  }
}

let lastDeployResult = null;

// Force-reset the deploying state (called when stuck)
function forceResetDeploy(reason) {
  const now = new Date().toISOString();
  console.error(`[${now}] FORCE RESET: ${reason}`);

  // Kill the child process if it exists
  if (deployProcess) {
    try {
      deployProcess.kill('SIGKILL');
      console.log(`[${now}] Killed stuck deploy process (PID: ${deployProcess.pid})`);
    } catch (e) {
      console.error(`[${now}] Failed to kill process:`, e.message);
    }
    deployProcess = null;
  }

  deploying = false;
  deployStartedAt = null;

  lastDeployResult = {
    status: 'failed',
    info: 'auto-reset',
    startedAt: deployStartedAt,
    finishedAt: now,
    error: reason,
  };

  // Update deploy-status.json so the dashboard shows the failure
  const statusPath = path.join(path.dirname(DEPLOY_SCRIPT), '..', 'deploy-status.json');
  try {
    const statusData = {
      status: 'failed',
      started_at: deployStartedAt,
      finished_at: now,
      message: reason,
      stuck: true,
    };
    fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
  } catch { /* best effort */ }

  // If there's a pending deploy queued, trigger it now
  if (pendingDeploy) {
    const info = pendingDeploy;
    pendingDeploy = null;
    console.log(`[${now}] Running queued deploy: ${info}`);
    setTimeout(() => runDeploy(info), 2000);
  }
}

// Periodically check if deploy is stuck
setInterval(() => {
  if (!deploying || !deployStartedAt) return;

  const elapsed = Date.now() - new Date(deployStartedAt).getTime();
  if (elapsed > DEPLOY_TIMEOUT_MS) {
    forceResetDeploy(
      `Deploy travou — excedeu timeout de ${Math.round(DEPLOY_TIMEOUT_MS / 60000)} minutos. ` +
      `Iniciou em ${deployStartedAt}.`
    );
  }
}, STALL_CHECK_INTERVAL_MS);

function runDeploy(info) {
  if (deploying) {
    // Instead of silently ignoring, queue the deploy
    console.log(`[${new Date().toISOString()}] Deploy in progress — queuing: ${info}`);
    pendingDeploy = info;
    return;
  }
  deploying = true;
  deployStartedAt = new Date().toISOString();
  console.log(`[${deployStartedAt}] Starting deploy: ${info}`);

  const child = execFile('bash', [DEPLOY_SCRIPT], { timeout: DEPLOY_TIMEOUT_MS }, (err, stdout, stderr) => {
    deployProcess = null;
    deploying = false;
    const finishedAt = new Date().toISOString();
    const elapsed = Math.round((Date.now() - new Date(deployStartedAt).getTime()) / 1000);

    if (err) {
      console.error(`[${finishedAt}] Deploy FAILED (${elapsed}s):`, err.message);
      if (stderr) console.error(stderr);
      lastDeployResult = { status: 'failed', info, startedAt: deployStartedAt, finishedAt, error: err.message, elapsed };
    } else {
      console.log(`[${finishedAt}] Deploy SUCCESS (${elapsed}s)`);
      lastDeployResult = { status: 'success', info, startedAt: deployStartedAt, finishedAt, elapsed };
    }
    if (stdout) console.log(stdout);
    deployStartedAt = null;

    // If a new push arrived during this deploy, trigger it now
    if (pendingDeploy) {
      const nextInfo = pendingDeploy;
      pendingDeploy = null;
      console.log(`[${finishedAt}] Running queued deploy: ${nextInfo}`);
      setTimeout(() => runDeploy(nextInfo), 3000);
    }
  });

  deployProcess = child;
}

const server = http.createServer((req, res) => {
  // Health check — always public (used by monitoring)
  if (req.method === 'GET' && req.url === '/health') {
    const elapsed = deploying && deployStartedAt
      ? Math.round((Date.now() - new Date(deployStartedAt).getTime()) / 1000)
      : null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'deploy-webhook',
      deploying,
      branch: BRANCH,
      deploy_elapsed_seconds: elapsed,
      pending_deploy: !!pendingDeploy,
    }));
    return;
  }

  // Status endpoint — requires auth (exposes deploy metadata)
  if (req.method === 'GET' && req.url === '/status') {
    if (!checkBearerAuth(req)) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }
    let statusFile = null;
    try {
      const statusPath = path.join(path.dirname(DEPLOY_SCRIPT), '..', 'deploy-status.json');
      statusFile = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    } catch { /* no status file */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      deploying,
      deployStartedAt,
      branch: BRANCH,
      lastDeployResult,
      pendingDeploy,
      statusFile,
    }, null, 2));
    return;
  }

  // Logs endpoint — requires auth (exposes operational details); reads only tail
  if (req.method === 'GET' && req.url === '/logs') {
    if (!checkBearerAuth(req)) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }
    const content = readTail(LOG_FILE, 100);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(content);
    return;
  }

  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // Verify GitHub signature
      const sig = req.headers['x-hub-signature-256'];
      if (SECRET && !verifySignature(body, sig)) {
        console.log(`[${new Date().toISOString()}] Invalid signature`);
        res.writeHead(401);
        res.end('Invalid signature');
        return;
      }

      try {
        const payload = JSON.parse(body);
        const ref = payload.ref || '';
        const branch = ref.replace('refs/heads/', '');

        // Only deploy on push to target branch
        if (branch === BRANCH || BRANCH === '*') {
          const pusher = payload.pusher?.name || 'unknown';
          const commitMsg = payload.head_commit?.message || 'no message';
          res.writeHead(200);
          res.end(deploying ? 'Deploy queued' : 'Deploy triggered');
          runDeploy(`${pusher}: ${commitMsg}`);
        } else {
          console.log(`[${new Date().toISOString()}] Ignoring push to ${branch} (watching: ${BRANCH})`);
          res.writeHead(200);
          res.end('Branch ignored');
        }
      } catch (e) {
        console.error('Bad payload:', e.message);
        res.writeHead(400);
        res.end('Bad request');
      }
    });
    return;
  }

  // Manual deploy trigger
  if (req.method === 'POST' && req.url === '/deploy') {
    if (!checkBearerAuth(req)) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }
    res.writeHead(200);
    res.end(deploying ? 'Deploy queued (current deploy still running)' : 'Manual deploy triggered');
    runDeploy('manual trigger');
    return;
  }

  // Force reset — emergency endpoint to unstick deploys
  if (req.method === 'POST' && req.url === '/reset') {
    if (!checkBearerAuth(req)) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }
    if (!deploying) {
      res.writeHead(200);
      res.end('Nothing to reset — no deploy in progress');
      return;
    }
    forceResetDeploy('Manual reset via /reset endpoint');
    res.writeHead(200);
    res.end('Deploy state reset. You can now trigger a new deploy.');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Deploy webhook v4 listening on port ${PORT}`);
  console.log(`  Branch: ${BRANCH}`);
  console.log(`  Timeout: ${DEPLOY_TIMEOUT_MS / 60000} minutes`);
  console.log(`  Secret: ${SECRET ? 'configured' : 'NOT SET (accepting all requests)'}`);
});
