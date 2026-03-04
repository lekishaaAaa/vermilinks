import React from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { SensorData } from '../../types';

interface MultiSensorChartProps {
  data: SensorData[];
  height?: number | string;
  className?: string;
  showLegend?: boolean;
}

const MultiSensorChart: React.FC<MultiSensorChartProps> = ({ 
  data, 
  height = '100%',
  className,
  showLegend = true
}) => {
  // detect dark mode via root html class, fallback to match-media
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
      const data = payload[0].payload || {};
      return (
        <div className={`${isDark ? 'bg-gray-800 text-gray-100 border-gray-700' : 'bg-white text-coffee-900 border-coffee-200'} p-4 rounded-lg shadow-lg border`}>
          <p className="font-medium">{formatTooltipTime(label || '')}</p>
          <div className="space-y-1">
            <p>
              <span className="font-medium">External Temperature:</span> {data.temperature.toFixed(1)}°C
            </p>
            <p>
              <span className="font-medium">Humidity:</span> {data.humidity.toFixed(1)}%
            </p>
            <p>
              <span className="font-medium">Moisture:</span> {data.moisture.toFixed(1)}%
            </p>
          </div>
          <p className="text-sm mt-2">Device: {data.deviceId || 'unknown'}</p>
        </div>
      );
    }
    return null;
  };

  // Normalize data for better visualization (scale temperature for comparison)
  const normalizedData = data.map(item => ({
    ...item,
    scaledTemperature: (item.temperature ?? 0) * 2.5, // Scale temperature to be visible alongside humidity/moisture
  }));

  return (
    <div className={`w-full ${className || ''}`}>
      <ResponsiveContainer width="100%" height={height as any}>
        <ComposedChart data={normalizedData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1f2937' : '#cfeef5'} opacity={0.3} />
            <XAxis 
              dataKey="timestamp" 
              tickFormatter={formatTime}
              stroke={isDark ? '#9ca3af' : '#6b7280'}
              fontSize={12}
            />
            <YAxis 
              yAxisId="left"
              stroke={isDark ? '#9ca3af' : '#6b7280'}
              fontSize={12}
              domain={[0, 100]}
            />
            <YAxis 
              yAxisId="right"
              orientation="right"
              stroke={isDark ? '#9ca3af' : '#6b7280'}
              fontSize={12}
              domain={[0, 100]}
            />
            <Tooltip content={<CustomTooltip />} />
            {showLegend && (
              <Legend 
                iconType="line"
                wrapperStyle={{ paddingTop: '10px', color: isDark ? '#d1d5db' : undefined }}
              />
            )}
          
          {/* Humidity as bars */}
          <Bar 
            yAxisId="left"
            dataKey="humidity" 
            fill={isDark ? '#03A9F4' : '#60A5FA'} 
            fillOpacity={0.6}
            name="Humidity (%)"
          />
          
          {/* Moisture as bars */}
          <Bar 
            yAxisId="left"
            dataKey="moisture" 
            fill={isDark ? '#00BFA6' : '#34D399'} 
            fillOpacity={0.6}
            name="Moisture (%)"
          />
          
          {/* Temperature as line (scaled) */}
          <Line 
            yAxisId="right"
            type="monotone" 
            dataKey="scaledTemperature" 
            stroke={isDark ? '#8E44AD' : '#7C3AED'} 
            strokeWidth={3}
            dot={{ fill: isDark ? '#8E44AD' : '#7C3AED', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, fill: isDark ? '#8E44AD' : '#7C3AED' }}
            name="External Temperature (°C × 2.5)"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default MultiSensorChart;
