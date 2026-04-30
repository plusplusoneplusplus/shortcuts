import { useCallback, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { ToastContainer, useToast } from '../ui/Toast';
import { useApp } from '../contexts/AppContext';
import { SHOW_WELCOME_TUTORIAL } from '../featureFlags';
import { useOnboardingPreferences } from '../hooks/useOnboardingPreferences';

export interface WelcomeModalProps {
    /** Called after the modal is dismissed via "Get Started". Parent may use this to scroll to FirstStepsCard. */
    onGetStarted?: () => void;
}

const FEATURES = [
    { icon: '🤖', title: 'AI Chat', desc: 'Have AI conversations about your code, scoped to each repo' },
    { icon: '⚡', title: 'Workflows', desc: 'Run YAML-defined AI pipelines with DAG execution' },
    { icon: '🧠', title: 'Memory', desc: 'AI learns from past sessions and improves over time' },
    { icon: '🔧', title: 'Skills', desc: 'Extend AI capabilities with installable agent skills' },
] as const;

export function WelcomeModal({ onGetStarted }: WelcomeModalProps) {
    const { state } = useApp();
    const { toasts, addToast, removeToast } = useToast();
    const { markWelcomeSeen, skipWelcomeTour } = useOnboardingPreferences((message) => addToast(message, 'error'));
    const [saving, setSaving] = useState(false);

    const open = SHOW_WELCOME_TUTORIAL && state.preferencesLoaded && !state.preferencesLoadFailed && !state.hasSeenWelcome;

    const handleGetStarted = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            await markWelcomeSeen();
            onGetStarted?.();
        } catch {
            // The persistence helper already reports the failure.
        } finally {
            setSaving(false);
        }
    }, [markWelcomeSeen, onGetStarted, saving]);

    const handleSkipTour = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            await skipWelcomeTour();
        } catch {
            // The persistence helper already reports the failure.
        } finally {
            setSaving(false);
        }
    }, [saving, skipWelcomeTour]);

    return (
        <>
            <Dialog
                open={open}
                onClose={() => { void handleGetStarted(); }}
                id="welcome-modal"
                renderHeader={() => null}
            >
                <div className="flex flex-col items-center text-center gap-6 py-2">
                {/* Hero */}
                <div className="flex flex-col items-center gap-2">
                    <span className="text-4xl" role="img" aria-label="CoC logo">🚀</span>
                    <h1 className="text-xl font-bold text-[#1e1e1e] dark:text-[#cccccc]">
                        Welcome to CoC
                    </h1>
                    <p className="text-sm text-[#616161] dark:text-[#999]">
                        Your AI-powered development companion
                    </p>
                </div>

                {/* Feature cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
                    {FEATURES.map(f => (
                        <div
                            key={f.title}
                            className="flex items-start gap-3 p-3 rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]"
                        >
                            <span className="text-xl flex-shrink-0 mt-0.5" role="img" aria-label={f.title}>
                                {f.icon}
                            </span>
                            <div>
                                <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                                    {f.title}
                                </div>
                                <div className="text-xs text-[#616161] dark:text-[#999] mt-0.5">
                                    {f.desc}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* CTA area */}
                <div className="flex flex-col items-center gap-2 w-full">
                    <Button
                        variant="primary"
                        size="lg"
                        data-testid="welcome-get-started"
                        onClick={() => { void handleGetStarted(); }}
                        loading={saving}
                        className="w-full sm:w-auto sm:min-w-[200px]"
                    >
                        Get Started →
                    </Button>
                    <button
                        data-testid="welcome-skip-tour"
                        className="text-xs text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none cursor-pointer py-1"
                        onClick={() => { void handleSkipTour(); }}
                        disabled={saving}
                    >
                        Skip tour
                    </button>
                </div>
                </div>
            </Dialog>
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </>
    );
}
