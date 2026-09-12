'use strict';
const { spawn } = require('node:child_process');
const { mkdtempSync, existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../serve.js');

async function main() {
  const browser = process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].find(existsSync);
  if (!browser) throw new Error('Set CHROME_PATH to your Chrome/Chromium executable.');
  // Never attach this fixture to an unrelated browser already using this port.
  const portCheck = require('node:net').createServer();
  await new Promise((resolve, reject) => { portCheck.once('error', reject); portCheck.listen(9223, '127.0.0.1', resolve); });
  await new Promise((resolve) => portCheck.close(resolve));
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8765, '127.0.0.1', resolve); });
  let chrome;
  try {
    chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=9223', '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), 'printer-e2e-'))}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let launchError;
    chrome.on('error', (error) => { launchError = error; });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (launchError) throw launchError;
      try { const response = await fetch('http://127.0.0.1:9223/json/version'); if (response.ok) { ready = true; break; } } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Headless browser did not start.');
    await new Promise((resolve, reject) => {
      const runner = spawn(process.execPath, [path.join(__dirname, 'browser-e2e.js')], { stdio: 'inherit', windowsHide: true });
      runner.once('error', reject);
      runner.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Browser tests exited ${code}`)));
    });
  } finally {
    chrome?.kill(); server.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
