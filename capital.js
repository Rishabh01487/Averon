// ══════════════════════════════════════════════════════════════════════════════
// AVERON CAPITAL — Funding & payout system
// ══════════════════════════════════════════════════════════════════════════════

const { queryOne, query, run, getPrice, setPrice } = require('./database');

function checkAndProcessFunding(assetId) {
  const asset = queryOne('SELECT * FROM assets WHERE id = ?', [assetId]);
  if (!asset || asset.status === 'funded') return null;

  const sold = queryOne('SELECT COUNT(*) as count FROM asset_tokens WHERE asset_id = ? AND owner_id IS NOT NULL', [assetId]);
  if ((sold?.count || 0) < asset.token_count) return null;

  const currentPrice = getPrice();
  const totalAC = asset.token_price * asset.token_count;
  const totalINR = parseFloat((totalAC * currentPrice).toFixed(2));

  run('UPDATE assets SET funded_amount = ?, status = "funded", payout_status = "paid" WHERE id = ?', [totalAC, assetId]);

  const boostPct = Math.min(0.05, 0.02 + (asset.raise_amount / 1000000) * 0.03);
  const newPrice = parseFloat((currentPrice * (1 + boostPct)).toFixed(4));
  setPrice(newPrice);

  run('UPDATE economy SET total_raised_inr = total_raised_inr + ?, total_assets_funded = total_assets_funded + 1 WHERE id = 1', [totalINR]);
  run('INSERT INTO activity_log (user_id, action, details, amount, created_at) VALUES (?, ?, ?, ?, ?)',
    [asset.owner_id, 'ASSET_FUNDED', `"${asset.title}" fully funded — ${asset.token_count} tokens — ₹${totalINR}`, totalINR, Date.now()]);

  return { assetId, totalACRaised: totalAC, totalINRRaised: totalINR, newCoinPrice: newPrice };
}

function checkDeadlines() {
  const active = query('SELECT * FROM assets WHERE status = "active"');
  const now = Date.now();
  for (const asset of active) {
    if (asset.deadline && now > asset.deadline) {
      const sold = queryOne('SELECT COUNT(*) as count FROM asset_tokens WHERE asset_id = ? AND owner_id IS NOT NULL', [asset.id]);
      if ((sold?.count || 0) >= asset.token_count) {
        checkAndProcessFunding(asset.id);
      } else {
        run('UPDATE assets SET status = "expired" WHERE id = ?', [asset.id]);
        run('INSERT INTO activity_log (user_id, action, details, created_at) VALUES (?, ?, ?, ?)',
          [asset.owner_id, 'ASSET_EXPIRED', `"${asset.title}" expired`, Date.now()]);
      }
    }
  }
}

module.exports = { checkAndProcessFunding, checkDeadlines };
