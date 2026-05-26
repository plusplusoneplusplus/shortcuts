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
    const { state, dispatch } = useApp();

    const handleScopeConsumed = () => {
        // Clear the transient scope after the panel has picked it up so a
        // later navigation to #memory without a scope doesn't re-apply it.
        if (state.activeMemoryScopeId !== null) {
            dispatch({ type: 'SET_MEMORY_SCOPE', scopeId: null });
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <FeatureTip tipId="memory-intro" className="mx-3 mt-2" />

            {/* Memory V2 panel — handles its own enabled/disabled state */}
            <div className="flex-1 overflow-hidden" data-testid="memory-v2-container">
                <MemoryV2Panel
                    initialTab={state.activeMemorySubTab}
                    initialScopeId={state.activeMemoryScopeId}
                    onInitialScopeConsumed={handleScopeConsumed}
                />
            </div>
        </div>
    );
}
