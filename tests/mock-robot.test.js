'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MockRobot } = require('../mock-api.js');

const LIMITS = {
  X: { min: 0, max: 300, unit: 'mm' },
  Z: { min: 0, max: 200, unit: 'mm' },
  theta1: { min: -180, max: 180, unit: 'deg' },
  theta2: { min: -180, max: 180, unit: 'deg' }
};

function createRobot() {
  return new MockRobot({ limits: LIMITS, simulateDelay: false });
}

test('MockRobot starts ready at zero on all four logical axes', async () => {
  const robot = createRobot();
  await robot.connect();

  assert.equal(robot.getStatus(), 'ready');
  assert.deepEqual(await robot.getPosition(), {
    X: 0,
    Z: 0,
    theta1: 0,
    theta2: 0
  });
});

test('MockRobot jogs X, Z, theta1 and theta2 independently', async () => {
  const robot = createRobot();
  await robot.connect();

  await robot.jog('X', 10, 5);
  await robot.jog('X', -1, 5);
  await robot.jog('Z', 5, 5);
  await robot.jog('theta1', 10, 10);
  await robot.jog('theta2', -5, 10);

  assert.deepEqual(await robot.getPosition(), {
    X: 9,
    Z: 5,
    theta1: 10,
    theta2: -5
  });
});

test('MockRobot rejects an out-of-range move without changing position', async () => {
  const robot = createRobot();
  await robot.connect();

  await assert.rejects(robot.jog('X', -1, 5), /X limit exceeded/);
  assert.equal((await robot.getPosition()).X, 0);
});

test('MockRobot emergency stop blocks jog and home until reset', async () => {
  const robot = createRobot();
  await robot.connect();
  await robot.jog('X', 10, 5);
  await robot.emergencyStop();

  assert.equal(robot.getStatus(), 'emergency-stop');
  await assert.rejects(robot.jog('X', 1, 5), /Emergency stop is active/);
  await assert.rejects(robot.home(), /Emergency stop is active/);
  assert.equal((await robot.getPosition()).X, 10);

  await robot.resetEmergencyStop();
  await robot.jog('X', 1, 5);
  assert.equal(robot.getStatus(), 'ready');
  assert.equal((await robot.getPosition()).X, 11);
});

test('MockRobot home returns every logical axis to the development origin', async () => {
  const robot = createRobot();
  await robot.connect();
  await robot.jog('X', 10, 5);
  await robot.jog('Z', 5, 5);
  await robot.jog('theta1', 10, 10);
  await robot.jog('theta2', -5, 10);

  await robot.home();

  assert.deepEqual(await robot.getPosition(), {
    X: 0,
    Z: 0,
    theta1: 0,
    theta2: 0
  });
});

test('MockRobot rejects unknown axes and invalid speed', async () => {
  const robot = createRobot();
  await robot.connect();

  await assert.rejects(robot.jog('Y', 1, 5), /Unsupported axis/);
  await assert.rejects(robot.jog('X', 1, 0), /Speed must be greater than zero/);
});
