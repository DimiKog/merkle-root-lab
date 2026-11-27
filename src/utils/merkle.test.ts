// Run with: npm test   (Node's built-in test runner, no extra dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BITCOIN_BLOCK_170,
  PRESETS,
  buildTree,
  bytesToHex,
  changedNodes,
  generateProof,
  hexToBytes,
  isHash,
  sha256Hex,
  tamperLine,
  verifyProof,
} from "./merkle.ts";
import type { MerkleConfig } from "../types.ts";

// ── independent reference implementations (node:crypto, written separately from the app code) ──

const sha = (b: Buffer) => createHash("sha256").update(b).digest();

function leaves(n: number): string[] {
  return Array.from({ length: n }, (_, i) => createHash("sha256").update(`leaf-${i}`).digest("hex"));
}

function refClassroom(values: string[]): string {
  let level = [...values];
  while (level.length > 1) {
    if (level.length % 2) level.push(level[level.length - 1]);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha(Buffer.from(level[i] + level[i + 1], "utf8")).toString("hex"));
    }
    level = next;
  }
  return level[0];
}

function refBitcoin(displayHashes: string[]): string {
  let level = displayHashes.map((h) => Buffer.from(h, "hex").reverse());
  while (level.length > 1) {
    if (level.length % 2) level.push(level[level.length - 1]);
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha(sha(Buffer.concat([level[i], level[i + 1]]))));
    }
    level = next;
  }
  return Buffer.from(level[0]).reverse().toString("hex");
}

// RFC 6962 section 2.1: recursive definition, split at the largest power of two below n.
function refRfc6962(values: string[]): string {
  const mth = (v: Buffer[]): Buffer => {
    if (v.length === 1) return sha(Buffer.concat([Buffer.from([0]), v[0]]));
    let k = 1;
    while (k * 2 < v.length) k *= 2;
    return sha(Buffer.concat([Buffer.from([1]), mth(v.slice(0, k)), mth(v.slice(k))]));
  };
  return mth(values.map((h) => Buffer.from(h, "hex"))).toString("hex");
}

// ── known vector ──

test("Bitcoin preset reproduces the Merkle root of block 170", async () => {
  const tree = await buildTree(BITCOIN_BLOCK_170.txids, PRESETS.bitcoin.config);
  assert.equal(tree.root, BITCOIN_BLOCK_170.merkleRoot);
});

// ── agreement with the independent references ──

test("classroom preset matches the reference for 1..40 leaves", async () => {
  for (let n = 1; n <= 40; n++) {
    const v = leaves(n);
    assert.equal((await buildTree(v, PRESETS.classroom.config)).root, refClassroom(v), `n=${n}`);
  }
});

test("bitcoin preset matches the reference for 1..40 leaves", async () => {
  for (let n = 1; n <= 40; n++) {
    const v = leaves(n);
    assert.equal((await buildTree(v, PRESETS.bitcoin.config)).root, refBitcoin(v), `n=${n}`);
  }
});

test("RFC 6962 preset matches the recursive definition for 1..40 leaves", async () => {
  for (let n = 1; n <= 40; n++) {
    const v = leaves(n);
    assert.equal((await buildTree(v, PRESETS.rfc6962.config)).root, refRfc6962(v), `n=${n}`);
  }
});

// ── structure ──

test("a single leaf is its own root without domain separation", async () => {
  const [v] = leaves(1);
  assert.equal((await buildTree([v], PRESETS.classroom.config)).root, v);
});

test("duplicate rule stores a visible copy; promote rule stores a promoted node", async () => {
  const dup = await buildTree(leaves(3), PRESETS.classroom.config);
  assert.equal(dup.levels[0].length, 4);
  assert.equal(dup.levels[0][3].kind, "duplicate");
  assert.equal(dup.levels[0][3].hash, dup.levels[0][2].hash);

  const pro = await buildTree(leaves(3), PRESETS.rfc6962.config);
  assert.equal(pro.levels[0].length, 3);
  assert.equal(pro.levels[1][1].kind, "promoted");
});

