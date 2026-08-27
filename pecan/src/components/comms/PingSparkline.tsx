import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import type { TelemetrySample } from '../../lib/DataStore';
import { useThemeColors } from '../../theme/useThemeColors';

interface Props {
  history: TelemetrySample[];
  windowMs?: number;
}

export default function PingSparkline({ history, windowMs = 60_000 }: Props) {
  const { mutedText, border, surface, secondary, success, warning } = useThemeColors();

  const chartData = useMemo(() => {
    const now = Date.now();
    return history.map((s) => ({
      time: Math.round((s.timestamp - now) / 1000),
      rtt:
        s.data.rtt_ms?.sensorReading >= 0
          ? s.data.rtt_ms.sensorReading
          : null,
    }));
  }, [history]);

  const maxRtt = useMemo(() => {
    const vals = chartData
      .map((d) => d.rtt)
      .filter((v): v is number => v !== null);
    return Math.max(100, ...vals);
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <div className="h-16 flex items-center justify-center text-xs text-sidebarfg/50">
        Waiting for ping data...
      </div>
    );
  }

  return (
    <div className="h-16">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 2, right: 4, left: 4, bottom: 2 }}
        >
          <XAxis
            dataKey="time"
            type="number"
            domain={[-(windowMs / 1000), 0]}
            tick={{ fill: mutedText, fontSize: 9 }}
            tickFormatter={(v) => `${v}s`}
            axisLine={{ stroke: border }}
            tickLine={false}
            ticks={[-60, -45, -30, -15, 0]}
          />
          <YAxis
            domain={[0, maxRtt]}
            tick={{ fill: mutedText, fontSize: 9 }}
            tickFormatter={(v) => `${v}`}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: surface,
              border: `1px solid ${border}`,
              borderRadius: '4px',
              fontSize: '10px',
            }}
            labelStyle={{ color: mutedText }}
            formatter={(v: number | undefined) => [`${v != null ? v.toFixed(1) : '--'} ms`, 'RTT']}
            labelFormatter={(v) => `${v}s ago`}
          />
          <ReferenceLine
            y={20}
            stroke={success}
            strokeDasharray="2 4"
            strokeOpacity={0.4}
          />
          <ReferenceLine
            y={80}
            stroke={warning}
            strokeDasharray="2 4"
            strokeOpacity={0.4}
          />
          <Line
            type="monotone"
            dataKey="rtt"
            stroke={secondary}
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
