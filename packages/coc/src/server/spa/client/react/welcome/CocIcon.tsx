/**
 * CoC brand icon. Inline SVG mirror of `assets/icons/coc-icon.svg`.
 *
 * Inlining keeps the markup self-contained for tests (jsdom does not
 * load image assets) and lets each consumer pick a unique gradient id
 * via the `idPrefix` prop so multiple icons on the same page do not
 * collide on `<defs>` ids.
 */

export interface CocIconProps {
    /** Pixel size for both width and height. Defaults to 100. */
    size?: number;
    /** Unique prefix for SVG `defs` ids when multiple icons share a page. */
    idPrefix?: string;
    /** Optional extra class names. */
    className?: string;
    /** Optional aria-label for screen readers. */
    'aria-label'?: string;
    /** Optional data-testid for tests. */
    'data-testid'?: string;
}

export function CocIcon({
    size = 100,
    idPrefix = 'coc-icon',
    className,
    'aria-label': ariaLabel = 'CoC',
    'data-testid': dataTestId,
}: CocIconProps) {
    const g1 = `${idPrefix}-g1`;
    const g2 = `${idPrefix}-g2`;
    const glow = `${idPrefix}-glow`;
    const pulse = `${idPrefix}-pulse`;
    const color1 = '#58a6ff';
    const color2 = '#a371f7';
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 100 100"
            width={size}
            height={size}
            className={className}
            role="img"
            aria-label={ariaLabel}
            data-testid={dataTestId}
        >
            <defs>
                <linearGradient id={g1} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={color1} />
                    <stop offset="100%" stopColor={color2} />
                </linearGradient>
                <linearGradient id={g2} x1="100%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor={color2} />
                    <stop offset="100%" stopColor={color1} />
                </linearGradient>
                <filter id={glow} x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                <radialGradient id={pulse} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor={color1} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={color1} stopOpacity="0" />
                </radialGradient>
            </defs>
            <rect width="100" height="100" rx="22" fill="#0d1117" />
            <circle cx="50" cy="50" r="28" fill={`url(#${pulse})`} />
            <path
                d="M 58 15 A 35 35 0 1 0 58 85"
                fill="none"
                stroke={`url(#${g1})`}
                strokeWidth="8.5"
                strokeLinecap="round"
                filter={`url(#${glow})`}
            />
            <path
                d="M 48 30 A 20 20 0 1 1 48 70"
                fill="none"
                stroke={`url(#${g2})`}
                strokeWidth="6"
                strokeLinecap="round"
                filter={`url(#${glow})`}
            />
            <circle cx="50" cy="50" r="5" fill={color1} filter={`url(#${glow})`} />
            <circle cx="50" cy="50" r="9" fill="none" stroke={color2} strokeWidth="1.2" opacity="0.45" />
        </svg>
    );
}
