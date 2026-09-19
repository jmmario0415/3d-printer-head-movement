'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MockRobot } = require('../mock-api.js');
const { MoonrakerRobot } = require('../robot-api.js');
const { CONFIG } = require('../app.js');
const { MOONRAKER_CONFIG } = require('../commissioning-config.js');

test('Mock temperature evolves with time, snapshots are independent, off cools without teleporting', async () => {
  let time = 0;
  const robot = new MockRobot({ now: () => time }); await robot.connect();
  await robot.setHeater('tool0', 100);
  assert.equal((await robot.getTelemetry()).heaters.tool0.current, 22);
  time = 1000;
  const first = await robot.getTelemetry();
  assert.equal(first.heaters.tool0.current, 34);
  first.heaters.tool0.target = 999;
  assert.equal((await robot.getTelemetry()).heaters.tool0.target, 100);
  await robot.setHeater('tool0', 0); time = 2000;
  assert.equal((await robot.getTelemetry()).heaters.tool0.current, 30);
});

test('Mock validates devices, targets and percentages without changing outputs', async () => {
  const robot = new MockRobot(); await robot.connect();
  for (const value of [-1, NaN, Infinity, 281]) await assert.rejects(robot.setHeater('tool0', value));
  for (const value of [-1, NaN, Infinity, 101]) await assert.rejects(robot.setFan('fan1', value));
  await assert.rejects(robot.setHeater('missing', 10));
  await assert.rejects(robot.setFan('missing', 10));
  assert.equal((await robot.getTelemetry()).heaters.tool0.target, 0);
  await robot.setFan('fan1', 37);
  assert.equal((await robot.getTelemetry()).fans.fan1.speed, 37);
});

test('all four Mock macros execute, motors return to their start, heating and fans end off', async () => {
  const robot = new MockRobot({ simulateDelay: false, limits: CONFIG.limits }); await robot.connect();
  await robot.jog('X', 300, 5);
  const before = await robot.getPosition();
  await robot.runMacro('motors');
  assert.deepEqual(await robot.getPosition(), before);
  for (const id of ['fans', 'heaters', 'homing']) {
    assert.match(await robot.runMacro(id), /hardware not verified/);
    assert.equal((await robot.getTelemetry()).macro.state, 'complete');
  }
  assert.deepEqual(await robot.getPosition(), { X: 0, Z: 0, theta1: 0, theta2: 0 });
  const data = await robot.getTelemetry();
  assert.equal(data.heaters.tool0.target, 0); assert.equal(data.fans.fan2.speed, 0);
});

test('E-stop interrupts Mock macro, zeros outputs and cannot reset while it is unwinding', async () => {
  const robot = new MockRobot(); await robot.connect();
  await robot.setHeater('bed', 60);
  const execution = robot.runMacro('fans');
  const rejected = assert.rejects(execution, /Emergency stop/);
  await robot.emergencyStop();
  await assert.rejects(robot.resetEmergencyStop(), /Wait/);
  await rejected;
  const data = await robot.getTelemetry();
  assert.equal(data.macro.state, 'interrupted');
  assert.equal(data.heaters.bed.target, 0); assert.equal(data.fans.fan1.speed, 0);
  await robot.resetEmergencyStop();
  assert.equal((await robot.getTelemetry()).heaters.bed.target, 0);
});

test('E-stop generation prevents pending Mock jog from resuming after reset', async () => {
  const robot = new MockRobot({ maxDelayMs: 10 }); await robot.connect();
  const execution = robot.jog('X', 1, 5);
  const rejected = assert.rejects(execution, /interrupted/);
  await robot.emergencyStop(); await robot.resetEmergencyStop(); await rejected;
  assert.equal((await robot.getPosition()).X, 0);
});

