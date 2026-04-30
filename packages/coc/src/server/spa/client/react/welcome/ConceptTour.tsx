import { useState, useCallback } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { ToastContainer, useToast } from '../ui/Toast';
import { useApp } from '../contexts/AppContext';
import { SHOW_WELCOME_TUTORIAL } from '../featureFlags';
import { TOUR_SLIDES } from './conceptTourSlides';
import { ConceptTourSlide } from './ConceptTourSlide';
import { useOnboardingPreferences } from '../hooks/useOnboardingPreferences';

export function ConceptTour() {
    const { state } = useApp();
    const { toasts, addToast, removeToast } = useToast();
    const { completeTour } = useOnboardingPreferences((message) => addToast(message, 'error'));
    const [currentSlide, setCurrentSlide] = useState(0);
    const [saving, setSaving] = useState(false);

    const showTour = SHOW_WELCOME_TUTORIAL
        && state.preferencesLoaded
        && !state.preferencesLoadFailed
        && state.hasSeenWelcome
        && !state.onboardingProgress.hasCompletedTour
        && !state.onboardingProgress.dismissed;

    const handleComplete = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        try {
            await completeTour();
        } catch {
            // The persistence helper already reports the failure.
        } finally {
            setSaving(false);
        }
    }, [completeTour, saving]);

    const handleNext = useCallback(async () => {
        if (currentSlide < TOUR_SLIDES.length - 1) {
            setCurrentSlide(s => s + 1);
        } else {
            await handleComplete();
        }
    }, [currentSlide, handleComplete]);

    const handleBack = useCallback(() => {
        setCurrentSlide(s => Math.max(0, s - 1));
    }, []);

    const isFirst = currentSlide === 0;
    const isLast = currentSlide === TOUR_SLIDES.length - 1;

    return (
        <>
            <Dialog
                open={showTour}
                onClose={() => { void handleComplete(); }}
                id="concept-tour"
                className="max-w-[28rem]"
                renderHeader={() => null}
            >
                <div className="flex flex-col items-center gap-6 py-2" style={{ minHeight: 280 }}>
                {/* Page dots */}
                <div className="flex items-center gap-1.5" data-testid="tour-dots">
                    {TOUR_SLIDES.map((_, i) => (
                        <span
                            key={i}
                            className={`w-2 h-2 rounded-full transition-colors ${
                                i === currentSlide
                                    ? 'bg-[#0078d4]'
                                    : 'bg-[#c8c8c8] dark:bg-[#555]'
                            }`}
                        />
                    ))}
                </div>

                {/* Slide content with cross-fade */}
                <div className="flex-1 flex items-center justify-center w-full transition-opacity duration-200" key={currentSlide}>
                    <ConceptTourSlide slide={TOUR_SLIDES[currentSlide]} />
                </div>

                {/* Navigation footer */}
                <div className="w-full border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-4 mt-4">
                    <div className="flex items-center justify-between">
                        <div className="w-24">
                            {!isFirst && (
                                <Button
                                    variant="secondary"
                                    size="md"
                                    data-testid="tour-back"
                                    onClick={handleBack}
                                >
                                    ← Back
                                </Button>
                            )}
                        </div>
                        <div className="w-24 flex justify-end">
                            <Button
                                variant="primary"
                                size="md"
                                data-testid="tour-next"
                                onClick={() => { void handleNext(); }}
                                loading={saving}
                            >
                                {isLast ? "Let's Go →" : 'Next →'}
                            </Button>
                        </div>
                    </div>
                    <div className="flex justify-center mt-3">
                        <button
                            data-testid="tour-skip"
                            className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none cursor-pointer py-1"
                            onClick={() => { void handleComplete(); }}
                            disabled={saving}
                        >
                            Skip tour
                        </button>
                    </div>
                </div>
                </div>
            </Dialog>
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </>
    );
}
