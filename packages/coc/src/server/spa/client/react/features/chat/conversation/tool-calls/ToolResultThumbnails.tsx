import type { ToolResultPresentation } from './toolResultPresentation';

export function ToolResultThumbnails({ images, onImageClick }: {
    images: ToolResultPresentation['images'];
    onImageClick?: (src: string, alt?: string) => void;
}) {
    return <div className="flex flex-wrap gap-2">
        {images.map((image, index) => <button
            key={index}
            type="button"
            aria-label={`Enlarge ${image.alt}`}
            className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden cursor-zoom-in"
            disabled={!onImageClick}
            onClick={event => { event.stopPropagation(); onImageClick?.(image.src, image.alt); }}
        >
            <img src={image.src} alt={image.alt} className="max-w-64 max-h-40 object-contain" data-testid="tool-result-thumbnail" />
        </button>)}
    </div>;
}
