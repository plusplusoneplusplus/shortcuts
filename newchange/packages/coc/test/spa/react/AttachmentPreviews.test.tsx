// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { AttachmentPreviews } from '../../../src/server/spa/client/react/shared/AttachmentPreviews';
import type { ChatAttachment } from '../../../src/server/spa/client/react/types/attachments';

afterEach(() => {
    vi.restoreAllMocks();
});

function makeAttachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
    return {
        id: 'att-1',
        name: 'test.png',
        mimeType: 'image/png',
        size: 1024,
        dataUrl: 'data:image/png;base64,aaaa',
        category: 'image',
        ...overrides,
    };
}

describe('AttachmentPreviews', () => {
    it('renders nothing when attachments is empty', () => {
        const { container } = render(<AttachmentPreviews attachments={[]} onRemove={vi.fn()} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders image thumbnail for image attachment', () => {
        const att = makeAttachment({ category: 'image' });
        render(<AttachmentPreviews attachments={[att]} onRemove={vi.fn()} />);

        const img = screen.getByRole('img');
        expect(img.getAttribute('src')).toBe(att.dataUrl);
        expect(screen.getByTestId('attachment-preview-image')).toBeTruthy();
    });

    it('renders file chip for text attachment', () => {
        const att = makeAttachment({
            id: 'att-txt',
            name: 'readme.md',
            mimeType: 'text/markdown',
            size: 256,
            category: 'text',
            dataUrl: 'data:text/markdown;base64,IyBIZWxsbw==',
        });
        render(<AttachmentPreviews attachments={[att]} onRemove={vi.fn()} />);

        expect(screen.getByTestId('attachment-preview-file')).toBeTruthy();
        expect(screen.getByText('readme.md')).toBeTruthy();
        expect(screen.getByText('📄')).toBeTruthy();
    });

    it('renders file chip for binary attachment', () => {
        const att = makeAttachment({
            id: 'att-bin',
            name: 'data.zip',
            mimeType: 'application/zip',
            size: 5000,
            category: 'binary',
            dataUrl: 'data:application/zip;base64,UEsDBBQ=',
        });
        render(<AttachmentPreviews attachments={[att]} onRemove={vi.fn()} />);

        expect(screen.getByTestId('attachment-preview-file')).toBeTruthy();
        expect(screen.getByText('data.zip')).toBeTruthy();
        expect(screen.getByText('📎')).toBeTruthy();
    });

    it('shows file size on file chips', () => {
        const att = makeAttachment({
            id: 'att-size',
            name: 'code.ts',
            mimeType: 'text/typescript',
            size: 2048,
            category: 'text',
            dataUrl: 'data:text/typescript;base64,Y29uc3QgeCA9IDE=',
        });
        render(<AttachmentPreviews attachments={[att]} onRemove={vi.fn()} />);

        expect(screen.getByText('2.0 KB')).toBeTruthy();
    });

    it('remove button calls onRemove with correct id', () => {
        const onRemove = vi.fn();
        const att = makeAttachment({ id: 'att-remove-me' });
        render(<AttachmentPreviews attachments={[att]} onRemove={onRemove} />);

        fireEvent.click(screen.getByTestId('remove-attachment-att-remove-me'));
        expect(onRemove).toHaveBeenCalledWith('att-remove-me');
    });

    it('remove button click stops propagation', () => {
        const parentClick = vi.fn();
        const onRemove = vi.fn();
        const att = makeAttachment({ id: 'att-stop' });
        render(
            <div onClick={parentClick}>
                <AttachmentPreviews attachments={[att]} onRemove={onRemove} />
            </div>
        );

        fireEvent.click(screen.getByTestId('remove-attachment-att-stop'));
        expect(onRemove).toHaveBeenCalledWith('att-stop');
        expect(parentClick).not.toHaveBeenCalled();
    });

    it('clicking an image thumbnail opens the lightbox', () => {
        const att = makeAttachment();
        render(<AttachmentPreviews attachments={[att]} onRemove={vi.fn()} />);

        expect(screen.queryByTestId('image-lightbox')).toBeNull();
        fireEvent.click(screen.getByRole('img'));
        expect(screen.getByTestId('image-lightbox')).toBeTruthy();
    });

    it('renders mixed image and file attachments', () => {
        const imgAtt = makeAttachment({ id: 'img-1', name: 'photo.jpg', category: 'image' });
        const txtAtt = makeAttachment({
            id: 'txt-1',
            name: 'notes.txt',
            mimeType: 'text/plain',
            category: 'text',
            dataUrl: 'data:text/plain;base64,aGVsbG8=',
        });
        const binAtt = makeAttachment({
            id: 'bin-1',
            name: 'data.bin',
            mimeType: 'application/octet-stream',
            category: 'binary',
            dataUrl: 'data:application/octet-stream;base64,AAAA',
        });
        render(<AttachmentPreviews attachments={[imgAtt, txtAtt, binAtt]} onRemove={vi.fn()} />);

        expect(screen.getByTestId('attachment-preview-image')).toBeTruthy();
        expect(screen.getAllByTestId('attachment-preview-file')).toHaveLength(2);
    });
});
