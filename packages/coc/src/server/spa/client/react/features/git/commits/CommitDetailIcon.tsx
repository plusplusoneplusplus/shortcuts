const PATHS = {
    copy: 'M9 8h11v12H9ZM15 8V4H4v12h5',
    check: 'm5 12 4 4L19 6',
    up: 'm6 15 6-6 6 6',
    down: 'm6 9 6 6 6-6',
    chat: 'M4 4h16v12H9l-5 4Z',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
    out: 'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7',
};

/** Decorative line icons; the owning button supplies its accessible name. */
export function CommitDetailIcon({ name }: { name: keyof typeof PATHS }) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
            <path d={PATHS[name]} />
        </svg>
    );
}
