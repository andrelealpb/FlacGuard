import { Router } from 'express';
import { pool } from '../db/pool.js';
import {
  generateToken,
  hashPassword,
  comparePassword,
  authenticate,
  authorize,
} from '../services/auth.js';
import { getTenantId } from '../services/tenant.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = rows[0];
    const valid = await comparePassword(password, user.hashed_password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = generateToken(user);
    res.json({ access_token: token, token_type: 'bearer' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/setup — Create first admin (only works when no users exist)
router.post('/setup', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(existing[0].count) > 0) {
      return res.status(403).json({ error: 'Setup already completed. Use /api/auth/register instead.' });
    }
    const { email, password, full_name } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'email, password, and full_name are required' });
    }
    const hashed = await hashPassword(password);
    // Default tenant for first admin
    const { rows: tenantRows } = await pool.query("SELECT id FROM tenants WHERE slug = 'happydo' LIMIT 1");
    const defaultTenantId = tenantRows[0]?.id || null;
    const { rows } = await pool.query(
      `INSERT INTO users (email, hashed_password, full_name, role, tenant_id)
       VALUES ($1, $2, $3, 'admin', $4) RETURNING id, email, full_name, role, tenant_id, created_at`,
      [email, hashed, full_name, defaultTenantId]
    );
    const token = generateToken(rows[0]);
    res.status(201).json({ user: rows[0], access_token: token, token_type: 'bearer' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register (admin only)
router.post('/register', authenticate, authorize('admin'), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { email, password, full_name, role = 'viewer' } = req.body;
    const hashed = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (email, hashed_password, full_name, role, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name, role, tenant_id, created_at`,
      [email, hashed, full_name, role, tenantId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
