import type { RepositoryFolderBrowser } from './useRepositoryFolderBrowser';

export function RepositoryBrowseRoots({ browser, disabled, testIdPrefix = 'browse-root' }: {
    browser: RepositoryFolderBrowser;
    disabled?: boolean;
    testIdPrefix?: string;
}) {
    const { browserPath, browseRoots, browserDrives, navigateTo } = browser;
    const roots = browseRoots.length > 0
        ? browseRoots
        : browserDrives.length > 1 ? browserDrives.map(path => ({ path, label: path })) : [];
    if (roots.length === 0) return null;
    return (
        <div className="mb-1 flex flex-wrap gap-1">
            {roots.map(root => (
                <button
                    key={root.path}
                    type="button"
                    className={`px-1 py-0.5 rounded border text-[10px] ${browserPath.toLowerCase().startsWith(root.path.toLowerCase())
                        ? 'border-[#0078d4] text-[#0078d4]'
                        : 'border-[#d0d0d0] text-[#666] dark:border-[#444] dark:text-[#aaa]'}`}
                    data-testid={browseRoots.length > 0 ? `${testIdPrefix}-${root.label}` : undefined}
                    disabled={disabled}
                    onClick={() => navigateTo(root.path)}
                >
                    {root.label}
                </button>
            ))}
        </div>
    );
}
