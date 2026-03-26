import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, authorize } from '../services/auth.js';

const router = Router();

// GET /api/settings/server — Get server/RTMP config
router.get('/server', authenticate, authorize('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM settings WHERE key IN ('rtmp_public_host', 'rtmp_public_port')"
    );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

    res.json({
      rtmp_public_host: map.rtmp_public_host || process.env.RTMP_PUBLIC_HOST || '',
      rtmp_public_port: map.rtmp_public_port || process.env.RTMP_PUBLIC_PORT || '1935',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/server — Save server/RTMP config
router.put('/server', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rtmp_public_host, rtmp_public_port } = req.body;

    if (!rtmp_public_host) {
      return res.status(400).json({ error: 'IP ou domínio público é obrigatório' });
    }

    const upsert = async (key, value) => {
      if (value === undefined || value === null) return;
      await pool.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [key, value]
      );
    };

    await upsert('rtmp_public_host', rtmp_public_host.trim());
    await upsert('rtmp_public_port', rtmp_public_port || '1935');

    res.json({ message: 'Configurações do servidor salvas com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
