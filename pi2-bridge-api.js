(function (global) {
  'use strict';

  class Pi2BridgeRobot {
    constructor(options = {}) {
      this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
      this.token = String(options.token || '');
      this.fetchImpl = options.fetchImpl || global.fetch.bind(global);
      this.timeoutMs = options.timeoutMs || 120000;
      this.status = 'disconnected';
      this.snapshot = null;
    }

    getStatus() { return this.status; }
    supportsAxis(axis) { return ['X', 'Z', 'theta1', 'theta2'].includes(axis); }
    isBridgeMode() { return true; }
    canHome() {
      return this.status === 'ready' && !!this.snapshot?.calibration_verified && this.snapshot?.checkpoint?.status !== 'uncertain';
    }
    isMotionEnabled() {
      return this.status === 'ready' && !!this.snapshot?.motion_enabled;
    }
    motionBlockReason() {
      if (this.status !== 'ready') return `Pi2 bridge is ${this.status}.`;
      if (!this.snapshot?.calibration_verified) return 'Motion is locked: calibration_verified is false in pi2-motor-control/config/machine.json.';
      if (this.snapshot?.reference_required) return 'Motion is locked: manually position the mechanism, then press REFERENCE HOME / ZERO.';
      if (this.snapshot?.checkpoint?.status === 'uncertain') return 'Motion is locked: the Pi2 checkpoint is uncertain. Re-home and recover on the Pi.';
      return 'Motion is not enabled.';
    }

    async connect() {
      const data = await this.#request('/api/v1/status', { method: 'GET' });
      if (data.klippy_state !== 'ready') {
        this.status = 'error';
        throw new Error(`Klipper is not ready (state=${data.klippy_state || 'unknown'}).`);
      }
      this.snapshot = data;
      this.status = 'ready';
      return this.status;
    }

    async getPosition() {
      const data = await this.#request('/api/v1/status', { method: 'GET' });
      this.snapshot = data;
      if (data.klippy_state !== 'ready') this.status = 'error';
      const pose = data?.checkpoint?.current_pose;
      return {
        X: Number.isFinite(pose?.x_mm) ? pose.x_mm : null,
        Z: Number.isFinite(pose?.z_mm) ? pose.z_mm : null,
        theta1: Number.isFinite(pose?.theta1_deg) ? pose.theta1_deg : null,
        theta2: Number.isFinite(pose?.theta2_deg) ? pose.theta2_deg : null
      };
    }

    async jog(axis, amount, speed) {
      this.#assertMotionEnabled();
      if (!this.supportsAxis(axis)) throw new Error(`Unsupported axis: ${axis}`);
      if (!Number.isFinite(amount) || amount === 0 || !Number.isFinite(speed) || speed <= 0) throw new Error('Jog amount and speed must be valid non-zero numbers.');
      const current = await this.getPosition();
      const target = {
        x_mm: current.X,
        z_mm: current.Z,
        theta1_deg: current.theta1,
        theta2_deg: current.theta2
      };
      const keys = { X: 'x_mm', Z: 'z_mm', theta1: 'theta1_deg', theta2: 'theta2_deg' };
      target[keys[axis]] += amount;
      this.status = 'busy';
      try {
        const result = await this.#request('/api/v1/move', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target, path_speed_mm_s: speed, extrude: false })
        }, true);
        this.snapshot = { ...this.snapshot, checkpoint: result.checkpoint };
      } finally {
        if (this.status === 'busy') this.status = 'ready';
      }
    }

    async home() {
      if (!this.canHome()) throw new Error(this.motionBlockReason());
      this.status = 'busy';
      try {
        const result = await this.#request('/api/v1/reference-home', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, true);
        this.snapshot = { ...this.snapshot, checkpoint: result.checkpoint, reference_required: false, motion_enabled: true };
      } finally {
        if (this.status === 'busy') this.status = 'ready';
      }
    }

    async emergencyStop() {
      this.status = 'emergency-stop';
      await this.#request('/api/v1/emergency-stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, true);
    }

    async resetEmergencyStop() { throw new Error('Restart Klipper and complete Pi2 recovery on the Raspberry Pi.'); }
    async getTelemetry() {
      const unavailable = (reason) => ({ available: false, current: null, target: null, speed: null, reason });
      return {
        heaters: { tool0: unavailable('Not configured in fixed Pi2 printer.cfg'), bed: unavailable('Not configured in fixed Pi2 printer.cfg') },
        fans: { fan1: unavailable('Not configured in fixed Pi2 printer.cfg'), fan2: unavailable('Not configured in fixed Pi2 printer.cfg') },
        macros: { homing: false, fans: false, heaters: false, motors: false },
        macro: { id: null, state: 'idle', message: 'Pi2 bridge controls motion only' }, simulated: false, state: this.status
      };
    }
    async setHeater() { throw new Error('Heater control is not configured in the fixed Pi2 printer.cfg.'); }
    async setFan() { throw new Error('Fan control is not configured in the fixed Pi2 printer.cfg.'); }
    async runMacro() { throw new Error('Test macros are not configured in the fixed Pi2 printer.cfg.'); }

    #assertMotionEnabled() {
      if (!this.isMotionEnabled()) throw new Error(this.motionBlockReason());
    }
    async #request(path, options, control = false) {
      const abort = new AbortController();
      const headers = { ...(options.headers || {}) };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      let timer;
      try {
        const response = await Promise.race([
          this.fetchImpl(`${this.baseUrl}${path}`, { ...options, headers, signal: abort.signal }),
          new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('Bridge request timed out.')); }, this.timeoutMs); })
        ]);
        let data = {};
        try { data = await response.json(); } catch (_) { /* Empty response. */ }
        if (!response.ok) throw new Error(data.error || `Bridge request failed (${response.status}).`);
        return data;
      } catch (cause) {
        if (this.status !== 'emergency-stop') this.status = 'disconnected';
        const error = new Error(`${path}: ${cause.message}`);
        error.code = abort.signal.aborted ? 'TIMEOUT' : 'REQUEST_FAILED';
        error.outcomeUnknown = control;
        throw error;
      } finally { clearTimeout(timer); }
    }
  }

  global.Pi2BridgeRobot = Pi2BridgeRobot;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Pi2BridgeRobot };
})(typeof window !== 'undefined' ? window : globalThis);
