import type { TourSlide } from './conceptTourSlides';

export interface ConceptTourSlideProps {
    slide: TourSlide;
}

export function ConceptTourSlide({ slide }: ConceptTourSlideProps) {
    return (
        <div className="flex flex-col items-center text-center gap-4">
            <span className="text-5xl" role="img" aria-label={slide.title}>
                {slide.icon}
            </span>
            <h2 className="text-lg font-bold text-[#1e1e1e] dark:text-[#cccccc]">
                {slide.title}
            </h2>
            <p className="text-sm text-[#616161] dark:text-[#999] max-w-[320px] mx-auto">
                {slide.description}
            </p>
        </div>
    );
}
