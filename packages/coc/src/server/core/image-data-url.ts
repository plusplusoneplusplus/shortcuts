/** Server attachment recognition; does not decode or validate the payload. */
export function isImageDataUrl(value: string): boolean {
    return /^data:image\/[\w+]+;base64,.+/.test(value);
}

/** Display policy accepts known browser formats, case-insensitive headers and empty payloads. */
export function isDisplayImageDataUrl(value: string): boolean {
    return /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(value.trim());
}
