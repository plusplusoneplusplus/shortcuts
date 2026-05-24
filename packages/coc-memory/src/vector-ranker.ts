/**
 * Vector math utilities for memory search.
 *
 * Handles encoding/decoding Float32 embeddings as SQLite BLOBs and computes
 * cosine similarity between query and stored vectors.
 */

// ---------------------------------------------------------------------------
// Encoding / decoding
// ---------------------------------------------------------------------------

/**
 * Encode a Float32 embedding vector to a Buffer (little-endian IEEE 754).
 * This is the on-disk representation stored in the `embedding` BLOB column.
 */
export function encodeEmbedding(values: Float32Array | number[]): Buffer {
    const arr = values instanceof Float32Array ? values : new Float32Array(values);
    // Copy the underlying ArrayBuffer so we own the memory
    const copy = new Float32Array(arr);
    return Buffer.from(copy.buffer);
}

/**
 * Decode a Buffer back to a Float32Array.
 * The buffer MUST have been produced by `encodeEmbedding`.
 */
export function decodeEmbedding(buf: Buffer): Float32Array {
    // Create a copy to avoid shared-buffer aliasing issues
    const copy = Buffer.allocUnsafe(buf.length);
    buf.copy(copy);
    return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two vectors.
 *
 * Returns a value in [-1, 1].  For unit-normalised embeddings this equals the
 * dot product.  Returns 0 when either vector is the zero vector.
 */
export function cosineSimilarity(
    a: Float32Array | number[],
    b: Float32Array | number[],
): number {
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    return dot / denom;
}

/**
 * Normalise a number array to unit length.
 * Returns the zero vector unchanged (to avoid NaN propagation).
 */
export function normalise(values: number[]): number[] {
    const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
    if (norm === 0) return values.slice();
    return values.map(v => v / norm);
}

/**
 * Recency decay score: `exp(-ageDays / halfLifeDays)`.
 * A fact created today scores 1.0; one created 90 days ago scores ~0.37.
 */
export function recencyScore(createdAt: string, halfLifeDays = 90): number {
    const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return Math.exp(-ageDays / halfLifeDays);
}
