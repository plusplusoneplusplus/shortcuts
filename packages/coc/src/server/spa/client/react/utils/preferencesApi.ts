import type { OnboardingProgress } from '../contexts/AppContext';
import { getApiBase } from './config';

export interface GlobalPreferencePatch {
    hasSeenWelcome?: boolean;
    onboardingProgress?: Partial<OnboardingProgress>;
    dismissedTips?: string[];
    activityFilters?: {
        workspace?: string;
        myWorkExcludedTypes?: string[];
    };
    reposSidebarCollapsed?: boolean;
    htmlEmbed?: {
        enabled: boolean;
    };
}

export async function patchGlobalPreferences(patch: GlobalPreferencePatch): Promise<any> {
    const res = await fetch(getApiBase() + '/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || `API error: ${res.status} ${res.statusText}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
}
