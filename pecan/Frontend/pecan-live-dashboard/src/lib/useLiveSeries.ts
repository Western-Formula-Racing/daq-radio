import { useMemo } from 'react';
import { useMessageHistory, useLatestMessage } from './useDataStore';

interface LiveSeriesResult {
  x: (number | Date)[];
  y: number[];
  unit: string;
  latestTimestamp: number | null;
}

/**
 * Small helper hook that prepares Plotly-friendly arrays for a single
 * CAN message + signal over a rolling window.
 */
export function useLiveSeries(
  msgID: string | undefined,
  signalName: string | undefined,
  windowMs: number = 60000
): LiveSeriesResult {
  const history = useMessageHistory(msgID ?? '', windowMs);
  const latest = useLatestMessage(msgID ?? '');

  return useMemo(() => {
    if (!msgID || !signalName) {
      return { x: [], y: [], unit: '', latestTimestamp: null };
    }

    const points = history
      .filter((sample) => sample.data?.[signalName])
      .map((sample) => ({
        time: new Date(sample.timestamp),
        value: sample.data[signalName].sensorReading,
        unit: sample.data[signalName].unit ?? '',
      }));

    const latestTimestamp =
      points.length > 0 ? points[points.length - 1].time.getTime() : null;

    return {
      x: points.map((p) => p.time),
      y: points.map((p) => p.value),
      unit: points[points.length - 1]?.unit ?? (latest?.data?.[signalName]?.unit ?? ''),
      latestTimestamp,
    };
  }, [history, latest, msgID, signalName]);
}
