import { SegmentedControl } from '../../ui/SegmentedControl';
import { describeCron, CRON_EXAMPLES } from '../../utils/cron';

export interface ScheduleTriggerPanelProps {
    mode: 'interval' | 'cron';
    onModeChange: (m: 'interval' | 'cron') => void;
    intervalValue: string;
    onIntervalValueChange: (v: string) => void;
    intervalUnit: string;
    onIntervalUnitChange: (u: string) => void;
    cron: string;
    onCronChange: (c: string) => void;
    onFailure: string;
    onFailureChange: (v: string) => void;
}

const SCHEDULE_MODE_OPTIONS = [
    { value: 'interval' as const, label: 'Interval' },
    { value: 'cron' as const, label: 'Cron' },
] as const;

/**
 * Self-contained panel covering the "when" section of a schedule:
 *  - Interval vs Cron toggle
 *  - Interval inputs (value + unit) OR Cron expression + helper chips
 *  - On failure behaviour
 *
 * Extracted from CreateScheduleForm so it can be reused in any schedule editor.
 */
export function ScheduleTriggerPanel({
    mode,
    onModeChange,
    intervalValue,
    onIntervalValueChange,
    intervalUnit,
    onIntervalUnitChange,
    cron,
    onCronChange,
    onFailure,
    onFailureChange,
}: ScheduleTriggerPanelProps) {
    const cronDescription = cron.trim() ? describeCron(cron) : '';

    return (
        <div className="flex flex-col gap-2">
            {/* Interval / Cron toggle */}
            <SegmentedControl
                options={SCHEDULE_MODE_OPTIONS}
                value={mode}
                onChange={onModeChange}
            />

            {mode === 'interval' ? (
                <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[#616161] dark:text-[#999]">Run every</span>
                    <input
                        type="number"
                        min="1"
                        className="w-14 px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                        value={intervalValue}
                        onChange={e => onIntervalValueChange(e.target.value)}
                    />
                    <select
                        className="px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                        value={intervalUnit}
                        onChange={e => onIntervalUnitChange(e.target.value)}
                    >
                        <option value="minutes">minutes</option>
                        <option value="hours">hours</option>
                        <option value="days">days</option>
                    </select>
                </div>
            ) : (
                <div className="flex flex-col gap-1.5" data-testid="cron-hint-panel">
                    <input
                        className="text-xs px-2 py-1.5 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc] font-mono"
                        placeholder="0 9 * * *"
                        value={cron}
                        onChange={e => onCronChange(e.target.value)}
                    />
                    {/* Simplified field legend — single faded hint line instead of five badge chips */}
                    <span className="text-[9px] text-[#848484] font-mono" data-testid="cron-field-legend">
                        min · hr · dom · mon · dow
                    </span>
                    {cronDescription && (
                        <div className="text-[10px] text-[#0078d4] dark:text-[#4fc3f7]" data-testid="cron-description">
                            {cronDescription}
                        </div>
                    )}
                    <div className="flex flex-wrap gap-1" data-testid="cron-examples">
                        {CRON_EXAMPLES.map(ex => (
                            <button
                                key={ex.expr}
                                type="button"
                                className="text-[9px] px-1.5 py-0.5 rounded border border-[#d0d0d0] dark:border-[#555] bg-white dark:bg-[#2a2a2a] text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#333] hover:text-[#1e1e1e] dark:hover:text-[#ccc] transition-colors"
                                onClick={() => onCronChange(ex.expr)}
                                title={ex.expr}
                                data-testid={`cron-example-${ex.expr.replace(/\s+/g, '-')}`}
                            >
                                {ex.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex items-center gap-2 text-xs">
                <span className="text-[#616161] dark:text-[#999]">On failure:</span>
                <select
                    className="px-2 py-1 border border-[#d0d0d0] dark:border-[#555] rounded bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc]"
                    value={onFailure}
                    onChange={e => onFailureChange(e.target.value)}
                >
                    <option value="notify">Notify</option>
                    <option value="stop">Stop</option>
                </select>
            </div>
        </div>
    );
}
