import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool } from '../db/pool.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Express middleware: authenticates via JWT (Authorization: Bearer ...),
 * API Key (X-API-Key header), or Internal Gateway Key (X-Internal-Key + X-Tenant-Id).
 *
 * Gateway auth: when the Control gateway proxies requests on behalf of a tenant,
 * it sends X-Internal-Key (shared secret) + X-Tenant-Id. This authenticates the
 * request in the context of that tenant without requiring a JWT.
 */
export function authenticate(req, res, next) {
  // Try Internal Gateway Key first (Control gateway proxying for a tenant)
  const internalKey = req.headers['x-internal-key'];
  const gatewayTenantId = req.headers['x-tenant-id'];
  if (internalKey && gatewayTenantId) {
    if (!INTERNAL_KEY) {
      return res.status(503).json({ error: 'Internal API not configured' });
    }
    try {
      if (!crypto.timingSafeEqual(Buffer.from(internalKey), Buffer.from(INTERNAL_KEY))) {
        return res.status(401).json({ error: 'Invalid internal key' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid internal key' });
    }
    req.auth = { type: 'gateway', tenantId: gatewayTenantId, role: 'admin' };
    return next();
  }

  // Try API Key
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    pool
      .query('SELECT * FROM api_keys WHERE key = $1 AND is_active = true', [apiKey])
      .then(({ rows }) => {
        if (rows.length === 0) {
          return res.status(401).json({ error: 'Invalid API key' });
        }
        req.auth = { type: 'api_key', key: rows[0], tenantId: rows[0].tenant_id };
        next();
      })
      .catch(() => res.status(500).json({ error: 'Auth error' }));
    return;
  }

  // Try JWT from header or query parameter (query param needed for <video src="...">)
  const header = req.headers.authorization;
  const tokenFromQuery = req.query.token;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : tokenFromQuery;

  if (!token) {
    return res.status(401).json({ error: 'Missing authentication' });
  }

  try {
    const decoded = verifyToken(token);
    req.auth = { type: 'jwt', user: decoded, tenantId: decoded.tenant_id };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Restrict to specific roles. Must be used after authenticate().
 */
export function authorize(...roles) {
  return (req, res, next) => {
    // API keys and gateway have full access
    if (req.auth?.type === 'api_key' || req.auth?.type === 'gateway') return next();
    if (!roles.includes(req.auth?.user?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
