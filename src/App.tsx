import { useCallback, useMemo, useState } from "react";
import {
  BITCOIN_BLOCK_170,
  PRESETS,
  SAMPLE_DATA,
  buildTree,
  changedNodes,
  generateProof,
  isHash,
  normalizeConfig,
  sha256Hex,
  tamperLine,
  verifyProof,
} from "./utils/merkle";
import type {
  MerkleConfig,
  MerkleResult,
  PresetId,
  ProofStep,
  ValidationError,
  VerifyResult,
} from "./types";
import "./App.css";

type InputMode = "data" | "hash";

const MAX_LEAVES = 64;

function sameConfig(a: MerkleConfig, b: MerkleConfig): boolean {
  const x = normalizeConfig(a);
  const y = normalizeConfig(b);
  return (
    x.encoding === y.encoding &&
    x.doubleSha === y.doubleSha &&
    x.oddRule === y.oddRule &&
    x.domainSeparation === y.domainSeparation &&
    x.reverseBytes === y.reverseBytes
  );
}

function presetOf(config: MerkleConfig): PresetId {
  for (const id of ["classroom", "bitcoin", "rfc6962"] as const) {
    if (sameConfig(config, PRESETS[id].config)) return id;
  }
  return "custom";
}

function shorten(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash;
}

function levelLabel(index: number, total: number): string {
  if (index === 0) return "Level 0 — Leaves";
  if (index === total - 1) return `Level ${index} — Merkle Root`;
  return `Level ${index} — Intermediate hashes`;
}

function levelExplanation(index: number, total: number, config: MerkleConfig): string {
  if (index === 0) {
    return config.domainSeparation
      ? "Leaf = SHA-256(0x00 || value): the leaf is hashed with a prefix."
      : "Leaf values are used as given, not re-hashed.";
  }
  if (index === total - 1) {
    return "Merkle Root — one hash that stands for the whole set. Stored on-chain or in a commitment.";
  }
  return "Parent hashes of the level below, left then right.";
}

