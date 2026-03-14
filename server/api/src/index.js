import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import rateLimit from 'express-rate-limit';

import camerasRouter from './routes/cameras.js';
import recordingsRouter from './routes/recordings.js';
import eventsRouter from './routes/events.js';
import webhooksRouter from './routes/webhooks.js';
import pdvsRouter from './routes/pdvs.js';
import authRouter from './routes/auth.js';
import hooksRouter from './routes/hooks.js';
import settingsRouter from './routes/settings.js';
import { pool } from './db/pool.js';

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting: 100 req/min per IP/API Key
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
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

// Nginx-RTMP callback hooks (internal, no /api prefix)
app.use('/hooks', hooksRouter);

// Deploy status — read from file written by deploy.sh
app.get('/api/deploy-status', (_req, res) => {
  try {
    const data = readFileSync('/opt/happydo-guard/deploy-status.json', 'utf-8');
    res.json(JSON.parse(data));
  } catch {
    res.json({ status: 'unknown', message: 'Nenhum deploy registrado ainda' });
  }
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

app.listen(PORT, () => {
  console.log(`HappyDo Guard API running on port ${PORT}`);
});

export default app;
