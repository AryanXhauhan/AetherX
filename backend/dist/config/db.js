import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;
// Standard PostgreSQL pool configuration
const pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER || undefined, // falls back to system user (e.g. aryanchauhan)
    password: process.env.PG_PASSWORD || undefined,
    database: process.env.PG_DATABASE || 'aetherx',
    max: 20, // Max concurrent connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
pool.on('error', (err) => {
    console.error('❌ Unexpected database error on idle PostgreSQL client:', err.message);
});
export const query = async (text, params) => {
    return pool.query(text, params);
};
export const getClient = async () => {
    return pool.connect();
};
export default pool;
