(function (global) {
  'use strict';

  const LOGICAL_AXES = Object.freeze(['X', 'Z', 'theta1', 'theta2']);

  class MockRobot {
    constructor(options = {}) {
      this.limits = options.limits || {};
      this.simulateDelay = options.simulateDelay !== false;
      this.maxDelayMs = Number.isFinite(options.maxDelayMs) ? options.maxDelayMs : 650;
      this.position = { X: 0, Z: 0, theta1: 0, theta2: 0 };
      this.status = 'disconnected';
      this.stopped = false;
      this.epoch = 0;
      this.now = options.now || Date.now;
      this.lastTemperatureUpdate = this.now();
      this.heaters = {
        tool0: { current: 22, target: 0, max: 280, available: true },
        bed: { current: 22, target: 0, max: 110, available: true }
      };
      this.fans = { fan1: { speed: 0, available: true }, fan2: { speed: 0, available: true } };
      this.macro = { id: null, state: 'idle', message: 'No test run' };
      this.macroRunning = false;
    }

    async connect() {
      this.status = 'ready';
      return this.getStatus();
    }

    getStatus() {
      return this.stopped ? 'emergency-stop' : this.status;
    }

    async getPosition() {
      return { ...this.position };
    }

    async jog(axis, amount, speed) {
      this.#assertOperational();
      const epoch = this.epoch;
      this.#assertAxis(axis);
      if (!Number.isFinite(amount) || amount === 0) {
        throw new Error('Jog amount must be a non-zero number.');
      }
      if (!Number.isFinite(speed) || speed <= 0) {
        throw new Error('Speed must be greater than zero.');
      }

      const target = this.position[axis] + amount;
      const limit = this.limits[axis];
      if (limit && (target < limit.min || target > limit.max)) {
        throw new Error(`${axis} limit exceeded: ${target} ${limit.unit} is outside ${limit.min}–${limit.max} ${limit.unit}.`);
      }

      this.status = 'busy';
      try {
        if (this.simulateDelay) {
          const delayMs = Math.min(this.maxDelayMs, Math.max(70, Math.abs(amount / speed) * 1000));
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        this.#assertOperational();
        if (epoch !== this.epoch) throw new Error('Motion interrupted by emergency stop.');
        this.position[axis] = Number(target.toFixed(6));
        return this.getPosition();
      } finally {
        if (!this.stopped) this.status = 'ready';
      }
    }

    async home() {
      this.#assertOperational();
      const epoch = this.epoch;
      this.status = 'busy';
      try {
        if (this.simulateDelay) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        this.#assertOperational();
        if (epoch !== this.epoch) throw new Error('Homing interrupted by emergency stop.');
        this.position = { X: 0, Z: 0, theta1: 0, theta2: 0 };
        return this.getPosition();
      } finally {
        if (!this.stopped) this.status = 'ready';
      }
    }

    async emergencyStop() {
      this.#updateTemperatures();
      this.epoch += 1;
      this.stopped = true;
      this.status = 'emergency-stop';
      Object.values(this.heaters).forEach((heater) => { heater.target = 0; });
      Object.values(this.fans).forEach((fan) => { fan.speed = 0; });
      if (this.macroRunning) this.macro = { ...this.macro, state: 'interrupted', message: 'Emergency stop' };
    }

    async resetEmergencyStop() {
      if (this.macroRunning) throw new Error('Wait for the interrupted mock test to finish.');
      this.stopped = false;
      this.status = 'ready';
    }

    #updateTemperatures() {
      const now = this.now();
      const seconds = Math.max(0, (now - this.lastTemperatureUpdate) / 1000);
      this.lastTemperatureUpdate = now;
      Object.values(this.heaters).forEach((heater) => {
        const target = Math.max(22, heater.target);
        const delta = target - heater.current;
        heater.current += Math.sign(delta) * Math.min(Math.abs(delta), seconds * (delta > 0 ? 12 : 4));
      });
    }

    async getTelemetry() {
      this.#updateTemperatures();
      return {
        heaters: structuredClone(this.heaters), fans: structuredClone(this.fans),
        macros: Object.fromEntries(['homing', 'fans', 'heaters', 'motors'].map((id) => [id, true])),
        macro: { ...this.macro }, simulated: true, state: this.getStatus()
      };
    }

    async setHeater(id, target) {
      this.#assertOperational();
      const heater = Object.hasOwn(this.heaters, id) ? this.heaters[id] : null;
      if (!heater) throw new Error(`Unknown heater: ${id}`);
      if (!Number.isFinite(target) || target < 0 || target > heater.max) throw new Error(`Mock ${id} target must be 0–${heater.max}°C.`);
      this.#updateTemperatures();
      heater.target = target;
    }

    async setFan(id, percent) {
      this.#assertOperational();
      if (!Object.hasOwn(this.fans, id)) throw new Error(`Unknown fan: ${id}`);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Fan speed must be 0–100%.');
      this.fans[id].speed = percent;
    }

    async runMacro(id) {
      this.#assertOperational();
      if (!['homing', 'fans', 'heaters', 'motors'].includes(id)) throw new Error(`Unknown macro: ${id}`);
      if (this.macroRunning || this.status === 'busy') throw new Error('Controller is busy.');
      this.macroRunning = true;
      const epoch = this.epoch;
      this.macro = { id, state: 'running', message: 'Mock simulation running' };
      const check = () => {
        this.#assertOperational();
        if (epoch !== this.epoch) throw new Error('Mock test interrupted.');
      };
      const wait = async (ms) => {
        if (this.simulateDelay) await new Promise((resolve) => setTimeout(resolve, ms));
        check();
      };
      try {
        if (id === 'homing') await this.home();
        if (id === 'fans') {
          for (const fan of Object.keys(this.fans)) {
            check();
            this.macro.message = `Testing ${fan} at 50%`;
            await this.setFan(fan, 50);
            await wait(900);
            await this.setFan(fan, 0);
          }
        }
        if (id === 'heaters') {
          await this.setHeater('tool0', 45);
          await this.setHeater('bed', 45);
          await wait(2200);
          this.#updateTemperatures();
        }
        if (id === 'motors') {
          for (const axis of LOGICAL_AXES) {
            check();
            const limit = this.limits[axis];
            const amount = limit && this.position[axis] + 1 > limit.max ? -1 : 1;
            this.macro.message = `Testing ${axis}: ${amount}, then return`;
            await this.jog(axis, amount, 5);
            check();
            await this.jog(axis, -amount, 5);
          }
        }
        check();
        this.macro = { id, state: 'complete', message: 'Simulation complete · hardware not verified' };
        return this.macro.message;
      } catch (error) {
        this.macro = { id, state: this.stopped ? 'interrupted' : 'error', message: error.message };
        throw error;
      } finally {
        if (id === 'heaters') {
          this.#updateTemperatures();
          Object.values(this.heaters).forEach((heater) => { heater.target = 0; });
        }
        if (id === 'fans') Object.values(this.fans).forEach((fan) => { fan.speed = 0; });
        this.macroRunning = false;
      }
    }

    #assertAxis(axis) {
      if (!LOGICAL_AXES.includes(axis)) {
        throw new Error(`Unsupported axis: ${axis}`);
      }
    }

    #assertOperational() {
      if (this.stopped) throw new Error('Emergency stop is active.');
      if (this.status === 'disconnected') throw new Error('Mock controller is disconnected.');
    }
  }

  global.MockRobot = MockRobot;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MockRobot, LOGICAL_AXES };
  }
})(typeof window !== 'undefined' ? window : globalThis);
