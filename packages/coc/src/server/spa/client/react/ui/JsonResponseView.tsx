/**
 * JsonResponseView — renders parsed JSON with an interactive collapsible tree.
 * Uses @uiw/react-json-view with dark/light theme from the dashboard.
 */
import React, { useMemo } from 'react';
import JsonView from '@uiw/react-json-view';
import { darkTheme } from '@uiw/react-json-view/dark';
import { lightTheme } from '@uiw/react-json-view/light';

interface JsonResponseViewProps {
    content: string;
}

function useIsDark(): boolean {
    // ThemeProvider toggles the `dark` class on <html> — read it directly.
    return document.documentElement.classList.contains('dark');
}

export function JsonResponseView({ content }: JsonResponseViewProps) {
    const parsed = useMemo(() => {
        try { return JSON.parse(content.trim()); } catch { return null; }
    }, [content]);

    const isDark = useIsDark();

    if (parsed === null) return null;

    return (
        <div className="json-response-view rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#ffffff] dark:bg-[#1e1e1e] overflow-auto max-h-[600px] p-3 font-mono text-xs">
            <JsonView
                value={parsed}
                collapsed={3}
                enableClipboard={true}
                displayDataTypes={false}
                shortenTextAfterLength={0}
                style={{
                    ...(isDark ? darkTheme : lightTheme),
                    backgroundColor: 'transparent',
                }}
            />
        </div>
    );
}
