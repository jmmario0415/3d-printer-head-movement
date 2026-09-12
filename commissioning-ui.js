(function (global) {
  'use strict';

  function initializeCommissioning(document, { run, log, fault, controls }) {
    const definitions = global.COMMISSIONING;
    const root = document.querySelector('#commissioning-panels');
    root.innerHTML = `
      <div class="thermal-grid">
        <section class="panel"><div class="panel-heading"><h2>Heaters</h2><span>Current / Target · °C</span></div>
          <div id="heater-rows" class="device-content"></div>
          <p class="device-note">Current is measured. Active / Standby are presets; editing does not heat until applied.</p></section>
        <section class="panel"><div class="panel-heading"><h2>Temperature Chart</h2><span id="telemetry-status">Waiting for connection</span></div>
          <canvas id="temperature-chart" width="680" height="190" role="img" aria-label="Temperature history. Solid: measured, dashed: target. Tool 0: red, Bed: blue."></canvas>
          <div class="chart-legend"><span class="tool-key">● Tool 0</span><span class="bed-key">● Bed</span><span>Solid: current · Dashed: target · last 180 samples</span></div></section>
      </div>
      <div class="test-grid">
        <section class="panel"><div class="panel-heading"><h2>Fan Tests</h2><span>Commanded output · %</span></div>
          <div id="fan-rows" class="device-content"></div><p class="device-note">Output percentage is not measured RPM. Verify rotation on the machine.</p></section>
        <section class="panel"><div class="panel-heading"><h2>User-Defined Macros</h2><span>Unit tests</span></div>
          <div id="macro-rows" class="macro-grid"></div><output id="macro-result" role="status">No test run</output>
          <p class="device-note">Command completion does not certify homing, heating or absence of motor stalls. Emergency Stop interrupts tests.</p></section>
      </div>`;
    let robot = null, mode = 'mock', generation = 0, timer = null, telemetry = null, history = [];
    let polling = null;
    const heaterRows = new Map(), fanRows = new Map(), macroRows = new Map();
    const status = document.querySelector('#telemetry-status');
    const result = document.querySelector('#macro-result');
    const canvas = document.querySelector('#temperature-chart');
    const context = canvas.getContext('2d');

    function action(button, task, request, complete) {
      button.dataset.deviceControl = '';
      button.addEventListener('click', () => run(async () => { await task(); await refresh(); }, request, complete));
    }
    for (const heater of definitions.heaters) {
      const row = document.createElement('div');
      row.className = 'heater-row'; row.dataset.heater = heater.id;
      row.innerHTML = `<div class="device-heading"><strong></strong><output class="reading">N/A</output><small class="availability">Waiting</small></div>
        <div class="device-actions"><label>Active <input class="active-preset" type="number" min="0" step="1" value="0"></label>
        <button class="control-button apply-active" type="button">ACTIVE</button>
        <label>Standby <input class="standby-preset" type="number" min="0" step="1" value="0"></label>
        <button class="control-button apply-standby" type="button">STANDBY</button>
        <button class="control-button heater-off" type="button">OFF</button></div>`;
      row.querySelector('strong').textContent = heater.label;
      for (const preset of ['active', 'standby']) {
        const input = row.querySelector(`.${preset}-preset`);
        input.setAttribute('aria-label', `${heater.label} ${preset} temperature`);
        action(row.querySelector(`.apply-${preset}`), () => {
          if (input.value.trim() === '' || !input.checkValidity()) throw new Error(`Invalid ${heater.label} ${preset} temperature.`);
          return robot.setHeater(heater.id, Number(input.value));
        }, `${heater.label} ${preset} requested`, () => `${heater.label} ${preset} target command acknowledged`);
      }
      action(row.querySelector('.heater-off'), () => robot.setHeater(heater.id, 0), `${heater.label} OFF requested`, () => `${heater.label} target set to 0°C`);
      heaterRows.set(heater.id, row); document.querySelector('#heater-rows').append(row);
    }
    for (const fan of definitions.fans) {
      const row = document.createElement('div'); row.className = 'fan-row'; row.dataset.fan = fan.id;
      row.innerHTML = `<strong></strong><output>N/A</output><input type="number" min="0" max="100" step="1" value="50">
        <button class="control-button fan-apply" type="button">APPLY %</button><button class="control-button fan-off" type="button">OFF</button><small>Waiting</small>`;
      row.querySelector('strong').textContent = fan.label;
      const input = row.querySelector('input'); input.setAttribute('aria-label', `${fan.label} output percent`);
      action(row.querySelector('.fan-apply'), () => {
        if (input.value.trim() === '' || !input.checkValidity()) throw new Error('Fan speed must be 0–100%.');
        return robot.setFan(fan.id, Number(input.value));
      }, `${fan.label} output requested`, () => `${fan.label} output command acknowledged`);
      action(row.querySelector('.fan-off'), () => robot.setFan(fan.id, 0), `${fan.label} OFF requested`, () => `${fan.label} output set to 0%`);
      fanRows.set(fan.id, row); document.querySelector('#fan-rows').append(row);
    }
    for (const macro of definitions.macros) {
      const item = document.createElement('div');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'control-button macro-button'; button.dataset.macro = macro.id;
      button.textContent = macro.label;
      const note = document.createElement('small'); note.textContent = 'Waiting';
      item.append(button, note);
      let outcome = '';
      action(button, async () => {
        result.textContent = `${macro.label}: running`;
        try { outcome = await robot.runMacro(macro.id); }
        catch (error) {
          result.textContent = `${macro.label}: ${robot.getStatus() === 'emergency-stop' ? 'interrupted' : 'error'} · ${error.message}`;
          throw error;
        }
      }, `${macro.label} requested`, () => `${macro.label}: ${outcome}`);
      macroRows.set(macro.id, { button, note, definition: macro });
      document.querySelector('#macro-rows').append(item);
    }

    function availability(row, available) {
      row.querySelectorAll('[data-device-control]').forEach((button) => { button.dataset.unavailable = String(!available); });
    }
    function draw() {
      const w = canvas.width, h = canvas.height, left = 42, right = w - 14, top = 12, bottom = h - 25;
      context.clearRect(0, 0, w, h);
      const values = history.flatMap((sample) => Object.values(sample.heaters).flatMap((heater) => [heater.current, heater.target])).filter(Number.isFinite);
      const max = Math.max(60, Math.ceil(Math.max(0, ...values) / 50) * 50);
      context.font = '11px Segoe UI'; context.lineWidth = 1; context.setLineDash([]);
      for (let i = 0; i <= 3; i++) {
        const y = bottom - i * (bottom - top) / 3;
        context.strokeStyle = '#dce2e6'; context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
        context.fillStyle = '#66717a'; context.fillText(`${Math.round(max * i / 3)}°`, 5, y + 4);
      }
      const start = history[0]?.time || Date.now(), end = history.at(-1)?.time || start;
      context.fillText(`${Math.round((end - start) / 1000)}s ago`, left, h - 6); context.fillText('Now', right - 24, h - 6);
      for (const [id, color] of [['tool0', '#b54134'], ['bed', '#276b9a']]) {
        for (const field of ['current', 'target']) {
          context.strokeStyle = color; context.lineWidth = field === 'current' ? 2 : 1; context.setLineDash(field === 'target' ? [5, 4] : []);
          context.beginPath(); let open = false;
          history.forEach((sample) => {
            const value = sample.heaters[id]?.[field];
            if (!Number.isFinite(value)) { open = false; return; }
            const x = left + (sample.time - start) / Math.max(1000, end - start) * (right - left);
            const y = bottom - value / max * (bottom - top);
            if (open) context.lineTo(x, y); else context.moveTo(x, y);
            open = true;
          }); context.stroke();
        }
      }
      context.setLineDash([]);
      if (!history.length) { context.fillStyle = '#66717a'; context.fillText('Waiting for temperature samples', left + 60, 90); }
    }

    function render(data) {
      for (const [id, row] of heaterRows) {
        const heater = data?.heaters[id];
        const available = !!heater?.available;
        availability(row, available);
        row.querySelector('.reading').textContent = available ? `${heater.current.toFixed(1)} / ${heater.target.toFixed(1)} °C` : 'N/A';
        row.querySelector('.availability').textContent = available ? (data.simulated ? `Simulated · dev max ${heater.max}°C` : 'Live measurement') : (heater?.reason || 'No live data');
        row.querySelectorAll('input').forEach((input) => { if (Number.isFinite(heater?.max)) input.max = heater.max; else input.removeAttribute('max'); });
      }
      for (const [id, row] of fanRows) {
        const fan = data?.fans[id]; availability(row, !!fan?.available);
        row.querySelector('output').textContent = fan?.available ? `${fan.speed.toFixed(0)}%` : 'N/A';
        row.querySelector('small').textContent = fan?.available ? (data.simulated ? 'Simulated' : 'Commanded output') : (fan?.reason || 'No live data');
      }
      for (const [id, item] of macroRows) {
        item.button.dataset.unavailable = String(!data?.macros[id]);
        item.note.textContent = data?.macros[id] ? (mode === 'mock' ? item.definition.description : 'Configured server macro · inspect printer.cfg procedure') : 'Not configured / unavailable';
      }
      if (data) result.textContent = `${data.macro.id || 'Tests'} · ${data.macro.state}: ${data.macro.message}`;
      controls();
    }

    async function refresh() {
      if (!robot) return;
      if (polling) { await polling; if (!telemetry) throw new Error('Telemetry unavailable; reconnect required.'); return; }
      const ownGeneration = generation, ownRobot = robot;
      const task = (async () => {
        const data = await ownRobot.getTelemetry();
        if (ownGeneration !== generation) return;
        if (!['ready', 'busy', 'emergency-stop'].includes(data.state)) throw new Error(`Klipper state: ${data.state}`);
        telemetry = data; render(data);
        status.textContent = `${data.simulated ? 'SIMULATED' : 'LIVE'} · ${new Date().toLocaleTimeString()}`;
        history.push({ time: Date.now(), heaters: data.heaters }); if (history.length > 180) history.shift(); draw();
      })();
      polling = task;
      try { await task; }
      finally { if (polling === task) polling = null; }
    }
    function stop() {
      generation++; clearTimeout(timer); timer = null; polling = null; robot = null; telemetry = null; history = [];
      status.textContent = 'No live data'; result.textContent = 'No test run'; render(null); draw();
    }
    async function bind(nextRobot, nextMode) {
      stop(); robot = nextRobot; mode = nextMode;
      for (const [id, row] of heaterRows) {
        row.querySelector('.active-preset').value = mode === 'mock' ? (id === 'tool0' ? 180 : 60) : 0;
        row.querySelector('.standby-preset').value = mode === 'mock' ? (id === 'tool0' ? 100 : 40) : 0;
      }
      const ownGeneration = generation;
      await refresh();
      const poll = async () => {
        try { await refresh(); }
        catch (error) {
          if (ownGeneration !== generation) return;
          telemetry = null; history.push({ time: Date.now(), heaters: {} }); render(null); draw(); status.textContent = 'STALE · reconnect required';
          fault(error); return;
        }
        if (ownGeneration === generation) timer = setTimeout(poll, 1000);
      };
      if (ownGeneration === generation) timer = setTimeout(poll, 1000);
    }
    render(null); draw();
    return { bind, stop, refresh, isBound: () => robot !== null };
  }
  global.initializeCommissioning = initializeCommissioning;
})(typeof window !== 'undefined' ? window : globalThis);
