import { useState, useCallback } from "react";
import { calculateMerkleRoot, SAMPLE_HASHES } from "./utils/merkle";
import type { MerkleResult, ValidationError } from "./types";
import "./App.css";

const DEFAULT_LEAF_COUNT = 4;

function App() {
  const [leafCount, setLeafCount] = useState<number>(DEFAULT_LEAF_COUNT);
  const [hashes, setHashes] = useState<string[]>(Array(DEFAULT_LEAF_COUNT).fill(""));
  const [result, setResult] = useState<MerkleResult | null>(null);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [copied, setCopied] = useState(false);
  const [computing, setComputing] = useState(false);
  const [oddWarning, setOddWarning] = useState(false);

  // ─── helpers ────────────────────────────────────────────────────────────────

  function validate(): ValidationError[] {
    const errs: ValidationError[] = [];
    if (leafCount < 1) {
      errs.push({ field: "leafCount", message: "Number of leaves must be ≥ 1." });
    }
    hashes.slice(0, leafCount).forEach((h, i) => {
      if (!h.trim()) {
        errs.push({ field: `hash-${i}`, message: `Leaf ${i + 1} cannot be empty.` });
      }
    });
    return errs;
  }

  const handleLeafCountChange = useCallback((val: number) => {
    const n = Math.max(1, val);
    setLeafCount(n);
    setHashes((prev) => {
      const next = [...prev];
      while (next.length < n) next.push("");
      return next.slice(0, n);
    });
    setResult(null);
    setErrors([]);
  }, []);

  const handleHashChange = useCallback((index: number, value: string) => {
    setHashes((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const loadSamples = useCallback(() => {
    const filled: string[] = [];
    for (let i = 0; i < leafCount; i++) {
      filled.push(SAMPLE_HASHES[i % SAMPLE_HASHES.length]);
    }
    setHashes(filled);
    setResult(null);
    setErrors([]);
  }, [leafCount]);

  const compute = useCallback(async () => {
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setComputing(true);
    try {
      const leaves = hashes.slice(0, leafCount).map((h) => h.trim());
      const res = await calculateMerkleRoot(leaves);
      setResult(res);
      setOddWarning(res.duplicatedIndices.size > 0);
    } finally {
      setComputing(false);
    }
  }, [hashes, leafCount]);

  const reset = useCallback(() => {
    setHashes(Array(DEFAULT_LEAF_COUNT).fill(""));
    setLeafCount(DEFAULT_LEAF_COUNT);
    setResult(null);
    setErrors([]);
    setCopied(false);
    setOddWarning(false);
  }, []);

  const exportTree = useCallback(() => {
    if (!result) return;
    const payload = {
      root: result.root,
      levels: result.levels.map((level, i) => ({
        index: i,
        label: levelLabel(i, result.levels.length),
        hashes: level,
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
  }, [result]);

  const copyRoot = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result.root).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  // ─── level label helpers ─────────────────────────────────────────────────────

  function levelLabel(index: number, total: number): string {
    if (index === 0) return "Level 0 — Leaves (Transaction Hashes)";
    if (index === total - 1) return `Level ${index} — Merkle Root`;
    return `Level ${index} — Intermediate Hashes`;
  }

  function levelExplanation(index: number, total: number): string {
    if (index === 0)
      return "Transaction hashes — provided as-is, not re-hashed.";
    if (index === total - 1)
      return "Merkle Root — stored on-chain or in a rollup commitment. Represents the entire transaction set as a single hash.";
    return "Parent hashes generated from SHA-256( left || right ) of the level below.";
  }

  function fieldError(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  // ─── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <header className="app-header">
        <h1>🌿 Merkle Root Lab</h1>
        <p className="subtitle">
          An interactive classroom tool for understanding Merkle Trees in blockchain systems.
        </p>
      </header>

      <section className="explainer card">
        <h2>What is a Merkle Tree?</h2>
        <p>
          A <strong>Merkle Tree</strong> is a binary hash tree where every leaf node holds a
          transaction hash and every parent node is the hash of its two children concatenated.
          This structure lets anyone prove that a specific transaction is included in a block
          using only a tiny <em>Merkle proof</em> — O(log&nbsp;n) hashes instead of the full dataset.
        </p>
        <p>
          The <strong>Merkle Root</strong> at the top of the tree is a compact fingerprint of all
          transactions. It is embedded in the block header and used by rollups to commit thousands
          of transactions to L1 in a single hash.
        </p>
      </section>

      {/* ── Input panel ─────────────────────────────────────────────────────── */}
      <section className="card input-panel">
        <h2>1. Configure Leaves</h2>

        <div className="row">
          <label htmlFor="leafCount">Number of leaves</label>
          <input
            id="leafCount"
            type="number"
            min={1}
            value={leafCount}
            onChange={(e) => handleLeafCountChange(Number(e.target.value))}
          />
          {fieldError("leafCount") && (
            <span className="error">{fieldError("leafCount")}</span>
          )}
        </div>

        <div className="hash-inputs">
          {Array.from({ length: leafCount }).map((_, i) => (
            <div key={i} className="hash-row">
              <label>Leaf {i + 1}</label>
              <input
                className={`hash-input${fieldError(`hash-${i}`) ? " invalid" : ""}`}
                type="text"
                placeholder="Paste SHA-256 transaction hash…"
                value={hashes[i] ?? ""}
                onChange={(e) => handleHashChange(i, e.target.value)}
                spellCheck={false}
              />
              {fieldError(`hash-${i}`) && (
                <span className="error">{fieldError(`hash-${i}`)}</span>
              )}
            </div>
          ))}
        </div>

        <div className="actions">
          <button className="btn secondary" onClick={loadSamples}>
            Load Sample Hashes
          </button>
          <button className="btn primary" onClick={compute} disabled={computing}>
            {computing ? "Computing…" : "Calculate Merkle Root"}
          </button>
          <button className="btn ghost" onClick={reset}>
            Reset
          </button>
        </div>
      </section>

      {/* ── Result panel ─────────────────────────────────────────────────────── */}
      {result && (
        <section className="card result-panel">
          <h2>2. Merkle Tree</h2>

          {oddWarning && (
            <div className="notice">
              ⚠️ Odd number of leaves detected. The last hash was duplicated to form a complete pair.
              Duplicated nodes are highlighted in <span className="dup-label">amber</span>.
            </div>
          )}

          <div className="tree">
            {[...result.levels].reverse().map((level, revIdx) => {
              const levelIdx = result.levels.length - 1 - revIdx;
              const dupSet = result.duplicatedIndices.get(levelIdx) ?? new Set<number>();
              const isRoot = levelIdx === result.levels.length - 1;

              return (
                <div key={levelIdx} className={`tree-level${isRoot ? " root-level" : ""}`}>
                  <div className="level-meta">
                    <span className="level-title">
                      {levelLabel(levelIdx, result.levels.length)}
                    </span>
                    <span className="level-explanation">
                      {levelExplanation(levelIdx, result.levels.length)}
                    </span>
                  </div>
                  <div className="level-nodes">
                    {level.map((hash, nodeIdx) => (
                      <div
                        key={nodeIdx}
                        className={`node${dupSet.has(nodeIdx) ? " duplicated" : ""}${isRoot ? " root-node" : ""}`}
                        title={hash}
                      >
                        <span className="node-label">
                          {isRoot ? "Root" : `L${levelIdx}[${nodeIdx}]`}
                          {dupSet.has(nodeIdx) && (
                            <span className="dup-badge">dup</span>
                          )}
                        </span>
                        <span className="node-hash">{hash}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="root-output">
            <h3>Merkle Root</h3>
            <div className="root-hash">{result.root}</div>
            <button className="btn primary" onClick={copyRoot}>
              {copied ? "✓ Copied!" : "Copy Merkle Root"}
            </button>
            <button className="btn secondary" onClick={exportTree}>
              Export Tree as JSON
            </button>
          </div>
        </section>
      )}

      <footer className="app-footer">
        Built with React + Vite + Web Crypto API · Educational use only
      </footer>
    </div>
  );
}

export default App;
