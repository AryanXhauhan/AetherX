// backend/scripts/init-db.js
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const initDb = async () => {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    database: 'aetherx'
  });

  try {
    console.log('🔌 Database Setup: Connecting to PostgreSQL...');
    await client.connect();

    console.log('📖 Database Setup: Reading schema.sql...');
    const schemaPath = path.join(__dirname, '..', 'src', 'models', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('⚙️ Database Setup: Running schema migrations...');
    await client.query(schemaSql);
    console.log('✅ Database Setup: Schema applied successfully');

    console.log('📖 Database Setup: Reading seed.sql...');
    const seedPath = path.join(__dirname, '..', 'src', 'models', 'seed.sql');
    const seedSql = fs.readFileSync(seedPath, 'utf8');

    console.log('⚙️ Database Setup: Running seeds...');
    await client.query(seedSql);
    console.log('✅ Database Setup: Seeding completed successfully');

  } catch (error) {
    console.error('❌ Database Setup failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database Setup: PostgreSQL client disconnected');
  }
};

initDb();
