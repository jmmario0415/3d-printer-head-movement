(function (global) {
  'use strict';
  // Logical UI names only. No machine-specific values are inferred here.
  const COMMISSIONING = {
    heaters: [{ id: 'tool0', label: 'Tool 0 · Nozzle' }, { id: 'bed', label: 'Bed' }],
    fans: [{ id: 'fan1', label: 'Fan 1' }, { id: 'fan2', label: 'Fan 2' }],
    macros: [
      { id: 'homing', label: '01-Test_IR_PD_Homing', description: 'Homing / zero test. Mock: zero all four axes.' },
      { id: 'fans', label: '02-Test_Fans', description: 'Mock: run each fan at 50%, then turn it off.' },
      { id: 'heaters', label: '03-Test_Heaters', description: 'Mock: heat Tool 0 / Bed to 45°C, then turn them off.' },
      { id: 'motors', label: '04-Test_motors', description: 'Mock: move each axis a small step and return. No stall detection.' }
    ]
  };
  // Fill ONLY from the verified printer.cfg. See README.md for the schema.
  // Empty mappings intentionally disable real heater/fan/macro controls.

  // 이 부분에 실제 연결 값 매핑
  const MOONRAKER_CONFIG = { heaters: {}, fans: {}, macros: {}, linearHomingVerified: false };
  Object.assign(global, { COMMISSIONING, MOONRAKER_CONFIG });
  if (typeof module !== 'undefined' && module.exports) module.exports = { COMMISSIONING, MOONRAKER_CONFIG };
})(typeof window !== 'undefined' ? window : globalThis);
