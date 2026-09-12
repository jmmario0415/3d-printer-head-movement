'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      } else {
        this.events.push(message);
      }
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const target = await fetch('http://127.0.0.1:9223/json/new?http://127.0.0.1:8765/index.html', { method: 'PUT' }).then((r) => r.json());
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  try {
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8765/index.html' });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async function waitFor(expression, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(expression)) return;
      await sleep(40);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  async function click(selector) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }

  async function clickJog(axis, amount) {
    await click(`.jog-button[data-axis="${axis}"][data-amount="${amount}"]`);
    await waitFor(`document.querySelector('#status-value').textContent !== 'BUSY'`);
  }

  async function positions() {
    return evaluate(`Object.fromEntries(Array.from(document.querySelectorAll('[data-position]'), el => [el.dataset.position, el.textContent]))`);
  }

  await waitFor(`document.readyState === 'complete' && document.querySelector('#status-value')?.textContent === 'READY'`);
  assert.equal(await evaluate(`document.querySelectorAll('.jog-button').length`), 32);
  assert.deepEqual(await positions(), { X: '0.000 mm', Z: '0.000 mm', theta1: '0.000 °', theta2: '0.000 °' });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, 'desktop layout should not overflow horizontally');
  assert.equal(await evaluate(`(() => { const y = Array.from(document.querySelectorAll('.jog-table-head > span'), el => el.getBoundingClientRect().top); return Math.max(...y) - Math.min(...y) < 2; })()`), true, 'jog column headings must stay on one row');

  await clickJog('X', '10');
  assert.equal((await positions()).X, '10.000 mm');
  await clickJog('X', '-1');
  assert.equal((await positions()).X, '9.000 mm');
  await clickJog('Z', '5');
  assert.equal((await positions()).Z, '5.000 mm');
  await clickJog('theta1', '10');
  assert.equal((await positions()).theta1, '10.000 °');
  await clickJog('theta2', '-5');
  assert.equal((await positions()).theta2, '-5.000 °');

  await clickJog('X', '-50');
  assert.equal((await positions()).X, '9.000 mm');
  assert.equal(await evaluate(`document.querySelector('#event-log').textContent.includes('X limit exceeded')`), true);

  await click('#emergency-button');
  await waitFor(`document.querySelector('#status-value').textContent === 'EMERGENCY STOP'`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.jog-button')).every(button => button.disabled)`), true);
  assert.equal(await evaluate(`document.querySelector('#home-button').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('#emergency-button').disabled`), false);

  await click('#reset-emergency-button');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  await waitFor(`document.querySelector('#status-value').textContent !== 'BUSY'`);
  assert.equal((await positions()).X, '10.000 mm');

  await click('#home-button');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  assert.deepEqual(await positions(), { X: '0.000 mm', Z: '0.000 mm', theta1: '0.000 °', theta2: '0.000 °' });

  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true }))`);
  await sleep(100);
  assert.equal((await positions()).X, '0.000 mm', 'repeated keydown must be ignored');

  await click(`.jog-button[data-axis="X"][data-amount="50"]`);
  await waitFor(`document.querySelector('#status-value').textContent === 'BUSY'`);
  assert.equal(await evaluate(`document.querySelector('#emergency-button').disabled`), false, 'E-stop must remain enabled while busy');
  await click('#emergency-button');
  await waitFor(`document.querySelector('#status-value').textContent === 'EMERGENCY STOP'`);
  await sleep(750);
  assert.equal((await positions()).X, '0.000 mm', 'E-stop during a pending jog must prevent position update');
  await click('#reset-emergency-button');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);

  await evaluate(`document.querySelector('[data-heater="tool0"] .active-preset').value = '80'`);
  await click('[data-heater="tool0"] .apply-active');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  await waitFor(`document.querySelector('[data-heater="tool0"] .reading').textContent.includes('/ 80.0')`);
  await sleep(1100);
  assert.equal(await evaluate(`parseFloat(document.querySelector('[data-heater="tool0"] .reading').textContent) > 22`), true);
  await evaluate(`document.querySelector('[data-heater="tool0"] .standby-preset').value = '40'`);
  await click('[data-heater="tool0"] .apply-standby');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  await waitFor(`document.querySelector('[data-heater="tool0"] .reading').textContent.includes('/ 40.0')`);
  await evaluate(`document.querySelector('[data-heater="tool0"] .active-preset').value = '-1'`);
  await click('[data-heater="tool0"] .apply-active');
  await waitFor(`document.querySelector('#status-value').textContent === 'ERROR'`);
  assert.equal(await evaluate(`document.querySelector('[data-heater="tool0"] .reading').textContent.includes('/ 40.0')`), true);
  await click('[data-heater="tool0"] .heater-off');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  await evaluate(`document.querySelector('[data-fan="fan1"] input').value = '37'`);
  await click('[data-fan="fan1"] .fan-apply');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  await waitFor(`document.querySelector('[data-fan="fan1"] output').textContent === '37%'`);
  await click('[data-fan="fan1"] .fan-off');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  for (const id of ['homing', 'fans', 'heaters', 'motors']) {
    await click(`[data-macro="${id}"]`);
    await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
    await waitFor(`document.querySelector('#macro-result').textContent.includes('complete')`);
  }
  await click('[data-macro="heaters"]');
  await waitFor(`document.querySelector('#status-value').textContent === 'BUSY'`);
  assert.equal(await evaluate(`document.querySelector('[data-fan="fan1"] .fan-apply').disabled`), true);
  await click('#emergency-button');
  await waitFor(`document.querySelector('#status-value').textContent === 'EMERGENCY STOP'`);
  await waitFor(`!document.querySelector('#reset-emergency-button').disabled`);
  await waitFor(`document.querySelector('[data-heater="tool0"] .reading').textContent.includes('/ 0.0')`);
  assert.equal(await evaluate(`document.querySelector('#macro-result').textContent.includes('interrupted')`), true);
  await click('#reset-emergency-button');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);

  // HTTP fixture inside this isolated page: no real printer requests are sent.
  await evaluate(`(() => {
    window.__calls = []; window.__fail = false; window.__printerState = 'ready';
    window.fetch = async (url, options) => {
      window.__calls.push({ url, method: options.method, body: options.body });
      if (window.__fail) throw new Error('Simulated link loss');
      let result = 'ok';
      if (url.endsWith('/info')) result = { state: window.__printerState };
      if (url.endsWith('/list')) result = { objects: ['extruder', 'fan_generic cooling', 'gcode_macro TEST_FANS'] };
      if (url.endsWith('/query')) result = { status: { webhooks: { state: 'ready' }, toolhead: { position: [2, 0, 3, 0] }, extruder: { temperature: 28, target: 0 }, 'fan_generic cooling': { speed: 0.25 } } };
      return { ok: true, json: async () => ({ result }) };
    };
    document.querySelector('#moonraker-url').value = 'http://fixture.invalid';
    document.querySelector('#mode-select').value = 'moonraker';
    document.querySelector('#mode-select').dispatchEvent(new Event('change'));
  })()`);
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  assert.equal(await evaluate(`document.querySelector('[data-heater="tool0"] .reading').textContent`), 'N/A');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[data-device-control]')).every(el => el.disabled)`), true);
  assert.equal(await evaluate(`document.querySelector('#home-button').disabled`), true);
  assert.equal((await positions()).theta1, 'N/A');

  await evaluate(`MOONRAKER_CONFIG.heaters.tool0 = { object: 'extruder', minTarget: 0, maxTarget: 200 }; MOONRAKER_CONFIG.fans.fan1 = { object: 'fan_generic cooling' }; MOONRAKER_CONFIG.macros.fans = 'TEST_FANS'`);
  await click('#connect-button');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  assert.equal(await evaluate(`document.querySelector('[data-heater="tool0"] .active-preset').value`), '0', 'Mock presets must not transfer to real mode');
  await evaluate(`document.querySelector('[data-heater="tool0"] .active-preset').value = '50'`);
  await click('[data-heater="tool0"] .apply-active');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  assert.equal(await evaluate(`window.__calls.some(c => c.body && c.body.includes('SET_HEATER_TEMPERATURE HEATER=extruder TARGET=50'))`), true);
  await click('[data-macro="fans"]');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  await waitFor(`document.querySelector('#macro-result').textContent.includes('inspect hardware')`);
  await evaluate(`window.__fail = true`);
  await waitFor(`document.querySelector('#status-value').textContent === 'DISCONNECTED'`);
  assert.equal(await evaluate(`document.querySelector('[data-heater="tool0"] .reading').textContent`), 'N/A');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[data-device-control], [data-motion-control]')).every(el => el.disabled)`), true);
  assert.equal(await evaluate(`document.querySelector('#event-log').textContent.includes('Simulated link loss')`), true);
  await evaluate(`window.__fail = false; window.__printerState = 'startup'`);
  await click('#connect-button');
  await waitFor(`!document.querySelector('#connect-button').disabled`);
  assert.equal(await evaluate(`document.querySelector('#status-value').textContent`), 'DISCONNECTED');
  await evaluate(`document.querySelector('#mode-select').value = 'mock'; document.querySelector('#mode-select').dispatchEvent(new Event('change'))`);
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  await click('[data-macro="heaters"]');
  await waitFor(`document.querySelector('#status-value').textContent === 'READY'`);
  await sleep(1100);

  await evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
  assert.equal(await evaluate(`(() => { const r = document.querySelector('#emergency-button').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`), true, 'Emergency stop stays visible while scrolling');
  await evaluate(`window.scrollTo(0, 0); document.querySelector('#moonraker-url').value = ''`);
  fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(__dirname, 'artifacts', 'commissioning-e2e.png'), Buffer.from(screenshot.data, 'base64'));

  const fatalEvents = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' || (event.method === 'Log.entryAdded' && event.params.entry.level === 'error'));
  assert.deepEqual(fatalEvents, [], 'browser console/runtime must contain no fatal JavaScript errors');

  console.log(JSON.stringify({
    result: 'PASS',
    jogButtons: 32,
    finalPositions: await positions(),
    limitProtection: true,
    emergencyStop: true,
    keyboardJog: true,
    consoleErrors: fatalEvents.length,
    commissioning: true,
    moonrakerFixture: true,
    screenshot: path.join(__dirname, 'artifacts', 'commissioning-e2e.png')
  }, null, 2));
  } finally {
  cdp.close();
  await fetch(`http://127.0.0.1:9223/json/close/${target.id}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
