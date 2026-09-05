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
        this.position[axis] = Number(target.toFixed(6));
        return this.getPosition();
      } finally {
        if (!this.stopped) this.status = 'ready';
      }
    }

    async home() {
      this.#assertOperational();
      this.status = 'busy';
      try {
        if (this.simulateDelay) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        this.#assertOperational();
        this.position = { X: 0, Z: 0, theta1: 0, theta2: 0 };
        return this.getPosition();
      } finally {
        if (!this.stopped) this.status = 'ready';
      }
    }

    async emergencyStop() {
      this.stopped = true;
      this.status = 'emergency-stop';
    }

    async resetEmergencyStop() {
      this.stopped = false;
      this.status = 'ready';
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
