import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastContainer } from '../../../src/server/spa/client/react/shared/Toast';
import type { ToastItem } from '../../../src/server/spa/client/react/shared/Toast';

describe('ToastContainer', () => {
    const makeToasts = (count: number): ToastItem[] =>
        Array.from({ length: count }, (_, i) => ({
            id: `toast-${i}`,
            message: `Toast ${i}`,
            type: 'info' as const,
        }));

    it('renders each toast in toasts', () => {
        const toasts = makeToasts(3);
        render(<ToastContainer toasts={toasts} removeToast={vi.fn()} />);
        expect(screen.getByText('Toast 0')).toBeDefined();
        expect(screen.getByText('Toast 1')).toBeDefined();
        expect(screen.getByText('Toast 2')).toBeDefined();
    });

    it('clicking a toast calls removeToast with its id', () => {
        const removeToast = vi.fn();
        const toasts = makeToasts(2);
        render(<ToastContainer toasts={toasts} removeToast={removeToast} />);
        fireEvent.click(screen.getByText('Toast 1'));
        expect(removeToast).toHaveBeenCalledWith('toast-1');
    });

    it('renders into document.body via createPortal', () => {
        const toasts = makeToasts(1);
        render(<ToastContainer toasts={toasts} removeToast={vi.fn()} />);
        const container = document.querySelector('.fixed.bottom-5.right-5');
        expect(container?.parentElement).toBe(document.body);
    });

    it('renders empty when no toasts', () => {
        render(<ToastContainer toasts={[]} removeToast={vi.fn()} />);
        const container = document.querySelector('.fixed.bottom-5.right-5');
        expect(container?.children.length).toBe(0);
    });

    it('applies success type classes', () => {
        const toasts: ToastItem[] = [{ id: '1', message: 'Success!', type: 'success' }];
        render(<ToastContainer toasts={toasts} removeToast={vi.fn()} />);
        const el = screen.getByText('Success!');
        expect(el.className).toContain('bg-[#16825d]');
    });

    it('applies error type classes', () => {
        const toasts: ToastItem[] = [{ id: '1', message: 'Error!', type: 'error' }];
        render(<ToastContainer toasts={toasts} removeToast={vi.fn()} />);
        const el = screen.getByText('Error!');
        expect(el.className).toContain('bg-[#f14c4c]');
    });
});
