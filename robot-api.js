(function (global) {
  'use strict';

  class MoonrakerRobot {
    constructor(options = {}) {
      this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
      this.fetchImpl = options.fetchImpl || global.fetch.bind(global);
      this.status = 'disconnected';
      this.config = structuredClone(options.config || { heaters: {}, fans: {}, macros: {} });
      this.timeoutMs = options.timeoutMs || 10000;
      this.macroTimeoutMs = options.macroTimeoutMs || 120000;
      this.epoch = 0;
      this.availableObjects = null;
      this.macro = { id: null, state: 'idle', message: 'No test run' };
    }

    getStatus() {
      return this.status;
    }

    async connect() {
      const epoch = this.epoch;
      this.availableObjects = null;
      try {
        const data = await this.#request('/printer/info', { method: 'GET' });
        const printerState = data?.result?.state;
        if (epoch !== this.epoch || this.status === 'emergency-stop') throw new Error('Emergency stop is active.');
        this.status = printerState === 'ready' ? 'ready' : printerState === 'startup' ? 'busy' : 'error';
        if (this.status === 'error') {
          throw new Error(data?.result?.state_message || `Klipper state: ${printerState || 'unknown'}`);
        }
        return this.status;
      } catch (error) {
        if (!['error', 'emergency-stop'].includes(this.status)) this.status = 'disconnected';
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
      this.#assertReady();
      if (!['X', 'Z'].includes(axis)) throw new Error(`Unsupported linear axis: ${axis}`);
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
        if (this.status === 'busy') this.status = 'ready';
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
      this.#assertReady();
      this.status = 'busy';
      try {
        // Deliberately homes only the logical linear axes; rotary homing is not configured.
        await this.#sendGcode('G28 X Z');
      } finally {
        if (this.status === 'busy') this.status = 'ready';
      }
    }

    async zeroRotary() {
      throw new Error('Rotary zeroing is not configured for Moonraker yet.');
    }

    async emergencyStop() {
      this.epoch += 1;
      this.status = 'emergency-stop';
      try {
        await this.#request('/printer/emergency_stop', { method: 'POST' });
      } finally {
        this.status = 'emergency-stop';
      }
    }

    async resetEmergencyStop() {
      throw new Error('Reset Klipper from its host/controller after an emergency stop.');
    }

    #assertReady() {
      if (this.status !== 'ready') throw new Error(`Moonraker is ${this.status}; reconnect and verify Klipper before control.`);
    }

    #heater(id) {
      const item = this.config.heaters?.[id];
      if (!item || !/^(extruder\d*|heater_bed)$/.test(item.object) ||
          !Number.isFinite(item.minTarget) || !Number.isFinite(item.maxTarget) ||
          item.minTarget < 0 || item.maxTarget <= item.minTarget) return null;
      return item;
    }

    #fan(id) {
      const item = this.config.fans?.[id];
      return item && /^(fan|fan_generic [A-Za-z_][A-Za-z0-9_]*)$/.test(item.object) ? item : null;
    }

    #macro(id) {
      const command = this.config.macros?.[id];
      return typeof command === 'string' && /^[A-Za-z_][A-Za-z_]*$/.test(command) ? command : null;
    }

    async #discover() {
      if (!this.availableObjects) {
        const data = await this.#request('/printer/objects/list', { method: 'GET' });
        if (!Array.isArray(data?.result?.objects)) throw new Error('Invalid Moonraker object list.');
        this.availableObjects = new Set(data.result.objects);
      }
    }

    async getTelemetry() {
      await this.#discover();
      const objects = { webhooks: ['state', 'state_message'] };
      for (const id of ['tool0', 'bed']) {
        const item = this.#heater(id);
        if (item && this.availableObjects.has(item.object)) objects[item.object] = ['temperature', 'target'];
      }
      for (const id of ['fan1', 'fan2']) {
        const item = this.#fan(id);
        if (item && this.availableObjects.has(item.object)) objects[item.object] = ['speed'];
      }
      const data = await this.#request('/printer/objects/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objects })
      });
      const status = data?.result?.status;
      if (!status || !status.webhooks?.state) throw new Error('Missing Moonraker telemetry / Klipper state.');
      if (status.webhooks.state !== 'ready' && this.status !== 'emergency-stop') this.status = 'error';
      const heaters = {}, fans = {}, macros = {};
      for (const id of ['tool0', 'bed']) {
        const item = this.#heater(id), value = item && status[item.object];
        const available = !!value && Number.isFinite(value.temperature) && Number.isFinite(value.target);
        heaters[id] = { available, current: available ? value.temperature : null, target: available ? value.target : null,
          max: item?.maxTarget, min: item?.minTarget, reason: item ? 'Object / measurement unavailable' : 'Not configured' };
      }
      for (const id of ['fan1', 'fan2']) {
        const item = this.#fan(id), value = item && status[item.object];
        const available = !!value && Number.isFinite(value.speed);
        fans[id] = { available, speed: available ? value.speed * 100 : null, reason: item ? 'Object / measurement unavailable' : 'Not configured' };
      }
      for (const id of ['homing', 'fans', 'heaters', 'motors']) {
        const command = this.#macro(id);
        macros[id] = !!command && this.availableObjects.has(`gcode_macro ${command}`);
      }
      return { heaters, fans, macros, macro: { ...this.macro }, simulated: false, state: status.webhooks.state };
    }

    async setHeater(id, target) {
      this.#assertReady();
      const item = this.#heater(id);
      if (!item) throw new Error(`${id} heater is not configured. Check commissioning-config.js.`);
      if (!Number.isFinite(target) || (target !== 0 && (target < item.minTarget || target > item.maxTarget))) {
        throw new Error(`${id} target must be 0 (off) or ${item.minTarget}–${item.maxTarget}°C.`);
      }
      await this.#discover();
      this.#assertReady();
      if (!this.availableObjects.has(item.object)) throw new Error(`Heater object missing: ${item.object}`);
      await this.#sendGcode(`SET_HEATER_TEMPERATURE HEATER=${item.object} TARGET=${target}`);
    }

    async setFan(id, percent) {
      this.#assertReady();
      const item = this.#fan(id);
      if (!item) throw new Error(`${id} fan is not configured. Check commissioning-config.js.`);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Fan speed must be 0–100%.');
      await this.#discover();
      this.#assertReady();
      if (!this.availableObjects.has(item.object)) throw new Error(`Fan object missing: ${item.object}`);
      await this.#sendGcode(item.object === 'fan' ? `M106 S${Number((percent * 255 / 100).toFixed(4))}` :
        `SET_FAN_SPEED FAN=${item.object.slice(12)} SPEED=${percent / 100}`);
    }

    async runMacro(id) {
      this.#assertReady();
      const command = this.#macro(id);
      if (!command) throw new Error(`${id} macro is not configured. Check commissioning-config.js.`);
      await this.#discover();
      this.#assertReady();
      if (!this.availableObjects.has(`gcode_macro ${command}`)) throw new Error(`Macro missing in printer.cfg: ${command}`);
      const epoch = this.epoch;
      this.status = 'busy';
      this.macro = { id, state: 'running', message: `Executing ${command}` };
      try {
        await this.#request('/printer/gcode/script', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script: command })
        }, this.macroTimeoutMs);
        if (epoch !== this.epoch) throw new Error('Macro interrupted by emergency stop.');
        this.macro = { id, state: 'complete', message: 'Command acknowledged · inspect hardware result' };
        return this.macro.message;
      } catch (error) {
        this.macro = { id, state: this.status === 'emergency-stop' ? 'interrupted' : 'error', message: error.message };
        throw error;
      } finally {
        if (this.status === 'busy') this.status = 'ready';
      }
    }

    async #sendGcode(script) {
      return this.#request('/printer/gcode/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script })
      });
    }

    async #request(path, options, timeoutMs = this.timeoutMs) {
      const abort = new AbortController();
      let timer;
      try {
        return await Promise.race([
          (async () => {
            const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...options, signal: abort.signal });
            if (!response.ok) {
              let detail = '';
              try { detail = JSON.stringify(await response.json()); } catch (_) { /* Non-JSON error body. */ }
              throw new Error(`Moonraker request failed (${response.status})${detail ? `: ${detail}` : ''}`);
            }
            const data = await response.json();
            if (data?.error) throw new Error(`Moonraker API error: ${JSON.stringify(data.error)}`);
            return data;
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              abort.abort();
              reject(new Error(`Moonraker timeout: ${path}. Command outcome unknown; inspect controller before reconnecting.`));
            }, timeoutMs);
          })
        ]);
      } catch (error) {
        if (this.status !== 'emergency-stop') this.status = 'disconnected';
        throw new Error(`${path}: ${error.message}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  global.MoonrakerRobot = MoonrakerRobot;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MoonrakerRobot };
  }
})(typeof window !== 'undefined' ? window : globalThis);
