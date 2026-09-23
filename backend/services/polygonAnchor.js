// ══════════════════════════════════════════════════════════════════════════════
// AVERON POLYGON ANCHOR — Public chain verifiability via Merkle root anchoring
// ══════════════════════════════════════════════════════════════════════════════
//
// WHY:
//   Averon's inbuilt blockchain is private — only Averon nodes can verify it.
//   By periodically anchoring (committing) the Merkle root of each block to
//   the Polygon blockchain (a public L2), anyone can independently verify
//   that Averon's chain hasn't been tampered with.
//
// HOW IT WORKS:
//   1. Every N blocks (default: 10), Averon computes the Merkle root of the
//      latest block
//   2. Submits a transaction to a smart contract on Polygon that stores
//      (blockIndex, merkleRoot, timestamp)
//   3. Anyone can verify: compute Averon's block Merkle root locally,
//      compare against what's stored on Polygon — if they match, the chain
//      hasn't been tampered with
//
// COST:
//   - Alchemy free tier: 300M compute units/month (way more than enough)
//   - Polygon gas per anchor tx: ~$0.001 (basically free)
//   - You need a wallet with ~$1 of MATIC (lasts months)
//
// SETUP:
//   1. Get Alchemy API key: https://alchemy.com (free)
//   2. Get a Polygon wallet with MATIC (get free MATIC from faucet)
//   3. Set env vars:
//      ALCHEMY_API_KEY=your_alchemy_key
//      POLYGON_PRIVATE_KEY=your_wallet_private_key
//      POLYGON_ANCHOR_CONTRACT=0x... (deployed contract address)
//   4. Deploy the anchor contract (see scripts/deploy-anchor-contract.js)
//
// ══════════════════════════════════════════════════════════════════════════════

