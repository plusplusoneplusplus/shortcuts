/**
 * Tests for ToolCallView — the run_tool_script card shows the script as code.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

describe('ToolCallView — run_tool_script', () => {
    it('renders the script as a code block instead of raw arguments JSON', () => {
        const { container } = render(<ToolCallView toolCall={{
            id: 'script-1',
            toolName: 'run_tool_script',
            args: { code: 'const r = await tools.search_conversations({ query: "x" });\nreturn r;' },
            status: 'completed',
            result: '{"result":1,"logs":[],"calls":[],"callCount":0}',
        }} />);
        const code = container.querySelector('[data-testid="tool-script-code"]');
        expect(code?.textContent).toBe('const r = await tools.search_conversations({ query: "x" });\nreturn r;');
        expect(container.textContent).not.toContain('"code":');
        expect(container.textContent).toContain('"callCount": 0');
    });
});
