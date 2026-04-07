import { describe, it, expect } from 'vitest';
import { TOUR_SLIDES, type TourSlide } from '../../../../src/server/spa/client/react/welcome/conceptTourSlides';

describe('conceptTourSlides', () => {
    it('exports exactly 5 slides', () => {
        expect(TOUR_SLIDES).toHaveLength(5);
    });

    it('each slide has required fields', () => {
        for (const slide of TOUR_SLIDES) {
            expect(typeof slide.icon).toBe('string');
            expect(slide.icon.length).toBeGreaterThan(0);
            expect(typeof slide.title).toBe('string');
            expect(slide.title.length).toBeGreaterThan(0);
            expect(typeof slide.description).toBe('string');
            expect(slide.description.length).toBeGreaterThan(0);
        }
    });

    it('slide titles match expected concepts', () => {
        const titles = TOUR_SLIDES.map(s => s.title);
        expect(titles).toEqual(['Ask', 'Autopilot', 'Generate Plan', 'Queue', 'Schedules']);
    });

    it('satisfies the TourSlide interface', () => {
        const slide: TourSlide = TOUR_SLIDES[0];
        expect(slide).toBeDefined();
    });
});
