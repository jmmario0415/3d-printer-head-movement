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
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
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

  await waitFor(`document.readyState === 'complete' && document.querySelector('#status-value').textContent === 'READY'`);
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

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(__dirname, 'head-movement-e2e.png'), Buffer.from(screenshot.data, 'base64'));

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
    screenshot: path.join(__dirname, 'head-movement-e2e.png')
  }, null, 2));
  cdp.close();
  await fetch(`http://127.0.0.1:9223/json/close/${target.id}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
