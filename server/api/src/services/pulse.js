/**
 * HappyDo Pulse API Integration
 *
 * Connects to HappyDoPulse to fetch PDV (store) data.
 * Auth: JWT-based (login → accessToken → refreshToken).
 */

const PULSE_API_URL = process.env.PULSE_API_URL || 'https://happydopulse-production.up.railway.app/api';
const PULSE_EMAIL = process.env.PULSE_EMAIL || '';
const PULSE_PASSWORD = process.env.PULSE_PASSWORD || '';

let accessToken = null;
let refreshToken = null;
let tokenExpiresAt = 0;

/**
 * Login to Pulse API and store tokens.
 */
async function login() {
  const res = await fetch(`${PULSE_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PULSE_EMAIL, password: PULSE_PASSWORD }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Pulse login failed: ${body.error?.message || res.statusText}`);
  }

  const { data } = await res.json();
  accessToken = data.accessToken;
  refreshToken = data.refreshToken;
  // Access token expires in 1h, refresh 5 min before
  tokenExpiresAt = Date.now() + 55 * 60 * 1000;
}

/**
 * Refresh the access token using the refresh token.
 */
async function refresh() {
  if (!refreshToken) {
    return login();
  }

  const res = await fetch(`${PULSE_API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    // Refresh failed, do a full login
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
  const token = await getToken();
  const res = await fetch(`${PULSE_API_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  // If 401, try refreshing token once and retry
  if (res.status === 401) {
    await refresh();
    const retryToken = accessToken;
    return fetch(`${PULSE_API_URL}${path}`, {
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
 * Returns array of store objects.
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
 * Check if Pulse credentials are configured.
 */
export function isPulseConfigured() {
  return !!(PULSE_EMAIL && PULSE_PASSWORD);
}
