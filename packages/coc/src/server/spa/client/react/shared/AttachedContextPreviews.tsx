import { cn } from './cn';
import type { AttachedContextItem } from '../hooks/useAttachedContext';

export interface AttachedContextPreviewsProps {
    items: AttachedContextItem[];
    onRemove: (id: string) => void;
    className?: string;
    'data-testid'?: string;
}

export function AttachedContextPreviews({ items, onRemove, className, ...props }: AttachedContextPreviewsProps) {
    if (items.length === 0) return null;

    return (
        <div
            className={cn('flex flex-col gap-1.5', className)}
            data-testid={props['data-testid'] ?? 'attached-context-previews'}
        >
            {items.map(item => (
                <div
                    key={item.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#2d2d2d] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                    data-testid="attached-context-chip"
                >
                    <span className="shrink-0">📎</span>
                    <span className="shrink-0 font-medium text-[10px] uppercase tracking-wide text-[#848484]">
                        {item.role === 'user' ? 'You' : 'Assistant'} #{item.turnIndex}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[#1e1e1e] dark:text-[#cccccc]">
                        {item.preview}
                    </span>
                    <button
                        type="button"
                        onClick={() => onRemove(item.id)}
                        title="Remove context"
                        className="shrink-0 w-5 h-5 flex items-center justify-center rounded bg-transparent border-none text-[#848484] hover:text-[#f14c4c] cursor-pointer text-sm"
                        data-testid="attached-context-remove"
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}
