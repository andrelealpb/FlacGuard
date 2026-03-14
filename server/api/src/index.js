import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import rateLimit from 'express-rate-limit';

import camerasRouter from './routes/cameras.js';
import recordingsRouter from './routes/recordings.js';
import eventsRouter from './routes/events.js';
import webhooksRouter from './routes/webhooks.js';
import pdvsRouter from './routes/pdvs.js';
import authRouter from './routes/auth.js';
import hooksRouter from './routes/hooks.js';
import settingsRouter from './routes/settings.js';
import facesRouter from './routes/faces.js';
import { pool } from './db/pool.js';
import { startMotionDetector } from './services/motion-detector.js';
import { manageContinuousRecordings } from './services/recorder.js';

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting: 100 req/min per IP/API Key
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
});
app.use('/api', limiter);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/cameras', camerasRouter);
app.use('/api/recordings', recordingsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/pdvs', pdvsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/faces', facesRouter);

// Nginx-RTMP callback hooks (internal, no /api prefix)
app.use('/hooks', hooksRouter);

// Deploy status — read from deploy-status.json (mounted) or build info
app.get('/api/deploy-status', (_req, res) => {
  // Try deploy-status.json from host (mounted volume)
  const paths = [
    '/opt/HappyDoGuard/deploy-status.json',
    '/app/deploy-status.json',
  ];
  for (const p of paths) {
    try {
      if (existsSync(p)) {
        const data = readFileSync(p, 'utf-8');
        return res.json(JSON.parse(data));
      }
    } catch {
      // try next
    }
  }

  // Fallback: read build info embedded at build time
  try {
    if (existsSync('/app/build-info.json')) {
      const data = readFileSync('/app/build-info.json', 'utf-8');
      return res.json({ status: 'ok', ...JSON.parse(data) });
    }
  } catch {
    // ignore
  }

  res.json({ status: 'unknown', message: 'Nenhum deploy registrado ainda' });
});

// Health check
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'happydo-guard-api' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// Run pending migrations on startup
async function runMigrations() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(__dirname, 'db', 'migrations');

  // Ensure migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  let files;
  try {
    files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  } catch {
    return; // no migrations dir
  }

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (rows.length > 0) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      console.log(`Migration applied: ${file}`);
    } catch (err) {
      console.error(`Migration failed (${file}):`, err.message);
    }
  }
}

runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`HappyDo Guard API running on port ${PORT}`);

      // Start background services after a delay (let nginx-rtmp be ready)
      setTimeout(() => {
        startMotionDetector();

        // Check for cameras that need continuous recording every 30s
        setInterval(manageContinuousRecordings, 30000);
        manageContinuousRecordings();
      }, 10000);
    });
  })
  .catch((err) => {
    console.error('Migration error:', err.message);
    // Start anyway so the API is accessible
    app.listen(PORT, () => {
      console.log(`HappyDo Guard API running on port ${PORT} (migrations had errors)`);
    });
  });

export default app;
