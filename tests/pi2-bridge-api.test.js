'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pi2BridgeRobot } = require('../pi2-bridge-api.js');

function fixture(overrides = {}) {
  let referenced = false;
  let pose = { x_mm: 0, z_mm: 0, theta1_deg: 0, theta2_deg: 0 };
  const calls = [];
  const status = () => ({ klippy_state: 'ready', calibration_verified: true, extrusion_enabled: false,
    reference_required: !referenced, motion_enabled: referenced,
    checkpoint: { status: 'idle', current_pose: pose, last_confirmed_index: 0 } });
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    if (path === '/api/v1/status') return { ok: true, json: async () => status() };
    if (path === '/api/v1/reference-home') { referenced = true; pose = { x_mm: 0, z_mm: 0, theta1_deg: 0, theta2_deg: 0 }; return { ok: true, json: async () => ({ checkpoint: status().checkpoint }) }; }
    if (path === '/api/v1/move') { pose = JSON.parse(options.body).target; return { ok: true, json: async () => ({ checkpoint: status().checkpoint, duration_s: 1, commands: ['upper', 'lower'] }) }; }
    if (path === '/api/v1/emergency-stop') return { ok: true, json: async () => ({ checkpoint: { ...status().checkpoint, status: 'uncertain' } }) };
    return { ok: false, json: async () => ({ error: 'missing' }) };
  };
  return { robot: new Pi2BridgeRobot({ baseUrl: 'http://pi.local:8766', fetchImpl, ...overrides }), calls };
}

test('Pi2 bridge requires calibrated reference before logical motion and sends no raw G-code', async () => {
  const { robot, calls } = fixture();
  await robot.connect();
  assert.equal(robot.isMotionEnabled(), false);
  await assert.rejects(robot.jog('X', 1, 5), /REFERENCE HOME/);
  await robot.home();
  assert.equal(robot.isMotionEnabled(), true);
  await robot.jog('theta2', 5, 10);
  const move = calls.find((call) => call.url.endsWith('/api/v1/move'));
  assert.deepEqual(JSON.parse(move.options.body), {
    target: { x_mm: 0, z_mm: 0, theta1_deg: 0, theta2_deg: 5 }, path_speed_mm_s: 10, extrude: false
  });
  assert.equal(calls.some((call) => String(call.options.body).includes('MANUAL_STEPPER')), false);
});

test('Pi2 bridge authenticates browser API requests with the optional token', async () => {
  const { robot, calls } = fixture({ token: 'demo-token' });
  await robot.connect();
  assert.equal(calls[0].options.headers.Authorization, 'Bearer demo-token');
});
