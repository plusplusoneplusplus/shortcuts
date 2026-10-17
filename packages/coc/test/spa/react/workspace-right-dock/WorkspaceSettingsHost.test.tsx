/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import {
    WorkspaceSettingsProvider, WorkspaceSettingsSlot,
} from '../../../../src/server/spa/client/react/features/repo-settings/WorkspaceSettingsHost';

afterEach(cleanup);

const mount = vi.fn();
function Form({ inPanel }: { inPanel: boolean }) {
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    useEffect(() => { mount(); }, []);
    return <div data-testid="settings-form" data-panel={inPanel}>
        <input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} />
        <button onClick={() => setError('Validation failed')}>Save</button>
        {error && <div role="alert">{error}</div>}
    </div>;
}

function Page({ top = false, panel = true, active = true, owner = 'ws-a', tabOwner = owner }: {
    top?: boolean; panel?: boolean; active?: boolean; owner?: string; tabOwner?: string;
}) {
    return <WorkspaceSettingsProvider ownerKey={owner} topLevelActive={top} renderPage={inPanel => <Form inPanel={inPanel} />}>
        <WorkspaceSettingsSlot />
        {panel && <WorkspaceSettingsSlot panel active={active} ownerKey={tabOwner} />}
    </WorkspaceSettingsProvider>;
}

describe('one shared Settings page', () => {
    it('mounts lazily and retains the exact form, edits and validation across top/panel moves and closing', () => {
        mount.mockClear();
        const view = render(<Page panel={false} />);
        expect(screen.queryByTestId('settings-form')).toBeNull();
        view.rerender(<Page top panel={false} />);
        const input = screen.getByRole('textbox', { name: 'Draft' });
        fireEvent.change(input, { target: { value: 'unsaved' } });
        fireEvent.click(screen.getByText('Save'));
        view.rerender(<Page />);
        expect(within(screen.getByTestId('panel-settings-host')).getByRole('textbox')).toBe(input);
        expect(input).toHaveValue('unsaved');
        expect(screen.getByRole('alert')).toHaveTextContent('Validation failed');
        view.rerender(<Page panel={false} />);
        view.rerender(<Page top panel={false} />);
        expect(within(screen.getByTestId('top-settings-host')).getByRole('textbox')).toBe(input);
        expect(mount).toHaveBeenCalledTimes(1);
    });

    it('opens in the panel even while the top-level Settings tab is selected', () => {
        const view = render(<Page top panel={false} />);
        const input = screen.getByRole('textbox');
        view.rerender(<Page top />);
        expect(within(screen.getByTestId('panel-settings-host')).getByRole('textbox')).toBe(input);
        fireEvent.click(screen.getByText('Show Settings here'));
        expect(within(screen.getByTestId('top-settings-host')).getByRole('textbox')).toBe(input);
        view.rerender(<Page top active={false} />);
        view.rerender(<Page top active />);
        expect(within(screen.getByTestId('panel-settings-host')).getByRole('textbox')).toBe(input);
    });

    it('keeps matching local and remote owners separate, and rejects stale tab ownership', () => {
        const view = render(<Page owner="remote:server-a:ws-a" />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'remote draft' } });
        view.rerender(<Page owner="remote:server-b:ws-a" tabOwner="remote:server-a:ws-a" />);
        expect(screen.getByRole('status')).toHaveTextContent('unavailable');
        expect(screen.queryByRole('textbox')).toBeNull();
        view.rerender(<Page owner="ws-a" />);
        expect(screen.getByRole('textbox')).toHaveValue('');
    });
});
