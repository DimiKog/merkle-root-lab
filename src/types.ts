export interface MerkleResult {
  root: string;
  levels: string[][];
  /** indices of duplicated nodes per level (level index -> set of node indices) */
  duplicatedIndices: Map<number, Set<number>>;
}

export interface ValidationError {
  field: string;
  message: string;
}
