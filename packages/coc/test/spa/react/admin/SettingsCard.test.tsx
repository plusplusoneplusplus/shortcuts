import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsCard } from '../../../../src/server/spa/client/react/admin/SettingsCard';

describe('SettingsCard', () => {
    it('renders title and children', () => {
        render(
            <SettingsCard title="Test Card" data-testid="test-card">
                <span>child content</span>
            </SettingsCard>,
        );
        expect(screen.getByText('Test Card')).toBeDefined();
        expect(screen.getByText('child content')).toBeDefined();
    });

    it('renders description when provided', () => {
        render(
            <SettingsCard title="T" description="A description">
                <span />
            </SettingsCard>,
        );
        expect(screen.getByText('A description')).toBeDefined();
    });

    it('renders badge when provided', () => {
        render(
            <SettingsCard title="T" badge="Global">
                <span />
            </SettingsCard>,
        );
        expect(screen.getByText('Global')).toBeDefined();
    });

    it('renders Save button when onSave is provided', () => {
        render(
            <SettingsCard title="T" onSave={() => {}} data-testid="card">
                <span />
            </SettingsCard>,
        );
        expect(screen.getByTestId('card-save')).toBeDefined();
    });

    it('Save button is disabled when not dirty', () => {
        render(
            <SettingsCard title="T" onSave={() => {}} dirty={false} data-testid="card">
                <span />
            </SettingsCard>,
        );
        expect((screen.getByTestId('card-save') as HTMLButtonElement).disabled).toBe(true);
    });

    it('Save button is enabled when dirty', () => {
        render(
            <SettingsCard title="T" onSave={() => {}} dirty={true} data-testid="card">
                <span />
            </SettingsCard>,
        );
        expect((screen.getByTestId('card-save') as HTMLButtonElement).disabled).toBe(false);
    });

    it('Cancel button is disabled when not dirty', () => {
        render(
            <SettingsCard title="T" onSave={() => {}} onCancel={() => {}} dirty={false} data-testid="card">
                <span />
            </SettingsCard>,
        );
        expect((screen.getByTestId('card-cancel') as HTMLButtonElement).disabled).toBe(true);
    });

    it('Cancel button calls onCancel when clicked', () => {
        const onCancel = vi.fn();
        render(
            <SettingsCard title="T" onSave={() => {}} onCancel={onCancel} dirty={true} data-testid="card">
                <span />
            </SettingsCard>,
        );
        fireEvent.click(screen.getByTestId('card-cancel'));
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('does not render Save/Cancel footer when onSave is not provided', () => {
        render(
            <SettingsCard title="T" data-testid="card">
                <span />
            </SettingsCard>,
        );
        expect(screen.queryByTestId('card-save')).toBeNull();
        expect(screen.queryByTestId('card-cancel')).toBeNull();
    });
});
