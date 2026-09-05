(function (global) {
  'use strict';

  const CONFIG = Object.freeze({
    mode: 'mock',
    moonrakerUrl: '',
    defaultLinearSpeed: 5,
    defaultRotarySpeed: 10,
    defaultKeyboardLinearStep: 1,
    defaultKeyboardRotaryStep: 1,
    // DEVELOPMENT-ONLY placeholders. These are not final machine specifications.
    // UI software limits supplement, and never replace, Klipper/hardware safety limits.
    limits: Object.freeze({
      X: Object.freeze({ min: 0, max: 300, unit: 'mm' }),
      Z: Object.freeze({ min: 0, max: 200, unit: 'mm' }),
      theta1: Object.freeze({ min: -180, max: 180, unit: 'deg' }),
      theta2: Object.freeze({ min: -180, max: 180, unit: 'deg' })
    })
  });

  const JOG_LAYOUT = Object.freeze({
    X: Object.freeze([-50, -10, -1, -0.1, 0.1, 1, 10, 50]),
    Z: Object.freeze([-25, -5, -0.5, -0.05, 0.05, 0.5, 5, 25]),
    theta1: Object.freeze([-30, -10, -5, -1, 1, 5, 10, 30]),
    theta2: Object.freeze([-30, -10, -5, -1, 1, 5, 10, 30])
  });

  const AXIS_META = Object.freeze({
    X: Object.freeze({ label: 'X', description: 'Linear', unit: 'mm', rotary: false }),
    Z: Object.freeze({ label: 'Z', description: 'Linear', unit: 'mm', rotary: false }),
    theta1: Object.freeze({ label: 'Theta1', shortLabel: 'θ1', description: 'Bed rotation', unit: '°', rotary: true }),
    theta2: Object.freeze({ label: 'Theta2', shortLabel: 'θ2', description: 'Nozzle rotation', unit: '°', rotary: true })
  });

  function getKeyboardJog(key, linearStep, rotaryStep) {
    const normalized = key.length === 1 ? key.toLowerCase() : key;
    const map = {
      ArrowLeft: { axis: 'X', amount: -linearStep },
      ArrowRight: { axis: 'X', amount: linearStep },
      ArrowUp: { axis: 'Z', amount: linearStep },
      ArrowDown: { axis: 'Z', amount: -linearStep },
      q: { axis: 'theta1', amount: -rotaryStep },
      e: { axis: 'theta1', amount: rotaryStep },
      a: { axis: 'theta2', amount: -rotaryStep },
      d: { axis: 'theta2', amount: rotaryStep }
    };
    return map[normalized] || null;
  }

  function formatPosition(axis, value) {
    if (!Number.isFinite(value)) return 'N/A';
    return `${value.toFixed(3)} ${AXIS_META[axis].unit}`;
  }

  function formatSignedAmount(axis, amount) {
    const sign = amount > 0 ? '+' : '';
    if (AXIS_META[axis].rotary) return `${AXIS_META[axis].shortLabel} ${sign}${amount}°`;
    return `${axis}${sign}${amount}`;
  }

  function initializeApp(document) {
    const elements = {
      modeSelect: document.querySelector('#mode-select'),
      modeValue: document.querySelector('#mode-value'),
      statusValue: document.querySelector('#status-value'),
      statusLamp: document.querySelector('#status-lamp'),
      jogRows: document.querySelector('#jog-rows'),
      linearSpeed: document.querySelector('#linear-speed'),
      rotarySpeed: document.querySelector('#rotary-speed'),
      linearStep: document.querySelector('#linear-step'),
      rotaryStep: document.querySelector('#rotary-step'),
      home: document.querySelector('#home-button'),
      refresh: document.querySelector('#refresh-button'),
      emergency: document.querySelector('#emergency-button'),
      resetEmergency: document.querySelector('#reset-emergency-button'),
      log: document.querySelector('#event-log'),
      clearLog: document.querySelector('#clear-log')
    };

    let robot = null;
    let mode = CONFIG.mode;
    let busy = false;
    let emergency = false;

    function createRobot(selectedMode) {
      return selectedMode === 'mock'
        ? new global.MockRobot({ limits: CONFIG.limits, simulateDelay: true })
        : new global.MoonrakerRobot({ baseUrl: CONFIG.moonrakerUrl });
    }

    function log(message, level = 'info') {
      const line = document.createElement('div');
      line.className = `log-line log-${level}`;
      const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
      line.textContent = `[${time}] ${message}`;
      elements.log.append(line);
      elements.log.scrollTop = elements.log.scrollHeight;
    }

    function setStatus(status, message) {
      const labels = {
        ready: 'READY', busy: 'BUSY', disconnected: 'DISCONNECTED',
        error: 'ERROR', 'emergency-stop': 'EMERGENCY STOP'
      };
      elements.statusValue.textContent = labels[status] || String(status).toUpperCase();
      elements.statusValue.title = message || '';
      elements.statusLamp.dataset.status = status;
    }

    function setControls() {
      const blocked = busy || emergency;
      document.querySelectorAll('[data-motion-control]').forEach((control) => {
        control.disabled = blocked;
      });
      elements.refresh.disabled = busy;
      elements.modeSelect.disabled = busy;
      elements.resetEmergency.hidden = mode !== 'mock';
      elements.resetEmergency.disabled = !emergency || busy;
      elements.emergency.disabled = false;
    }

    function renderPosition(position) {
      Object.keys(AXIS_META).forEach((axis) => {
        const output = document.querySelector(`[data-position="${axis}"]`);
        const value = position[axis];
        output.textContent = formatPosition(axis, value);
        output.classList.toggle('position-na', !Number.isFinite(value));
      });
    }

    async function refreshPosition({ quiet = false } = {}) {
      try {
        renderPosition(await robot.getPosition());
        if (!quiet) log('Position refreshed');
      } catch (error) {
        if (!quiet) log(`Position refresh failed: ${error.message}`, 'error');
        throw error;
      }
    }

    function speedFor(axis) {
      return Number(AXIS_META[axis].rotary ? elements.rotarySpeed.value : elements.linearSpeed.value);
    }

    async function runMotion(action, requestMessage, completeMessage) {
      if (busy || emergency) {
        log(emergency ? 'Motion blocked: emergency stop is active' : 'Motion blocked: controller is busy', 'warn');
        return;
      }
      busy = true;
      setStatus('busy');
      setControls();
      log(requestMessage);
      try {
        await action();
        await refreshPosition({ quiet: true });
        if (!emergency) {
          setStatus('ready');
          log(completeMessage());
        }
      } catch (error) {
        if (!emergency) setStatus('error', error.message);
        log(error.message, 'error');
      } finally {
        busy = false;
        setControls();
      }
    }

    async function jog(axis, amount, source = 'Button') {
      const meta = AXIS_META[axis];
      const signed = `${amount > 0 ? '+' : ''}${amount}`;
      const unit = meta.rotary ? 'deg' : 'mm';
      await runMotion(
        () => robot.jog(axis, amount, speedFor(axis)),
        `${meta.label} ${signed} ${unit} requested (${source})`,
        () => {
          const value = document.querySelector(`[data-position="${axis}"]`).textContent;
          return `${meta.label} move complete → ${value}`;
        }
      );
    }

    function buildJogRows() {
      elements.jogRows.replaceChildren();
      Object.entries(JOG_LAYOUT).forEach(([axis, amounts]) => {
        const row = document.createElement('div');
        row.className = 'jog-row';
        row.dataset.axis = axis;

        const axisLabel = document.createElement('div');
        axisLabel.className = 'axis-label';
        axisLabel.innerHTML = `<strong>${AXIS_META[axis].label}</strong><small>${AXIS_META[axis].description}</small>`;
        row.append(axisLabel);

        const buttons = document.createElement('div');
        buttons.className = 'jog-buttons';
        amounts.forEach((amount, index) => {
          if (index === amounts.length / 2) {
            const divider = document.createElement('span');
            divider.className = 'jog-divider';
            divider.setAttribute('aria-hidden', 'true');
            buttons.append(divider);
          }
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `jog-button ${amount < 0 ? 'jog-negative' : 'jog-positive'}`;
          button.dataset.motionControl = '';
          button.dataset.axis = axis;
          button.dataset.amount = String(amount);
          button.textContent = formatSignedAmount(axis, amount);
          button.addEventListener('click', () => jog(axis, amount));
          buttons.append(button);
        });
        row.append(buttons);
        elements.jogRows.append(row);
      });
    }

    async function connect(selectedMode) {
      mode = selectedMode;
      emergency = false;
      robot = createRobot(mode);
      elements.modeValue.textContent = mode.toUpperCase();
      elements.modeSelect.value = mode;
      setStatus('disconnected');
      setControls();
      log(`Connecting in ${mode.toUpperCase()} mode…`);
      try {
        await robot.connect();
        setStatus(robot.getStatus());
        await refreshPosition({ quiet: true });
        log(mode === 'mock' ? 'Mock controller ready' : 'Moonraker connection ready');
      } catch (error) {
        setStatus(robot.getStatus(), error.message);
        renderPosition({ X: null, Z: null, theta1: null, theta2: null });
        log(`Connection failed: ${error.message}`, 'error');
      } finally {
        setControls();
      }
    }

    buildJogRows();
    elements.modeSelect.addEventListener('change', () => connect(elements.modeSelect.value));
    elements.home.addEventListener('click', () => runMotion(
      () => robot.home(),
      mode === 'mock' ? 'HOME / ZERO requested' : 'Linear X/Z homing requested',
      () => mode === 'mock' ? 'HOME / ZERO complete → all axes 0' : 'Linear X/Z homing complete'
    ));
    elements.refresh.addEventListener('click', () => refreshPosition().catch(() => {}));
    elements.emergency.addEventListener('click', async () => {
      log('EMERGENCY STOP requested', 'emergency');
      emergency = true;
      setStatus('emergency-stop');
      setControls();
      try {
        await robot.emergencyStop();
        log('EMERGENCY STOP active', 'emergency');
      } catch (error) {
        log(`Emergency stop request failed: ${error.message}`, 'error');
      }
    });
    elements.resetEmergency.addEventListener('click', async () => {
      try {
        await robot.resetEmergencyStop();
        emergency = false;
        setStatus('ready');
        setControls();
        log('Mock emergency stop reset', 'warn');
      } catch (error) {
        log(error.message, 'error');
      }
    });
    elements.clearLog.addEventListener('click', () => elements.log.replaceChildren());

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (event.repeat || target.matches('input, select, textarea, button') || target.isContentEditable) return;
      const command = getKeyboardJog(event.key, Number(elements.linearStep.value), Number(elements.rotaryStep.value));
      if (!command) return;
      event.preventDefault();
      jog(command.axis, command.amount, `Key ${event.key}`);
    });

    connect(CONFIG.mode);
    return { jog, connect, refreshPosition };
  }

  const exported = { CONFIG, JOG_LAYOUT, AXIS_META, getKeyboardJog, formatPosition, formatSignedAmount, initializeApp };
  Object.assign(global, exported);
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (global.document) global.document.addEventListener('DOMContentLoaded', () => initializeApp(global.document));
})(typeof window !== 'undefined' ? window : globalThis);
