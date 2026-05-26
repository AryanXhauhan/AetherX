import { query } from './src/config/db.js';
async function run() {
  try {
    await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS stop_price DECIMAL(20, 8);`);
    console.log("Added stop_price column");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
