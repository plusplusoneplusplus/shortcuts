/**
 * Tests for shared SkillDetailPanel — loading state, null detail, and rendering all fields.
 * Regression coverage to ensure the shared component works for both AgentSkillsPanel and SkillsInstalledPanel.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkillDetailPanel } from '../../../../src/server/spa/client/react/shared/SkillDetailPanel';
import type { SkillInfo } from '../../../../src/server/spa/client/react/shared/SkillDetailPanel';

describe('SkillDetailPanel (shared)', () => {
    it('shows loading state', () => {
        render(<SkillDetailPanel detail={null} loading={true} />);
        expect(screen.getByTestId('skill-detail-loading')).toBeTruthy();
        expect(screen.getByText('Loading detail...')).toBeTruthy();
    });

    it('renders nothing when detail is null and not loading', () => {
        const { container } = render(<SkillDetailPanel detail={null} loading={false} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders version badge', () => {
        const detail: SkillInfo = { name: 'test-skill', version: '1.2.3' };
        render(<SkillDetailPanel detail={detail} loading={false} />);
        expect(screen.getByTestId('skill-detail-version').textContent).toContain('v1.2.3');
    });

    it('renders variables', () => {
        const detail: SkillInfo = { name: 'test-skill', variables: ['FOO', 'BAR'] };
        render(<SkillDetailPanel detail={detail} loading={false} />);
        const el = screen.getByTestId('skill-detail-variables');
        expect(el.textContent).toContain('2 variables');
        expect(el.textContent).toContain('FOO, BAR');
    });

    it('renders output', () => {
        const detail: SkillInfo = { name: 'test-skill', output: ['result.json'] };
        render(<SkillDetailPanel detail={detail} loading={false} />);
        expect(screen.getByTestId('skill-detail-output').textContent).toContain('result.json');
    });

    it('renders relativePath', () => {
        const detail: SkillInfo = { name: 'test-skill', relativePath: '.github/skills/test-skill' };
        render(<SkillDetailPanel detail={detail} loading={false} />);
        expect(screen.getByTestId('skill-detail-path').textContent).toContain('.github/skills/test-skill');
    });

    it('renders references', () => {
        const detail: SkillInfo = { name: 'test-skill', references: ['ref1.md', 'ref2.md'] };
        render(<SkillDetailPanel detail={detail} loading={false} />);
        const section = screen.getByTestId('skill-detail-references');
        expect(section.textContent).toContain('ref1.md');
        expect(section.textContent).toContain('ref2.md');
    });

    it('renders scripts', () => {
        const detail: SkillInfo = { name: 'test-skill', scripts: ['build.sh'] };
        render(<SkillDetailPanel detail={detail} loading={false} />);
        const section = screen.getByTestId('skill-detail-scripts');
        expect(section.textContent).toContain('build.sh');
    });

    it('renders prompt body', () => {
        const detail: SkillInfo = { name: 'test-skill', promptBody: 'Do the thing' };
        render(<SkillDetailPanel detail={detail} loading={false} />);
        const section = screen.getByTestId('skill-detail-prompt');
        expect(section.textContent).toContain('Do the thing');
    });

    it('renders all fields together', () => {
        const detail: SkillInfo = {
            name: 'full-skill',
            description: 'A full skill',
            version: '2.0.0',
            variables: ['X'],
            output: ['out.txt'],
            promptBody: 'prompt text',
            references: ['a.md'],
            scripts: ['run.sh'],
            relativePath: '.github/skills/full-skill',
        };
        render(<SkillDetailPanel detail={detail} loading={false} />);
        expect(screen.getByTestId('skill-detail-panel')).toBeTruthy();
        expect(screen.getByTestId('skill-detail-version')).toBeTruthy();
        expect(screen.getByTestId('skill-detail-variables')).toBeTruthy();
        expect(screen.getByTestId('skill-detail-output')).toBeTruthy();
        expect(screen.getByTestId('skill-detail-path')).toBeTruthy();
        expect(screen.getByTestId('skill-detail-references')).toBeTruthy();
        expect(screen.getByTestId('skill-detail-scripts')).toBeTruthy();
        expect(screen.getByTestId('skill-detail-prompt')).toBeTruthy();
    });

    it('singular variable text for single variable', () => {
        const detail: SkillInfo = { name: 'test-skill', variables: ['ONLY'] };
        render(<SkillDetailPanel detail={detail} loading={false} />);
        expect(screen.getByTestId('skill-detail-variables').textContent).toContain('1 variable:');
    });
});
