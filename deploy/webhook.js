// HappyDo Guard — Auto-deploy webhook v3
const http = require('http');
const crypto = require('crypto');
const { execFile, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.WEBHOOK_PORT || 9000;
const SECRET = process.env.WEBHOOK_SECRET || '';
const DEPLOY_SCRIPT = process.env.DEPLOY_SCRIPT || path.join(__dirname, 'deploy.sh');
const BRANCH = process.env.DEPLOY_BRANCH || 'main';
const LOG_FILE = process.env.DEPLOY_LOG || '/opt/HappyDoGuard/deploy.log';

let deploying = false;

function verifySignature(payload, signature) {
  if (!SECRET) return true;
  const hmac = crypto.createHmac('sha256', SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature || ''));
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

function runDeploy(info) {
  if (deploying) {
    console.log(`[${new Date().toISOString()}] Deploy already in progress, skipping`);
    return;
  }
  deploying = true;
  const startedAt = new Date().toISOString();
  console.log(`[${startedAt}] Starting deploy: ${info}`);

  execFile('bash', [DEPLOY_SCRIPT], { timeout: 1800000 }, (err, stdout, stderr) => {
    deploying = false;
    const finishedAt = new Date().toISOString();
    if (err) {
      console.error(`[${finishedAt}] Deploy FAILED:`, err.message);
      if (stderr) console.error(stderr);
      lastDeployResult = { status: 'failed', info, startedAt, finishedAt, error: err.message };
    } else {
      console.log(`[${finishedAt}] Deploy SUCCESS`);
      lastDeployResult = { status: 'success', info, startedAt, finishedAt };
    }
    if (stdout) console.log(stdout);
  });
}

const server = http.createServer((req, res) => {
  // Health check — always public (used by monitoring)
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'deploy-webhook', deploying, branch: BRANCH }));
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
    res.end(JSON.stringify({ deploying, branch: BRANCH, lastDeployResult, statusFile }, null, 2));
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
          res.end('Deploy triggered');
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
    res.end('Manual deploy triggered');
    runDeploy('manual trigger');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Deploy webhook listening on port ${PORT}`);
  console.log(`  Branch: ${BRANCH}`);
  console.log(`  Secret: ${SECRET ? 'configured' : 'NOT SET (accepting all requests)'}`);
});
