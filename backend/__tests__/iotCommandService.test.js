jest.mock('../models', () => ({
  ActuatorState: {
    findOne: jest.fn(),
  },
  PendingCommand: {
    findOne: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  AuditLog: {
    create: jest.fn(),
  },
}));

jest.mock('../models/Device', () => ({
  findOne: jest.fn(),
}));

jest.mock('../models/SensorSnapshot', () => ({
  findOne: jest.fn(),
}));

jest.mock('../services/iotMqtt', () => ({
  publishCommand: jest.fn(),
}));

jest.mock('../services/actuatorSafetyService', () => ({
  evaluatePumpSafety: jest.fn(),
}));

const { ActuatorState, PendingCommand } = require('../models');
const Device = require('../models/Device');
const SensorSnapshot = require('../models/SensorSnapshot');
const { publishCommand } = require('../services/iotMqtt');
const { evaluatePumpSafety } = require('../services/actuatorSafetyService');
const { createCommand } = require('../services/iotCommandService');

describe('iotCommandService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PendingCommand.findOne.mockResolvedValue(null);
    PendingCommand.update.mockResolvedValue([0]);
    PendingCommand.create.mockResolvedValue({});
    ActuatorState.findOne.mockResolvedValue(null);
    SensorSnapshot.findOne.mockResolvedValue(null);
    evaluatePumpSafety.mockResolvedValue({ allowed: true, floatState: null });
    publishCommand.mockImplementation(() => {});
  });

  test('accepts command when device row is stale but fresh telemetry exists', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    Device.findOne.mockResolvedValue({
      online: false,
      status: 'offline',
      lastHeartbeat: null,
      lastSeen: null,
      update,
    });
    SensorSnapshot.findOne.mockResolvedValue({
      timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await createCommand({
      deviceId: 'esp32A',
      desiredState: {
        pump: false,
        valve1: true,
        valve2: false,
        valve3: false,
        forcePumpOverride: false,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(PendingCommand.create).toHaveBeenCalledTimes(1);
    expect(publishCommand).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'online',
      online: true,
    }));
  });
});