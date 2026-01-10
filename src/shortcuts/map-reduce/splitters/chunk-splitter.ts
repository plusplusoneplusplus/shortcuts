/**
 * Chunk Splitter
 *
 * Splits large content into smaller chunks for processing.
 * Useful for processing large files or texts that exceed model context limits.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { Splitter, WorkItem } from '../types';

/**
 * Input for chunk splitter
 */
export interface ChunkInput {
    /** The content to split into chunks */
    content: string;
    /** Optional source identifier (e.g., file path) */
    source?: string;
    /** Additional context to include with each chunk */
    context?: Record<string, unknown>;
}

/**
 * Work item data for chunk processing
 */
export interface ChunkWorkItemData {
    /** The chunk content */
    content: string;
    /** Chunk index (0-based) */
    chunkIndex: number;
    /** Total number of chunks */
    totalChunks: number;
    /** Source identifier */
    source?: string;
    /** Common context from input */
    context?: Record<string, unknown>;
    /** Start position in original content */
    startOffset?: number;
    /** End position in original content */
    endOffset?: number;
}

/**
 * Options for chunk splitter
 */
export interface ChunkSplitterOptions {
    /**
     * Maximum size of each chunk (in characters)
     * Default: 4000
     */
    maxChunkSize: number;

    /**
     * Number of characters to overlap between chunks
     * Default: 200
     */
    overlapSize: number;

    /**
     * Strategy for splitting
     * - 'character': Split by character count
     * - 'line': Split by line count
     * - 'paragraph': Split by paragraph (double newlines)
     * - 'sentence': Split by sentence boundaries
     * Default: 'character'
     */
    strategy: 'character' | 'line' | 'paragraph' | 'sentence';

    /**
     * Whether to preserve boundaries (lines, paragraphs, etc.)
     * When true, chunks may be smaller than maxChunkSize to avoid
     * breaking boundaries
     * Default: true
     */
    preserveBoundaries: boolean;
}

/**
 * Default chunk splitter options
 */
const DEFAULT_CHUNK_OPTIONS: ChunkSplitterOptions = {
    maxChunkSize: 4000,
    overlapSize: 200,
    strategy: 'character',
    preserveBoundaries: true
};

/**
 * Splitter that divides content into smaller chunks
 */
export class ChunkSplitter implements Splitter<ChunkInput, ChunkWorkItemData> {
    private options: ChunkSplitterOptions;

    constructor(options: Partial<ChunkSplitterOptions> = {}) {
        this.options = { ...DEFAULT_CHUNK_OPTIONS, ...options };
    }

    split(input: ChunkInput): WorkItem<ChunkWorkItemData>[] {
        const { content, source, context } = input;

        if (!content || content.length === 0) {
            return [];
        }

        const chunks = this.splitContent(content);

        return chunks.map((chunk, index) => ({
            id: `chunk-${index}-${source || 'content'}`,
            data: {
                content: chunk.content,
                chunkIndex: index,
                totalChunks: chunks.length,
                source,
                context,
                startOffset: chunk.startOffset,
                endOffset: chunk.endOffset
            },
            metadata: {
                chunkIndex: index,
                totalChunks: chunks.length,
                chunkSize: chunk.content.length
            }
        }));
    }

    /**
     * Split content based on the configured strategy
     */
    private splitContent(content: string): Array<{
        content: string;
        startOffset: number;
        endOffset: number;
    }> {
        switch (this.options.strategy) {
            case 'line':
                return this.splitByLines(content);
            case 'paragraph':
                return this.splitByParagraphs(content);
            case 'sentence':
                return this.splitBySentences(content);
            case 'character':
            default:
                return this.splitByCharacters(content);
        }
    }

    /**
     * Split content by character count
     */
    private splitByCharacters(content: string): Array<{
        content: string;
        startOffset: number;
        endOffset: number;
    }> {
        const { maxChunkSize, overlapSize, preserveBoundaries } = this.options;
        const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];

        let startOffset = 0;

        while (startOffset < content.length) {
            let endOffset = Math.min(startOffset + maxChunkSize, content.length);

            // Try to preserve boundaries if configured
            if (preserveBoundaries && endOffset < content.length) {
                // Look for a good break point (newline, period, space)
                const breakPoints = ['\n\n', '\n', '. ', ' '];
                for (const breakPoint of breakPoints) {
                    const searchStart = Math.max(startOffset, endOffset - 200);
                    const lastBreak = content.lastIndexOf(breakPoint, endOffset);
                    if (lastBreak > searchStart) {
                        endOffset = lastBreak + breakPoint.length;
                        break;
                    }
                }
            }

            chunks.push({
                content: content.slice(startOffset, endOffset),
                startOffset,
                endOffset
            });

            // Move to next chunk with overlap
            startOffset = endOffset - overlapSize;
            if (startOffset >= content.length) {
                break;
            }
        }

