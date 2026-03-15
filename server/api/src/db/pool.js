import pg from 'pg';

const CAMERA_TIMEZONE = process.env.CAMERA_TIMEZONE || 'America/Sao_Paulo';

// Return TIMESTAMPTZ as raw PG string (session timezone applied)
// Format from PG with session TZ: "2026-03-15 18:11:00-03"
// We keep the raw string so the frontend can parse/display correctly
pg.types.setTypeParser(1184, (val) => val);
pg.types.setTypeParser(1114, (val) => val);

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://happydo:happydo@db:5432/happydo_guard',
});

// Set session timezone so PG converts TIMESTAMPTZ to camera local time
pool.on('connect', (client) => {
  client.query(`SET timezone = '${CAMERA_TIMEZONE}'`);
});
