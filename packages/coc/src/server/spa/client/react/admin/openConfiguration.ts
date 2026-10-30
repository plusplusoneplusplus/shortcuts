/** Opens the existing Admin overlay without unmounting the underlying composer. */
export function openConfiguration(hash: string): void {
    window.location.hash = hash;
}

export function effortTierSettingsHash(provider?: string, baseUrl?: string): string {
    const params = new URLSearchParams({ section: 'effort-tiers' });
    if (provider && provider !== 'auto') params.set('provider', provider);
    if (baseUrl) params.set('owner', baseUrl);
    return `#admin/agents?${params}`;
}

export function readEffortTierSettingsTarget(): { baseUrl?: string; provider?: string } | null {
    const [route, query] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    if (route !== '#admin/agents' || params.get('section') !== 'effort-tiers') return null;
    return { baseUrl: params.get('owner') || undefined, provider: params.get('provider') || undefined };
}