const config = {
  heaters: { tool0: { object: 'extruder', minTarget: 10, maxTarget: 200 }, bed: { object: 'heater_bed', minTarget: 10, maxTarget: 80 } },
  fans: { fan1: { object: 'fan_generic cooling' }, fan2: { object: 'fan' } },
  macros: { fans: 'TEST_FANS' }
};
function realFixture(overrides = {}) {
  const calls = [];
  const objects = ['extruder', 'heater_bed', 'fan_generic cooling', 'fan', 'gcode_macro TEST_FANS'];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    let result = 'ok';
    if (url.endsWith('/info')) result = { state: 'ready' };
    if (url.endsWith('/list')) result = { objects };
    if (url.endsWith('/query')) result = { status: { webhooks: { state: 'ready' }, extruder: { temperature: 31, target: 40 }, heater_bed: { temperature: 25, target: 0 }, fan: { speed: .2 }, 'fan_generic cooling': { speed: .5 } } };
    return { ok: true, json: async () => ({ result }) };
  };
  const robot = new MoonrakerRobot({ config, fetchImpl, ...overrides });
  return { robot, calls };
}

test('Moonraker default mappings are empty and never substitute Mock devices', async () => {
  const { robot, calls } = realFixture({ config: MOONRAKER_CONFIG }); await robot.connect();
  const telemetry = await robot.getTelemetry();
  assert.equal(telemetry.heaters.tool0.current, null);
  assert.equal(telemetry.fans.fan1.available, false);
  assert.equal(telemetry.macros.fans, false);
  await assert.rejects(robot.setHeater('tool0', 100), /not configured/);
  await assert.rejects(robot.setFan('fan1', 50), /not configured/);
  await assert.rejects(robot.runMacro('fans'), /not configured/);
  assert.equal(calls.filter((call) => call.url.endsWith('/script')).length, 0);
});

test('Moonraker queries mapped measurements and formats configured heater/fan/macro commands', async () => {
  const { robot, calls } = realFixture(); await robot.connect();
  const data = await robot.getTelemetry();
  assert.equal(data.heaters.tool0.current, 31); assert.equal(data.fans.fan1.speed, 50);
  assert.equal(data.macros.fans, true);
  await robot.setHeater('tool0', 150); await robot.setHeater('bed', 0);
  await robot.setFan('fan1', 37); await robot.setFan('fan2', 100);
  assert.match(await robot.runMacro('fans'), /inspect hardware/);
  assert.deepEqual(calls.filter((c) => c.url.endsWith('/script')).map((c) => JSON.parse(c.options.body).script), [
    'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=150', 'SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=0',
    'SET_FAN_SPEED FAN=cooling SPEED=0.37', 'M106 S255', 'TEST_FANS'
  ]);
});

test('Moonraker rejects invalid values and command injection before transmitting', async () => {
  const { robot, calls } = realFixture(); await robot.connect();
  for (const target of [-1, 5, 201, NaN, Infinity]) await assert.rejects(robot.setHeater('tool0', target));
  await assert.rejects(robot.setFan('fan1', 101));
  await assert.rejects(robot.jogLinear('X1\nG28', 1, 5));
  const bad = realFixture({ config: { heaters: { tool0: { object: 'extruder\nG28', minTarget: 0, maxTarget: 200 } }, macros: { fans: 'TEST_FANS\nG28' } } });
  await bad.robot.connect();
  await assert.rejects(bad.robot.setHeater('tool0', 30), /not configured/);
  await assert.rejects(bad.robot.runMacro('fans'), /not configured/);
  assert.equal([...calls, ...bad.calls].filter((c) => c.url.endsWith('/script')).length, 0);
});

test('Moonraker missing objects never become successful measurements or executable macros', async () => {
  const { robot } = realFixture({ config: { heaters: { tool0: { object: 'extruder1', minTarget: 0, maxTarget: 200 } }, macros: { fans: 'MISSING' } } });
  await robot.connect();
  assert.equal((await robot.getTelemetry()).heaters.tool0.available, false);
  await assert.rejects(robot.setHeater('tool0', 30), /missing/);
  await assert.rejects(robot.runMacro('fans'), /missing/);
});

