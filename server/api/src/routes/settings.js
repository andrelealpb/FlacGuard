import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, authorize } from '../services/auth.js';
import { testPulseConnection } from '../services/pulse.js';

const router = Router();

// GET /api/settings/pulse — Get Pulse config (password masked)
router.get('/pulse', authenticate, authorize('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM settings WHERE key IN ('pulse_api_url', 'pulse_email', 'pulse_password')"
    );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

    res.json({
      api_url: map.pulse_api_url || process.env.PULSE_API_URL || 'https://happydopulse-production.up.railway.app/api',
      email: map.pulse_email || process.env.PULSE_EMAIL || '',
      has_password: !!(map.pulse_password || process.env.PULSE_PASSWORD),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/pulse — Save Pulse credentials
router.put('/pulse', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { api_url, email, password } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    // Upsert each setting
    const upsert = async (key, value) => {
      if (value === undefined || value === null) return;
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [key, value]
      );
    };

    await upsert('pulse_api_url', api_url || 'https://happydopulse-production.up.railway.app/api');
    await upsert('pulse_email', email);
    if (password) {
      await upsert('pulse_password', password);
    }

    res.json({ message: 'Configurações do Pulse salvas com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/pulse/test — Test Pulse connection
router.post('/pulse/test', authenticate, authorize('admin'), async (_req, res) => {
  try {
    const result = await testPulseConnection();
    res.json(result);
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

export default router;
