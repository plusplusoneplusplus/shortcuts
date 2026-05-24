/**
 * MemoryView — top-level route component for #memory.
 *
 * Renders the redesigned MemoryV2Panel. The panel itself manages
 * its enabled/disabled state.
 */

import { useApp } from '../../contexts/AppContext';
import { FeatureTip } from '../../welcome/FeatureTip';
import { MemoryV2Panel } from './MemoryV2Panel';

export function MemoryView() {
    const { state } = useApp();

    return (
        <div id="view-memory" className="flex flex-col h-full overflow-hidden">
            <FeatureTip tipId="memory-intro" className="mx-3 mt-2" />

            {/* Memory V2 panel — handles its own enabled/disabled state */}
            <div className="flex-1 overflow-hidden" data-testid="memory-v2-container">
                <MemoryV2Panel initialTab={state.activeMemorySubTab} />
            </div>
        </div>
    );
}
