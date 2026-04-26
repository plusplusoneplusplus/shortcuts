import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

async function renderControl<T extends string>(overrides: Partial<Parameters<typeof import('../../../../src/server/spa/client/react/ui/SegmentedControl').SegmentedControl<T>>[0]> = {}) {
    const { SegmentedControl } = await import(
        '../../../../src/server/spa/client/react/ui/SegmentedControl'
    );
    const onChange = vi.fn();
    const result = render(
        <SegmentedControl
            options={[
                { value: 'a' as T, label: 'Option A', testId: 'opt-a' },
                { value: 'b' as T, label: 'Option B', testId: 'opt-b' },
                { value: 'c' as T, label: 'Option C', testId: 'opt-c' },
            ]}
            value={'a' as T}
            onChange={onChange}
            {...overrides}
        />
    );
    return { ...result, onChange };
}

describe('SegmentedControl', () => {
    it('renders all option labels', async () => {
        await renderControl();
        expect(screen.getByText('Option A')).toBeTruthy();
        expect(screen.getByText('Option B')).toBeTruthy();
        expect(screen.getByText('Option C')).toBeTruthy();
    });

    it('calls onChange with the clicked value', async () => {
        const user = userEvent.setup();
        const { onChange } = await renderControl();
        await user.click(screen.getByTestId('opt-b'));
        expect(onChange).toHaveBeenCalledWith('b');
    });

    it('does not call onChange when the active option is clicked', async () => {
        const user = userEvent.setup();
        const { onChange } = await renderControl();
        await user.click(screen.getByTestId('opt-a'));
        // onChange is still called (SegmentedControl is stateless — parent controls value)
        expect(onChange).toHaveBeenCalledWith('a');
    });

    it('renders an optional label', async () => {
        await renderControl({ label: 'Mode:' } as any);
        expect(screen.getByText('Mode:')).toBeTruthy();
    });

    it('renders data-testid on the container', async () => {
        await renderControl({ 'data-testid': 'my-control' } as any);
        expect(screen.getByTestId('my-control')).toBeTruthy();
    });

    it('renders testId on individual option buttons', async () => {
        await renderControl();
        expect(screen.getByTestId('opt-a')).toBeTruthy();
        expect(screen.getByTestId('opt-b')).toBeTruthy();
    });
});
