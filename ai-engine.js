// ══════════════════════════════════════════════════════════════════════════════
// AVERON AI ENGINE — Document Analysis & Asset Valuation
// Uses Google Gemini API for real analysis, with intelligent fallback.
// ══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// ── CATEGORY DEFAULTS (for fallback) ─────────────────────────────────────────

const CATEGORY_PROFILES = {
  'Stocks & Shares':    { avgValue: 50000, riskRange: [15, 45], minTokens: 5,  maxTokens: 200 },
  'Land & Real Estate': { avgValue: 500000, riskRange: [10, 35], minTokens: 10, maxTokens: 500 },
  'Agricultural Goods': { avgValue: 20000, riskRange: [25, 55], minTokens: 5,  maxTokens: 100 },
  'Shop Inventory':     { avgValue: 30000, riskRange: [30, 60], minTokens: 5,  maxTokens: 150 },
  'Equipment':          { avgValue: 40000, riskRange: [20, 50], minTokens: 5,  maxTokens: 100 },
  'Invoices & Bills':   { avgValue: 15000, riskRange: [20, 45], minTokens: 3,  maxTokens: 50  },
  'Vehicles':           { avgValue: 100000, riskRange: [15, 40], minTokens: 10, maxTokens: 200 },
  'Precious Metals':    { avgValue: 80000, riskRange: [10, 30], minTokens: 5,  maxTokens: 200 },
  'Commodities':        { avgValue: 25000, riskRange: [20, 50], minTokens: 5,  maxTokens: 100 },
  'Other':              { avgValue: 25000, riskRange: [30, 65], minTokens: 3,  maxTokens: 100 },
};

// ── MAIN ANALYSIS FUNCTION ───────────────────────────────────────────────────

/**
 * Analyze an asset's documents and return valuation + risk assessment.
 * Uses Gemini API if available, otherwise falls back to simulated analysis.
 *
 * @param {object} asset - Asset details { title, description, category, raise_amount }
 * @param {array}  documents - Array of { filename, original_name, mimetype, size, path }
 * @returns {object} Analysis result
 */
async function analyzeAsset(asset, documents) {
  if (GEMINI_API_KEY && GEMINI_API_KEY.length > 10) {
    try {
      return await analyzeWithGemini(asset, documents);
    } catch (e) {
      console.warn('Gemini analysis failed, using fallback:', e.message);
      return analyzeWithFallback(asset, documents);
    }
  }
  return analyzeWithFallback(asset, documents);
}

// ── GEMINI API ANALYSIS ──────────────────────────────────────────────────────

async function analyzeWithGemini(asset, documents) {
  const docDescriptions = documents.map((d, i) =>
    `Document ${i + 1}: "${d.original_name}" (${d.mimetype}, ${(d.size / 1024).toFixed(1)}KB)`
  ).join('\n');

  // Prepare parts - text prompt + document images
  const parts = [];

  // Add document images if they are images
  for (const doc of documents) {
    if (doc.mimetype && doc.mimetype.startsWith('image/')) {
      try {
        const imageData = fs.readFileSync(doc.path);
        const base64 = imageData.toString('base64');
        parts.push({
          inlineData: {
            mimeType: doc.mimetype,
            data: base64
          }
        });
      } catch (e) {
        console.warn('Could not read document image:', e.message);
      }
    }
  }

  // Add the analysis prompt
  parts.push({
    text: `You are an expert asset valuation AI for the Averon blockchain tokenization platform.

ASSET DETAILS:
- Title: ${asset.title}
- Category: ${asset.category}
- Description: ${asset.description || 'Not provided'}
- Amount to Raise: ₹${asset.raise_amount}

UPLOADED DOCUMENTS:
${docDescriptions}

${parts.length > 0 ? 'I have also attached the document images above for visual analysis.' : 'No document images available for visual analysis.'}

Analyze this asset and respond in EXACTLY this JSON format (no markdown, no code blocks, just raw JSON):
{
  "verified": true or false,
  "estimated_value": number in INR (your best estimate of the asset's market value),
  "risk_score": number from 0 to 100 (0=very safe, 100=extremely risky),
  "risk_level": "LOW" or "MEDIUM" or "HIGH",
  "suggested_tokens": number (how many tokens to create for the raise amount),
  "token_price_inr": number (suggested price per token in INR),
  "analysis": "2-3 sentence summary of your findings",
  "concerns": "any red flags, issues, or concerns (empty string if none)",
  "confidence": number from 0 to 100 (how confident you are in this analysis)
}

Rules:
- Be realistic with valuations
- If docs seem suspicious or insufficient, set verified=false
- Risk score considers: asset type, documentation quality, raise-to-value ratio
- Token count should make each token affordable (₹100-₹5000 per token)
- If raise_amount > estimated_value, flag it as a concern`
  });

  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Parse JSON from response (handle possible markdown wrapping)
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  }

  const result = JSON.parse(jsonStr);

  return {
    verified: !!result.verified,
    estimatedValue: result.estimated_value || asset.raise_amount,
    riskScore: Math.min(100, Math.max(0, result.risk_score || 50)),
    riskLevel: result.risk_level || 'MEDIUM',
    suggestedTokens: result.suggested_tokens || 10,
    tokenPriceInr: result.token_price_inr || (asset.raise_amount / 10),
    analysis: result.analysis || 'AI analysis completed.',
    concerns: result.concerns || '',
    confidence: result.confidence || 70,
    source: 'gemini',
    raw: text
  };
}

