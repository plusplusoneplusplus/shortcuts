import { botControlSourceLabel, readBotControl } from '../../utils/botControl';

export function BotManagementBadge({ control, compact = false }: { control: unknown; compact?: boolean }) {
    const safe = readBotControl(control);
    if (!safe) return null;
    const label = `Bot-managed \u00b7 ${botControlSourceLabel(safe)}`;
    return (
        <span
            role="img"
            aria-label={label}
            title={label}
            data-testid="bot-management-badge"
            className="inline-flex shrink-0 items-center gap-1 rounded border border-[#d0d0d0] dark:border-[#505050] bg-[#f3f3f3] dark:bg-[#2d2d2d] px-1 py-0.5 text-[10px] leading-none text-[#616161] dark:text-[#bbbbbb]"
        >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M8 1v3M6 1h4M2 7H1v4h1m12-4h1v4h-1" />
                <rect x="2.5" y="4.5" width="11" height="9" rx="2" />
                <path d="M5 8h1m4 0h1m-5 3h4" />
            </svg>
            <span aria-hidden="true" className={compact ? 'sr-only' : undefined}>{label}</span>
        </span>
    );
}
