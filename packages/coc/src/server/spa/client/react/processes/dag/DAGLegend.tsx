import type { DAGNodeState } from './types';
import { getNodeColors } from './dag-colors';

export interface DAGLegendProps {
    isDark: boolean;
}

const legendStates: Array<{ state: DAGNodeState; label: string }> = [
    { state: 'waiting', label: 'Waiting' },
    { state: 'running', label: 'Running' },
    { state: 'completed', label: 'Completed' },
    { state: 'failed', label: 'Failed' },
    { state: 'cancelled', label: 'Cancelled' },
];

export function DAGLegend({ isDark }: DAGLegendProps): JSX.Element {
    return (
        <div data-testid="dag-legend" className="flex items-center justify-center gap-4 text-[10px] text-[#848484] mt-1">
            {legendStates.map(({ state, label }) => {
                const colors = getNodeColors(state, isDark);
                return (
                    <span key={state} className="flex items-center gap-1">
                        <span style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: colors.border,
                            display: 'inline-block',
                        }} />
                        {label}
                    </span>
                );
            })}
        </div>
    );
}
