jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../models', () => ({
  SensorData: {},
  SensorSnapshot: {},
  ActuatorState: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
  PendingCommand: {
    findOne: jest.fn(),
    update: jest.fn(),
  },
  Alert: {
    createAlert: jest.fn(),
  },
  ActuatorLog: {
    create: jest.fn(),
  },
}));

jest.mock('../models/Device', () => ({
  findOne: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../utils/realtime', () => ({
  REALTIME_EVENTS: {
    ACTUATOR_UPDATE: 'actuator:update',
    ALERT_NEW: 'alert:new',
  },
  emitRealtime: jest.fn(),
}));

jest.mock('../utils/sensorEvents', () => ({
  broadcastSensorData: jest.fn(),
  checkThresholds: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/sensorLogService', () => ({
  recordSnapshot: jest.fn(),
}));

jest.mock('../services/alertService', () => ({
  createWaterReservoirLowAlert: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/deviceManager', () => ({
  markDeviceOnline: jest.fn().mockResolvedValue(undefined),
}));

const { ActuatorState, PendingCommand, Alert } = require('../models');
const { __testHooks } = require('../services/iotMqtt');

describe('iotMqtt state acknowledgements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Alert.createAlert.mockResolvedValue(null);
    ActuatorState.findOne.mockResolvedValue(null);
    ActuatorState.create.mockResolvedValue({});
    PendingCommand.findOne.mockResolvedValue(null);
  });

  test('marks override command mismatch when safety override remains active', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    PendingCommand.findOne.mockResolvedValue({
      desiredState: {
        pump: false,
        valve1: false,
        valve2: false,
        valve3: false,
        forcePumpOverride: true,
      },
      update,
    });

    await __testHooks.handleStateMessage({
      deviceId: 'esp32A',
      requestId: 'req-force-on',
      pump: false,
      valve1: false,
      valve2: false,
      valve3: false,
      float: 'LOW',
      source: 'safety_override',
      forcePumpOverride: false,
    }, 'vermilinks/esp32a/state');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'mismatch',
      error: 'Device state mismatch',
      responseState: expect.objectContaining({
        forcePumpOverride: false,
        source: 'safety_override',
      }),
    }));
  });

  test('acknowledges override command when normalized state confirms forcePumpOverride', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    PendingCommand.findOne.mockResolvedValue({
      desiredState: {
        pump: true,
        valve1: false,
        valve2: false,
        valve3: false,
        forcePumpOverride: true,
      },
      update,
    });

    await __testHooks.handleStateMessage({
      deviceId: 'esp32A',
      requestId: 'req-force-confirmed',
      pump: true,
      valve1: false,
      valve2: false,
      valve3: false,
      float: 'LOW',
      source: 'forced_manual_override',
      forcePumpOverride: true,
    }, 'vermilinks/esp32a/state');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'acknowledged',
      error: null,
      responseState: expect.objectContaining({
        forcePumpOverride: true,
        pump: true,
        source: 'forced_manual_override',
      }),
    }));
  });
});