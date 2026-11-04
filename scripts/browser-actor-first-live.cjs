const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Opt-in authenticated UI smoke. No fixtures, message sends, uploads or saved auth state.
async function run() {
  const base = new URL(process.env.MEIDS_LIVE_URL || '');
  assert.equal(base.protocol, 'https:', 'An explicit HTTPS target is required');
  assert.ok(!base.username && !base.password, 'Credentials must not be in the URL');
  const storageState = process.env.MEIDS_LIVE_STORAGE_STATE;
  assert.ok(storageState && fs.existsSync(storageState), 'Existing private authenticated storage state is required');
  const root = path.resolve(__dirname, '..');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const expected = Object.fromEntries(['app.js', 'styles.css'].map(name => [name,
    hash(execFileSync('git', ['show', `HEAD:frontend/${name}`], { cwd: root }))]));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const report = { sourceRevision: sha, cases: [], scope: 'UI reconnect smoke; no message submission or timed auth-expiry simulation' };
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ storageState, viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      let sentMessages = 0;
      let pageErrors = 0;
      const realAssets = new Map();
      const assetReads = [];
      page.on('pageerror', () => { pageErrors++; });
      page.on('request', request => {
        try { if (request.postDataJSON()?.action === 'sendMessage') sentMessages++; } catch {}
      });
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.hostname === 'cdn.jsdelivr.net' && /\/@n8n\/chat(?:@[^/]+)?\/dist\/(chat\.bundle\.es\.js|style\.css)$/.test(url.pathname)) {
          assetReads.push(response.body().then(body => {
            assert.ok(response.ok(), 'Real n8n asset failed');
            realAssets.set(path.basename(url.pathname), hash(body));
          }));
        }
      });
      const go = async view => {
        await page.locator(`.nav-item[data-view="${view}"]`).click();
        await page.waitForSelector(`#${view}.view.active`);
      };
      const composer = async () => {
        await page.waitForFunction(() => document.querySelector('#n8nChatStatus')?.textContent === 'n8n agent connected.');
        await page.locator('#n8nChatMount textarea[data-test-id="chat-input"]').waitFor({ state: 'visible' });
        for (const selector of ['#actorChatControls', '#actorVoiceBtn', '#actorSourceBtn', 'textarea[data-test-id="chat-input"]', 'button[data-test-id="chat-input-send-button"]']) {
          assert.equal(await page.locator(`#n8nChatMount ${selector}`).count(), 1, `Expected one ${selector}`);
        }
        assert.equal(await page.locator('#n8nChatMount .chat-header:visible, #n8nChatMount .chat-heading:visible').count(), 0, 'Duplicate branding visible');
      };
      await page.goto(base.href, { waitUntil: 'domcontentloaded' });
      if (await page.locator('#enterWorkspaceBtn').isVisible()) await page.locator('#enterWorkspaceBtn').click();
      await go('chat');
      await composer();
      for (const name of Object.keys(expected)) {
        const response = await context.request.get(new URL(name, base).href);
        assert.ok(response.ok(), 'Frontend asset fetch failed');
        assert.equal(hash(await response.body()), expected[name], `Deployed ${name} differs from checked-out revision`);
      }
      await Promise.all(assetReads);
      assert.equal(realAssets.size, 2, 'Real n8n JS and CSS were not both loaded');
      // Use the application reconnect handler; never synthesize or replace its composer.
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.evaluate(() => reloadN8nChatContext());
        await composer();
      }
      assert.equal(sentMessages, 0, 'Reconnect unexpectedly sent/replayed a message');
      await go('concepts');
      const row = page.locator('.knowledge-increment').first();
      await row.waitFor({ state: 'visible' });
      await row.focus();
      assert.ok(await row.evaluate(node => {
        const detail = document.getElementById(node.getAttribute('aria-describedby'));
        return detail && detail.getAttribute('aria-hidden') !== 'true' && detail.textContent.trim() &&
          getComputedStyle(detail).visibility === 'visible' &&
          getComputedStyle(node.querySelector('.knowledge-increment-main > p')).display === 'none';
      }), 'Compact Knowledge focus detail missing');
      await go('dashboard');
      assert.equal(await page.locator('#dashboard .dashboard-filter:visible').count(), 0, 'Legacy filters visible');
      for (const queue of await page.locator('#dashboardQueueSelect option').evaluateAll(nodes => nodes.map(n => n.value))) {
        await page.locator('#dashboardQueueSelect').selectOption(queue);
        const lanes = await page.locator('#dashboardLaneSelect option').evaluateAll(nodes => nodes.map(n => n.value));
        assert.ok(lanes.length, 'Queue has no lane');
        for (const lane of lanes) {
          if (lanes.length > 1) await page.locator('#dashboardLaneSelect').selectOption(lane);
          assert.equal(await page.locator('#dashboard .dashboard-section:visible').count(), 1, 'Expected one Review lane');
        }
      }
      await go('graph');
      await page.locator('#graphCanvas .graph-topology-svg').waitFor({ state: 'visible' });
      const canvas = await page.locator('#graph .graph-canvas-wrap').boundingBox();
      const svg = await page.locator('#graph .graph-topology-svg').boundingBox();
      assert.ok(canvas && svg && canvas.height >= 500 && svg.height >= canvas.height * 0.72, 'Graph canvas fill below acceptance threshold');
      assert.equal(pageErrors, 0, 'New uncaught browser errors');
      report.cases.push({ width, status: 'passed', reconnects: 2, n8nAssetHashes: Object.fromEntries(realAssets), graphHeight: canvas.height });
      await context.close();
    }
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
}

run().catch(() => {
  // Browser errors can contain authenticated URLs or page content. Do not log them.
  console.error('Live actor-first smoke failed. Inspect locally with the authorized session; no live pass recorded.');
  process.exitCode = 1;
});
