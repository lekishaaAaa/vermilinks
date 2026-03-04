import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';
import { SensorData } from '../../types';

interface TemperatureChartProps {
  data: SensorData[];
  warningThreshold?: number;
  criticalThreshold?: number;
  /** number in px or percent string like '100%' to fill parent */
  height?: number | string;
  className?: string;
}

const TemperatureChart: React.FC<TemperatureChartProps> = ({ 
  data, 
  warningThreshold = 35, 
  criticalThreshold = 40,
  height = '100%',
  className
}) => {
  const isDark = typeof window !== 'undefined' && (document.documentElement.classList.contains('dark') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
  const formatTime = (timestamp: string) => {
    try {
      return format(new Date(timestamp), 'HH:mm');
    } catch {
      return timestamp;
    }
  };

  const formatTooltipTime = (timestamp: string) => {
    try {
      return format(new Date(timestamp), 'MMM dd, HH:mm:ss');
    } catch {
      return timestamp;
    }
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className={`${isDark ? 'bg-gray-800 text-gray-100 border-gray-700' : 'bg-white text-coffee-900 border-coffee-200'} p-4 rounded-lg shadow-lg border`}>
          <p className="font-medium">{formatTooltipTime(label)}</p>
          <p>
            <span className="font-medium">External Temperature:</span> {data.temperature.toFixed(1)}°C
          </p>
          <p className="text-sm">Device: {data.deviceId}</p>
          <div className="flex items-center mt-2">
            <div className={`w-2 h-2 rounded-full mr-2 ${
              data.temperature >= criticalThreshold ? 'bg-red-500' :
              data.temperature >= warningThreshold ? 'bg-[#03A9F4]' : 'bg-green-500'
            }`}></div>
            <span className="text-sm">
              {data.temperature >= criticalThreshold ? 'Critical' :
               data.temperature >= warningThreshold ? 'Warning' : 'Normal'}
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`w-full ${className || ''}`}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1f2937' : '#cfeef5'} opacity={0.3} />
          <XAxis 
            dataKey="timestamp" 
            tickFormatter={formatTime}
            stroke={isDark ? '#9ca3af' : '#6b7280'}
            fontSize={12}
          />
          <YAxis 
            stroke={isDark ? '#9ca3af' : '#6b7280'}
            fontSize={12}
            domain={['dataMin - 2', 'dataMax + 2']}
          />
          <Tooltip content={<CustomTooltip />} />
          
          {/* Warning threshold line */}
          <ReferenceLine 
            y={warningThreshold} 
            stroke="#03A9F4" 
            strokeDasharray="5 5" 
            strokeWidth={2}
            label={{ value: `Warning (${warningThreshold}°C)`, position: "right" }}
          />
          
          {/* Critical threshold line */}
          <ReferenceLine 
            y={criticalThreshold} 
            stroke="#ef4444" 
            strokeDasharray="5 5" 
            strokeWidth={2}
            label={{ value: `Critical (${criticalThreshold}°C)`, position: "right" }}
          />
          
          <Line 
            type="monotone" 
            dataKey="temperature" 
            stroke={isDark ? '#8E44AD' : '#7C3AED'} 
            strokeWidth={3}
            dot={{ fill: isDark ? '#8E44AD' : '#7C3AED', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, fill: isDark ? '#8E44AD' : '#7C3AED' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TemperatureChart;
