# Merkle Root Lab

An interactive classroom tool for building and visualizing Merkle Trees — the same hash structures used in Bitcoin block headers and Layer 2 rollup commitments.

**[Live demo](https://dimikog.github.io/merkle-root-lab/)** · React 19 · Vite · TypeScript · Web Crypto API

---

## Features

- Build a Merkle tree from data (the app hashes each line) or from pre-computed 64-hex hashes
- Three rule sets: **Classroom** (simple), **Bitcoin-style** (raw bytes, double SHA-256, byte-reversed display; reproduces block 170's root) and **RFC 6962 style** (leaf/node prefixes, odd node passed up); each rule can also be set by hand
- See every level from leaves to root; odd nodes are shown as a copy (duplicate rule) or passed up (promote rule)
- **Tamper demo:** change one character in a leaf and see which nodes change
- **Merkle proof:** generate the sibling path for a leaf, verify it against the root, optionally corrupt one hash
- Copy the root, export the tree as JSON
- Unit tests against independent reference implementations and a real Bitcoin vector: `npm test`

### What the lab does not claim

Only the *Bitcoin-style* preset follows Bitcoin's byte rules. *Classroom* hashes the hex text of the children, which is easy to follow by hand but does not match any real chain. Sparse Merkle trees, Merkle-Patricia tries and on-chain verification are not covered yet.

---

## Getting started

**Prerequisites:** Node.js 18+ and npm

```bash
git clone https://github.com/DimiKog/merkle-root-lab.git
cd merkle-root-lab
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Other scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run the unit tests (Node built-in runner) |

---

## How to use the app

1. Pick the rules (or leave **Classroom**) and choose whether the leaves are data or hashes.
2. Enter one leaf per line, or use **Load sample data** / **Load Bitcoin block 170**, then **Build tree**.
3. **Change one leaf** to see how a single change reaches the root.
4. **Prove that a leaf is in the tree**: generate the proof, then verify it. After tampering, verification runs against the original root and fails.
