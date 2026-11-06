const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
const app = fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8');
const guard = app.slice(app.indexOf('function installN8nChatBusyGuard('), app.indexOf('function placeActorChatControls('));

async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('https://performance-fixture.invalid/', route => route.fulfill({
    contentType: 'text/html', body: '<p id="actorCaptureStatus" aria-live="polite"></p><div id="mount"><textarea data-test-id="chat-input"></textarea></div>',
  }));
  await page.goto('https://performance-fixture.invalid/');
  await page.addScriptTag({ content: `
    const $ = s => document.querySelector(s);
    const ACTOR_CHAT_LATENCY_STORAGE_KEY = 'test-latency';
    const ACTOR_CHAT_LATENCY_SAMPLE_LIMIT = 20;
    const placeActorChatControls = () => {}; // Docking has a separate regression suite.
    window.testNow = 1000;
    Date.now = () => window.testNow;
    window.setInterval = callback => { window.progressTick = callback; return 1; };
    window.clearInterval = () => {};
    ${guard}
    installN8nChatBusyGuard(document.querySelector('#mount'));
  ` });
  return page;
}
async function typing(page, present, advance = 0, error = false) {
  await page.evaluate(({ present, advance, error }) => {
    window.testNow += advance;
    const mount = document.querySelector('#mount');
    if (present) mount.insertAdjacentHTML('beforeend', '<div class="chat-message-typing"></div>');
    else {
      mount.querySelector('.chat-message-typing')?.remove();
      mount.insertAdjacentHTML('beforeend', error ? '<div class="chat-message-error">Request failed</div>' : '<div class="chat-message-from-bot">Synthetic answer</div>');
    }
  }, { present, advance, error });
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
}

test('PERF-09/10 typing state disables input and exposes immediate progress', async t => {
  const page = await fixture(t);
  await typing(page, true);
  assert.equal(await page.locator('textarea').isDisabled(), true);
  assert.equal(await page.locator('#mount').getAttribute('aria-busy'), 'true');
  assert.match(await page.locator('#actorCaptureStatus').innerText(), /Understanding/);
  // This tests typing onset, not submit-to-feedback latency or server deduplication.
});

test('Latency samples remain bounded and content-free', async t => {
  const page = await fixture(t);
  for (let i = 0; i < 22; i++) { await typing(page, true, 100); await typing(page, false, 500); }
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('test-latency')));
  assert.equal(rows.length, 20);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['duration_ms', 'outcome', 'recorded_at']);
});

test('PERF-10 error completion must not announce Answer ready or record completed', async t => {
  const page = await fixture(t);
  await typing(page, true);
  await typing(page, false, 5000, true);
  assert.doesNotMatch(await page.locator('#actorCaptureStatus').innerText(), /Answer ready/);
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('test-latency') || '[]'));
  assert.ok(rows.every(row => row.outcome !== 'completed'));
});

test('PERF-08 reconnect during work must not record a successful answer', async t => {
  const page = await fixture(t);
  await typing(page, true);
  await page.evaluate(() => { window.testNow += 5000; document.querySelector('#mount').innerHTML = ''; });
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('test-latency') || '[]'));
  assert.ok(rows.every(row => row.outcome !== 'completed'));
});

test('PERF-01/10 elapsed time alone must not assert a tool route', async t => {
  const page = await fixture(t);
  await typing(page, true);
  for (const elapsed of [5000, 15000, 30000]) {
    await page.evaluate(ms => { window.testNow = 1000 + ms; window.progressTick(); }, elapsed);
    assert.doesNotMatch(await page.locator('#actorCaptureStatus').innerText(), /Checking reviewed knowledge|Coordinating the right specialist|Completing a deeper workflow/);
  }
});
