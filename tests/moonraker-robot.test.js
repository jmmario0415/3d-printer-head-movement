'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MoonrakerRobot } = require('../robot-api.js');

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('MoonrakerRobot checks printer info and reports ready state', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response({ result: { state: 'ready', state_message: 'Printer is ready' } });
  };
  const robot = new MoonrakerRobot({ baseUrl: 'http://pi.local', fetchImpl });

  await robot.connect();

  assert.equal(robot.getStatus(), 'ready');
  assert.equal(calls[0].url, 'http://pi.local/printer/info');
  assert.equal(calls[0].options.method, 'GET');
});

test('MoonrakerRobot emits relative G-code only for X and Z with mm/s converted to mm/min', async () => {
  const scripts = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/printer/info')) return response({ result: { state: 'ready' } });
    scripts.push(JSON.parse(options.body).script);
    return response({ result: 'ok' });
  };
  const robot = new MoonrakerRobot({ baseUrl: '', fetchImpl });
  await robot.connect();

  await robot.jog('X', 1, 5);
  await robot.jog('Z', -0.5, 2);

  assert.equal(scripts[0], 'SAVE_GCODE_STATE NAME=head_jog\nG91\nG1 X1 F300\nRESTORE_GCODE_STATE NAME=head_jog');
  assert.equal(scripts[1], 'SAVE_GCODE_STATE NAME=head_jog\nG91\nG1 Z-0.5 F120\nRESTORE_GCODE_STATE NAME=head_jog');
});

test('MoonrakerRobot never guesses rotary-axis G-code mappings', async () => {
  let gcodeRequests = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/printer/gcode/script')) gcodeRequests += 1;
    return response({ result: { state: 'ready' } });
  };
  const robot = new MoonrakerRobot({ fetchImpl });
  await robot.connect();

  await assert.rejects(robot.jog('theta1', 1, 10), /Theta1 Moonraker control is not configured yet/);
  await assert.rejects(robot.jog('theta2', -1, 10), /Theta2 Moonraker control is not configured yet/);
  assert.equal(gcodeRequests, 0);
});

test('MoonrakerRobot exposes only measured X and Z positions and marks rotary axes unavailable', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/printer/info')) return response({ result: { state: 'ready' } });
    return response({ result: { status: { toolhead: { position: [12.5, 99, 4.25, 0] } } } });
  };
  const robot = new MoonrakerRobot({ fetchImpl });
  await robot.connect();

  assert.deepEqual(await robot.getPosition(), {
    X: 12.5,
    Z: 4.25,
    theta1: null,
    theta2: null
  });
});

test('MoonrakerRobot sends linear-only homing and the emergency-stop endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/printer/info')) return response({ result: { state: 'ready' } });
    return response({ result: 'ok' });
  };
  const robot = new MoonrakerRobot({ fetchImpl });
  await robot.connect();

  await robot.home();
  await robot.emergencyStop();

  const homeCall = calls.find((call) => call.url.endsWith('/printer/gcode/script'));
  assert.equal(JSON.parse(homeCall.options.body).script, 'G28 X Z');
  assert.equal(calls.at(-1).url, '/printer/emergency_stop');
  assert.equal(calls.at(-1).options.method, 'POST');
  assert.equal(robot.getStatus(), 'emergency-stop');
});
