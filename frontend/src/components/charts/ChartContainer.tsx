import React, { useState, useMemo } from 'react';
import { toDateTime } from '../../utils/date';
import { Calendar, Filter, TrendingUp, BarChart3 } from 'lucide-react';
import { SensorData } from '../../types';
import TemperatureChart from './TemperatureChart';
import MoistureChart from './MoistureChart';
import WaterLevelChart from './WaterLevelChart';
import MultiSensorChart from './MultiSensorChart';
import { useData } from '../../contexts/DataContext';

// Lightweight diagnostic banner so we can surface connection state next to charts.
const DebugInfo: React.FC = () => {
  const { lastFetchAt, isLoading, isConnected, latestTelemetry } = useData();
  const lastTimestamp = lastFetchAt || latestTelemetry?.timestamp || null;
  return (
    <div className="flex items-center space-x-3 text-xs">
      <span>{isLoading ? 'Fetching…' : isConnected ? 'Live telemetry' : 'Offline'}</span>
      {lastTimestamp ? <span className="opacity-80">{new Date(lastTimestamp).toLocaleTimeString()}</span> : null}
    </div>
  );
};

interface ChartContainerProps {
  data: SensorData[];
  title: string;
  deviceId?: string;
}

type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d';
type ChartType = 'temperature' | 'moisture' | 'waterLevel' | 'multi';

const ChartContainer: React.FC<ChartContainerProps> = ({ data, title, deviceId }) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [chartType, setChartType] = useState<ChartType>('multi');

  // Filter data based on time range
  const filteredData = useMemo(() => {
    const now = new Date();
    const ranges = {
      '1h': 1 * 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    const cutoff = new Date(now.getTime() - ranges[timeRange]);
    
    let filtered = data.filter(item => {
  const itemTime = toDateTime(item.timestamp);
      return itemTime >= cutoff;
    });

    // If filtering by device, apply that filter
    if (deviceId) {
      filtered = filtered.filter(item => item.deviceId === deviceId);
    }

    // Sort by timestamp
  return filtered.sort((a, b) => toDateTime(a.timestamp).getTime() - toDateTime(b.timestamp).getTime());
  }, [data, timeRange, deviceId]);

  const timeRangeOptions = [
    { value: '1h', label: '1 Hour' },
    { value: '6h', label: '6 Hours' },
    { value: '24h', label: '24 Hours' },
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
  ];

  const chartTypeOptions = [
    { value: 'multi', label: 'All Sensors', icon: BarChart3 },
    { value: 'temperature', label: 'External Temperature', icon: TrendingUp },
  { value: 'moisture', label: 'Moisture', icon: TrendingUp },
  { value: 'waterLevel', label: 'Water Level', icon: TrendingUp },
  ];

  const renderChart = () => {
    const chartHeight: number | string = '100%';

    switch (chartType) {
      case 'temperature':
        return <TemperatureChart data={filteredData} height={chartHeight} className="h-full" />;
      case 'moisture':
        return <MoistureChart data={filteredData} height={chartHeight} className="h-full" />;
      case 'waterLevel':
        return <WaterLevelChart data={filteredData} height={chartHeight} className="h-full" />;
      case 'multi':
      default:
        return <MultiSensorChart data={filteredData} height={chartHeight} className="h-full" />;
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-coffee-200 dark:border-gray-700 overflow-hidden flex flex-col h-full min-h-[260px]">
  {/* Header */}
  <div className="bg-gradient-to-r from-primary-600 to-secondary-500 text-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            {deviceId && (
              <p className="text-coffee-100 text-sm">Device: {deviceId}</p>
            )}
            <p className="text-coffee-200 text-sm">
              {filteredData.length} data points
            </p>

            {/* Debug info from DataContext (lightweight) */}
            <div className="text-coffee-100 text-xs mt-1">
              <DebugInfo />
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4" />
            <span className="text-sm">Last updated: {
              filteredData.length > 0 
                ? toDateTime(filteredData[filteredData.length - 1].timestamp).toLocaleTimeString()
                : 'No data'
            }</span>
          </div>
        </div>
      </div>

  {/* Controls */}
  <div className="bg-coffee-50 dark:bg-gray-800 p-4 border-b border-coffee-200 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          {/* Time Range Selector */}
      <div className="flex items-center space-x-2 w-full sm:w-auto">
            <Filter className="w-4 h-4 text-coffee-600" />
            <span className="text-sm font-medium text-coffee-700">Time Range:</span>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
    className="bg-white dark:bg-gray-700 border border-coffee-300 dark:border-gray-600 rounded-md px-3 py-1 text-sm text-coffee-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-coffee-500 min-w-[120px] sm:min-w-[160px] w-full sm:w-auto"
            >
              {timeRangeOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Chart Type Selector */}
          <div className="flex items-center space-x-4 w-full sm:w-auto">
            <BarChart3 className="w-4 h-4 text-coffee-600" />
            <span className="text-sm font-medium text-coffee-700">Chart Type:</span>

            {/* Vertical separator on desktop, horizontal on mobile */}
            <div className="hidden sm:block h-8 w-px bg-coffee-200 dark:bg-gray-700 mx-2" aria-hidden />
            <div className="block sm:hidden h-px w-full bg-coffee-200 dark:bg-gray-700 my-2" aria-hidden />

            {/* Buttons for tablet+ */}
            <div className="hidden sm:flex flex-wrap gap-2">
              {chartTypeOptions.map(option => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    onClick={() => setChartType(option.value as ChartType)}
                    className={`px-4 py-1 text-sm rounded-md transition-colors min-w-[110px] sm:min-w-[140px] whitespace-nowrap ${
                      chartType === option.value
                        ? 'bg-coffee-600 text-white'
                        : 'bg-white dark:bg-gray-700 text-coffee-600 dark:text-gray-200 hover:bg-coffee-100 dark:hover:bg-gray-700 border border-coffee-300 dark:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center space-x-1">
                      <Icon className="w-3 h-3" />
                      <span>{option.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Compact select for mobile */}
            <div className="flex sm:hidden w-full">
              <select
                aria-label="Chart Type"
                value={chartType}
                onChange={(e) => setChartType(e.target.value as ChartType)}
                className="w-full bg-white dark:bg-gray-700 border border-coffee-300 dark:border-gray-600 rounded-md px-3 py-1 text-sm text-coffee-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-coffee-500"
              >
                {chartTypeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

  {/* Chart */}
  <div className="p-4 flex-1 min-h-[160px]">
        {filteredData.length > 0 ? (
          renderChart()
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-coffee-500">
            <BarChart3 className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No data available in this range.</p>
            <p className="text-sm">Adjust the time window or verify sensor connectivity.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChartContainer;