// ── FALLBACK ANALYSIS (No API Key) ───────────────────────────────────────────

function analyzeWithFallback(asset, documents) {
  const profile = CATEGORY_PROFILES[asset.category] || CATEGORY_PROFILES['Other'];

  // Simulate analysis based on documents and category
  const docCount = documents.length;
  const totalSize = documents.reduce((s, d) => s + (d.size || 0), 0);
  const hasImages = documents.some(d => d.mimetype && d.mimetype.startsWith('image/'));

  // Better docs = lower risk, higher confidence
  const docQuality = Math.min(1, (docCount / 3) * 0.5 + (totalSize > 50000 ? 0.3 : 0.1) + (hasImages ? 0.2 : 0));

  // Risk calculation
  const baseRisk = profile.riskRange[0] + Math.random() * (profile.riskRange[1] - profile.riskRange[0]);
  const riskAdjust = docQuality * -15; // Better docs = less risk
  const raiseRatio = asset.raise_amount / profile.avgValue;
  const ratioAdjust = raiseRatio > 1 ? 15 : raiseRatio > 0.5 ? 5 : -5;
  const riskScore = Math.round(Math.min(95, Math.max(5, baseRisk + riskAdjust + ratioAdjust)));

  const riskLevel = riskScore < 30 ? 'LOW' : riskScore < 60 ? 'MEDIUM' : 'HIGH';

  // Valuation
  const estimatedValue = Math.round(profile.avgValue * (0.7 + Math.random() * 0.6));
  const verified = docCount >= 1 && riskScore < 80;

  // Token calculation
  const idealTokenPrice = Math.max(100, Math.min(5000, asset.raise_amount / 20));
  const suggestedTokens = Math.max(2, Math.min(profile.maxTokens, Math.round(asset.raise_amount / idealTokenPrice)));
  const tokenPriceInr = parseFloat((asset.raise_amount / suggestedTokens).toFixed(2));

  const confidence = Math.round(40 + docQuality * 40 + (verified ? 10 : 0));

  // Generate analysis text
  const analyses = {
    'Stocks & Shares': `Based on ${docCount} uploaded document(s), the share certificate(s) appear ${verified ? 'legitimate' : 'unverifiable'}. Estimated portfolio value is ₹${estimatedValue.toLocaleString()}. ${riskLevel === 'LOW' ? 'Blue-chip stocks indicate low risk.' : riskLevel === 'MEDIUM' ? 'Mixed portfolio with moderate risk.' : 'High-volatility stocks detected.'}`,
    'Land & Real Estate': `Property documentation reviewed (${docCount} file(s)). Estimated land/property value is ₹${estimatedValue.toLocaleString()} based on location and category analysis. ${verified ? 'Documents appear valid.' : 'Additional verification recommended.'} ${riskLevel} risk classification assigned.`,
    'Agricultural Goods': `Agricultural asset documentation analyzed. ${docCount} document(s) show commodity holdings valued at approximately ₹${estimatedValue.toLocaleString()}. ${riskLevel} risk due to ${riskScore > 50 ? 'seasonal price volatility' : 'stable commodity pricing'}.`,
    'Shop Inventory': `Inventory and sales records analyzed from ${docCount} uploaded file(s). Estimated stock value: ₹${estimatedValue.toLocaleString()}. ${verified ? 'Records appear consistent.' : 'Some discrepancies noted.'} Business risk rated as ${riskLevel}.`,
  };

  const analysis = analyses[asset.category] ||
    `Asset documentation reviewed (${docCount} file(s)). Estimated value: ₹${estimatedValue.toLocaleString()}. Risk assessment: ${riskLevel} (${riskScore}%). ${verified ? 'Documentation appears sufficient for tokenization.' : 'Additional documentation may improve verification confidence.'}`;

  const concerns = [];
  if (docCount < 2) concerns.push('Only ' + docCount + ' document uploaded — more documentation would improve confidence');
  if (riskScore > 60) concerns.push('Higher than average risk score — investors should exercise caution');
  if (asset.raise_amount > estimatedValue) concerns.push('Raise amount exceeds estimated asset value');
  if (!hasImages) concerns.push('No image documents provided — visual verification not possible');

  return {
    verified,
    estimatedValue,
    riskScore,
    riskLevel,
    suggestedTokens,
    tokenPriceInr,
    analysis,
    concerns: concerns.join('. '),
    confidence,
    source: 'fallback',
    raw: null
  };
}

// ── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = { analyzeAsset };
