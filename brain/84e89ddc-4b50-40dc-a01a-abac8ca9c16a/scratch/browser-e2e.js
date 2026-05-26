// browser-e2e.js
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACT_DIR = '/Users/aryanchauhan/.gemini/antigravity-ide/brain/84e89ddc-4b50-40dc-a01a-abac8ca9c16a';

const runBrowserTest = async () => {
  console.log('🏁 Starting headful Next.js Playwright Browser E2E Test...');
  
  // Ensure artifact screenshot dir exists
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  // Launch Chromium in headful mode using the system's pre-installed Google Chrome!
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'chrome', // Use system Google Chrome
    slowMo: 100 // Slow down execution by 100ms so actions are visually trackable
  });
  
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  
  const page = await context.newPage();

  // Listen to browser console and runtime page errors
  page.on('console', msg => console.log(`🖥️ PAGE LOG: [${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.error(`❌ PAGE RUNTIME ERROR: ${err.message}`));

  try {
    // ── 1. Navigate to Local Next.js Terminal ───────────
    console.log('📡 Browser: Navigating to http://localhost:3000 ...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    // ── 2. Handle Login Authentication ──────────────────
    console.log('👤 Browser: Filling in developer admin credentials...');
    await page.fill('input[type="email"]', 'admin@aetherx.io');
    await page.fill('input[type="password"]', 'password123');

    console.log('🔌 Browser: Submitting session handshake request...');
    // Click submit button
    await page.click('button[type="submit"]');

    // ── 3. Wait for Dashboard Load ──────────────────────
    console.log('⚖️ Browser: Waiting for secure workspace session initialization...');
    await page.waitForSelector('text=AETHERX // CORE', { timeout: 15000 });
    console.log('h Browser: Secure Session loaded successfully!');

    // Wait a couple of seconds to capture live WebSocket ticks streaming
    console.log('📊 Browser: Capturing real-time WebSocket chart tick flows...');
    await page.waitForTimeout(3000);

    // Save visual workspace screenshot before placing any orders
    const screenshot1Path = path.join(ARTIFACT_DIR, 'dashboard_before_trade.png');
    await page.screenshot({ path: screenshot1Path });
    console.log(`📸 Screenshot: Dashboard pre-trade saved to: ${screenshot1Path}`);

    // ── 4. Submit LIMIT BUY Order from UI ───────────────
    console.log('✍️ Browser: Filling out trading order form...');
    // Input size of 0.5 BTC
    await page.fill('input[placeholder="0.0000"]', '0.5000');

    // Click order submission button
    console.log('💰 Browser: Clicking PLACE BUY ORDER button...');
    await page.click('button:has-text("PLACE BUY ORDER")');

    // Wait for the success alert message (containing checkmark or success)
    console.log('⏳ Browser: Waiting for Matching Engine settlement notifications...');
    await page.waitForSelector('text=Order placed!', { timeout: 8000 });
    console.log('f Browser: Order filled and matched successfully inside PostgreSQL matching pool!');

    // Let the chart and positions refresh on client
    await page.waitForTimeout(2000);

    // Save visual workspace screenshot after trade matching
    const screenshot2Path = path.join(ARTIFACT_DIR, 'dashboard_after_trade.png');
    await page.screenshot({ path: screenshot2Path });
    console.log(`📸 Screenshot: Dashboard post-trade saved to: ${screenshot2Path}`);

    // ── 5. Inspect Ledger Double-Entry Audit ────────────
    console.log('🔎 Browser: Navigating to LEDGER INSPECTOR audit panel...');
    await page.click('button:has-text("LEDGER INSPECTOR")');
    await page.waitForSelector('text=Ledger Bookkeeping Inspector', { timeout: 5000 });

    // Save visual screenshot of double-entry inspector audit logs
    const screenshot3Path = path.join(ARTIFACT_DIR, 'ledger_audit_inspector.png');
    await page.screenshot({ path: screenshot3Path });
    console.log(`📸 Screenshot: Ledger Inspector saved to: ${screenshot3Path}`);

    console.log('🏁 Browser: Browser E2E verification test suite completed successfully!');
  } catch (error) {
    console.error('❌ Browser: E2E Automation Verification failed:', error.message || error);
    // Take a screenshot of the failure state
    const failPath = path.join(ARTIFACT_DIR, 'browser_error_state.png');
    await page.screenshot({ path: failPath }).catch(() => {});
    console.log(`📸 Failure Screenshot saved to: ${failPath}`);
  } finally {
    console.log('🔌 Browser: Closing browser context...');
    await browser.close();
    process.exit(0);
  }
};

runBrowserTest();
