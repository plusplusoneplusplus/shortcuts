// Admin "Dreams" tab — the single home for Dreams configuration and activity.
//
// Lives in the dashboard's "Knowledge" nav group (alongside Memory and
// Skills) and is embedded inside the admin shell. This tab owns:
//   • the global `dreams.enabled` toggle,
//   • the running-interval (`dreams.idleCheckIntervalMs`, edited in minutes),
//   • default provider / model / timeout for idle-triggered Dream runs, and
//   • the "Dreams provider activity" queue + history.
//
// The per-workspace dream-cards review panel (`DreamsPanel`) is a separate,
// untouched surface under each repo's detail view.

export function DreamsView() {
    return (
        <div className="aip-page" data-testid="dreams-admin-page">
            <div className="aip-page-head">
                <div>
                    <h2 className="ar-page-title">Dreams</h2>
                    <p className="ar-page-desc">
                        Enable Dreams, tune the idle-reflection schedule and defaults, and watch the
                        provider activity queue — all from one place.
                    </p>
                </div>
                <span className="ar-badge ar-badge-accent"><span className="aip-dot" /> Restart-aware</span>
            </div>
        </div>
    );
}
