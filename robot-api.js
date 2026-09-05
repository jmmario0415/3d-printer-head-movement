(function (global) {
  'use strict';

  class MoonrakerRobot {
    constructor(options = {}) {
      this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
      this.fetchImpl = options.fetchImpl || global.fetch.bind(global);
      this.status = 'disconnected';
    }

    getStatus() {
      return this.status;
    }

    async connect() {
      try {
        const data = await this.#request('/printer/info', { method: 'GET' });
        const printerState = data?.result?.state;
        this.status = printerState === 'ready' ? 'ready' : printerState === 'startup' ? 'busy' : 'error';
        if (this.status === 'error') {
          throw new Error(data?.result?.state_message || `Klipper state: ${printerState || 'unknown'}`);
        }
        return this.status;
      } catch (error) {
        if (this.status !== 'error') this.status = 'disconnected';
        throw error;
      }
    }

    async jog(axis, amount, speed) {
      if (axis === 'X' || axis === 'Z') {
        return this.jogLinear(axis, amount, speed);
      }
      if (axis === 'theta1') return this.jogTheta1(amount, speed);
      if (axis === 'theta2') return this.jogTheta2(amount, speed);
      throw new Error(`Unsupported axis: ${axis}`);
    }

    async jogLinear(axis, amount, speed) {
      if (!Number.isFinite(amount) || amount === 0) throw new Error('Jog amount must be a non-zero number.');
      if (!Number.isFinite(speed) || speed <= 0) throw new Error('Speed must be greater than zero.');
      const feedRate = Number((speed * 60).toFixed(6));
      const script = [
        'SAVE_GCODE_STATE NAME=head_jog',
        'G91',
        `G1 ${axis}${amount} F${feedRate}`,
        'RESTORE_GCODE_STATE NAME=head_jog'
      ].join('\n');
      this.status = 'busy';
      try {
        await this.#sendGcode(script);
      } finally {
        if (this.status !== 'emergency-stop') this.status = 'ready';
      }
    }

    async jogTheta1(_amount, _speed) {
      // TODO: Implement only after printer.cfg exposes the real Theta1 mechanism.
      throw new Error('Theta1 Moonraker control is not configured yet.');
    }

    async jogTheta2(_amount, _speed) {
      // TODO: Implement only after printer.cfg exposes the real Theta2 mechanism.
      throw new Error('Theta2 Moonraker control is not configured yet.');
    }

    async getPosition() {
      const data = await this.#request('/printer/objects/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objects: { toolhead: ['position'] } })
      });
      const position = data?.result?.status?.toolhead?.position;
      return {
        X: Number.isFinite(position?.[0]) ? position[0] : null,
        Z: Number.isFinite(position?.[2]) ? position[2] : null,
        theta1: null,
        theta2: null
      };
    }

    async home() {
      return this.homeLinear();
    }

    async homeLinear() {
      this.status = 'busy';
      try {
        // Deliberately homes only the logical linear axes; rotary homing is not configured.
        await this.#sendGcode('G28 X Z');
      } finally {
        if (this.status !== 'emergency-stop') this.status = 'ready';
      }
    }

    async zeroRotary() {
      throw new Error('Rotary zeroing is not configured for Moonraker yet.');
    }

    async emergencyStop() {
      try {
        await this.#request('/printer/emergency_stop', { method: 'POST' });
      } finally {
        this.status = 'emergency-stop';
      }
    }

    async resetEmergencyStop() {
      throw new Error('Reset Klipper from its host/controller after an emergency stop.');
    }

    async #sendGcode(script) {
      return this.#request('/printer/gcode/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script })
      });
    }

    async #request(path, options) {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, options);
      if (!response.ok) {
        let detail = '';
        try {
          detail = JSON.stringify(await response.json());
        } catch (_error) {
          detail = '';
        }
        throw new Error(`Moonraker request failed (${response.status})${detail ? `: ${detail}` : ''}`);
      }
      return response.json();
    }
  }

  global.MoonrakerRobot = MoonrakerRobot;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MoonrakerRobot };
  }
})(typeof window !== 'undefined' ? window : globalThis);