function App() {
  const [config, setConfig] = useState<MerkleConfig>(PRESETS.classroom.config);
  const [inputMode, setInputMode] = useState<InputMode>("data");
  const [text, setText] = useState<string>("");
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [computing, setComputing] = useState(false);

  // Original tree and (optionally) a tampered copy of it.
  const [original, setOriginal] = useState<MerkleResult | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [tampered, setTampered] = useState<MerkleResult | null>(null);
  const [tamperedLines, setTamperedLines] = useState<string[]>([]);
  const [tamperIndex, setTamperIndex] = useState(0);

  // Proof
  const [proofIndex, setProofIndex] = useState(0);
  const [proof, setProof] = useState<ProofStep[] | null>(null);
  const [corruptProof, setCorruptProof] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  const [copied, setCopied] = useState(false);

  const preset = presetOf(config);
  const shown = tampered ?? original;

  const diff = useMemo(
    () => (original && tampered ? changedNodes(original, tampered) : null),
    [original, tampered]
  );

  // Path and sibling nodes of the selected proof, for highlighting.
  const pathNodes = useMemo(() => {
    const set = new Set<string>();
    if (!original || !proof) return set;
    for (let level = 0; level < original.levels.length; level++) {
      set.add(`${level}:${proofIndex >> level}`);
    }
    return set;
  }, [original, proof, proofIndex]);

  const siblingNodes = useMemo(() => {
    const set = new Set<string>();
    if (proof) proof.forEach((s) => set.add(`${s.level}:${s.siblingIndex}`));
    return set;
  }, [proof]);

  // ── helpers ──

  const toLeafValues = useCallback(
    async (rawLines: string[]): Promise<string[]> => {
      if (inputMode === "data") return Promise.all(rawLines.map((l) => sha256Hex(l)));
      return rawLines.map((l) => l.toLowerCase());
    },
    [inputMode]
  );

  function parseLines(): string[] {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  function validate(rawLines: string[]): ValidationError[] {
    const errs: ValidationError[] = [];
    if (rawLines.length === 0) errs.push({ field: "text", message: "Enter at least one leaf." });
    if (rawLines.length > MAX_LEAVES) {
      errs.push({ field: "text", message: `At most ${MAX_LEAVES} leaves in this lab (you entered ${rawLines.length}).` });
    }
    if (inputMode === "hash") {
      rawLines.forEach((l, i) => {
        if (!isHash(l.toLowerCase())) {
          errs.push({ field: "text", message: `Line ${i + 1} is not a 64-character hex hash.` });
        }
      });
    }
    return errs;
  }

  function clearDerived() {
    setTampered(null);
    setTamperedLines([]);
    setProof(null);
    setVerify(null);
    setCorruptProof(false);
    setCopied(false);
  }

  // ── actions ──

  const compute = useCallback(async () => {
    const rawLines = parseLines();
    const errs = validate(rawLines);
    if (errs.length) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    setComputing(true);
    try {
      const values = await toLeafValues(rawLines);
      const tree = await buildTree(values, config);
      setOriginal(tree);
      setLines(rawLines);
      setTamperIndex(0);
      setProofIndex(0);
      clearDerived();
    } finally {
      setComputing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, inputMode, config, toLeafValues]);

  function loadSampleData() {
    setInputMode("data");
    setText(SAMPLE_DATA.join("\n"));
    setErrors([]);
  }

  function loadBitcoinSample() {
    setInputMode("hash");
    setConfig(PRESETS.bitcoin.config);
    setText(BITCOIN_BLOCK_170.txids.join("\n"));
    setErrors([]);
  }

  function reset() {
    setText("");
    setOriginal(null);
    setLines([]);
    setErrors([]);
    clearDerived();
  }

  function applyPreset(id: PresetId) {
    if (id !== "custom") setConfig(PRESETS[id].config);
  }

  function patchConfig(patch: Partial<MerkleConfig>) {
    setConfig((c) => normalizeConfig({ ...c, ...patch }));
  }

  async function tamper() {
    if (!original) return;
    const edited = [...lines];
    edited[tamperIndex] = tamperLine(edited[tamperIndex]);
    const values = await toLeafValues(edited);
    setTampered(await buildTree(values, original.config));
    setTamperedLines(edited);
    setVerify(null);
  }

  function undoTamper() {
    setTampered(null);
    setTamperedLines([]);
    setVerify(null);
  }

  function makeProof() {
    if (!original) return;
    setProof(generateProof(original, proofIndex));
    setVerify(null);
    setCorruptProof(false);
  }

  async function runVerify() {
    if (!original || !proof) return;
    // The verifier gets the leaf as it is now (possibly tampered), the proof, and the ORIGINAL root.
    const currentLines = tampered ? tamperedLines : lines;
    const values = await toLeafValues([currentLines[proofIndex]]);
    const usedProof = corruptProof
      ? proof.map((s, i) => (i === 0 ? { ...s, sibling: tamperLine(s.sibling) } : s))
      : proof;
    setVerify(await verifyProof(values[0], usedProof, original.root, original.config));
  }

  async function copyRoot() {
    if (!shown) return;
    await navigator.clipboard.writeText(shown.root);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function exportTree() {
    if (!shown) return;
    const payload = {
      root: shown.root,
      config: shown.config,
      levels: shown.levels.map((level, i) => ({
        index: i,
        label: levelLabel(i, shown.levels.length),
        nodes: level,
      })),
      generatedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `merkle-tree-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const textError = errors.filter((e) => e.field === "text");
  const leafCountLabel = parseLines().length;

  // ── render ──

  return (
    <div className="app">
      <header className="app-header">
        <h1>🌿 Merkle Root Lab</h1>
        <p className="subtitle">
          Build a Merkle tree, prove that one leaf belongs to it, and see what a single changed byte does.
        </p>
      </header>

      <section className="explainer card">
        <h2>What is a Merkle tree?</h2>
        <p>
          A <strong>Merkle tree</strong> is a binary hash tree: every leaf is a hash of one item, and every
          parent is the hash of its two children. The <strong>Merkle root</strong> at the top is one short
          fingerprint of the whole set. It sits in a Bitcoin block header, and rollups commit thousands of
          transactions to Ethereum with it.
        </p>
        <p>
          A <strong>Merkle proof</strong> shows that one item is in the set using only about log₂(n) hashes,
          without the other items. Change any leaf and the root changes. Try both below.
        </p>
        <p className="fineprint">
          Only the <em>Bitcoin-style</em> preset follows Bitcoin's byte rules. <em>Classroom</em> hashes the
          hex text of the children, which is easy to follow but does not match any real chain.
        </p>
      </section>

      {/* ── 1. Configure ── */}
      <section className="card input-panel">
        <h2>1. Choose the rules and the leaves</h2>

        <div className="row">
          <label htmlFor="preset">Rules</label>
          <select id="preset" value={preset} onChange={(e) => applyPreset(e.target.value as PresetId)}>
            <option value="classroom">{PRESETS.classroom.label}</option>
            <option value="bitcoin">{PRESETS.bitcoin.label}</option>
            <option value="rfc6962">{PRESETS.rfc6962.label}</option>
            {preset === "custom" && <option value="custom">Custom</option>}
          </select>
        </div>
        <p className="hint">
          {preset === "custom"
            ? "Custom combination of the options below."
            : PRESETS[preset].description}
        </p>

        <details className="advanced">
          <summary>Advanced options</summary>
          <div className="toggle-grid">
            <label>
              Parent input
              <select
                value={config.encoding}
                onChange={(e) => patchConfig({ encoding: e.target.value as MerkleConfig["encoding"] })}
              >
                <option value="text">Hash of the hex text of the children</option>
                <option value="bytes">Hash of the 32-byte values</option>
              </select>
            </label>
            <label>
              Odd node at the end of a level
              <select
                value={config.oddRule}
                onChange={(e) => patchConfig({ oddRule: e.target.value as MerkleConfig["oddRule"] })}
              >
                <option value="duplicate">Duplicate it (Bitcoin)</option>
                <option value="promote">Pass it up unchanged (RFC 6962)</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={config.doubleSha}
                onChange={(e) => patchConfig({ doubleSha: e.target.checked })}
              />
              Double SHA-256 (Bitcoin)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={config.domainSeparation}
                onChange={(e) => patchConfig({ domainSeparation: e.target.checked })}
              />
              Prefix 0x00 to leaves and 0x01 to parents
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={config.reverseBytes && config.encoding === "bytes"}
                disabled={config.encoding !== "bytes"}
                onChange={(e) => patchConfig({ reverseBytes: e.target.checked })}
              />
              Show hashes in Bitcoin byte order (reversed)
            </label>
          </div>
        </details>

        <div className="row mode-row">
          <label>Leaves are</label>
          <div className="segmented">
            <button
              className={inputMode === "data" ? "active" : ""}
              onClick={() => setInputMode("data")}
              type="button"
            >
              Data (the app hashes each line)
            </button>
            <button
              className={inputMode === "hash" ? "active" : ""}
              onClick={() => setInputMode("hash")}
              type="button"
            >
              Hashes (64 hex characters)
            </button>
          </div>
        </div>

        <textarea
          className={`leaf-textarea${textError.length ? " invalid" : ""}`}
          rows={6}
          spellCheck={false}
          placeholder={
            inputMode === "data"
              ? "One item per line, for example:\nAlice pays Bob 5\nBob pays Carol 2"
              : "One 64-character hex hash per line"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="meta-line">
          {leafCountLabel} {leafCountLabel === 1 ? "leaf" : "leaves"} (max {MAX_LEAVES})
        </div>
        {textError.slice(0, 3).map((e, i) => (
          <div key={i} className="error">{e.message}</div>
        ))}
        {textError.length > 3 && <div className="error">…and {textError.length - 3} more.</div>}

        <div className="actions">
          <button className="btn secondary" onClick={loadSampleData} type="button">Load sample data (5)</button>
          <button className="btn secondary" onClick={loadBitcoinSample} type="button">Load Bitcoin block 170</button>
          <button className="btn primary" onClick={compute} disabled={computing} type="button">
            {computing ? "Computing…" : "Build tree"}
          </button>
          <button className="btn ghost" onClick={reset} type="button">Reset</button>
        </div>
      </section>

      {/* ── 2. Tree ── */}
      {shown && original && (
        <section className="card result-panel">
          <h2>2. The Merkle tree {tampered && <span className="tag danger">TAMPERED</span>}</h2>

          {shown.levels.some((l) => l.some((n) => n.kind === "duplicate")) && (
            <div className="notice">
              Odd number of nodes: the last node is <span className="dup-label">duplicated</span> to form a pair
              (amber). With this rule, <code>[a, b, c]</code> and <code>[a, b, c, c]</code> give the same root.
            </div>
          )}
          {shown.levels.some((l) => l.some((n) => n.kind === "promoted")) && (
            <div className="notice">
              Odd number of nodes: the last node is <span className="promo-label">passed up unchanged</span> (violet),
              so there is no copy and the proof for it is shorter.
            </div>
          )}

          <div className="legend">
            <span className="chip path">on the proof path</span>
            <span className="chip sibling">sibling in the proof</span>
            <span className="chip changed">changed by tampering</span>
          </div>

          <div className="tree">
            {[...shown.levels].reverse().map((level, revIdx) => {
              const levelIdx = shown.levels.length - 1 - revIdx;
              const isRoot = levelIdx === shown.levels.length - 1;
              return (
                <div key={levelIdx} className={`tree-level${isRoot ? " root-level" : ""}`}>
                  <div className="level-meta">
                    <span className="level-title">{levelLabel(levelIdx, shown.levels.length)}</span>
                    <span className="level-explanation">
                      {levelExplanation(levelIdx, shown.levels.length, shown.config)}
                    </span>
                  </div>
                  <div className="level-nodes">
                    {level.map((node, nodeIdx) => {
                      const key = `${levelIdx}:${nodeIdx}`;
                      const classes = [
                        "node",
                        node.kind === "duplicate" ? "duplicated" : "",
                        node.kind === "promoted" ? "promoted" : "",
                        isRoot ? "root-node" : "",
                        diff?.[levelIdx]?.[nodeIdx] ? "changed" : "",
                        pathNodes.has(key) ? "path" : "",
                        siblingNodes.has(key) ? "sibling" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <div key={nodeIdx} className={classes} title={node.hash}>
                          <span className="node-label">
                            {isRoot ? "Root" : `L${levelIdx}[${nodeIdx}]`}
                            {node.kind === "duplicate" && <span className="dup-badge">copy</span>}
                            {node.kind === "promoted" && <span className="promo-badge">up</span>}
                          </span>
                          <span className="node-hash">{node.hash}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="root-output">
            <h3>Merkle root{tampered ? " (tampered)" : ""}</h3>
            <div className="root-hash">{shown.root}</div>
            {tampered && (
              <>
                <h3 className="orig">Original root</h3>
                <div className="root-hash orig">{original.root}</div>
              </>
            )}
            <div className="actions">
              <button className="btn primary" onClick={copyRoot} type="button">
                {copied ? "✓ Copied!" : "Copy root"}
              </button>
              <button className="btn secondary" onClick={exportTree} type="button">Export tree as JSON</button>
            </div>
          </div>
        </section>
      )}

      {/* ── 3. Tamper ── */}
      {original && (
        <section className="card">
          <h2>3. Change one leaf</h2>
          <p className="hint">
            Pick a leaf and change one character. Compare the two roots: the nodes on the path from that leaf to
            the root change (red); everything else stays the same.
          </p>
          <div className="row">
            <label htmlFor="tamperLeaf">Leaf</label>
            <select
              id="tamperLeaf"
              value={tamperIndex}
              onChange={(e) => setTamperIndex(Number(e.target.value))}
            >
              {lines.map((l, i) => (
                <option key={i} value={i}>
                  {i}: {shorten(l)}
                </option>
              ))}
            </select>
            <button className="btn secondary" onClick={tamper} type="button">Tamper with this leaf</button>
            {tampered && <button className="btn ghost" onClick={undoTamper} type="button">Undo</button>}
          </div>
          {tampered && (
            <div className="compare">
              <div>
                <strong>Leaf {tamperIndex} before:</strong> <code>{lines[tamperIndex]}</code>
              </div>
              <div>
                <strong>Leaf {tamperIndex} after:</strong> <code>{tamperedLines[tamperIndex]}</code>
              </div>
              <div>
                <strong>Changed nodes:</strong> {diff ? diff.flat().filter(Boolean).length : 0} of{" "}
                {diff ? diff.flat().length : 0}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── 4. Proof ── */}
      {original && (
        <section className="card">
          <h2>4. Prove that a leaf is in the tree</h2>
          <p className="hint">
            The proof is the list of sibling hashes from the leaf to the root. The verifier needs only the leaf,
            this list and the root — not the other leaves. If you tampered with the leaf above, verification
            runs against the <strong>original</strong> root and should fail.
          </p>
          <div className="row">
            <label htmlFor="proofLeaf">Leaf</label>
            <select
              id="proofLeaf"
              value={proofIndex}
              onChange={(e) => {
                setProofIndex(Number(e.target.value));
                setProof(null);
                setVerify(null);
              }}
            >
              {lines.map((l, i) => (
                <option key={i} value={i}>
                  {i}: {shorten(l)}
                </option>
              ))}
            </select>
            <button className="btn secondary" onClick={makeProof} type="button">Generate proof</button>
          </div>

          {proof && (
            <>
              <div className="meta-line">
                {proof.length} hash{proof.length === 1 ? "" : "es"} for {original.leafValues.length} leaves
                (about log₂ n).
              </div>
              {proof.length === 0 ? (
                <p className="hint">Single leaf: the leaf is the root, nothing to prove.</p>
              ) : (
                <table className="proof-table">
                  <thead>
                    <tr><th>Step</th><th>Level</th><th>Sibling is</th><th>Sibling hash</th></tr>
                  </thead>
                  <tbody>
                    {proof.map((s, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{s.level}</td>
                        <td>{s.side} of the running hash{s.siblingKind === "duplicate" ? " (copy)" : ""}</td>
                        <td className="mono" title={s.sibling}>{shorten(s.sibling)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="actions">
                <label className="check inline">
                  <input
                    type="checkbox"
                    checked={corruptProof}
                    disabled={proof.length === 0}
                    onChange={(e) => {
                      setCorruptProof(e.target.checked);
                      setVerify(null);
                    }}
                  />
                  Corrupt one hash in the proof
                </label>
                <button className="btn primary" onClick={runVerify} type="button">Verify proof</button>
              </div>

              {verify && (
                <div className={`verify ${verify.valid ? "ok" : "fail"}`}>
                  <strong>{verify.valid ? "✓ Valid: the leaf is in the tree." : "✗ Invalid: the computed root does not match."}</strong>
                  <div className="trace">
                    <div>Leaf node: <code>{shorten(verify.leafNode)}</code></div>
                    {verify.trace.map((t, i) => (
                      <div key={i}>
                        Level {t.level}: H(<code>{shorten(t.left)}</code>, <code>{shorten(t.right)}</code>) ={" "}
                        <code>{shorten(t.result)}</code>
                      </div>
                    ))}
                    <div>Computed root: <code>{shorten(verify.computedRoot)}</code></div>
                    <div>Expected root: <code>{shorten(original.root)}</code></div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <footer className="app-footer">
        Built with React + Vite + Web Crypto API · Educational use only
      </footer>
    </div>
  );
}

export default App;
