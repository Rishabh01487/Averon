// ══════════════════════════════════════════════════════════════════════════════
// AVERON TOKENIZER — Splits assets into fractional tokens
// ══════════════════════════════════════════════════════════════════════════════

const { queryOne, run, getPrice } = require('./database');

function tokenizeAsset(assetId, aiResult) {
  const asset = queryOne('SELECT * FROM assets WHERE id = ?', [assetId]);
  if (!asset) throw new Error('Asset not found');

  const currentPrice = getPrice();
  let tokenCount = Math.max(2, Math.min(1000, aiResult.suggestedTokens || 10));
  let tokenPriceInr = parseFloat((asset.raise_amount / tokenCount).toFixed(2));
  const tokenPriceAC = parseFloat((tokenPriceInr / currentPrice).toFixed(4));

  for (let i = 1; i <= tokenCount; i++) {
    run('INSERT INTO asset_tokens (asset_id, token_index, price) VALUES (?, ?, ?)', [assetId, i, tokenPriceAC]);
  }

  run('UPDATE assets SET token_count = ?, token_price = ?, status = "active" WHERE id = ?', [tokenCount, tokenPriceAC, assetId]);

  return { assetId, tokenCount, tokenPriceInr, tokenPriceAC, totalRaiseAC: parseFloat((tokenPriceAC * tokenCount).toFixed(4)) };
}

module.exports = { tokenizeAsset };
