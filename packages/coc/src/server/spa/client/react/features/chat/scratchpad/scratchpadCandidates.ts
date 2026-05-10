export interface ScratchpadCandidateFile {
    filePath: string;
}

export interface ScratchpadCandidateInput {
    linkedNotePath?: string | null;
    knownFiles?: string[];
    createdFiles?: ScratchpadCandidateFile[];
    effectivePlanPath?: string;
    invalidPaths?: ReadonlySet<string>;
}

export function buildScratchpadCandidates({
    linkedNotePath,
    knownFiles = [],
    createdFiles = [],
    effectivePlanPath,
    invalidPaths = new Set(),
}: ScratchpadCandidateInput): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];

    const add = (path: string | null | undefined) => {
        if (!path) return;
        const key = path.toLowerCase();
        if (!key.endsWith('.md') || invalidPaths.has(key) || seen.has(key)) return;
        seen.add(key);
        candidates.push(path);
    };

    add(linkedNotePath);
    for (const path of knownFiles) add(path);
    for (const file of createdFiles) add(file.filePath);
    add(effectivePlanPath);

    return candidates;
}