test('Moonraker disconnected and stopped controllers reject control', async () => {
  const { robot, calls } = realFixture();
  await assert.rejects(robot.jog('X', 1, 5), /disconnected/);
  await robot.connect(); await robot.emergencyStop();
  await assert.rejects(robot.home(), /emergency-stop/);
  await assert.rejects(robot.setHeater('tool0', 20), /emergency-stop/);
  await assert.rejects(robot.setFan('fan1', 20), /emergency-stop/);
  assert.equal(calls.filter((c) => c.url.endsWith('/script')).length, 0);
});

test('Moonraker timeout and JSON API errors are explicit and latch disconnection', async () => {
  const robot = new MoonrakerRobot({ timeoutMs: 10, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(robot.connect(), /timeout.*Read response unavailable/);
  assert.equal(robot.getStatus(), 'disconnected');
  const errorRobot = new MoonrakerRobot({ fetchImpl: async () => ({ ok: true, json: async () => ({ error: { message: 'fault' } }) }) });
  await assert.rejects(errorRobot.connect(), /API error.*fault/);
});

test('E-stop bypasses pending Moonraker macro and late acknowledgement cannot restore READY', async () => {
  let finish;
  const { robot } = realFixture({ fetchImpl: async (url) => {
    if (url.endsWith('/script')) return new Promise((resolve) => { finish = () => resolve({ ok: true, json: async () => ({ result: 'ok' }) }); });
    return { ok: true, json: async () => ({ result: url.endsWith('/info') ? { state: 'ready' } : url.endsWith('/list') ? { objects: ['gcode_macro TEST_FANS'] } : 'ok' }) };
  } });
  await robot.connect();
  const execution = robot.runMacro('fans');
  const rejected = assert.rejects(execution, /interrupted/);
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  await robot.emergencyStop(); finish(); await rejected;
  assert.equal(robot.getStatus(), 'emergency-stop');
});

test('read timeouts are not uncertain commands; control timeouts are never retried', async () => {
  let scripts = 0, finish;
  const robot = new MoonrakerRobot({ timeoutMs: 15, fetchImpl: async (url) => {
    if (url.endsWith('/info')) return { ok: true, json: async () => ({ result: { state: 'ready' } }) };
    if (url.endsWith('/script')) { scripts++; return new Promise((resolve) => { finish = () => resolve({ ok: true, json: async () => ({ result: 'ok' }) }); }); }
    return new Promise(() => {});
  } });
  await robot.connect();
  await assert.rejects(robot.getPosition(), (error) => error.code === 'TIMEOUT' && error.outcomeUnknown === false);
  await robot.connect();
  await assert.rejects(robot.jog('X', 1, 5), (error) => error.code === 'TIMEOUT' && error.outcomeUnknown === true);
  assert.equal(scripts, 1);
  finish(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(robot.getStatus(), 'disconnected');
});

test('a failed emergency request leaves the adapter locked and exposes unknown outcome', async () => {
  const { robot } = realFixture({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(robot.emergencyStop(), (error) => error.outcomeUnknown === true && error.code === 'REQUEST_FAILED');
  assert.equal(robot.getStatus(), 'emergency-stop');
  await assert.rejects(robot.jog('X', 1, 5), /emergency-stop/);
});

test('HTTP success without a command acknowledgement is not a confirmed stop', async () => {
  const robot = new MoonrakerRobot({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  await assert.rejects(robot.emergencyStop(), (error) => error.outcomeUnknown && /Missing command acknowledgement/.test(error.message));
  assert.equal(robot.getStatus(), 'emergency-stop');
});

test('late connect response after emergency stop cannot restore ready', async () => {
  let finish;
  const robot = new MoonrakerRobot({ fetchImpl: async (url) => {
    if (url.endsWith('/info')) return new Promise((resolve) => { finish = () => resolve({ ok: true, json: async () => ({ result: { state: 'ready' } }) }); });
    return { ok: true, json: async () => ({ result: 'ok' }) };
  } });
  const connecting = robot.connect();
  const rejected = assert.rejects(connecting, /Emergency stop/);
  await robot.emergencyStop(); finish(); await rejected;
  assert.equal(robot.getStatus(), 'emergency-stop');
});
