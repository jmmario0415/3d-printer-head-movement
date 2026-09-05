'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONFIG,
  JOG_LAYOUT,
  getKeyboardJog,
  formatPosition,
  formatSignedAmount
} = require('../app.js');

test('application defaults to mock mode and provides all required jog increments', () => {
  assert.equal(CONFIG.mode, 'mock');
  assert.deepEqual(JOG_LAYOUT.X, [-50, -10, -1, -0.1, 0.1, 1, 10, 50]);
  assert.deepEqual(JOG_LAYOUT.Z, [-25, -5, -0.5, -0.05, 0.05, 0.5, 5, 25]);
  assert.deepEqual(JOG_LAYOUT.theta1, [-30, -10, -5, -1, 1, 5, 10, 30]);
  assert.deepEqual(JOG_LAYOUT.theta2, [-30, -10, -5, -1, 1, 5, 10, 30]);
});

test('keyboard mapping returns one logical jog using configured linear and rotary steps', () => {
  assert.deepEqual(getKeyboardJog('ArrowLeft', 2, 3), { axis: 'X', amount: -2 });
  assert.deepEqual(getKeyboardJog('ArrowRight', 2, 3), { axis: 'X', amount: 2 });
  assert.deepEqual(getKeyboardJog('ArrowUp', 2, 3), { axis: 'Z', amount: 2 });
  assert.deepEqual(getKeyboardJog('ArrowDown', 2, 3), { axis: 'Z', amount: -2 });
  assert.deepEqual(getKeyboardJog('q', 2, 3), { axis: 'theta1', amount: -3 });
  assert.deepEqual(getKeyboardJog('E', 2, 3), { axis: 'theta1', amount: 3 });
  assert.deepEqual(getKeyboardJog('a', 2, 3), { axis: 'theta2', amount: -3 });
  assert.deepEqual(getKeyboardJog('D', 2, 3), { axis: 'theta2', amount: 3 });
  assert.equal(getKeyboardJog('Escape', 2, 3), null);
});

test('position and jog labels preserve axis units and unavailable values', () => {
  assert.equal(formatPosition('X', 9), '9.000 mm');
  assert.equal(formatPosition('theta1', -5), '-5.000 °');
  assert.equal(formatPosition('theta2', null), 'N/A');
  assert.equal(formatSignedAmount('X', 0.1), 'X+0.1');
  assert.equal(formatSignedAmount('theta1', -10), 'θ1 -10°');
});
