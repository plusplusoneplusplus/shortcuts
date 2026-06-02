import type { ReactNode } from 'react';
import { CocIcon } from './CocIcon';

/** A single tour step. `visual` is the right-pane illustration. */
export interface WelcomeTourStep {
    /** Stable identifier; used in keyboard navigation and tests. */
    id: string;
    /** Short label shown in the header step ladder ("Welcome", "Modes", …). */
    label: string;
    /** Eyebrow text above the headline ("Step 1 · Modes"). */
    eyebrow: string;
    /** Headline shown on the left pane. May contain a single <br/>. */
    headlineTop: string;
    headlineBottom?: string;
    /** Lead paragraph under the headline. */
    lede: string;
    /** Bullet list — each item is rich JSX. */
    bullets: ReactNode[];
    /** Footer note under the bullets. */
    footNote: ReactNode;
    /** Right-pane illustration. */
    visual: ReactNode;
}

const Check = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
        <polyline points="5,12 10,17 19,7" />
    </svg>
);

const checkBullet = (head: string, dim: string): ReactNode => (
    <>
        <span className="welcome-tour__bullet-icon">
            <Check />
        </span>
        <div>
            <b>{head}</b>
            <span className="welcome-tour__dim"> — {dim}</span>
        </div>
    </>
);