const { ethers } = require('ethers');

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const POLYGON_PRIVATE_KEY = process.env.POLYGON_PRIVATE_KEY;
const POLYGON_ANCHOR_CONTRACT = process.env.POLYGON_ANCHOR_CONTRACT;
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// The smart contract ABI — matches the Solidity contract in scripts/anchor-contract.sol
const ANCHOR_ABI = [
  {
    "inputs": [
      { "name": "blockIndex", "type": "uint256" },
      { "name": "merkleRoot", "type": "bytes32" },
      { "name": "blockHash", "type": "bytes32" }
    ],
    "name": "anchor",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "name": "blockIndex", "type": "uint256" }],
    "name": "getAnchor",
    "outputs": [
      { "name": "merkleRoot", "type": "bytes32" },
      { "name": "blockHash", "type": "bytes32" },
      { "name": "timestamp", "type": "uint256" },
      { "name": "anchoredBy", "type": "address" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getLatestAnchor",
    "outputs": [
      { "name": "blockIndex", "type": "uint256" },
      { "name": "merkleRoot", "type": "bytes32" },
      { "name": "blockHash", "type": "bytes32" },
      { "name": "timestamp", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

let provider = null;
let signer = null;
let contract = null;
let isEnabled = false;

/**
 * Initialize the Polygon anchor.
 * Returns true if enabled, false if not configured (silent fallback).
 */
function initAnchor() {
  if (!ALCHEMY_API_KEY || !POLYGON_PRIVATE_KEY || !POLYGON_ANCHOR_CONTRACT) {
    console.log('  ℹ Polygon anchor not configured (set ALCHEMY_API_KEY + POLYGON_PRIVATE_KEY + POLYGON_ANCHOR_CONTRACT to enable)');
    console.log('  ℹ Without anchoring, Averon chain is not publicly verifiable on Polygon');
    return false;
  }

  try {
    provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
    signer = new ethers.Wallet(POLYGON_PRIVATE_KEY, provider);
    contract = new ethers.Contract(POLYGON_ANCHOR_CONTRACT, ANCHOR_ABI, signer);
    isEnabled = true;
    console.log('  🔗 Polygon anchor enabled — chain state will be publicly verifiable');
    console.log(`  🔗 Contract: ${POLYGON_ANCHOR_CONTRACT}`);
    console.log(`  🔗 Signer: ${signer.address}`);
    return true;
  } catch (e) {
    console.error('  ⚠ Polygon anchor init failed:', e.message);
    return false;
  }
}

/**
 * Anchor a block's Merkle root to Polygon.
 * Called automatically after every N blocks mined.
 *
 * @param {Object} block - the Averon block to anchor
 * @returns {Object|null} - tx hash + block explorer URL, or null if not enabled
 */
async function anchorBlock(block) {
  if (!isEnabled) return null;

  try {
    // Convert block hash + Merkle root to bytes32
    const blockIndex = block.index;
    const merkleRoot = '0x' + block.merkleRoot.padStart(64, '0');
    const blockHash = '0x' + block.hash.padStart(64, '0');

    // Check if this block is already anchored
    const existing = await contract.getAnchor(blockIndex);
    if (existing.timestamp > 0) {
      // Already anchored — skip
      return { alreadyAnchored: true, blockIndex };
    }

    // Submit anchor transaction
    console.log(`  🔗 Anchoring block #${blockIndex} to Polygon...`);
    const tx = await contract.anchor(blockIndex, merkleRoot, blockHash);
    console.log(`  🔗 TX submitted: ${tx.hash}`);
    console.log(`  🔗 Explorer: https://polygonscan.com/tx/${tx.hash}`);

    // Wait for confirmation (Polygon blocks are ~2s)
    const receipt = await tx.wait();
    console.log(`  ✓ Anchored in Polygon block ${receipt.blockNumber}, gas: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} MATIC`);

    return {
      txHash: tx.hash,
      explorerUrl: `https://polygonscan.com/tx/${tx.hash}`,
      polygonBlock: receipt.blockNumber,
      gasCost: ethers.formatEther(receipt.gasUsed * receipt.gasPrice),
      averonBlockIndex: blockIndex,
      merkleRoot,
      blockHash,
    };
  } catch (e) {
    console.error('  ⚠ Polygon anchor failed:', e.message);
    return null;
  }
}

/**
 * Get the latest anchor from Polygon (for verification).
 */
async function getLatestAnchor() {
  if (!isEnabled) return null;
  try {
    const result = await contract.getLatestAnchor();
    return {
      blockIndex: result[0].toString(),
      merkleRoot: result[1],
      blockHash: result[2],
      timestamp: result[3].toString(),
      explorerUrl: `https://polygonscan.com/address/${POLYGON_ANCHOR_CONTRACT}`,
    };
  } catch (e) {
    console.error('  ⚠ getLatestAnchor failed:', e.message);
    return null;
  }
}

/**
 * Verify that a local Averon block matches what's anchored on Polygon.
 * @param {Object} block - local Averon block
 * @returns {Object} - { verified: boolean, details: {...} }
 */
async function verifyBlock(block) {
  if (!isEnabled) return { verified: false, reason: 'Polygon anchor not enabled' };

  try {
    const anchored = await contract.getAnchor(block.index);
    if (anchored.timestamp === 0n) {
      return { verified: false, reason: 'Block not anchored on Polygon' };
    }

    const localMerkleRoot = '0x' + block.merkleRoot.padStart(64, '0');
    const localBlockHash = '0x' + block.hash.padStart(64, '0');

    const merkleMatch = anchored.merkleRoot === localMerkleRoot;
    const hashMatch = anchored.blockHash === localBlockHash;

    return {
      verified: merkleMatch && hashMatch,
      details: {
        blockIndex: block.index,
        localMerkleRoot: localMerkleRoot,
        polygonMerkleRoot: anchored.merkleRoot,
        merkleMatch,
        localBlockHash: localBlockHash,
        polygonBlockHash: anchored.blockHash,
        hashMatch,
        anchoredAt: new Date(Number(anchored.timestamp) * 1000).toISOString(),
        anchoredBy: anchored.anchoredBy,
      },
    };
  } catch (e) {
    return { verified: false, reason: e.message };
  }
}

function isAnchorEnabled() {
  return isEnabled;
}

module.exports = { initAnchor, anchorBlock, getLatestAnchor, verifyBlock, isAnchorEnabled };
