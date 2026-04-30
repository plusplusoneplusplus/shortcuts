import React from 'react';
import { usePreferences } from '../../hooks/preferences/usePreferences';

interface DisplaySettingsSectionProps {
    workspaceId: string;
}

export function DisplaySettingsSection({ workspaceId }: DisplaySettingsSectionProps) {
    const prefs = usePreferences(workspaceId);
    const enabled = prefs.htmlEmbed.enabled;

    if (!prefs.loaded) {
        return (
            <div id="repo-display-section" data-testid="repo-display-section">
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Display</h3>
                <div className="text-xs text-[#848484]">Loading...</div>
            </div>
        );
    }

    return (
        <div id="repo-display-section" data-testid="repo-display-section">
            <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-3">Display</h3>

            <div className="rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                            Inline HTML previews
                        </h4>
                        <p className="mt-1 text-xs text-[#616161] dark:text-[#999]">
                            Render local <span className="font-mono">.html</span> links with the title <span className="font-mono">"embed"</span> as sandboxed previews in chat.
                        </p>
                        <div className="mt-3 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] p-2">
                            <div className="text-[11px] text-[#848484] mb-1">Markdown syntax</div>
                            <code className="text-xs text-[#1e1e1e] dark:text-[#cccccc] break-all">
                                [chart](outputs/chart.html "embed:600")
                            </code>
                        </div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        data-testid="html-embed-toggle"
                        onClick={() => prefs.setHtmlEmbedEnabled(!enabled)}
                        className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
                            enabled
                                ? 'border-[#0078d4] bg-[#0078d4]/10 text-[#0078d4]'
                                : 'border-[#848484]/50 bg-transparent text-[#616161] dark:text-[#999]'
                        }`}
                    >
                        <span>{enabled ? 'On' : 'Off'}</span>
                        <span
                            aria-hidden="true"
                            className={`h-2.5 w-2.5 rounded-full ${enabled ? 'bg-[#0078d4]' : 'bg-[#848484]'}`}
                        />
                    </button>
                </div>
                <p className="mt-3 text-[11px] text-[#848484]">
                    Previews are disabled by default. The iframe omits same-origin access and always keeps the original link visible.
                </p>
            </div>
        </div>
    );
}