test("duplicate rule has the Bitcoin mutation weakness; promote rule does not", async () => {
  // CVE-2012-2459: repeating the last element of an odd list yields the same root.
  const three = leaves(3);
  const four = [...three, three[2]];
  const a = await buildTree(three, PRESETS.bitcoin.config);
  const b = await buildTree(four, PRESETS.bitcoin.config);
  assert.equal(a.root, b.root);
  const c = await buildTree(three, PRESETS.rfc6962.config);
  const d = await buildTree(four, PRESETS.rfc6962.config);
  assert.notEqual(c.root, d.root);
});

test("empty input is rejected", async () => {
  await assert.rejects(() => buildTree([], PRESETS.classroom.config));
});

// ── proofs ──

const presets = Object.entries(PRESETS) as [string, (typeof PRESETS)[keyof typeof PRESETS]][];

test("every leaf of every size verifies, in every preset", async () => {
  for (const [name, preset] of presets) {
    for (let n = 1; n <= 20; n++) {
      const v = leaves(n);
      const tree = await buildTree(v, preset.config);
      for (let i = 0; i < n; i++) {
        const proof = generateProof(tree, i);
        assert.ok(proof.length <= Math.ceil(Math.log2(n)), `${name} n=${n} i=${i} proof too long`);
        const res = await verifyProof(v[i], proof, tree.root, preset.config);
        assert.ok(res.valid, `${name} n=${n} i=${i}`);
      }
    }
  }
});

test("a wrong leaf, a corrupted sibling or a wrong root fails", async () => {
  for (const [name, preset] of presets) {
    const v = leaves(7);
    const tree = await buildTree(v, preset.config);
    const proof = generateProof(tree, 3);
    assert.ok(proof.length > 0);

    const wrongLeaf = await verifyProof(v[4], proof, tree.root, preset.config);
    assert.equal(wrongLeaf.valid, false, `${name} wrong leaf`);

    const corrupted = proof.map((s, i) => (i === 0 ? { ...s, sibling: tamperLine(s.sibling) } : s));
    assert.equal((await verifyProof(v[3], corrupted, tree.root, preset.config)).valid, false, `${name} corrupted`);

    assert.equal((await verifyProof(v[3], proof, tamperLine(tree.root), preset.config)).valid, false, `${name} root`);
  }
});

test("a promoted node produces a shorter proof than a duplicated one", async () => {
  const v = leaves(5);
  const promote = generateProof(await buildTree(v, PRESETS.rfc6962.config), 4);
  const duplicate = generateProof(await buildTree(v, PRESETS.classroom.config), 4);
  assert.equal(promote.length, 1);
  assert.equal(duplicate.length, 3);
});

// ── tamper ──

test("tampering one leaf changes the root and exactly the nodes on its path", async () => {
  const v = leaves(8);
  const original = await buildTree(v, PRESETS.classroom.config);
  const changed = [...v];
  changed[5] = tamperLine(changed[5]);
  const tampered = await buildTree(changed, PRESETS.classroom.config);
  assert.notEqual(tampered.root, original.root);
  const diff = changedNodes(original, tampered);
  const count = diff.flat().filter(Boolean).length;
  assert.equal(count, 4); // one node per level: leaf, 2 parents, root
  assert.ok(diff[0][5]);
  assert.ok(diff[diff.length - 1][0]);
});

test("a tampered leaf fails verification against the original root", async () => {
  const v = leaves(8);
  const tree = await buildTree(v, PRESETS.bitcoin.config);
  const proof = generateProof(tree, 2);
  const res = await verifyProof(tamperLine(v[2]), proof, tree.root, PRESETS.bitcoin.config);
  assert.equal(res.valid, false);
});

// ── helpers ──

test("tamperLine keeps hashes valid and changes free text", () => {
  const h = "a".repeat(64);
  assert.ok(isHash(tamperLine(h)));
  assert.notEqual(tamperLine(h), h);
  assert.equal(tamperLine("hello"), "hello!");
});

test("hex helpers round-trip and sha256Hex matches node:crypto", async () => {
  const hex = leaves(1)[0];
  assert.equal(bytesToHex(hexToBytes(hex)), hex);
  assert.equal(await sha256Hex("abc"), createHash("sha256").update("abc").digest("hex"));
});

// ── configuration is honoured ──

test("reverseBytes is ignored for the text encoding", async () => {
  const cfg: MerkleConfig = { ...PRESETS.classroom.config, reverseBytes: true };
  const v = leaves(4);
  assert.equal((await buildTree(v, cfg)).root, refClassroom(v));
});
