// ══════════════════════════════════════════════════════════════════════════════
// AVERON AI PIPELINE — Multi-stage document analysis
// ══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const crypto = require('crypto');
const C = require('../config/constants');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${C.AI.GEMINI_MODEL}:generateContent`;

// ── CATEGORY PROFILES (for fallback) ─────────────────────────────────────────