        return chunks;
    }

    /**
     * Split content by lines
     */
    private splitByLines(content: string): Array<{
        content: string;
        startOffset: number;
        endOffset: number;
    }> {
        const { maxChunkSize, overlapSize } = this.options;
        const lines = content.split('\n');
        const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];

        let currentChunk: string[] = [];
        let currentSize = 0;
        let startOffset = 0;
        let lineStartOffset = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineSize = line.length + 1; // +1 for newline

            if (currentSize + lineSize > maxChunkSize && currentChunk.length > 0) {
                // Save current chunk
                const chunkContent = currentChunk.join('\n');
                chunks.push({
                    content: chunkContent,
                    startOffset,
                    endOffset: startOffset + chunkContent.length
                });

                // Start new chunk with overlap
                const overlapLines = Math.max(1, Math.floor(overlapSize / 50)); // Estimate lines for overlap
                const overlapStart = Math.max(0, currentChunk.length - overlapLines);
                currentChunk = currentChunk.slice(overlapStart);
                currentSize = currentChunk.reduce((sum, l) => sum + l.length + 1, 0);
                startOffset = lineStartOffset - currentSize;
            }

            currentChunk.push(line);
            currentSize += lineSize;
            lineStartOffset += lineSize;
        }

        // Add final chunk
        if (currentChunk.length > 0) {
            const chunkContent = currentChunk.join('\n');
            chunks.push({
                content: chunkContent,
                startOffset,
                endOffset: startOffset + chunkContent.length
            });
        }

        return chunks;
    }

    /**
     * Split content by paragraphs (double newlines)
     */
    private splitByParagraphs(content: string): Array<{
        content: string;
        startOffset: number;
        endOffset: number;
    }> {
        const { maxChunkSize } = this.options;
        const paragraphs = content.split(/\n\n+/);
        const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];

        let currentChunk: string[] = [];
        let currentSize = 0;
        let startOffset = 0;
        let paragraphStartOffset = 0;

        for (const paragraph of paragraphs) {
            const paragraphSize = paragraph.length + 2; // +2 for \n\n

            if (currentSize + paragraphSize > maxChunkSize && currentChunk.length > 0) {
                // Save current chunk
                const chunkContent = currentChunk.join('\n\n');
                chunks.push({
                    content: chunkContent,
                    startOffset,
                    endOffset: startOffset + chunkContent.length
                });

                // Start new chunk (no overlap for paragraph mode)
                currentChunk = [];
                currentSize = 0;
                startOffset = paragraphStartOffset;
            }

            currentChunk.push(paragraph);
            currentSize += paragraphSize;
            paragraphStartOffset += paragraphSize;
        }

        // Add final chunk
        if (currentChunk.length > 0) {
            const chunkContent = currentChunk.join('\n\n');
            chunks.push({
                content: chunkContent,
                startOffset,
                endOffset: startOffset + chunkContent.length
            });
        }

        return chunks;
    }

    /**
     * Split content by sentences
     */
    private splitBySentences(content: string): Array<{
        content: string;
        startOffset: number;
        endOffset: number;
    }> {
        const { maxChunkSize, overlapSize } = this.options;
        // Simple sentence splitting - matches period/exclamation/question followed by space and capital
        const sentencePattern = /[.!?]+\s+(?=[A-Z])/g;
        const sentences: string[] = [];
        let lastIndex = 0;
        let match;

        while ((match = sentencePattern.exec(content)) !== null) {
            sentences.push(content.slice(lastIndex, match.index + match[0].length - 1));
            lastIndex = match.index + match[0].length - 1;
        }
        if (lastIndex < content.length) {
            sentences.push(content.slice(lastIndex));
        }

        const chunks: Array<{ content: string; startOffset: number; endOffset: number }> = [];
        let currentChunk: string[] = [];
        let currentSize = 0;
        let startOffset = 0;
        let sentenceStartOffset = 0;

        for (const sentence of sentences) {
            const sentenceSize = sentence.length;

            if (currentSize + sentenceSize > maxChunkSize && currentChunk.length > 0) {
                // Save current chunk
                const chunkContent = currentChunk.join(' ');
                chunks.push({
                    content: chunkContent,
                    startOffset,
                    endOffset: startOffset + chunkContent.length
                });

                // Start new chunk with some overlap
                const overlapSentences = Math.max(1, Math.floor(overlapSize / 100));
                const overlapStart = Math.max(0, currentChunk.length - overlapSentences);
                currentChunk = currentChunk.slice(overlapStart);
                currentSize = currentChunk.reduce((sum, s) => sum + s.length + 1, 0);
                startOffset = sentenceStartOffset - currentSize;
            }

            currentChunk.push(sentence);
            currentSize += sentenceSize + 1;
            sentenceStartOffset += sentenceSize + 1;
        }

        // Add final chunk
        if (currentChunk.length > 0) {
            const chunkContent = currentChunk.join(' ');
            chunks.push({
                content: chunkContent,
                startOffset,
                endOffset: startOffset + chunkContent.length
            });
        }

        return chunks;
    }
}

/**
 * Factory function to create a chunk splitter
 */
export function createChunkSplitter(options?: Partial<ChunkSplitterOptions>): ChunkSplitter {
    return new ChunkSplitter(options);
}

/**
 * Create a line-based chunk splitter
 */
export function createLineChunkSplitter(
    maxChunkSize: number = 4000,
    overlapSize: number = 200
): ChunkSplitter {
    return new ChunkSplitter({
        maxChunkSize,
        overlapSize,
        strategy: 'line',
        preserveBoundaries: true
    });
}

/**
 * Create a paragraph-based chunk splitter
 */
export function createParagraphChunkSplitter(maxChunkSize: number = 4000): ChunkSplitter {
    return new ChunkSplitter({
        maxChunkSize,
        overlapSize: 0, // No overlap for paragraphs
        strategy: 'paragraph',
        preserveBoundaries: true
    });
}
