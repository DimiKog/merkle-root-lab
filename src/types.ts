/**
 * How the tree is built. Every field changes the resulting root, which is the point of the lab.
 */
export interface MerkleConfig {
  /** "text": hash the concatenated hex strings (simple, classroom). "bytes": hash the decoded 32-byte values (real systems). */
  encoding: "text" | "bytes";
  /** Apply SHA-256 twice (Bitcoin). */
  doubleSha: boolean;
  /** Odd node at the end of a level: copy it ("duplicate", Bitcoin) or pass it up unchanged ("promote", RFC 6962 style). */
  oddRule: "duplicate" | "promote";
  /** Prefix 0x00 to leaf hashes and 0x01 to inner hashes so a leaf can never be confused with an inner node. */
  domainSeparation: boolean;
  /** Bitcoin shows hashes byte-reversed. Only meaningful with encoding "bytes". */
  reverseBytes: boolean;
}

export type PresetId = "classroom" | "bitcoin" | "rfc6962" | "custom";

export type NodeKind = "leaf" | "node" | "duplicate" | "promoted";

export interface TreeNode {
  hash: string;
  kind: NodeKind;
}

export interface MerkleResult {
  root: string;
  /** levels[0] are the leaves, the last level holds the root. A duplicated node is stored (kind "duplicate"). */
  levels: TreeNode[][];
  config: MerkleConfig;
  /** The leaf values before leaf hashing (64-hex strings). */
  leafValues: string[];
}

export interface ProofStep {
  level: number;
  siblingIndex: number;
  sibling: string;
  /** Where the sibling sits relative to the running hash. */
  side: "left" | "right";
  siblingKind: NodeKind;
}

export interface VerifyTraceStep {
  level: number;
  left: string;
  right: string;
  result: string;
}

export interface VerifyResult {
  valid: boolean;
  leafNode: string;
  computedRoot: string;
  trace: VerifyTraceStep[];
}

export interface ValidationError {
  field: string;
  message: string;
}
