import { useCallback } from 'react';
import { useApp, type OnboardingProgress } from '../contexts/AppContext';
import { patchGlobalPreferences, type GlobalPreferencePatch } from '../utils/preferencesApi';

const SAVE_FAILURE_MESSAGE = 'Failed to save onboarding preferences. The welcome tour may reappear after reload.';

const DEFAULT_ONBOARDING_PROGRESS: OnboardingProgress = {
    hasRunWorkflow: false,
    hasOpenedWiki: false,
    hasUsedChat: false,
    settingsVisited: false,
    dismissed: false,
    hasCompletedTour: false,
};

export function useOnboardingPreferences(onFailure?: (message: string) => void) {
    const { state, dispatch } = useApp();

    const reportFailure = useCallback((message = SAVE_FAILURE_MESSAGE) => {
        if (onFailure) {
            onFailure(message);
        } else {
            console.error(message);
        }
    }, [onFailure]);

    const persist = useCallback(async (patch: GlobalPreferencePatch, failureMessage?: string) => {
        try {
            return await patchGlobalPreferences(patch);
        } catch (error) {
            reportFailure(failureMessage);
            throw error;
        }
    }, [reportFailure]);

    const markWelcomeSeen = useCallback(async () => {
        await persist({ hasSeenWelcome: true });
        dispatch({ type: 'DISMISS_WELCOME' });
    }, [dispatch, persist]);

    const skipWelcomeTour = useCallback(async () => {
        const onboardingProgress = { ...state.onboardingProgress, dismissed: true };
        await persist({ hasSeenWelcome: true, onboardingProgress });
        dispatch({ type: 'DISMISS_WELCOME' });
        dispatch({ type: 'UPDATE_ONBOARDING', payload: { dismissed: true } });
    }, [dispatch, persist, state.onboardingProgress]);

    const updateOnboarding = useCallback(async (payload: Partial<OnboardingProgress>) => {
        const onboardingProgress = { ...state.onboardingProgress, ...payload };
        await persist({ onboardingProgress });
        dispatch({ type: 'UPDATE_ONBOARDING', payload });
    }, [dispatch, persist, state.onboardingProgress]);

    const completeTour = useCallback(async () => {
        await updateOnboarding({ hasCompletedTour: true });
    }, [updateOnboarding]);

    const dismissTip = useCallback(async (tipId: string) => {
        if (state.dismissedTips.includes(tipId)) return;
        const dismissedTips = [...state.dismissedTips, tipId];
        await persist({ dismissedTips });
        dispatch({ type: 'DISMISS_TIP', payload: { tipId } });
    }, [dispatch, persist, state.dismissedTips]);

    const resetWelcomeTour = useCallback(async () => {
        await persist({
            hasSeenWelcome: false,
            onboardingProgress: DEFAULT_ONBOARDING_PROGRESS,
            dismissedTips: [],
        }, 'Failed to reset welcome tour');
        dispatch({
            type: 'SET_WELCOME_PREFERENCES',
            payload: {
                hasSeenWelcome: false,
                onboardingProgress: DEFAULT_ONBOARDING_PROGRESS,
                dismissedTips: [],
            },
        });
    }, [dispatch, persist]);

    return {
        markWelcomeSeen,
        skipWelcomeTour,
        updateOnboarding,
        completeTour,
        dismissTip,
        resetWelcomeTour,
    };
}
