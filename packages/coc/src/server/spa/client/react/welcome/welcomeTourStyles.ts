/**
 * Self-contained CSS for the WelcomeTour modal.
 *
 * Lives next to the component as a string so the entire onboarding
 * surface is one isolated bundle — the SPA's Tailwind/utility classes
 * carry no risk of clashing with the rest of the dashboard chrome.
 *
 * All selectors are namespaced under `.welcome-tour__*` so the CSS
 * never leaks beyond the modal.
 */
export const WELCOME_TOUR_STYLES = `
.welcome-tour__scrim {
    position: fixed;
    inset: 0;
    z-index: 10003;
    background: radial-gradient(120% 80% at 50% 40%, rgba(15, 18, 25, 0.42), rgba(15, 18, 25, 0.62));
    backdrop-filter: blur(8px) saturate(0.8);
    -webkit-backdrop-filter: blur(8px) saturate(0.8);
    display: grid;
    place-items: center;
    animation: welcome-tour-scrim-in 0.25s ease;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #1d2230;
    padding: 24px;
    -webkit-font-smoothing: antialiased;
    font-variant-numeric: tabular-nums;
}
@keyframes welcome-tour-scrim-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}

.welcome-tour__modal {
    width: min(960px, 100%);
    height: min(640px, 100%);
    background: #ffffff;
    border: 1px solid #cdd2db;
    border-radius: 14px;
    box-shadow: 0 30px 80px -20px rgba(15, 18, 25, 0.5),
                0 8px 24px -8px rgba(15, 18, 25, 0.3);
    display: grid;
    grid-template-rows: auto 1fr auto;
    overflow: hidden;
    animation: welcome-tour-in 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes welcome-tour-in {
    from { opacity: 0; transform: translateY(8px) scale(0.985); }
    to   { opacity: 1; transform: none; }
}

/* ---- Header ---- */
.welcome-tour__head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    border-bottom: 1px solid #e3e5ea;
    background: #ffffff;
}
.welcome-tour__brand {
    display: flex;
    align-items: center;
    gap: 9px;
    font-weight: 600;
    letter-spacing: -0.01em;
}
.welcome-tour__brand-mark {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    overflow: hidden;
    line-height: 0;
}
.welcome-tour__brand-name { color: #1d2230; }
.welcome-tour__brand-sub { color: #6b7280; font-weight: 400; margin-left: 4px; }
.welcome-tour__steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    list-style: none;
    margin: 0;
    padding: 0;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10.5px;
    color: #98a0b0;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    flex-wrap: wrap;
}
.welcome-tour__step {
    display: flex;
    align-items: stretch;
    border-right: 1px solid #e3e5ea;
}
.welcome-tour__step:last-child { border-right: 0; }
.welcome-tour__step-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
}
.welcome-tour__step-btn:hover { color: #1d2230; background: rgba(15, 18, 25, 0.04); }
.welcome-tour__step--done .welcome-tour__step-btn { color: #6b7280; }
.welcome-tour__step--active .welcome-tour__step-btn { color: #1d2230; font-weight: 600; }
.welcome-tour__step-num {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid #e3e5ea;
    background: #ffffff;
    font-weight: 600;
    color: inherit;
}
.welcome-tour__step--active .welcome-tour__step-num {
    background: #1d2230;
    color: #ffffff;
    border-color: #1d2230;
}
.welcome-tour__step--done .welcome-tour__step-num {
    background: #d6f0e2;
    color: #167c46;
    border-color: transparent;
}
.welcome-tour__close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: #6b7280;
    background: transparent;
    border: 0;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
}
.welcome-tour__close:hover:not(:disabled) {
    background: #f0f1f4;
    color: #1d2230;
}
.welcome-tour__close:disabled { opacity: 0.4; cursor: not-allowed; }
.welcome-tour__close svg { width: 14px; height: 14px; }

/* ---- Body ---- */
.welcome-tour__body {
    overflow: hidden;
    position: relative;
    background: #ffffff;
    min-height: 0;
}
.welcome-tour__panel {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    animation: welcome-tour-fade 0.25s ease;
}
@keyframes welcome-tour-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
}
.welcome-tour__text {
    padding: 36px 36px 24px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    border-right: 1px solid #e3e5ea;
    min-width: 0;
    overflow-y: auto;
}
.welcome-tour__visual {
    padding: 24px;
    display: grid;
    place-items: center;
    background: #f4f5f8;
    min-width: 0;
    overflow: auto;
    position: relative;
}

.welcome-tour__eyebrow {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10.5px;
    letter-spacing: 0.08em;
    color: #167c46;
    font-weight: 600;
    text-transform: uppercase;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.welcome-tour__eyebrow-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #167c46;
}
.welcome-tour__headline {
    margin: 0 0 12px;
    font-size: 26px;
    line-height: 1.18;
    letter-spacing: -0.02em;
    font-weight: 600;
    color: #1d2230;
}
.welcome-tour__lede {
    margin: 0 0 16px;
    color: #6b7280;
    font-size: 14px;
    line-height: 1.55;
    max-width: 38ch;
}
.welcome-tour__bullets {
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 42ch;
}
.welcome-tour__bullet {
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: 9px;
    font-size: 12.5px;
    line-height: 1.5;
    color: #1d2230;
}
.welcome-tour__bullet b { font-weight: 600; }
.welcome-tour__dim { color: #6b7280; }
.welcome-tour__bullet-icon {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: #d6f0e2;
    color: #167c46;
    margin-top: 3px;
    font-size: 10px;
    font-weight: 700;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
}
.welcome-tour__bullet-icon svg { width: 9px; height: 9px; }
.welcome-tour__bullet-icon--info   { background: #dbeafe; color: #1e60d4; }
.welcome-tour__bullet-icon--warn   { background: #fef0c7; color: #b97300; }
.welcome-tour__bullet-icon--accent { background: #d6f0e2; color: #167c46; }

.welcome-tour__foot-note {
    margin-top: 16px;
    font-size: 11.5px;
    color: #98a0b0;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}
.welcome-tour__kbd,
.welcome-tour__btn-kbd {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10.5px;
    color: #6b7280;
    background: #f4f5f8;
    border: 1px solid #e3e5ea;
    border-radius: 3px;
    padding: 1px 5px;
    letter-spacing: 0;
}
.welcome-tour__legend {
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    color: #ffffff;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 9px;
    font-weight: 700;
    margin: 0 4px;
}
.welcome-tour__legend--info   { background: #1e60d4; }
.welcome-tour__legend--accent { background: #167c46; }

/* ---- Footer ---- */
.welcome-tour__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 12px 16px;
    border-top: 1px solid #e3e5ea;
    background: #ffffff;
    flex-wrap: wrap;
}
.welcome-tour__foot-left {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #6b7280;
    font-size: 11.5px;
}
.welcome-tour__dots { display: flex; gap: 5px; }
.welcome-tour__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #e3e5ea;
    transition: background 0.15s, transform 0.15s;
}
.welcome-tour__dot--active { background: #1d2230; transform: scale(1.25); }
.welcome-tour__dot--done   { background: #167c46; }
.welcome-tour__foot-right { display: flex; align-items: center; gap: 8px; }
.welcome-tour__btn {
    height: 30px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: -0.005em;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background 0.12s, color 0.12s, border-color 0.12s, opacity 0.12s;
    border: 1px solid transparent;
    cursor: pointer;
    font-family: inherit;
}
.welcome-tour__btn:disabled {
    opacity: 0.4;
    pointer-events: none;
    cursor: not-allowed;
}
.welcome-tour__btn--ghost { color: #6b7280; background: transparent; }
.welcome-tour__btn--ghost:hover:not(:disabled) { color: #1d2230; background: #f0f1f4; }
.welcome-tour__btn--secondary {
    border-color: #cdd2db;
    color: #1d2230;
    background: #ffffff;
}
.welcome-tour__btn--secondary:hover:not(:disabled) { background: #f0f1f4; }
.welcome-tour__btn--primary { background: #1d2230; color: #ffffff; }
.welcome-tour__btn--primary:hover:not(:disabled) { background: #0e1320; }
.welcome-tour__btn--primary .welcome-tour__btn-kbd {
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.78);
    border: 0;
}
.welcome-tour__btn svg { width: 13px; height: 13px; }

/* ---- Hero (welcome step) ---- */
.welcome-tour__hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
}
.welcome-tour__hero-logo {
    width: 96px;
    height: 96px;
    border-radius: 22px;
    display: grid;
    place-items: center;
    background: #0d1117;
    box-shadow: 0 12px 32px -8px rgba(20, 48, 96, 0.35),
                inset 0 1px 0 rgba(255, 255, 255, 0.18);
    overflow: hidden;
    line-height: 0;
}
.welcome-tour__hero-tag {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px;
    background: #ffffff;
    border: 1px solid #e3e5ea;
    border-radius: 9999px;
    font-size: 11px;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    color: #6b7280;
}
.welcome-tour__hero-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #167c46;
    box-shadow: 0 0 0 3px #d6f0e2;
}
.welcome-tour__hero-meta {
    display: flex;
    gap: 14px;
    color: #6b7280;
    font-size: 11px;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
}
.welcome-tour__hero-meta span b {
    color: #1d2230;
    font-weight: 600;
    margin-right: 4px;
}

/* ---- Modes step ---- */
.welcome-tour__modes {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    width: 100%;
    max-width: 340px;
}
.welcome-tour__mode-card {
    background: #ffffff;
    border: 1px solid #e3e5ea;
    border-radius: 6px;
    padding: 10px 12px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 10px;
    align-items: center;
}
.welcome-tour__mode-card--featured {
    border-color: #167c46;
    box-shadow: 0 0 0 3px #d6f0e2;
}
.welcome-tour__mode-dot { width: 8px; height: 8px; border-radius: 50%; }
.welcome-tour__mode-dot--info   { background: #1e60d4; box-shadow: 0 0 0 3px #dbeafe; }
.welcome-tour__mode-dot--warn   { background: #b97300; box-shadow: 0 0 0 3px #fef0c7; }
.welcome-tour__mode-dot--accent { background: #167c46; box-shadow: 0 0 0 3px #d6f0e2; }
.welcome-tour__mode-name {
    font-weight: 600;
    letter-spacing: -0.005em;
    color: #1d2230;
    display: flex;
    align-items: baseline;
    gap: 6px;
}
.welcome-tour__mode-sub {
    font-weight: 400;
    color: #6b7280;
    font-size: 11px;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
}
.welcome-tour__mode-tag {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.welcome-tour__mode-tag--info   { color: #1e60d4; }
.welcome-tour__mode-tag--warn   { color: #b97300; }
.welcome-tour__mode-tag--accent { color: #167c46; }
.welcome-tour__mode-body {
    grid-column: 2 / 3;
    font-size: 11.5px;
    color: #6b7280;
}

/* ---- Queue step ---- */
.welcome-tour__queue {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    max-width: 340px;
}
.welcome-tour__queue-now {
    background: #ffffff;
    border: 1px solid #167c46;
    border-radius: 6px;
    padding: 10px 12px;
    box-shadow: 0 0 0 3px #d6f0e2;
}
.welcome-tour__queue-now-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    color: #167c46;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 4px;
}
.welcome-tour__queue-pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #167c46;
    animation: welcome-tour-pulse 1.6s ease infinite;
}
@keyframes welcome-tour-pulse {
    0%, 100% { box-shadow: 0 0 0 0 #167c46; }
    50%      { box-shadow: 0 0 0 5px transparent; }
}
.welcome-tour__queue-now-name { font-weight: 600; font-size: 13px; color: #1d2230; }
.welcome-tour__queue-now-meta {
    font-size: 11px;
    color: #6b7280;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    margin-top: 4px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}
.welcome-tour__queue-pending {
    background: #ffffff;
    border: 1px solid #e3e5ea;
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: #6b7280;
}
.welcome-tour__queue-num {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: #f4f5f8;
    color: #98a0b0;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10px;
    font-weight: 600;
}
.welcome-tour__queue-name { color: #1d2230; font-weight: 500; }
.welcome-tour__queue-meta {
    margin-left: auto;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10.5px;
    color: #98a0b0;
}
.welcome-tour__queue-sep {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #98a0b0;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 2px;
}
.welcome-tour__queue-sep::before,
.welcome-tour__queue-sep::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #e3e5ea;
}

/* ---- Multi-repo step ---- */
.welcome-tour__repos {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    max-width: 340px;
}
.welcome-tour__repo {
    background: #ffffff;
    border: 1px solid #e3e5ea;
    border-radius: 6px;
    padding: 9px 11px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 10px;
    align-items: center;
    font-size: 12px;
}
.welcome-tour__repo--current {
    border-color: #cdd2db;
    background: #f4f5f8;
}
.welcome-tour__repo-ico {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10px;
    font-weight: 700;
    color: #ffffff;
}
.welcome-tour__repo-ico--a { background: #2d8855; }
.welcome-tour__repo-ico--b { background: #2c64c0; }
.welcome-tour__repo-ico--c { background: #6a4cc0; }
.welcome-tour__repo-ico--d { background: #c06a3a; }
.welcome-tour__repo-name {
    font-weight: 500;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 11.5px;
    color: #1d2230;
}
.welcome-tour__repo-branch {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10.5px;
    color: #6b7280;
    background: #f4f5f8;
    padding: 1px 6px;
    border-radius: 3px;
}
.welcome-tour__repo--current .welcome-tour__repo-branch { background: #ffffff; }

/* ---- Servers / tunnel step ---- */
.welcome-tour__tunnel {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
}
.welcome-tour__tunnel-row {
    background: #ffffff;
    border: 1px solid #e3e5ea;
    border-radius: 6px;
    padding: 10px 12px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 10px;
    align-items: center;
}
.welcome-tour__tunnel-ico {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: #f4f5f8;
    display: grid;
    place-items: center;
    color: #6b7280;
}
.welcome-tour__tunnel-ico svg { width: 14px; height: 14px; }
.welcome-tour__tunnel-name {
    font-size: 12.5px;
    font-weight: 600;
    color: #1d2230;
}
.welcome-tour__tunnel-sub {
    font-weight: 400;
    color: #6b7280;
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10.5px;
    margin-left: 6px;
}
.welcome-tour__tunnel-pill {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 3px 8px;
    border-radius: 9999px;
    background: #d6f0e2;
    color: #167c46;
    font-weight: 600;
}
.welcome-tour__tunnel-pill--warn { background: #fef0c7; color: #b97300; }
.welcome-tour__tunnel-pipe {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
}
.welcome-tour__tunnel-line {
    height: 1px;
    background: repeating-linear-gradient(90deg, #cdd2db 0 6px, transparent 6px 12px);
}
.welcome-tour__tunnel-label {
    font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
    font-size: 10px;
    color: #98a0b0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 4px;
}

/* ---- Compact / narrow viewport ---- */
@media (max-width: 760px) {
    .welcome-tour__steps { display: none; }
    .welcome-tour__panel { grid-template-columns: 1fr; }
    .welcome-tour__visual { display: none; }
    .welcome-tour__text {
        border-right: 0;
        padding: 24px 20px;
    }
    .welcome-tour__headline { font-size: 22px; }
    .welcome-tour__btn--secondary { display: none; }
}

/* ---- Dark theme (matches the SPA dark surfaces) ---- */
@media (prefers-color-scheme: dark) {
    .welcome-tour__scrim { color: #d4d4d4; }
    .welcome-tour__modal {
        background: #1f2024;
        border-color: #3a3d44;
        box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.7), 0 8px 24px -8px rgba(0, 0, 0, 0.5);
    }
    .welcome-tour__head { background: #1f2024; border-bottom-color: #2c2f36; }
    .welcome-tour__brand-name { color: #ececec; }
    .welcome-tour__brand-sub { color: #98a0b0; }
    .welcome-tour__steps { color: #6b7280; }
    .welcome-tour__step { border-right-color: #2c2f36; }
    .welcome-tour__step-num { background: #2a2c33; border-color: #3a3d44; }
    .welcome-tour__step-btn:hover { color: #ececec; background: rgba(255, 255, 255, 0.05); }
    .welcome-tour__step--done .welcome-tour__step-btn { color: #98a0b0; }
    .welcome-tour__step--active .welcome-tour__step-btn { color: #ececec; }
    .welcome-tour__step--active .welcome-tour__step-num { background: #ececec; color: #1f2024; border-color: #ececec; }
    .welcome-tour__step--done .welcome-tour__step-num { background: rgba(46, 160, 67, 0.18); color: #4cd182; }
    .welcome-tour__close { color: #98a0b0; }
    .welcome-tour__close:hover:not(:disabled) { background: #2a2c33; color: #ececec; }
    .welcome-tour__body { background: #1f2024; }
    .welcome-tour__text { border-right-color: #2c2f36; }
    .welcome-tour__visual { background: #181a1f; }
    .welcome-tour__eyebrow { color: #4cd182; }
    .welcome-tour__eyebrow-dot { background: #4cd182; }
    .welcome-tour__headline { color: #ececec; }
    .welcome-tour__lede { color: #98a0b0; }
    .welcome-tour__bullet { color: #ececec; }
    .welcome-tour__dim { color: #98a0b0; }
    .welcome-tour__bullet-icon { background: rgba(46, 160, 67, 0.18); color: #4cd182; }
    .welcome-tour__bullet-icon--info { background: rgba(56, 139, 253, 0.18); color: #6cb6ff; }
    .welcome-tour__bullet-icon--warn { background: rgba(187, 128, 9, 0.22); color: #f3c34c; }
    .welcome-tour__bullet-icon--accent { background: rgba(46, 160, 67, 0.18); color: #4cd182; }
    .welcome-tour__foot-note { color: #6b7280; }
    .welcome-tour__kbd, .welcome-tour__btn-kbd { background: #2a2c33; border-color: #3a3d44; color: #98a0b0; }
    .welcome-tour__legend--info { background: #2c64c0; }
    .welcome-tour__legend--accent { background: #2d8855; }
    .welcome-tour__foot { background: #1f2024; border-top-color: #2c2f36; }
    .welcome-tour__foot-left { color: #98a0b0; }
    .welcome-tour__dot { background: #3a3d44; }
    .welcome-tour__dot--active { background: #ececec; }
    .welcome-tour__dot--done { background: #4cd182; }
    .welcome-tour__btn--ghost { color: #98a0b0; }
    .welcome-tour__btn--ghost:hover:not(:disabled) { color: #ececec; background: #2a2c33; }
    .welcome-tour__btn--secondary { background: #2a2c33; border-color: #3a3d44; color: #ececec; }
    .welcome-tour__btn--secondary:hover:not(:disabled) { background: #34373f; }
    .welcome-tour__btn--primary { background: #ececec; color: #1f2024; }
    .welcome-tour__btn--primary:hover:not(:disabled) { background: #ffffff; }
    .welcome-tour__btn--primary .welcome-tour__btn-kbd { background: rgba(31, 32, 36, 0.18); color: rgba(31, 32, 36, 0.7); }
    .welcome-tour__hero-tag { background: #2a2c33; border-color: #3a3d44; color: #98a0b0; }
    .welcome-tour__hero-dot { background: #4cd182; box-shadow: 0 0 0 3px rgba(46, 160, 67, 0.25); }
    .welcome-tour__hero-meta { color: #98a0b0; }
    .welcome-tour__hero-meta span b { color: #ececec; }
    .welcome-tour__mode-card { background: #2a2c33; border-color: #3a3d44; }
    .welcome-tour__mode-card--featured { border-color: #4cd182; box-shadow: 0 0 0 3px rgba(46, 160, 67, 0.25); }
    .welcome-tour__mode-dot--info { background: #6cb6ff; box-shadow: 0 0 0 3px rgba(56, 139, 253, 0.25); }
    .welcome-tour__mode-dot--warn { background: #f3c34c; box-shadow: 0 0 0 3px rgba(187, 128, 9, 0.25); }
    .welcome-tour__mode-dot--accent { background: #4cd182; box-shadow: 0 0 0 3px rgba(46, 160, 67, 0.25); }
    .welcome-tour__mode-name { color: #ececec; }
    .welcome-tour__mode-sub { color: #98a0b0; }
    .welcome-tour__mode-tag--info { color: #6cb6ff; }
    .welcome-tour__mode-tag--warn { color: #f3c34c; }
    .welcome-tour__mode-tag--accent { color: #4cd182; }
    .welcome-tour__mode-body { color: #98a0b0; }
    .welcome-tour__queue-now { background: #2a2c33; border-color: #4cd182; box-shadow: 0 0 0 3px rgba(46, 160, 67, 0.25); }
    .welcome-tour__queue-now-head { color: #4cd182; }
    .welcome-tour__queue-pulse { background: #4cd182; }
    .welcome-tour__queue-now-name { color: #ececec; }
    .welcome-tour__queue-now-meta { color: #98a0b0; }
    .welcome-tour__queue-pending { background: #2a2c33; border-color: #3a3d44; color: #98a0b0; }
    .welcome-tour__queue-num { background: #34373f; color: #98a0b0; }
    .welcome-tour__queue-name { color: #ececec; }
    .welcome-tour__queue-meta { color: #98a0b0; }
    .welcome-tour__queue-sep { color: #98a0b0; }
    .welcome-tour__queue-sep::before, .welcome-tour__queue-sep::after { background: #2c2f36; }
    .welcome-tour__repo { background: #2a2c33; border-color: #3a3d44; }
    .welcome-tour__repo--current { background: #34373f; border-color: #4a4d55; }
    .welcome-tour__repo-name { color: #ececec; }
    .welcome-tour__repo-branch { color: #98a0b0; background: #34373f; }
    .welcome-tour__repo--current .welcome-tour__repo-branch { background: #2a2c33; }
    .welcome-tour__tunnel-row { background: #2a2c33; border-color: #3a3d44; }
    .welcome-tour__tunnel-ico { background: #34373f; color: #98a0b0; }
    .welcome-tour__tunnel-name { color: #ececec; }
    .welcome-tour__tunnel-sub { color: #98a0b0; }
    .welcome-tour__tunnel-pill { background: rgba(46, 160, 67, 0.18); color: #4cd182; }
    .welcome-tour__tunnel-pill--warn { background: rgba(187, 128, 9, 0.22); color: #f3c34c; }
    .welcome-tour__tunnel-line { background: repeating-linear-gradient(90deg, #3a3d44 0 6px, transparent 6px 12px); }
    .welcome-tour__tunnel-label { color: #98a0b0; }
}
`;
