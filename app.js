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
    let connected = false;
    let connecting = false;
    let stopping = false;
    let panel = null;
    let stopState = null;
    let positionUpdated = null;
    let positionStale = true;
    let readingGeneration = 0;
    let controllerKey = 'mock';
    const uncertainCommands = new Map();
    const connectionState = document.querySelector('#connection-state');
    const positionTime = document.querySelector('#position-updated');
    const operationDetail = document.querySelector('#operation-detail');
    const acknowledge = document.querySelector('#acknowledge-outcome');
    const urlInput = document.querySelector('#moonraker-url');
    const connectButton = document.querySelector('#connect-button');

    function createRobot(selectedMode) {
      return selectedMode === 'mock'
        ? new global.MockRobot({ limits: CONFIG.limits, simulateDelay: true })
        : new global.MoonrakerRobot({ baseUrl: urlInput.value.trim(), config: global.MOONRAKER_CONFIG });
    }

    function log(message, level = 'info') {
      const line = document.createElement('div');
      line.className = `log-line log-${level}`;
      const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
      line.textContent = `[${time}] ${message}`;
      elements.log.append(line);
      while (elements.log.children.length > 500) elements.log.firstElementChild.remove();
      elements.log.scrollTop = elements.log.scrollHeight;
    }

    function setStatus(status, message) {
      const labels = {
        ready: 'READY', busy: 'BUSY', disconnected: 'DISCONNECTED',
        error: 'ERROR', 'emergency-stop': 'EMERGENCY STOP',
        'stop-pending': 'STOP REQUESTING', 'stop-acknowledged': 'STOP ACKNOWLEDGED',
        'stop-unconfirmed': 'STOP UNCONFIRMED', 'outcome-unknown': 'OUTCOME UNKNOWN'
      };
      if (emergency && stopState) status = stopState;
      else if (uncertainCommands.has(controllerKey)) status = 'outcome-unknown';
      elements.statusValue.textContent = labels[status] || String(status).toUpperCase();
      elements.statusValue.title = message || '';
      elements.statusLamp.dataset.status = status;
    }

    function setControls() {
      const uncertain = uncertainCommands.has(controllerKey);
      const blocked = busy || emergency || connecting || !connected || uncertain;
      connectionState.textContent = connecting ? 'CONNECTING' : connected ? 'CONNECTED' : 'DISCONNECTED';
      acknowledge.hidden = !uncertain;
      acknowledge.disabled = !connected || busy || connecting || emergency || stopping;
      document.querySelectorAll('[data-motion-control]').forEach((control) => {
        control.disabled = blocked || (mode === 'moonraker' && (control.dataset.axis?.startsWith('theta') ||
          (control === elements.home && !global.MOONRAKER_CONFIG.linearHomingVerified)));
      });
      document.querySelectorAll('[data-device-control]').forEach((control) => {
        control.disabled = blocked || control.dataset.unavailable === 'true';
      });
      elements.refresh.disabled = busy || connecting || !connected;
      elements.modeSelect.disabled = busy || connecting || stopping;
      connectButton.disabled = busy || connecting || stopping;
      urlInput.disabled = mode !== 'moonraker' || busy || connecting || stopping;
      elements.resetEmergency.hidden = mode !== 'mock';
      elements.resetEmergency.disabled = !emergency || busy || connecting || stopping;
      elements.emergency.disabled = false;
    }

    function showPositionAge() {
      const age = positionUpdated === null ? null : Math.floor((Date.now() - positionUpdated) / 1000);
      const stale = positionStale || age > 5;
      positionTime.dataset.stale = String(stale);
      positionTime.textContent = age === null ? 'No sample' :
        `${new Date(positionUpdated).toLocaleTimeString()} · ${age}s ago${stale ? ' · STALE' : ' · snapshot'}`;
    }

    function invalidateReadings() {
      readingGeneration++;
      connected = false;
      positionStale = true;
      panel?.invalidate();
      renderPosition({ X: null, Z: null, theta1: null, theta2: null });
      showPositionAge();
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
      const requestRobot = robot;
      const ownGeneration = readingGeneration;
      try {
        const position = await requestRobot.getPosition();
        if (requestRobot !== robot || ownGeneration !== readingGeneration) return;
        renderPosition(position);
        positionUpdated = Date.now(); positionStale = false; showPositionAge();
        if (!quiet) log('Position refreshed');
      } catch (error) {
        if (requestRobot !== robot || ownGeneration !== readingGeneration) return;
        if (robot.getStatus() === 'disconnected') {
          invalidateReadings();
          if (!emergency) setStatus('disconnected', error.message);
          setControls();
        }
        if (!quiet) log(`Position refresh failed: ${error.message}`, 'error');
        throw error;
      }
    }

    function speedFor(axis) {
      return Number(AXIS_META[axis].rotary ? elements.rotarySpeed.value : elements.linearSpeed.value);
    }

    async function runMotion(action, requestMessage, completeMessage) {
      if (busy || emergency || connecting || !connected || uncertainCommands.has(controllerKey)) {
        log(emergency ? 'Control blocked: emergency stop is active' : 'Control blocked: busy or disconnected', 'warn');
        return;
      }
      busy = true;
      setStatus('busy');
      setControls();
      log(requestMessage);
      operationDetail.textContent = requestMessage;
      operationDetail.dataset.warning = 'false';
      try {
        await action();
        await refreshPosition({ quiet: true });
        if (!emergency && connected) {
          setStatus('ready');
          log(completeMessage());
          operationDetail.textContent = completeMessage();
        }
      } catch (error) {
        if (robot.getStatus() === 'disconnected') {
          invalidateReadings();
        }
        if (error.outcomeUnknown) {
          const message = `${requestMessage}: execution outcome unknown. Not retried. Reconnect, inspect controller state, then unlock.`;
          uncertainCommands.set(controllerKey, message);
          if (!emergency) {
            operationDetail.textContent = message;
            operationDetail.dataset.warning = 'true';
          }
          log(message, 'warn');
        } else if (!emergency) operationDetail.textContent = error.message;
        if (!emergency) setStatus('error', error.message);
        log(error.message, 'error');
      } finally {
        busy = false;
        setControls();
      }
    }

    async function jog(axis, amount, source = 'Button') {
      if (mode === 'moonraker' && axis.startsWith('theta')) {
        log(`${AXIS_META[axis].label} Moonraker control is not configured yet.`, 'warn');
        return;
      }
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
      if (busy || connecting || stopping) return;
      connecting = true;
      readingGeneration++;
      connected = false;
      panel?.stop();
      mode = selectedMode;
      emergency = false;
      stopState = null;
      positionUpdated = null; positionStale = true; showPositionAge();
      renderPosition({ X: null, Z: null, theta1: null, theta2: null });
      controllerKey = mode === 'mock' ? 'mock' : urlInput.value.trim().replace(/\/$/, '');
      operationDetail.textContent = uncertainCommands.get(controllerKey) || 'No command pending';
      operationDetail.dataset.warning = String(uncertainCommands.has(controllerKey));
      robot = createRobot(mode);
      elements.modeValue.textContent = mode.toUpperCase();
      elements.modeSelect.value = mode;
      document.querySelector('#source-note').textContent = mode === 'mock' ? 'MOCK · simulated devices only' : 'MOONRAKER · real hardware control';
      setStatus('disconnected');
      setControls();
      log(`Connecting in ${mode.toUpperCase()} mode…`);
      try {
        if (mode === 'moonraker') {
          const url = new URL(urlInput.value.trim());
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new Error('Enter an HTTP(S) Moonraker base URL without credentials, query or fragment.');
          }
        }
        await robot.connect();
        if (emergency) throw new Error('Connection interrupted by emergency stop.');
        if (robot.getStatus() !== 'ready') throw new Error(`Controller is ${robot.getStatus()}; reconnect when ready.`);
        await refreshPosition({ quiet: true });
        await panel.bind(robot, mode);
        if (emergency) throw new Error('Connection interrupted by emergency stop.');
        connected = true;
        setStatus('ready');
        log(mode === 'mock' ? 'Mock controller ready' : 'Moonraker connection ready');
      } catch (error) {
        panel?.stop();
        if (!emergency) setStatus('disconnected', error.message);
        renderPosition({ X: null, Z: null, theta1: null, theta2: null });
        log(`Connection failed: ${error.message}`, 'error');
      } finally {
        connecting = false;
        setControls();
      }
    }

    buildJogRows();
    panel = global.initializeCommissioning(document, {
      run: runMotion, log, controls: setControls,
      fault(error) {
        invalidateReadings();
        if (!emergency) setStatus('disconnected', error.message);
        setControls(); log(`Telemetry failed: ${error.message}`, 'error');
      }
    });
    acknowledge.addEventListener('click', () => {
      if (!connected || busy || connecting || emergency || stopping) return;
      uncertainCommands.delete(controllerKey);
      operationDetail.textContent = 'Operator acknowledged controller state check; previous command was not replayed.';
      operationDetail.dataset.warning = 'false';
      log(operationDetail.textContent, 'warn');
      setStatus('ready'); setControls();
    });
    connectButton.addEventListener('click', () => connect(elements.modeSelect.value));
    elements.modeSelect.addEventListener('change', () => connect(elements.modeSelect.value));
    elements.home.addEventListener('click', () => runMotion(
      () => {
        if (mode === 'moonraker' && !global.MOONRAKER_CONFIG.linearHomingVerified) throw new Error('Linear homing is not verified in commissioning-config.js.');
        return robot.home();
      },
      mode === 'mock' ? 'HOME / ZERO requested' : 'Linear X/Z homing requested',
      () => mode === 'mock' ? 'HOME / ZERO complete → all axes 0' : 'Linear X/Z homing complete'
    ));
    elements.refresh.addEventListener('click', () => refreshPosition().catch(() => {}));
    elements.emergency.addEventListener('click', async () => {
      if (stopping || !robot) return;
      stopping = true;
      log('EMERGENCY STOP requested', 'emergency');
      emergency = true;
      stopState = 'stop-pending';
      operationDetail.textContent = 'Emergency stop request in progress; stop is not yet confirmed.';
      operationDetail.dataset.warning = 'true';
      setStatus(stopState);
      setControls();
      try {
        await robot.emergencyStop();
        stopState = mode === 'mock' ? 'emergency-stop' : 'stop-acknowledged';
        operationDetail.textContent = mode === 'mock' ? 'Mock emergency stop active.' : 'Server acknowledged stop request. Physical stop has not been independently verified.';
        setStatus(stopState);
        log(operationDetail.textContent, 'emergency');
      } catch (error) {
        stopState = 'stop-unconfirmed';
        invalidateReadings();
        operationDetail.textContent = 'Stop request failed · actual stop unconfirmed. Controls remain locked; check the machine.';
        setStatus(stopState);
        log(`Emergency stop request failed: ${error.message}`, 'error');
      } finally {
        stopping = false;
        setControls();
      }
    });
    elements.resetEmergency.addEventListener('click', async () => {
      if (mode !== 'mock' || busy || connecting || stopping || !emergency) return;
      busy = true;
      setControls();
      try {
        await robot.resetEmergencyStop();
        emergency = false;
        stopState = null;
        if (!panel.isBound()) await panel.bind(robot, mode);
        else await panel.refresh();
        await refreshPosition({ quiet: true });
        connected = true;
        setStatus('ready');
        operationDetail.textContent = 'Mock emergency stop reset'; operationDetail.dataset.warning = 'false';
        log('Mock emergency stop reset', 'warn');
      } catch (error) {
        log(error.message, 'error');
      } finally {
        busy = false;
        setControls();
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
    const ageTimer = setInterval(showPositionAge, 1000);
    global.addEventListener?.('pagehide', () => { clearInterval(ageTimer); panel.stop(); }, { once: true });
    return { jog, connect, refreshPosition };
  }

  const exported = { CONFIG, JOG_LAYOUT, AXIS_META, getKeyboardJog, formatPosition, formatSignedAmount, initializeApp };
  Object.assign(global, exported);
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (global.document) global.document.addEventListener('DOMContentLoaded', () => initializeApp(global.document));
})(typeof window !== 'undefined' ? window : globalThis);
