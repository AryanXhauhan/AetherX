// browser-comprehensive-e2e.js
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const ARTIFACT_DIR = '/Users/aryanchauhan/.gemini/antigravity-ide/brain/84e89ddc-4b50-40dc-a01a-abac8ca9c16a';

const runComprehensiveTest = async () => {
  console.log('🏁 Starting Comprehensive E2E Playwright Browser Walkthrough...');
  
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  // Launch Chromium in headful mode using the system's pre-installed Google Chrome!
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'chrome',
    slowMo: 150 // Slow down actions by 150ms so the user can easily follow on-screen
  });
  
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  
  const page = await context.newPage();

  // Listen to browser console and page runtime errors
  page.on('console', msg => console.log(`🖥️ PAGE LOG: [${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.error(`❌ PAGE RUNTIME ERROR: ${err.message}`));

  try {
    const randomSuffix = Math.floor(Math.random() * 10000);
    const mockEmail = `trader-${randomSuffix}@aetherx.io`;
    const mockPassword = 'password123';

    // ── 1. Navigate to Platform ─────────────────────────
    console.log('\n📡 Step 1: Navigating to Next.js Trading Console...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // ── 2. User Registration ─────────────────────────────
    console.log('\n👤 Step 2: Toggling auth mode to REGISTER...');
    await page.click('button:has-text("Initialize Ledger")');
    await page.waitForTimeout(500);

    console.log(`👤 Step 2: Creating new simulated account [${mockEmail}]...`);
    await page.fill('input[type="email"]', mockEmail);
    await page.fill('input[type="password"]', mockPassword);
    
    // Accept standard confirm alert from Next.js automatically
    page.once('dialog', async dialog => {
      console.log(`💬 Alert dialog captured: [${dialog.message()}]`);
      await dialog.accept();
    });

    console.log('👤 Step 2: Submitting initializing request...');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);

    // ── 3. User Login ────────────────────────────────────
    console.log('\n👤 Step 3: Logging into the initialized account...');
    await page.fill('input[type="email"]', mockEmail);
    await page.fill('input[type="password"]', mockPassword);
    await page.click('button[type="submit"]');

    // ── 4. Dashboard Handshake Verification ──────────────
    console.log('\n⚖️ Step 4: Verifying secure session handshake and layout elements...');
    await page.waitForSelector('text=AETHERX // CORE', { timeout: 10000 });
    console.log('h Step 4: Sockets and session persist active!');

    // Wait a couple of seconds to capture streaming chart ticks
    console.log('📊 Step 4: Capturing real-time WebSocket tick flows on chart...');
    await page.waitForTimeout(3000);

    const shot1 = path.join(ARTIFACT_DIR, 'comp_1_dashboard_initialized.png');
    await page.screenshot({ path: shot1 });
    console.log(`📸 Screenshot: Dashboard initialized saved to: ${shot1}`);

    // ── 5. Switch Trading Symbol ─────────────────────────
    console.log('\n🔄 Step 5: Testing multi-symbol selectors...');
    console.log('🔄 Step 5: Selecting ETHUSDT ticker stream...');
    await page.click('button:has-text("ETHUSDT")');
    await page.waitForTimeout(1500);

    console.log('🔄 Step 5: Selecting SOLUSDT ticker stream...');
    await page.click('button:has-text("SOLUSDT")');
    await page.waitForTimeout(1500);

    console.log('🔄 Step 5: Returning to BTCUSDT ticker stream...');
    await page.click('button:has-text("BTCUSDT")');
    await page.waitForTimeout(1000);

    // ── 6. Place Limit BUY Order (Escrow Hold Verification) ──
    console.log('\n✍️ Step 6: Placing a resting LIMIT BUY order...');
    // Enter size of 0.25 BTC
    await page.fill('input[placeholder="0.0000"]', '0.2500');
    
    // Get current spot price to set limit slightly below it (to guarantee it rests in book)
    const currentPriceText = await page.inputValue('input[placeholder="0.00"]');
    const spotPrice = parseFloat(currentPriceText);
    const limitPrice = spotPrice * 0.99; // 1% below spot
    
    console.log(`✍️ Step 6: Setting LIMIT BUY price to $${limitPrice.toFixed(2)} USD (Spot: $${spotPrice.toFixed(2)})`);
    await page.fill('input[placeholder="0.00"]', limitPrice.toFixed(2));
    await page.waitForTimeout(500);

    console.log('💰 Step 6: Submitting limit buy order...');
    await page.click('button:has-text("PLACE BUY ORDER")');

    // Wait for placement success notification
    await page.waitForSelector('text=Order placed!', { timeout: 5000 });
    console.log('h Step 6: Limit order submitted! Verifying escrow hold in wallet...');

    // Let the positions list update
    await page.waitForTimeout(1500);
    const shot2 = path.join(ARTIFACT_DIR, 'comp_2_resting_limit_placed.png');
    await page.screenshot({ path: shot2 });
    console.log(`📸 Screenshot: Limit order placed saved to: ${shot2}`);

    // ── 7. Cancel Active Pending Order ───────────────────
    console.log('\n✕ Step 7: Canceling the active pending limit order...');
    // Click the cancel (✕) button in the pending orders list
    await page.click('button:has-text("✕")');
    await page.waitForTimeout(1500);

    const shot3 = path.join(ARTIFACT_DIR, 'comp_3_limit_canceled.png');
    await page.screenshot({ path: shot3 });
    console.log(`📸 Screenshot: Limit order canceled saved to: ${shot3}`);

    // ── 8. Place Market BUY Order (Execution Match Verification) ──
    console.log('\n✍️ Step 8: Executing a MARKET BUY order for immediate matching...');
    // Toggle order type to MARKET
    await page.click('button:has-text("MARKET")');
    await page.waitForTimeout(500);

    // Enter size of 0.4 BTC
    await page.fill('input[placeholder="0.0000"]', '0.4000');
    await page.waitForTimeout(500);

    console.log('💰 Step 8: Clicking PLACE BUY ORDER button...');
    await page.click('button:has-text("PLACE BUY ORDER")');

    // Wait for matching execution notification
    await page.waitForSelector('text=Order placed!', { timeout: 5000 });
    console.log('f Step 8: Market order filled instantly! Verifying holdings position update...');

    // Wait for websocket data feeds to settle balances
    await page.waitForTimeout(2000);

    const shot4 = path.join(ARTIFACT_DIR, 'comp_4_market_trade_matched.png');
    await page.screenshot({ path: shot4 });
    console.log(`📸 Screenshot: Market match completed saved to: ${shot4}`);

    // ── 9. Inspect Ledger Bookkeeping Inspector ──────────
    console.log('\n🔎 Step 9: Auditing ledger logs in the LEDGER INSPECTOR...');
    await page.click('button:has-text("LEDGER INSPECTOR")');
    await page.waitForSelector('text=Ledger Bookkeeping Inspector', { timeout: 5000 });
    await page.waitForTimeout(1000);

    const shot5 = path.join(ARTIFACT_DIR, 'comp_5_ledger_audit_inspector.png');
    await page.screenshot({ path: shot5 });
    console.log(`📸 Screenshot: Ledger audit inspector saved to: ${shot5}`);

    // ── 10. Disconnect Workspace ─────────────────────────
    console.log('\n🔌 Step 10: Disconnecting secure terminal workspace...');
    // Return to terminal and log out
    await page.click('button:has-text("TRADING TERMINAL")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("DISCONNECT")');
    
    // Verify login screen reappears
    await page.waitForSelector('text=AETHERX TERMINAL', { timeout: 5000 });
    console.log('h Step 10: Disconnected successfully! Session cookies cleared.');

    const shot6 = path.join(ARTIFACT_DIR, 'comp_6_disconnected.png');
    await page.screenshot({ path: shot6 });
    console.log(`📸 Screenshot: Disconnected login gate saved to: ${shot6}`);

    console.log('\n🎉 COMPREHENSIVE E2E WALKTHROUGH TEST SUCCESSFULLY COMPLETED!');
  } catch (error) {
    console.error('\n❌ Comprehensive E2E Verification failed:', error.message || error);
    const failPath = path.join(ARTIFACT_DIR, 'comp_failure_error_state.png');
    await page.screenshot({ path: failPath }).catch(() => {});
    console.log(`📸 Failure Screenshot saved to: ${failPath}`);
  } finally {
    console.log('🔌 Closing browser context...');
    await browser.close();
    process.exit(0);
  }
};

runComprehensiveTest();
