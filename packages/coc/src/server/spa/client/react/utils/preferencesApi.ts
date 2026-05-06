import { CocApiError } from '@plusplusoneplusplus/coc-client';
import type { OnboardingProgress } from '../contexts/AppContext';
import { getSpaCocClient, translateSpaCocClientError } from '../api/cocClient';

export interface GlobalPreferencePatch {
    hasSeenWelcome?: boolean;
    onboardingProgress?: Partial<OnboardingProgress>;
    dismissedTips?: string[];
    activityFilters?: {
        workspace?: string;
        myWorkExcludedTypes?: string[];
    };
    reposSidebarCollapsed?: boolean;
    topBarItemOrder?: string[];
    htmlEmbed?: {
        enabled: boolean;
    };
}

export async function patchGlobalPreferences(patch: GlobalPreferencePatch): Promise<any> {
    try {
        return await getSpaCocClient().preferences.patchGlobal(patch);
    } catch (error) {
        if (error instanceof CocApiError) {
            throw new Error(error.message);
        }
        translateSpaCocClientError(error);
    }
}
