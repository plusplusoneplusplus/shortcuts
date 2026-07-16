import { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { ToastContainer, useToast } from '../ui/Toast';
import { useApp } from '../contexts/AppContext';
import { SHOW_WELCOME_TUTORIAL } from '../featureFlags';
import { useOnboardingPreferences } from '../hooks/useOnboardingPreferences';
import { CocIcon } from './CocIcon';
import { WELCOME_TOUR_STEPS } from './welcomeTourSteps';
import { WELCOME_TOUR_STYLES } from './welcomeTourStyles';
import { usePortalContainer } from '../ui/usePortalContainer';

export interface WelcomeTourProps {
    /** Called after the tour is dismissed via "Get started". Parent may use this to scroll to FirstStepsCard. */
    onGetStarted?: () => void;
}

const TOTAL = WELCOME_TOUR_STEPS.length;

export function WelcomeTour({ onGetStarted }: WelcomeTourProps) {
    const { state } = useApp();
    const { toasts, addToast, removeToast } = useToast();
    const { markWelcomeSeen, skipWelcomeTour } = useOnboardingPreferences((message) => addToast(message, 'error'));
    const [step, setStep] = useState(0);
    const [saving, setSaving] = useState(false);

    const open = SHOW_WELCOME_TUTORIAL
        && state.preferencesLoaded
        && !state.preferencesLoadFailed
        && !state.hasSeenWelcome;
    const portalContainer = usePortalContainer(open);

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

    const handleSkip = useCallback(async () => {
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

    const next = useCallback(() => {
        if (step < TOTAL - 1) {
            setStep(s => s + 1);
        } else {
            void handleGetStarted();
        }
    }, [step, handleGetStarted]);

    const back = useCallback(() => {
        setStep(s => Math.max(0, s - 1));
    }, []);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                void handleSkip();
            } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
                e.preventDefault();
                next();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                back();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, next, back, handleSkip]);

    useEffect(() => {
        if (!open) setStep(0);
    }, [open]);

    if (!open || !portalContainer) {
        return (
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        );
    }

    const isFirst = step === 0;
    const isLast = step === TOTAL - 1;
    const current = WELCOME_TOUR_STEPS[step];

    return (
        <>
            <style data-testid="welcome-tour-styles">{WELCOME_TOUR_STYLES}</style>
            {ReactDOM.createPortal(
                <div
                    className="welcome-tour__scrim"
                    id="welcome-tour"
                    data-testid="welcome-tour-scrim"
                    role="presentation"
                >
                    <div
                        className="welcome-tour__modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="welcome-tour-title"
                    >
                        {/* Header */}
                        <header className="welcome-tour__head">
                            <div className="welcome-tour__brand">
                                <span className="welcome-tour__brand-mark">
                                    <CocIcon size={20} idPrefix="welcome-tour-brand" aria-label="CoC" data-testid="welcome-tour-brand-icon" />
                                </span>
                                <span className="welcome-tour__brand-name">
                                    CoC <span className="welcome-tour__brand-sub">· first run</span>
                                </span>
                            </div>
                            <ol className="welcome-tour__steps" data-testid="welcome-tour-steps">
                                {WELCOME_TOUR_STEPS.map((s, i) => {
                                    const cls = i === step
                                        ? 'welcome-tour__step welcome-tour__step--active'
                                        : i < step
                                            ? 'welcome-tour__step welcome-tour__step--done'
                                            : 'welcome-tour__step';
                                    return (
                                        <li key={s.id} className={cls}>
                                            <button
                                                type="button"
                                                className="welcome-tour__step-btn"
                                                onClick={() => setStep(i)}
                                                data-testid={`welcome-tour-step-${s.id}`}
                                                aria-current={i === step ? 'step' : undefined}
                                            >
                                                <span className="welcome-tour__step-num">{i + 1}</span>
                                                {s.label}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ol>
                            <button
                                type="button"
                                className="welcome-tour__close"
                                onClick={() => { void handleSkip(); }}
                                aria-label="Skip tour"
                                title="Skip tour (Esc)"
                                data-testid="welcome-tour-close"
                                disabled={saving}
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                    <path d="M6 6l12 12M6 18L18 6" />
                                </svg>
                            </button>
                        </header>

                        {/* Body */}
                        <div className="welcome-tour__body">
                            <section className="welcome-tour__panel" data-testid={`welcome-tour-panel-${current.id}`} key={current.id}>
                                <div className="welcome-tour__text">
                                    <div className="welcome-tour__eyebrow">
                                        <span className="welcome-tour__eyebrow-dot" aria-hidden="true" />
                                        {current.eyebrow}
                                    </div>
                                    <h1 id="welcome-tour-title" className="welcome-tour__headline">
                                        {current.headlineTop}
                                        {current.headlineBottom && (
                                            <>
                                                <br />
                                                {current.headlineBottom}
                                            </>
                                        )}
                                    </h1>
                                    <p className="welcome-tour__lede">{current.lede}</p>
                                    <ul className="welcome-tour__bullets">
                                        {current.bullets.map((bullet, i) => (
                                            <li key={i} className="welcome-tour__bullet">
                                                {bullet}
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="welcome-tour__foot-note">{current.footNote}</div>
                                </div>
                                <div className="welcome-tour__visual">
                                    {current.visual}
                                </div>
                            </section>
                        </div>

                        {/* Footer */}
                        <footer className="welcome-tour__foot">
                            <div className="welcome-tour__foot-left">
                                <div className="welcome-tour__dots" data-testid="welcome-tour-dots">
                                    {WELCOME_TOUR_STEPS.map((s, i) => {
                                        const cls = i === step
                                            ? 'welcome-tour__dot welcome-tour__dot--active'
                                            : i < step
                                                ? 'welcome-tour__dot welcome-tour__dot--done'
                                                : 'welcome-tour__dot';
                                        return <span key={s.id} className={cls} aria-hidden="true" />;
                                    })}
                                </div>
                                <span data-testid="welcome-tour-counter">{step + 1} of {TOTAL}</span>
                            </div>
                            <div className="welcome-tour__foot-right">
                                <button
                                    type="button"
                                    className="welcome-tour__btn welcome-tour__btn--ghost"
                                    onClick={() => { void handleSkip(); }}
                                    disabled={saving}
                                    data-testid="welcome-tour-skip"
                                >
                                    Skip tour
                                </button>
                                <button
                                    type="button"
                                    className="welcome-tour__btn welcome-tour__btn--secondary"
                                    onClick={back}
                                    disabled={isFirst || saving}
                                    data-testid="welcome-tour-back"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                        <polyline points="15,6 9,12 15,18" />
                                    </svg>
                                    Back
                                </button>
                                <button
                                    type="button"
                                    className="welcome-tour__btn welcome-tour__btn--primary"
                                    onClick={next}
                                    disabled={saving}
                                    data-testid="welcome-tour-next"
                                >
                                    <span data-testid="welcome-tour-next-label">{isLast ? 'Get started' : 'Next'}</span>
                                    <kbd className="welcome-tour__btn-kbd">↵</kbd>
                                </button>
                            </div>
                        </footer>
                    </div>
                </div>,
                portalContainer,
            )}
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </>
    );
}
