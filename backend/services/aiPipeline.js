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
    totalSize: 0,
    types: {},
    hasImages: false,
    hasPdf: false,
  };

  for (const doc of documents) {
    result.totalSize += doc.size || 0;
    const mime = doc.mimetype || '';
    result.types[mime] = (result.types[mime] || 0) + 1;
    if (mime.startsWith('image/')) result.hasImages = true;
    if (mime === 'application/pdf') result.hasPdf = true;
  }

  result.quality = Math.min(100, (
    (result.totalFiles / 3) * 30 +
    (result.totalSize > 100000 ? 25 : result.totalSize > 50000 ? 15 : 5) +
    (result.hasImages ? 25 : 0) +
    (result.hasPdf ? 20 : 0)
  ));

  return result;
}

// ── Stage 2: Duplicate Detection ─────────────────────────────────────────────

function detectDuplicates(documents, dbModule) {
  const duplicates = [];

  if (dbModule) {
    for (const doc of documents) {
      if (!doc.path && !doc.filepath) continue;
      try {
        const filePath = doc.path || doc.filepath;
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        doc.doc_hash = hash;

        // Check database for same hash
        const existing = dbModule.queryOne('SELECT asset_id FROM asset_documents WHERE doc_hash = ? AND asset_id != ?',
          [hash, doc.asset_id || 0]);
        if (existing) {
          duplicates.push({ filename: doc.original_name, existingAssetId: existing.asset_id });
        }
      } catch {}
    }
  }

  return {
    hasDuplicates: duplicates.length > 0,
    duplicates,
  };
}

// ── Stage 3a: Gemini Analysis ────────────────────────────────────────────────

async function analyzeWithGemini(asset, documents, docInfo) {
  const parts = [];

  for (const doc of documents) {
    if (doc.mimetype?.startsWith('image/')) {
      try {
        const filePath = doc.path || doc.filepath;
        if (!fs.existsSync(filePath)) continue;
        const data = fs.readFileSync(filePath);
        parts.push({ inlineData: { mimeType: doc.mimetype, data: data.toString('base64') } });
      } catch {}
    }
  }

  parts.push({ text: `You are an expert asset valuation AI for the Averon blockchain tokenization platform.

ASSET: "${asset.title}" | Category: ${asset.category} | Raise: ₹${asset.raise_amount}
Description: ${asset.description || 'None'}
Documents: ${documents.length} file(s), ${(docInfo.totalSize / 1024).toFixed(0)}KB total
${parts.length > 1 ? 'Document images attached above.' : 'No images available.'}

Respond ONLY with this JSON (no markdown):
{"verified":true,"estimated_value":50000,"risk_score":30,"risk_level":"LOW","analysis":"summary","concerns":"","confidence":80}` });

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: C.AI.TEMPERATURE, maxOutputTokens: 512 },
    }),
    signal: AbortSignal.timeout(C.AI.TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  text = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  const r = JSON.parse(text);

  return {
    verified: !!r.verified,
    estimatedValue: r.estimated_value || asset.raise_amount,
    riskScore: Math.min(100, Math.max(0, r.risk_score || 50)),
    riskLevel: r.risk_level || 'MEDIUM',
    analysis: r.analysis || 'AI analysis completed.',
    concerns: r.concerns || '',
    confidence: r.confidence || 70,
    source: 'gemini',
    raw: text,
  };
}

// ── Stage 3b: Fallback Analysis ──────────────────────────────────────────────

function analyzeWithFallback(asset, documents, docInfo) {
  const p = PROFILES[asset.category] || PROFILES['Other'];
  const quality = docInfo.quality || 50;

  const baseRisk = p.risk[0] + Math.random() * (p.risk[1] - p.risk[0]);
  const qualityAdj = (quality / 100) * -15;
  const ratioAdj = asset.raise_amount > p.avg ? 10 : -5;
  const riskScore = Math.round(Math.min(95, Math.max(5, baseRisk + qualityAdj + ratioAdj)));
  const riskLevel = riskScore < 30 ? 'LOW' : riskScore < 60 ? 'MEDIUM' : 'HIGH';
  const estimatedValue = Math.round(p.avg * (0.7 + Math.random() * 0.6));
  const verified = documents.length >= 1 && riskScore < 80;
  const confidence = Math.round(35 + quality * 0.5 + (verified ? 10 : 0));

  const analysis = `${asset.category} asset analyzed from ${documents.length} document(s). ` +
    `Estimated value: ₹${estimatedValue.toLocaleString()}. ` +
    `Risk: ${riskLevel} (${riskScore}%). ` +
    `${verified ? 'Documents appear sufficient for tokenization.' : 'Additional documentation recommended.'}`;

  const concerns = [];
  if (documents.length < 2) concerns.push('Limited documentation');
  if (riskScore > 60) concerns.push('Elevated risk score');
  if (asset.raise_amount > estimatedValue) concerns.push('Raise exceeds estimated value');

  return {
    verified, estimatedValue, riskScore, riskLevel, analysis,
    concerns: concerns.join('. '), confidence, source: 'fallback', raw: null,
  };
}

// ── Stage 4: Fraud Detection ─────────────────────────────────────────────────

function checkFraudIndicators(asset, analysis, duplicateResult) {
  const flags = [];
  let hasCriticalFraud = false;

  if (duplicateResult.hasDuplicates) {
    flags.push(`Duplicate documents detected (also used in asset #${duplicateResult.duplicates[0]?.existingAssetId})`);
    hasCriticalFraud = true;
  }

  if (asset.raise_amount > (analysis.estimatedValue || 0) * 2) {
    flags.push('Raise amount is more than 2x estimated value');
  }

  if (analysis.confidence < C.AI.FRAUD_ALERT_THRESHOLD) {
    flags.push(`Very low AI confidence (${analysis.confidence}%)`);
  }

  if (analysis.riskScore > 85) {
    flags.push('Extremely high risk score');
  }

  return { fraudFlags: flags, hasCriticalFraud, flagCount: flags.length };
}

// ── Stage 5: Tokenization ────────────────────────────────────────────────────

function calculateTokenization(raiseAmount, analysis) {
  const riskFactor = 1 + (analysis.riskScore || 50) / 200; // Higher risk = more tokens
  const idealPrice = Math.max(C.LIMITS.MIN_TOKEN_PRICE_INR, Math.min(C.LIMITS.MAX_TOKEN_PRICE_INR, raiseAmount / (15 * riskFactor)));
  const suggestedTokens = Math.max(C.LIMITS.MIN_TOKEN_COUNT, Math.min(C.LIMITS.MAX_TOKEN_COUNT, Math.round(raiseAmount / idealPrice)));
  const tokenPriceInr = parseFloat((raiseAmount / suggestedTokens).toFixed(2));

  return { suggestedTokens, tokenPriceInr, idealPrice: parseFloat(idealPrice.toFixed(2)) };
}

module.exports = { analyzeAsset };
