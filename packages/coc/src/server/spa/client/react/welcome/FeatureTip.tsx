import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { cn } from '../ui/cn';
import { TIPS } from './tips';
import { SHOW_WELCOME_TUTORIAL } from '../featureFlags';

interface FeatureTipProps {
    tipId: string;
    className?: string;
}

export function FeatureTip({ tipId, className }: FeatureTipProps) {
    if (!SHOW_WELCOME_TUTORIAL) return null;
    const { state, dispatch } = useApp();
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        setVisible(true);
    }, []);

    const tip = TIPS[tipId];
    if (!tip) return null;
    if (state.dismissedTips.includes(tipId)) return null;

    return (
        <div
            data-testid={`feature-tip-${tipId}`}
            className={cn(
                'flex items-start gap-2 px-3 py-2 rounded-md',
                'bg-[#0078d4]/10 dark:bg-[#0078d4]/15',
                'border border-[#0078d4]/20 dark:border-[#0078d4]/30',
                'transition-opacity duration-300',
                visible ? 'opacity-100' : 'opacity-0',
                className,
            )}
        >
            <span className="text-[#0078d4] text-base leading-none mt-0.5 shrink-0" aria-hidden="true">💡</span>

            <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-[#0078d4] dark:text-[#3794ff]">{tip.title}</span>
                <span className="text-sm text-[#1e1e1e] dark:text-[#cccccc] ml-1">{tip.body}</span>
            </div>

            <button
                onClick={() => dispatch({ type: 'DISMISS_TIP', payload: { tipId } })}
                className="shrink-0 text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-base leading-none p-0.5"
                aria-label={`Dismiss ${tip.title} tip`}
                data-testid={`dismiss-tip-${tipId}`}
            >
                ×
            </button>
        </div>
    );
}
