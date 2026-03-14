/**
 * HappyDo Pulse API Integration
 *
 * Connects to HappyDoPulse to fetch PDV (store) data.
 * Auth: JWT-based (login → accessToken → refreshToken).
 * Credentials can be set via DB (settings table) or env vars.
 */

import { pool } from '../db/pool.js';

let accessToken = null;
let refreshToken = null;
let tokenExpiresAt = 0;

/**
 * Read Pulse credentials from DB settings, falling back to env vars.
 */
async function getConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM settings WHERE key IN ('pulse_api_url', 'pulse_email', 'pulse_password')"
    );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
      apiUrl: map.pulse_api_url || process.env.PULSE_API_URL || 'https://happydopulse-production.up.railway.app/api',
      email: map.pulse_email || process.env.PULSE_EMAIL || '',
      password: map.pulse_password || process.env.PULSE_PASSWORD || '',
    };
  } catch {
    return {
      apiUrl: process.env.PULSE_API_URL || 'https://happydopulse-production.up.railway.app/api',
      email: process.env.PULSE_EMAIL || '',
      password: process.env.PULSE_PASSWORD || '',
    };
  }
}

/**
 * Login to Pulse API and store tokens.
 */
async function login() {
  const config = await getConfig();
  const res = await fetch(`${config.apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Pulse login failed: ${body.error?.message || res.statusText}`);
  }

  const { data } = await res.json();
  accessToken = data.accessToken;
  refreshToken = data.refreshToken;
  tokenExpiresAt = Date.now() + 55 * 60 * 1000;
}

/**
 * Refresh the access token using the refresh token.
 */
async function refresh() {
  if (!refreshToken) {
    return login();
  }

  const config = await getConfig();
  const res = await fetch(`${config.apiUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    return login();
  }

  const { data } = await res.json();
  accessToken = data.accessToken;
  refreshToken = data.refreshToken;
  tokenExpiresAt = Date.now() + 55 * 60 * 1000;
}

/**
 * Get a valid access token, refreshing or logging in as needed.
 */
async function getToken() {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    if (refreshToken) {
      await refresh();
    } else {
      await login();
    }
  }
  return accessToken;
}

/**
 * Authenticated fetch to Pulse API.
 */
async function pulseFetch(path, options = {}) {
  const config = await getConfig();
  const token = await getToken();
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    await refresh();
    const retryToken = accessToken;
    return fetch(`${config.apiUrl}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${retryToken}`,
      },
    });
  }

  return res;
}

/**
 * Fetch all stores (PDVs) from Pulse, handling pagination.
 */
export async function fetchAllStores() {
  const stores = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const res = await pulseFetch(`/stores?page=${page}&limit=${limit}&active=true`);
    if (!res.ok) {
      throw new Error(`Pulse stores fetch failed: ${res.statusText}`);
    }

    const { data } = await res.json();
    stores.push(...data.stores);

    if (page >= data.pagination.pages) break;
    page++;
  }

  return stores;
}

/**
 * Fetch a single store by ID from Pulse.
 */
export async function fetchStoreById(storeId) {
  const res = await pulseFetch(`/stores/${storeId}`);
  if (!res.ok) {
    throw new Error(`Pulse store fetch failed: ${res.statusText}`);
  }
  const { data } = await res.json();
  return data;
}

/**
 * Check if Pulse credentials are configured (DB or env).
 */
export async function isPulseConfigured() {
  const config = await getConfig();
  return !!(config.email && config.password);
}

/**
 * Test Pulse connection by attempting login.
 * Returns { ok, message }.
 */
export async function testPulseConnection() {
  const config = await getConfig();
  if (!config.email || !config.password) {
    return { ok: false, message: 'Credenciais não configuradas' };
  }

  try {
    const res = await fetch(`${config.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: config.email, password: config.password }),
    });

    if (res.ok) {
      const { data } = await res.json();
      // Store the token for subsequent use
      accessToken = data.accessToken;
      refreshToken = data.refreshToken;
      tokenExpiresAt = Date.now() + 55 * 60 * 1000;
      return { ok: true, message: 'Conexão estabelecida com sucesso' };
    }

    const body = await res.json().catch(() => ({}));
    return { ok: false, message: body.error?.message || `Erro HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: `Falha na conexão: ${err.message}` };
  }
}
