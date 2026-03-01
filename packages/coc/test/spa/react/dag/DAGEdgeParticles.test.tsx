import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DAGEdgeParticles } from '../../../../src/server/spa/client/react/processes/dag/DAGEdgeParticles';

describe('DAGEdgeParticles', () => {
    const defaultProps = {
        pathD: 'M 0 0 L 100 100',
        color: '#0078d4',
        particleCount: 3,
        durationMs: 1200,
    };

    it('renders correct number of circle elements', () => {
        const { container } = render(
            <svg><DAGEdgeParticles {...defaultProps} /></svg>
        );
        const circles = container.querySelectorAll('circle');
        expect(circles.length).toBe(3);
    });

    it('each circle has an animateMotion child', () => {
        const { container } = render(
            <svg><DAGEdgeParticles {...defaultProps} /></svg>
        );
        const circles = container.querySelectorAll('circle');
        circles.forEach(circle => {
            const animateMotion = circle.querySelector('animateMotion');
            expect(animateMotion).toBeTruthy();
        });
    });

    it('animateMotion has correct dur and path attributes', () => {
        const { container } = render(
            <svg><DAGEdgeParticles {...defaultProps} /></svg>
        );
        const animateMotions = container.querySelectorAll('animateMotion');
        animateMotions.forEach(am => {
            expect(am.getAttribute('dur')).toBe('1200ms');
            expect(am.getAttribute('path')).toBe('M 0 0 L 100 100');
            expect(am.getAttribute('repeatCount')).toBe('indefinite');
        });
    });

    it('staggered begin values are evenly spaced', () => {
        const { container } = render(
            <svg><DAGEdgeParticles {...defaultProps} /></svg>
        );
        const animateMotions = container.querySelectorAll('animateMotion');
        const begins = Array.from(animateMotions).map(am => am.getAttribute('begin'));
        // 3 particles, 1200ms: begin = 0ms, 400ms, 800ms
        expect(begins).toEqual(['0ms', '400ms', '800ms']);
    });

    it('uses correct color', () => {
        const { container } = render(
            <svg><DAGEdgeParticles {...defaultProps} color="#ff0000" /></svg>
        );
        const circles = container.querySelectorAll('circle');
        circles.forEach(circle => {
            expect(circle.getAttribute('fill')).toBe('#ff0000');
        });
    });

    it('renders single particle correctly', () => {
        const { container } = render(
            <svg><DAGEdgeParticles {...defaultProps} particleCount={1} /></svg>
        );
        const circles = container.querySelectorAll('circle');
        expect(circles.length).toBe(1);
        const am = circles[0].querySelector('animateMotion');
        expect(am?.getAttribute('begin')).toBe('0ms');
    });

    it('circles have correct radius and opacity', () => {
        const { container } = render(
            <svg><DAGEdgeParticles {...defaultProps} /></svg>
        );
        const circles = container.querySelectorAll('circle');
        circles.forEach(circle => {
            expect(circle.getAttribute('r')).toBe('3');
            expect(circle.getAttribute('opacity')).toBe('0.85');
        });
    });

    it('renders with data-testid', () => {
        const { container } = render(
            <svg><DAGEdgeParticles {...defaultProps} /></svg>
        );
        const g = container.querySelector('[data-testid="dag-edge-particles"]');
        expect(g).toBeTruthy();
    });
});
