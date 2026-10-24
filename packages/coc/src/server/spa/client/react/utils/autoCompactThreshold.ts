/** K input accepts whole tokens (up to three decimal places), without rounding. */
export function parseThresholdInput(value: string): number | undefined {
    if (!/^\d+(?:\.\d{1,3})?$/.test(value.trim())) return undefined;
    const [whole, fraction = ''] = value.trim().split('.');
    const tokens = Number(`${whole}${fraction.padEnd(3, '0')}`);
    return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : undefined;
}

export function formatThresholdInput(tokens: number): string {
    const remainder = tokens % 1000;
    return `${Math.floor(tokens / 1000)}${remainder ? `.${String(remainder).padStart(3, '0').replace(/0+$/, '')}` : ''}`;
}