export const WELCOME_TOUR_STEPS: WelcomeTourStep[] = [
    {
        id: 'welcome',
        label: 'Welcome',
        eyebrow: 'Welcome',
        headlineTop: 'A coding companion that',
        headlineBottom: 'runs your queue while you sleep.',
        lede: 'CoC is your team of background agents. You hand off work — across modes, repos, and machines — and it keeps making progress without holding the keyboard.',
        bullets: [
            checkBullet('Three modes', 'Ask, Autopilot, Ralph'),
            checkBullet('A live queue', 'tasks run sequentially, in parallel, or fanned out'),
            checkBullet('Many repositories at once', 'switch context without losing it'),
            checkBullet('Run anywhere', 'attach to a remote dev machine via secure tunnel'),
        ],
        footNote: (
            <>
                Takes about 60 seconds. <kbd className="welcome-tour__kbd">→</kbd> to step through, <kbd className="welcome-tour__kbd">Esc</kbd> to skip.
            </>
        ),
        visual: (
            <div className="welcome-tour__hero">
                <div className="welcome-tour__hero-logo">
                    <CocIcon size={72} idPrefix="welcome-tour-hero" aria-label="CoC" data-testid="welcome-tour-hero-icon" />
                </div>
                <div className="welcome-tour__hero-tag">
                    <span className="welcome-tour__hero-dot" aria-hidden="true" />
                    Background agents · ready
                </div>
                <div className="welcome-tour__hero-meta">
                <span><b>3</b>modes</span>
                    <span><b>∞</b>repos</span>
                    <span><b>1</b>queue</span>
                </div>
            </div>
        ),
    },
    {
        id: 'modes',
        label: 'Modes',
        eyebrow: 'Step 1 · Modes',
        headlineTop: 'Pick how much rope',
        headlineBottom: 'the agent gets.',
        lede: 'Every task runs in a mode. The mode decides whether the agent can write files, run shell, or just read and respond. You can change it mid-task.',
        bullets: [
            <>
                <span className="welcome-tour__bullet-icon welcome-tour__bullet-icon--info">A</span>
                <div>
                    <b>Ask</b>
                    <span className="welcome-tour__dim"> — read-only Q&amp;A. Reads code and explains. Safe to parallelise.</span>
                </div>
            </>,
            <>
                <span className="welcome-tour__bullet-icon welcome-tour__bullet-icon--accent">⇡</span>
                <div>
                    <b>Autopilot</b>
                    <span className="welcome-tour__dim"> — writes files, runs tests, commits. Runs one at a time per repo.</span>
                </div>
            </>,
            <>
                <span className="welcome-tour__bullet-icon welcome-tour__bullet-icon--warn">R</span>
                <div>
                    <b>Ralph</b>
                    <span className="welcome-tour__dim"> — iterates from a goal spec with checkpoints, commits, and final validation.</span>
                </div>
            </>,
        ],
        footNote: (
            <>
                <span className="welcome-tour__legend welcome-tour__legend--info">R</span>
                read-only · parallel-safe ·
                <span className="welcome-tour__legend welcome-tour__legend--accent">W</span>
                read-write · sequential
            </>
        ),
        visual: (
            <div className="welcome-tour__modes">
                <div className="welcome-tour__mode-card">
                    <span className="welcome-tour__mode-dot welcome-tour__mode-dot--info" aria-hidden="true" />
                    <div className="welcome-tour__mode-name">
                        Ask <span className="welcome-tour__mode-sub">read-only</span>
                    </div>
                    <span className="welcome-tour__mode-tag welcome-tour__mode-tag--info">parallel</span>
                    <div className="welcome-tour__mode-body">&ldquo;Where is session validation defined?&rdquo;</div>
                </div>
                <div className="welcome-tour__mode-card">
                    <span className="welcome-tour__mode-dot welcome-tour__mode-dot--warn" aria-hidden="true" />
                    <div className="welcome-tour__mode-name">
                    Autopilot <span className="welcome-tour__mode-sub">read-write</span>
                </div>
                    <span className="welcome-tour__mode-tag welcome-tour__mode-tag--warn">sequential</span>
                    <div className="welcome-tour__mode-body">&ldquo;Migrate auth middleware. Land tests, open PR.&rdquo;</div>
                </div>
                <div className="welcome-tour__mode-card welcome-tour__mode-card--featured">
                    <span className="welcome-tour__mode-dot welcome-tour__mode-dot--accent" aria-hidden="true" />
                    <div className="welcome-tour__mode-name">
                        Ralph <span className="welcome-tour__mode-sub">iterative</span>
                    </div>
                    <span className="welcome-tour__mode-tag welcome-tour__mode-tag--accent">goal loop</span>
                    <div className="welcome-tour__mode-body">&ldquo;Turn this goal into commits and run final checks.&rdquo;</div>
                </div>
            </div>
        ),
    },
    {
        id: 'queue',
        label: 'Queue',
        eyebrow: 'Step 2 · Queue',
        headlineTop: 'Drop work in, walk away,',
        headlineBottom: 'come back to PRs.',
        lede: 'The queue is the centre of CoC. Read-only tasks fan out in parallel. Write tasks run one-at-a-time per repo so they never conflict.',
        bullets: [
            checkBullet('Live status', 'see who is editing what, right now.'),
            checkBullet('Reorder & pause', 'pick the next task before the current one finishes.'),
            checkBullet('Resume anywhere', 'queue persists across machines and restarts.'),
        ],
        footNote: (
            <>
                Tip: pause Autopilot or All from the activity toolbar to stop work cleanly.
            </>
        ),
        visual: (
            <div className="welcome-tour__queue">
                <div className="welcome-tour__queue-now">
                    <div className="welcome-tour__queue-now-head">
                        <span className="welcome-tour__queue-pulse" aria-hidden="true" />
                        Running · 04:12
                    </div>
                    <div className="welcome-tour__queue-now-name">Refactor auth middleware to OAuth2</div>
                    <div className="welcome-tour__queue-now-meta">
                        <span>autopilot</span>
                        <span>· acme-platform</span>
                        <span>· +318 / −201</span>
                    </div>
                </div>
                <div className="welcome-tour__queue-sep">queued · 3</div>
                <div className="welcome-tour__queue-pending">
                    <span className="welcome-tour__queue-num">2</span>
                    <span className="welcome-tour__queue-name">Audit logging coverage</span>
                    <span className="welcome-tour__queue-meta">ask · 4 repos</span>
                </div>
                <div className="welcome-tour__queue-pending">
                    <span className="welcome-tour__queue-num">3</span>
                    <span className="welcome-tour__queue-name">Sketch cache layer for /api/v2</span>
                    <span className="welcome-tour__queue-meta">ask</span>
                </div>
                <div className="welcome-tour__queue-pending">
                    <span className="welcome-tour__queue-num">4</span>
                    <span className="welcome-tour__queue-name">Bump deps · weekly sweep</span>
                    <span className="welcome-tour__queue-meta">script</span>
                </div>
            </div>
        ),
    },
    {
        id: 'multi-repo',
        label: 'Multi-repo',
        eyebrow: 'Step 3 · Multi-repo',
        headlineTop: 'One workspace.',
        headlineBottom: 'Every repo you work on.',
        lede: 'Add repos once and switch between them in the sidebar. Each repo keeps its own queue, branches, and review state — but they all live in the same dashboard.',
        bullets: [
            checkBullet('Cross-repo tasks', 'one Ask query fans out across all of them.'),
            checkBullet('Per-repo rules', 'different modes, different reviewers, different CI.'),
            checkBullet('Repo group views', 'group by service, team, or release train.'),
        ],
        footNote: <>Add repos any time from the workspace menu.</>,
        visual: (
            <div className="welcome-tour__repos">
                <div className="welcome-tour__repo welcome-tour__repo--current">
                    <div className="welcome-tour__repo-ico welcome-tour__repo-ico--a">A</div>
                    <div className="welcome-tour__repo-name"><span className="welcome-tour__dim">acme/</span>platform</div>
                    <span className="welcome-tour__repo-branch">main</span>
                </div>
                <div className="welcome-tour__repo">
                    <div className="welcome-tour__repo-ico welcome-tour__repo-ico--b">W</div>
                    <div className="welcome-tour__repo-name"><span className="welcome-tour__dim">acme/</span>web</div>
                    <span className="welcome-tour__repo-branch">feat/oauth</span>
                </div>
                <div className="welcome-tour__repo">
                    <div className="welcome-tour__repo-ico welcome-tour__repo-ico--c">I</div>
                    <div className="welcome-tour__repo-name"><span className="welcome-tour__dim">acme/</span>infra</div>
                    <span className="welcome-tour__repo-branch">main</span>
                </div>
                <div className="welcome-tour__repo">
                    <div className="welcome-tour__repo-ico welcome-tour__repo-ico--d">M</div>
                    <div className="welcome-tour__repo-name"><span className="welcome-tour__dim">acme/</span>mobile</div>
                    <span className="welcome-tour__repo-branch">release/2.3</span>
                </div>
            </div>
        ),
    },
    {
        id: 'servers',
        label: 'Servers',
        eyebrow: 'Step 4 · Servers',
        headlineTop: 'Local interface.',
        headlineBottom: 'Remote horsepower.',
        lede: 'Attach a remote dev server over an encrypted tunnel. Code lives there, the tunnel forwards ports, your laptop stays a thin client.',
        bullets: [
            checkBullet('Dev tunnels', 'mTLS, scoped per repo, no inbound ports needed.'),
            checkBullet('Bring your own host', 'SSH, Tailscale, GitHub Codespaces, or our agent.'),
            checkBullet('Survives disconnect', 'tasks keep running when you close the lid.'),
        ],
        footNote: <>Add a server in Settings → Servers.</>,
        visual: (
            <div className="welcome-tour__tunnel">
                <div className="welcome-tour__tunnel-row">
                    <div className="welcome-tour__tunnel-ico" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <rect x="3" y="4" width="18" height="12" rx="2" />
                            <path d="M8 20h8M12 16v4" />
                        </svg>
                    </div>
                    <div className="welcome-tour__tunnel-name">
                        This Mac <span className="welcome-tour__tunnel-sub">macOS · M-series</span>
                    </div>
                    <span className="welcome-tour__tunnel-pill">client</span>
                </div>
                <div className="welcome-tour__tunnel-pipe">
                    <div className="welcome-tour__tunnel-line" aria-hidden="true" />
                    <div className="welcome-tour__tunnel-label">mTLS · :443</div>
                    <div className="welcome-tour__tunnel-line" aria-hidden="true" />
                </div>
                <div className="welcome-tour__tunnel-row">
                    <div className="welcome-tour__tunnel-ico" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <rect x="3" y="3" width="18" height="7" rx="1.5" />
                            <rect x="3" y="14" width="18" height="7" rx="1.5" />
                            <circle cx="7" cy="6.5" r=".8" fill="currentColor" />
                            <circle cx="7" cy="17.5" r=".8" fill="currentColor" />
                        </svg>
                    </div>
                    <div className="welcome-tour__tunnel-name">
                        build-01.dev <span className="welcome-tour__tunnel-sub">us-east · 32 vCPU</span>
                    </div>
                    <span className="welcome-tour__tunnel-pill">attached</span>
                </div>
                <div className="welcome-tour__tunnel-row welcome-tour__tunnel-row--warn">
                    <div className="welcome-tour__tunnel-ico" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
                        </svg>
                    </div>
                    <div className="welcome-tour__tunnel-name">
                        gpu-eu-west <span className="welcome-tour__tunnel-sub">on demand</span>
                    </div>
                    <span className="welcome-tour__tunnel-pill welcome-tour__tunnel-pill--warn">idle · ready</span>
                </div>
            </div>
        ),
    },
];
