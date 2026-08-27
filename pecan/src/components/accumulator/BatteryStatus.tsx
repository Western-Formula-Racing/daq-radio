import { Zap, Battery, BatteryCharging } from 'lucide-react';
import { useSignal } from '../../lib/useDataStore';

// Assuming BMS_Status ID is 512 based on example.dbc
const BMS_STATUS_ID = "512";
const CURRENT_SIGNAL = "PackCurrent";

// Thresholds in Amps
const CHARGING_THRESHOLD = -0.5; // Negative current means charging (usually)
const DISCHARGING_THRESHOLD = 0.5; // Positive current means discharging

export function BatteryStatus() {
    const signal = useSignal(BMS_STATUS_ID, CURRENT_SIGNAL);
    const current = signal?.sensorReading ?? null;

    // Determine state
    let icon = <Battery className="w-6 h-6 text-text-muted" />;
    let label = "Static";
    let colorClass = "text-text-muted";

    if (current !== null) {
        if (current < CHARGING_THRESHOLD) {
            icon = <BatteryCharging className="w-6 h-6 animate-pulse" />;
            label = "Charging";
            colorClass = "text-chart-series-success";
        } else if (current > DISCHARGING_THRESHOLD) {
            icon = <Zap className="w-6 h-6" />;
            label = "Discharging";
            colorClass = "text-chart-series-warning";
        } else {
            // Static
            icon = <Battery className="w-6 h-6" />;
            label = "Standby";
            colorClass = "text-chart-series-secondary";
        }
    }

    return (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-option border border-border ${colorClass}`} title={`Current: ${current?.toFixed(1) ?? '--'} A`}>
            {icon}
            <span className="text-sm font-semibold uppercase tracking-wider">
                {label}
            </span>
            {current !== null && (
                <span className="text-xs text-text-muted ml-1 font-mono">
                    ({current.toFixed(1)} A)
                </span>
            )}
        </div>
    );
}
