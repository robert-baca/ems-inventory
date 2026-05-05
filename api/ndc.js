import { Redis } from '@upstash/redis';

// Extract NDC from GS1 GTIN barcode
// GTIN-14: 00-[5 digit labeler]-[4 digit product]-[1 digit package]-[check digit]
function extractNDCfromGTIN(barcode) {
  const clean = barcode.replace(/[^0-9]/g, '');
  const attempts = [];

  // Raw cleaned barcode
  attempts.push(clean);

  // GS1 GTIN-14: strip leading zeros and check digit
  if (clean.length === 14) {
    const inner = clean.slice(1, 13); // remove first digit and last check digit
    attempts.push(inner);
    // Try different NDC splits: 5-4-2, 5-3-2, 4-4-2
    attempts.push(inner.slice(1, 6) + inner.slice(6, 10) + inner.slice(10, 12));
    attempts.push(inner.slice(2)); // just remove first 2
    attempts.push(inner.slice(1)); // remove first 1
  }

  // GTIN-12 (UPC-A): strip check digit
  if (clean.length === 12) {
    attempts.push(clean.slice(0, 11));
    attempts.push(clean.slice(1, 11));
  }

  // EAN-13: strip leading zero and check digit
  if (clean.length === 13) {
    attempts.push(clean.slice(1, 12));
    attempts.push(clean.slice(0, 12));
    attempts.push(clean.slice(1, 11));
  }

  // Remove leading zeros
  attempts.forEach(a => attempts.push(a.replace(/^0+/, '')));

  return [...new Set(attempts)].filter(a => a.length >= 9);
}

async function searchFDA(query) {
  const urls = [
    `https://api.fda.gov/drug/ndc.json?search=product_ndc:"${query}"&limit=1`,
    `https://api.fda.gov/drug/ndc.json?search=package_ndc:"${query}"&limit=1`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        if (d.results?.[0]) return d.results[0];
      }
    } catch { /* try next */ }
  }
  return null;
}

async function searchByName(name) {
  try {
    const r = await fetch(`https://api.fda.gov/drug/ndc.json?search=brand_name:"${encodeURIComponent(name)}"&limit=1`);
    if (r.ok) { const d = await r.json(); if (d.results?.[0]) return d.results[0]; }
  } catch {}
  try {
    const r = await fetch(`https://api.fda.gov/drug/ndc.json?search=generic_name:"${encodeURIComponent(name)}"&limit=1`);
    if (r.ok) { const d = await r.json(); if (d.results?.[0]) return d.results[0]; }
  } catch {}
  return null;
}

function formatResult(result) {
  const strength = result.active_ingredients?.[0];
  const name = [
    result.brand_name || result.generic_name,
    strength?.strength,
  ].filter(Boolean).join(' ');
  return {
    found:        true,
    name:         name || result.brand_name || result.generic_name,
    genericName:  result.generic_name,
    brandName:    result.brand_name,
    strength:     strength?.strength,
    dosageForm:   result.dosage_form,
    route:        result.route?.[0],
    packager:     result.labeler_name,
    packageSize:  result.packaging?.[0]?.description,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { ndc, name } = req.query;

  // Name search
  if (name && !ndc) {
    const result = await searchByName(name);
    if (result) return res.status(200).json(formatResult(result));
    return res.status(200).json({ found: false });
  }

  if (!ndc) return res.status(400).json({ error: 'NDC or name required' });

  try {
    const candidates = extractNDCfromGTIN(ndc);
    for (const candidate of candidates) {
      const result = await searchFDA(candidate);
      if (result) return res.status(200).json(formatResult(result));
    }
    return res.status(200).json({ found: false, ndc, tried: candidates });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}