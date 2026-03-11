import React from 'react';
import { act, cleanup, fireEvent, render, RenderResult, screen, waitFor } from '@testing-library/react';
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
  let currentRender: RenderResult | null = null;

  const renderComponent = async (expectedStatus: 'online' | 'offline' = 'online') => {
    await act(async () => {
      currentRender = render(<ActuatorControls />);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(expectedStatus === 'online' ? /esp32-a online/i : /esp32-a offline/i)).toBeInTheDocument();
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockFetchLatest.mockReset();
    mockSendControl.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      currentRender?.unmount();
      currentRender = null;
      jest.clearAllTimers();
      await Promise.resolve();
    });
    cleanup();
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

      await act(async () => {
        fireEvent.click(valve1Switch);
        await Promise.resolve();
      });

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

      await act(async () => {
        fireEvent.click(overrideCheckbox);
        await Promise.resolve();
      });

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

      await act(async () => {
        fireEvent.click(screen.getByRole('switch', { name: /pump \(layer 4 reservoir\)/i }));
        await Promise.resolve();
      });

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

      await act(async () => {
        fireEvent.click(valve1Switch);
        await Promise.resolve();
      });

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

  test('shows offline when backend deviceOnline is false even if stale nested actuator state says online', async () => {
    const staleTimestamp = '2026-03-10T20:19:45.152Z';

    mockFetchLatest.mockResolvedValue(buildLatestPayload({
      deviceOnline: false,
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
        ts: '2026-03-08T13:50:12.000Z',
        lastSeen: '2026-03-08T13:50:15.374Z',
        online: true,
        forcePumpOverride: false,
      },
    }));

    await renderComponent('offline');

    expect(screen.getByRole('checkbox', { name: /enable force pump override/i })).toBeEnabled();
  });

  test('keeps other valve controls interactive while one valve command is pending and preserves prior desired state', async () => {
    mockFetchLatest.mockResolvedValue(buildLatestPayload({
      deviceOnline: true,
      deviceState: {
        pump: false,
        valve1: false,
        valve2: false,
        valve3: false,
        float: 'NORMAL',
        float_state: 'NORMAL',
        requestId: null,
        source: 'applied',
        ts: new Date().toISOString(),
        forcePumpOverride: false,
      },
    }));

    mockSendControl
      .mockResolvedValueOnce({ requestId: 'req-valve1' } as any)
      .mockResolvedValueOnce({ requestId: 'req-valve2' } as any);

    await renderComponent();

    const valve1Switch = screen.getByRole('switch', { name: /layer 1 solenoid/i });
    const valve2Switch = screen.getByRole('switch', { name: /layer 2 solenoid/i });

      await act(async () => {
        fireEvent.click(valve1Switch);
        await Promise.resolve();
      });

    await waitFor(() => {
      expect(mockSendControl).toHaveBeenNthCalledWith(1, {
        pump: false,
        valve1: true,
        valve2: false,
        valve3: false,
        forcePumpOverride: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /layer 2 solenoid/i })).toBeEnabled();
    });

      await act(async () => {
        fireEvent.click(screen.getByRole('switch', { name: /layer 2 solenoid/i }));
        await Promise.resolve();
      });

    await waitFor(() => {
      expect(mockSendControl).toHaveBeenNthCalledWith(2, {
        pump: false,
        valve1: true,
        valve2: true,
        valve3: false,
        forcePumpOverride: false,
      });
    });
  });

  test('keeps override interactive while an actuator command is pending', async () => {
    mockFetchLatest.mockResolvedValue(buildLatestPayload({
      deviceOnline: true,
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
    }));

    mockSendControl
      .mockResolvedValueOnce({ requestId: 'req-valve1-pending' } as any)
      .mockResolvedValueOnce({ requestId: 'req-override-while-pending' } as any);

    await renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByRole('switch', { name: /layer 1 solenoid/i }));
        await Promise.resolve();
      });

    await waitFor(() => {
      expect(mockSendControl).toHaveBeenNthCalledWith(1, {
        pump: false,
        valve1: true,
        valve2: false,
        valve3: false,
        forcePumpOverride: false,
      });
    });

    const overrideCheckbox = screen.getByRole('checkbox', { name: /enable force pump override/i });
    expect(overrideCheckbox).toBeEnabled();

      await act(async () => {
        fireEvent.click(overrideCheckbox);
        await Promise.resolve();
      });

    await waitFor(() => {
      expect(mockSendControl).toHaveBeenNthCalledWith(2, {
        pump: false,
        valve1: true,
        valve2: false,
        valve3: false,
        forcePumpOverride: true,
      });
    });
  });
});