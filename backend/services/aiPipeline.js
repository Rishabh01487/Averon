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
  stages.push({ stage: 'Duplicate Check', ...stage2 });

  // Stage 3: AI/Fallback Analysis
  let analysis;
  if (GEMINI_API_KEY && GEMINI_API_KEY.length > 10) {
    try {
      analysis = await analyzeWithGemini(asset, documents, stage1);
      stages.push({ stage: 'AI Analysis', source: 'gemini', duration: Date.now() - startTime });
    } catch (e) {
      console.warn('Gemini failed:', e.message);
      analysis = analyzeWithFallback(asset, documents, stage1);
      stages.push({ stage: 'AI Analysis', source: 'fallback', error: e.message });
    }
  } else {
    analysis = analyzeWithFallback(asset, documents, stage1);
    stages.push({ stage: 'AI Analysis', source: 'fallback' });
  }

  // Stage 4: Fraud checks
  const stage4 = checkFraudIndicators(asset, analysis, stage2);
  stages.push({ stage: 'Fraud Check', ...stage4 });

  // Stage 5: Tokenization recommendation
  const tokenRec = calculateTokenization(asset.raise_amount, analysis);
  stages.push({ stage: 'Tokenization', ...tokenRec });

  // Compile final result
  const confidence = Math.max(0, Math.min(100, analysis.confidence - (stage4.fraudFlags?.length || 0) * 10));
  const verified = analysis.verified && confidence >= C.AI.MIN_CONFIDENCE_FOR_LISTING && !stage4.hasCriticalFraud;

  return {
    verified,
    estimatedValue: analysis.estimatedValue,
    riskScore: analysis.riskScore,
    riskLevel: analysis.riskLevel,
    confidence,
    analysis: analysis.analysis,
    concerns: [analysis.concerns, ...(stage4.fraudFlags || [])].filter(Boolean).join('. '),
    suggestedTokens: tokenRec.suggestedTokens,
    tokenPriceInr: tokenRec.tokenPriceInr,
    source: analysis.source || 'fallback',
    stages,
    raw: analysis.raw || null,
    duration: Date.now() - startTime,
  };
}

// ── Stage 1: Document Processing ─────────────────────────────────────────────

function processDocuments(documents) {
  const result = {
    totalFiles: documents.length,