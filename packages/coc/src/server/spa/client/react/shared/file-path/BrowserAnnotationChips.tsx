import type { BrowserDemoOwner } from './browser-bridge';
import { removeBrowserAnnotationChip, useBrowserAnnotationChips } from './browser-annotation-chips';

function selectionLabel(chip: { selection: { kind: 'element' | 'area'; tag?: string; page: { title: string; url: string } } }): string {
    const target = chip.selection.kind === 'area' ? 'Area' : `<${chip.selection.tag ?? 'element'}>`;
    return `${target} · ${chip.selection.page.title || chip.selection.page.url}`;
}

/** Saved browser comments queued for this exact chat composer. */
export function BrowserAnnotationChips({ owner }: { owner: BrowserDemoOwner | null }) {
    const chips = useBrowserAnnotationChips(owner);
    if (chips.length === 0) return null;
    return (
        <div className="flex flex-col gap-1.5" data-testid="browser-annotation-chips">
            {chips.map(chip => (
                <div key={chip.key} data-testid="browser-annotation-chip"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 text-[#1e1e1e] dark:text-[#cccccc]">
                    <span aria-hidden="true" className="shrink-0 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">{chip.number}</span>
                    <span className="flex-1 min-w-0 truncate" title={chip.comment}>
                        <span className="font-medium">{chip.comment}</span>
                        <span className="ml-1 text-[#848484]">{selectionLabel(chip)}</span>
                    </span>
                    <button type="button" aria-label={`Remove browser comment ${chip.number}`}
                        className="shrink-0 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-white"
                        // Failures end the mode natively; its toolbar reports them.
                        onClick={() => { void removeBrowserAnnotationChip(chip.key).catch(() => undefined); }}>×</button>
                </div>
            ))}
        </div>
    );
}
