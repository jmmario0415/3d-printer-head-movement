'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('HTML provides the complete Head Movement shell with local assets only', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const id of [
    'mode-select', 'mode-value', 'status-value', 'status-lamp', 'emergency-button',
    'jog-rows', 'linear-speed', 'rotary-speed', 'linear-step', 'rotary-step',
    'home-button', 'refresh-button', 'reset-emergency-button', 'event-log'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.doesNotMatch(html, /https?:\/\//, 'UI must not depend on external assets');
  assert.ok(html.indexOf('mock-api.js') < html.indexOf('app.js'));
  assert.ok(html.indexOf('robot-api.js') < html.indexOf('app.js'));
});

test('stylesheet includes dense desktop jog grid and emergency-state styling', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(css, /\.jog-row/);
  assert.match(css, /\.jog-buttons/);
  assert.match(css, /grid-template-columns/);
  assert.match(css, /#emergency-button/);
  assert.match(css, /emergency-stop/);
  assert.match(css, /@media/);
});
