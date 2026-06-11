# Merkle Root Lab

An interactive classroom tool for building and visualizing Merkle Trees — the same hash structures used in Bitcoin block headers and Layer 2 rollup commitments.

**[Live demo](#getting-started)** · React 19 · Vite · TypeScript · Web Crypto API

---

## Features

- Build a Merkle tree from any number of pre-computed transaction hashes
- Visualize every level from leaves to root, with labels and explanations
- Highlight duplicated nodes when an odd leaf count forces pairing
- Load sample hashes for quick classroom demos
- Copy the Merkle Root to the clipboard
- Export the full tree as JSON

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

---

## How to use the app

1. Enter how many transaction hashes (leaves) you have.
2. Paste each pre-computed `Tx_Hash` into the input fields. The app **does not re-hash** your inputs — it uses them directly as leaves.
3. Click **Calculate Merkle Root**.
4. Review every intermediate hash level and the final Merkle Root.
5. Use **Load Sample Hashes** to populate the form with example values for a classroom demo.

---

## Concepts

### What is a Merkle Tree?

A **Merkle Tree** is a binary hash tree where:

- Every **leaf node** holds a transaction hash (a pre-existing hash, not raw data).
- Every **parent node** is the SHA-256 of its two children's hashes concatenated:
  `parent = SHA-256(left_hash + right_hash)`
- This continues level by level until a single hash remains — the **Merkle Root**.

The structure allows anyone to prove a transaction is in a block with only O(log n) hashes (a *Merkle proof*), rather than the full dataset.

### What is a Merkle Root?

The **Merkle Root** is the single hash at the top of the tree. It is a compact cryptographic fingerprint of every transaction in the set. If any transaction changes, the root changes entirely.

The root is stored in the **block header** and is what miners and validators commit to when sealing a block.

### Why do rollups use Merkle Roots?

Layer 2 rollups (Optimistic Rollups, ZK-Rollups) process thousands of transactions off-chain and need to commit a summary to Ethereum L1. Instead of posting every transaction, they post a single **Merkle Root**:

- **Cheap:** one 32-byte value on L1 instead of megabytes of transaction data.
- **Verifiable:** anyone can verify a specific transaction is included using a Merkle proof.
- **Tamper-evident:** changing any transaction changes the root, making fraud detectable.

### Why are odd leaves duplicated?

Merkle Trees pair nodes two-by-two. If a level has an odd number of nodes, there is no partner for the last node. The convention (used in Bitcoin and most blockchains) is to **duplicate the last node**, pair it with itself, and hash the pair to produce a parent. This ensures the tree is always a complete binary tree.

---

## Project structure

```
src/
  App.tsx          # Main UI component
  App.css          # Styles
  types.ts         # TypeScript interfaces
  utils/
    merkle.ts      # calculateMerkleRoot() + sample data
```

## Tech stack

- React 19 + Vite
- TypeScript
- Web Crypto API (`crypto.subtle.digest`) — no external crypto libraries
- Browser-only, no backend

---

## License

Educational use. Feel free to fork and adapt for teaching.
