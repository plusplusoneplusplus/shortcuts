export function BrowserModePill({ active, onRemove }: { active: boolean; onRemove: () => void }) {
    if (!active) return null;
    return <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300" data-testid="browser-mode-pill">
        Browser
        <button type="button" aria-label="Turn off browser mode" onClick={onRemove} className="px-0.5 hover:text-blue-900">×</button>
    </span>;
}
