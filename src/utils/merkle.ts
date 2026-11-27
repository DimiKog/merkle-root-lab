import type {
  MerkleConfig,
  MerkleResult,
  PresetId,
  ProofStep,
  TreeNode,
  VerifyResult,
  VerifyTraceStep,
} from "../types.ts";

const encoder = new TextEncoder();

// ─── byte helpers ────────────────────────────────────────────────────────────

export function isHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer-backed array so the Web Crypto typings accept it.
  const buffer = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return new Uint8Array(buffer);
}

/** SHA-256 of a UTF-8 string, lowercase hex. Used to turn classroom "data" into a leaf value. */
export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(await sha256Bytes(encoder.encode(text)));
}

// ─── configuration ───────────────────────────────────────────────────────────

export const PRESETS: Record<
  Exclude<PresetId, "custom">,
  { label: string; description: string; config: MerkleConfig }
> = {
  classroom: {
    label: "Classroom (simple)",
    description:
      "Parent = SHA-256 of the two child hashes written as text, last node duplicated when odd. Easy to follow by hand; it does not match any real chain.",
    config: {
      encoding: "text",
      doubleSha: false,
      oddRule: "duplicate",
      domainSeparation: false,
      reverseBytes: false,
    },
  },
  bitcoin: {
    label: "Bitcoin-style",
    description:
      "Parent = double SHA-256 of the two 32-byte children, hashes shown in Bitcoin's byte-reversed order, odd node duplicated. Reproduces Bitcoin block 170's Merkle root.",
    config: {
      encoding: "bytes",
      doubleSha: true,
      oddRule: "duplicate",
      domainSeparation: false,
      reverseBytes: true,
    },
  },
  rfc6962: {
    label: "RFC 6962 style",
    description:
      "Leaf = SHA-256(0x00 || value), parent = SHA-256(0x01 || left || right), odd node passed up unchanged (as in Certificate Transparency).",
    config: {
      encoding: "bytes",
      doubleSha: false,
      oddRule: "promote",
      domainSeparation: true,
      reverseBytes: false,
    },
  },
};

export function normalizeConfig(config: MerkleConfig): MerkleConfig {
  return { ...config, reverseBytes: config.reverseBytes && config.encoding === "bytes" };
}

// ─── hashing rules ───────────────────────────────────────────────────────────

async function digest(data: Uint8Array, config: MerkleConfig): Promise<Uint8Array> {
  const once = await sha256Bytes(data);
  return config.doubleSha ? sha256Bytes(once) : once;
}

function toInternal(hex: string, config: MerkleConfig): Uint8Array {
  const bytes = hexToBytes(hex);
  return config.reverseBytes ? bytes.reverse() : bytes;
}

function fromInternal(bytes: Uint8Array, config: MerkleConfig): string {
  return bytesToHex(config.reverseBytes ? Uint8Array.from(bytes).reverse() : bytes);
}

/** The node placed at level 0 for a leaf value. Identity unless domain separation is on. */
export async function hashLeaf(value: string, config: MerkleConfig): Promise<string> {
  const c = normalizeConfig(config);
  if (!c.domainSeparation) return value;
  const payload = c.encoding === "text" ? encoder.encode(value) : toInternal(value, c);
  return fromInternal(await digest(concat(Uint8Array.of(0), payload), c), c);
}

/** Parent of two nodes. */
export async function hashPair(left: string, right: string, config: MerkleConfig): Promise<string> {
  const c = normalizeConfig(config);
  const prefix = c.domainSeparation ? Uint8Array.of(1) : new Uint8Array(0);
  const payload =
    c.encoding === "text"
      ? encoder.encode(left + right)
      : concat(toInternal(left, c), toInternal(right, c));
  return fromInternal(await digest(concat(prefix, payload), c), c);
}

// ─── tree ────────────────────────────────────────────────────────────────────

/**
 * Builds the tree from leaf values (64-hex strings, used as given: they are not re-hashed
 * unless domain separation is on).
 */
