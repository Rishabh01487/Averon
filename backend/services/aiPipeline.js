// ══════════════════════════════════════════════════════════════════════════════
// AVERON AI PIPELINE — Multi-stage document analysis
// ══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const crypto = require('crypto');
const C = require('../config/constants');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${C.AI.GEMINI_MODEL}:generateContent`;

// ── CATEGORY PROFILES (for fallback) ─────────────────────────────────────────

const PROFILES = {
  'Stocks & Shares':    { avg: 50000, risk: [15,45] },
  'Land & Real Estate': { avg: 500000, risk: [10,35] },
  'Agricultural Goods': { avg: 20000, risk: [25,55] },
  'Shop Inventory':     { avg: 30000, risk: [30,60] },
  'Equipment':          { avg: 40000, risk: [20,50] },
  'Invoices & Bills':   { avg: 15000, risk: [20,45] },
  'Vehicles':           { avg: 100000, risk: [15,40] },
  'Precious Metals':    { avg: 80000, risk: [10,30] },
  'Commodities':        { avg: 25000, risk: [20,50] },
  'Infrastructure':     { avg: 1000000, risk: [15,40] },
  'Energy':             { avg: 200000, risk: [20,45] },
  'Other':              { avg: 25000, risk: [30,65] },
};

// ── MAIN PIPELINE ────────────────────────────────────────────────────────────

async function analyzeAsset(asset, documents, dbModule) {
  const stages = [];
  const startTime = Date.now();

  // Stage 1: Document Ingestion & Classification
  const stage1 = processDocuments(documents);
  stages.push({ stage: 'Document Ingestion', ...stage1, duration: Date.now() - startTime });

  // Stage 2: Duplicate detection
  const stage2 = detectDuplicates(documents, dbModule);