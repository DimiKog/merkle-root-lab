import type { MerkleResult } from "../types";

/**
 * SHA-256 of a string using the browser's Web Crypto API.
 * Returns a lowercase hex string.
 */
async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Builds a Merkle tree from an array of leaf hashes.
 *
 * Rules:
 *  - Leaves are NOT re-hashed; they are used as-is.
 *  - At each level, adjacent pairs are concatenated and SHA-256'd.
 *  - If a level has an odd number of nodes, the last node is duplicated.
 *
 * Returns the root hash, every level, and which node indices were duplicated.
 */
export async function calculateMerkleRoot(
  leafHashes: string[]
): Promise<MerkleResult> {
  if (leafHashes.length === 0) {
    throw new Error("At least one leaf hash is required.");
  }

  const levels: string[][] = [];
  const duplicatedIndices = new Map<number, Set<number>>();

  // Level 0 — the leaves themselves
  levels.push([...leafHashes]);

  let current = [...leafHashes];

  while (current.length > 1) {
    const levelDuplicates = new Set<number>();

    // Duplicate last node when count is odd
    if (current.length % 2 !== 0) {
      current.push(current[current.length - 1]);
      levelDuplicates.add(current.length - 1);
    }

    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const parent = await sha256(current[i] + current[i + 1]);
      next.push(parent);
    }

    // Store duplicate info keyed to the level we just processed
    if (levelDuplicates.size > 0) {
      duplicatedIndices.set(levels.length - 1, levelDuplicates);
    }

    levels.push(next);
    current = next;
  }

  return {
    root: current[0],
    levels,
    duplicatedIndices,
  };
}

/** Pre-generated sample SHA-256-like hex strings for classroom demos. */
export const SAMPLE_HASHES: string[] = [
  "a3f1c2e4b5d6a7f8e9c0b1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2",
  "b4e2d1c3a5f7e8d9c0b2a3f4e5d6c7b8a9e0f1d2c3b4a5f6e7d8c9b0a1f2e3d4",
  "c5f3e2d1b4a6e9f8d7c0b3a4e5f6d7c8b9a0e1f2d3c4b5a6f7e8d9c0b1a2f3e4",
  "d6a4f3e2c1b5f0e9d8c7b6a5e4f3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5",
  "e7b5a4f3d2c1e0f9d8c7b6a5f4e3d2c1b0a9e8f7d6c5b4a3e2f1d0c9b8a7e6f5",
];
