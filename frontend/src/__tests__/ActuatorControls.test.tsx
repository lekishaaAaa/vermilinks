import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ActuatorControls from '../components/ActuatorControls';
import { fetchLatest, sendControl } from '../services/iotControl';

jest.mock('../services/iotControl', () => ({
  fetchLatest: jest.fn(),
  sendControl: jest.fn(),
}));

const mockFetchLatest = fetchLatest as jest.MockedFunction<typeof fetchLatest>;
const mockSendControl = sendControl as jest.MockedFunction<typeof sendControl>;

const buildLatestPayload = (overrides?: Partial<Awaited<ReturnType<typeof fetchLatest>>>) => ({
  telemetry: null,
  pendingCommand: null,
  deviceOnline: true,
  lastSeen: new Date().toISOString(),
  lastHeartbeat: new Date().toISOString(),
  deviceState: {
    pump: false,
    valve1: false,
    valve2: false,
    valve3: false,
    float: 'LOW',
    float_state: 'LOW',
    requestId: null,
    source: 'safety_override',
    ts: new Date().toISOString(),
    forcePumpOverride: false,
  },
  ...overrides,
});

describe('ActuatorControls', () => {
  const renderComponent = async () => {
    await act(async () => {
      render(<ActuatorControls />);
    });

    await waitFor(() => {
      expect(screen.getByText(/esp32-a online/i)).toBeInTheDocument();
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetchLatest.mockReset();
    mockSendControl.mockReset();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('keeps override and valves interactive while float is LOW', async () => {
    mockFetchLatest.mockResolvedValue(buildLatestPayload());
    mockSendControl.mockResolvedValue({ requestId: 'req-valve' } as any);

    await renderComponent();

    const overrideCheckbox = screen.getByRole('checkbox', { name: /enable force pump override/i });
    const pumpSwitch = screen.getByRole('switch', { name: /pump \(layer 4 reservoir\)/i });
    const valve1Switch = screen.getByRole('switch', { name: /layer 1 solenoid/i });

    expect(overrideCheckbox).toBeEnabled();
    expect(pumpSwitch).toBeDisabled();
    await waitFor(() => {
      expect(valve1Switch).toBeEnabled();
    });

    fireEvent.click(valve1Switch);

    await waitFor(() => {
      expect(mockSendControl).toHaveBeenCalledWith({
        pump: false,
        valve1: true,
        valve2: false,
        valve3: false,
        forcePumpOverride: false,
      });
    });
  });

  test('enabling override unlocks the pump while float is LOW', async () => {
    mockFetchLatest
      .mockResolvedValueOnce(buildLatestPayload())
      .mockResolvedValueOnce(buildLatestPayload({
        deviceState: {
          pump: false,
          valve1: false,
          valve2: false,
          valve3: false,
          float: 'LOW',
          float_state: 'LOW',
          requestId: 'req-override',
          source: 'forced_manual_override',
          ts: new Date().toISOString(),
          forcePumpOverride: true,
        },
      }));

    mockSendControl
      .mockResolvedValueOnce({ requestId: 'req-override' } as any)
      .mockResolvedValueOnce({ requestId: 'req-pump' } as any);

    await renderComponent();

    const overrideCheckbox = screen.getByRole('checkbox', { name: /enable force pump override/i });
    const pumpSwitch = screen.getByRole('switch', { name: /pump \(layer 4 reservoir\)/i });

    expect(overrideCheckbox).toBeEnabled();
    expect(pumpSwitch).toBeDisabled();

    fireEvent.click(overrideCheckbox);

    await waitFor(() => {
      expect(mockSendControl).toHaveBeenCalledWith({
        pump: false,
        valve1: false,
        valve2: false,
        valve3: false,
        forcePumpOverride: true,
      });
    });

    await act(async () => {
      jest.advanceTimersByTime(2100);
    });

    await waitFor(() => {
      expect(mockFetchLatest).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /pump \(layer 4 reservoir\)/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('switch', { name: /pump \(layer 4 reservoir\)/i }));

    await waitFor(() => {
      expect(mockSendControl).toHaveBeenLastCalledWith({
        pump: true,
        valve1: false,
        valve2: false,
        valve3: false,
        forcePumpOverride: true,
      });
    });
  });

  test('keeps actuator controls online when top-level telemetry is stale but deviceState is fresh', async () => {
    const staleTimestamp = '2026-03-10T17:51:30.867Z';
    const freshTimestamp = new Date().toISOString();

    mockFetchLatest.mockResolvedValue(buildLatestPayload({
      deviceOnline: true,
      lastSeen: staleTimestamp,
      lastHeartbeat: staleTimestamp,
      deviceState: {
        pump: false,
        valve1: false,
        valve2: false,
        valve3: false,
        float: 'LOW',
        float_state: 'LOW',
        requestId: null,
        source: 'safety_override',
        ts: freshTimestamp,
        lastSeen: freshTimestamp,
        online: true,
        forcePumpOverride: false,
      },
    }));
    mockSendControl.mockResolvedValue({ requestId: 'req-valve-fresh' } as any);

    await renderComponent();

    expect(screen.getByText(/esp32-a online/i)).toBeInTheDocument();
    const overrideCheckbox = screen.getByRole('checkbox', { name: /enable force pump override/i });
    const valve1Switch = screen.getByRole('switch', { name: /layer 1 solenoid/i });

    expect(overrideCheckbox).toBeEnabled();
    expect(valve1Switch).toBeEnabled();

    fireEvent.click(valve1Switch);

    await waitFor(() => {
      expect(mockSendControl).toHaveBeenCalledWith({
        pump: false,
        valve1: true,
        valve2: false,
        valve3: false,
        forcePumpOverride: false,
      });
    });
  });
});