export async function buildTree(leafValues: string[], config: MerkleConfig): Promise<MerkleResult> {
  if (leafValues.length === 0) {
    throw new Error("At least one leaf is required.");
  }
  const c = normalizeConfig(config);

  const level0: TreeNode[] = [];
  for (const value of leafValues) {
    level0.push({ hash: await hashLeaf(value, c), kind: "leaf" });
  }

  const levels: TreeNode[][] = [level0];
  let current = level0;

  while (current.length > 1) {
    let work = current;
    if (current.length % 2 === 1 && c.oddRule === "duplicate") {
      // Store the copy in the level so it is displayed and can appear in a proof.
      work = [...current, { hash: current[current.length - 1].hash, kind: "duplicate" }];
      levels[levels.length - 1] = work;
    }

    const next: TreeNode[] = [];
    for (let i = 0; i < work.length; i += 2) {
      if (i + 1 < work.length) {
        next.push({ hash: await hashPair(work[i].hash, work[i + 1].hash, c), kind: "node" });
      } else {
        next.push({ hash: work[i].hash, kind: "promoted" });
      }
    }
    levels.push(next);
    current = next;
  }

  return { root: current[0].hash, levels, config: c, leafValues: [...leafValues] };
}

// ─── proof ───────────────────────────────────────────────────────────────────

/** Sibling hashes from a leaf to the root. A promoted node has no sibling at that level, so no step. */
export function generateProof(result: MerkleResult, leafIndex: number): ProofStep[] {
  if (leafIndex < 0 || leafIndex >= result.leafValues.length) {
    throw new Error("Leaf index out of range.");
  }
  const steps: ProofStep[] = [];
  let index = leafIndex;
  for (let level = 0; level < result.levels.length - 1; level++) {
    const nodes = result.levels[level];
    const siblingIndex = index ^ 1;
    if (siblingIndex < nodes.length) {
      steps.push({
        level,
        siblingIndex,
        sibling: nodes[siblingIndex].hash,
        side: siblingIndex < index ? "left" : "right",
        siblingKind: nodes[siblingIndex].kind,
      });
    }
    index = Math.floor(index / 2);
  }
  return steps;
}

/** Recomputes the root from a leaf value and a proof. Needs no other leaf of the tree. */
export async function verifyProof(
  leafValue: string,
  proof: ProofStep[],
  expectedRoot: string,
  config: MerkleConfig
): Promise<VerifyResult> {
  const c = normalizeConfig(config);
  const leafNode = await hashLeaf(leafValue, c);
  let running = leafNode;
  const trace: VerifyTraceStep[] = [];
  for (const step of proof) {
    const left = step.side === "left" ? step.sibling : running;
    const right = step.side === "left" ? running : step.sibling;
    running = await hashPair(left, right, c);
    trace.push({ level: step.level, left, right, result: running });
  }
  return { valid: running === expectedRoot, leafNode, computedRoot: running, trace };
}

// ─── teaching helpers ────────────────────────────────────────────────────────

/** Changes one character: flips the first hex digit of a hash, or appends "!" to free text. */
export function tamperLine(line: string): string {
  if (isHash(line)) {
    const first = (parseInt(line[0], 16) + 1) % 16;
    return first.toString(16) + line.slice(1);
  }
  return line + "!";
}

/** For each node, did its hash differ between two trees of the same shape? */
export function changedNodes(a: MerkleResult, b: MerkleResult): boolean[][] {
  return a.levels.map((level, l) => level.map((node, i) => node.hash !== b.levels[l]?.[i]?.hash));
}

/** Classroom sample: five invented transfers, hashed by the app in "data" mode. */
export const SAMPLE_DATA: string[] = [
  "Alice pays Bob 5",
  "Bob pays Carol 2",
  "Carol pays Dave 1",
  "Dave pays Erin 3",
  "Erin pays Alice 4",
];

/** The two transactions of Bitcoin block 170 (txids in display order) and its Merkle root. */
export const BITCOIN_BLOCK_170 = {
  txids: [
    "b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082",
    "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
  ],
  merkleRoot: "7dac2c5666815c17a3b36427de37bb9d2e2c5ccec3f8633eb91a4205cb4c10ff",
};
