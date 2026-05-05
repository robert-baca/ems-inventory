function extractCandidates(barcode) {
  const clean = barcode.replace(/[^0-9]/g, '');
  const results = new Set();
  results.add(clean);

  // Get the core number — strip known AI prefixes
  let core = clean;
  if (clean.startsWith('01') && clean.length === 16) core = clean.slice(2); // remove AI "01"
  if (clean.startsWith('01') && clean.length === 15) core = clean.slice(2);
  results.add(core);

  // Brute force: try every 10 and 11 digit substring
  // NDC is always 10 or 11 digits
  for (let start = 0; start <= core.length - 10; start++) {
    results.add(core.slice(start, start + 10));
    if (start <= core.length - 11) results.add(core.slice(start, start + 11));
  }

  // Also try with dashes in common NDC formats (5-4-2, 4-4-2, 5-3-2)
  const withDashes = new Set();
  results.forEach(r => {
    const s = r.replace(/-/g, '');
    if (s.length === 10) {
      withDashes.add(s.slice(0,5) + '-' + s.slice(5,9) + '-' + s.slice(9,11));  // 5-4-2 (only 11 chars)
      withDashes.add(s.slice(0,4) + '-' + s.slice(4,8) + '-' + s.slice(8,10));  // 4-4-2
      withDashes.add(s.slice(0,5) + '-' + s.slice(5,8) + '-' + s.slice(8,10));  // 5-3-2
    }
    if (s.length === 11) {
      withDashes.add(s.slice(0,5) + '-' + s.slice(5,9) + '-' + s.slice(9,11));  // 5-4-2
      withDashes.add(s.slice(0,5) + '-' + s.slice(5,8) + '-' + s.slice(8,11));  // 5-3-2 (11)
    }
    // Remove leading zeros
    withDashes.add(s.replace(/^0+/, ''));
  });
  withDashes.forEach(r => results.add(r));

  return [...results].filter(r => r.replace(/-/g,'').length >= 9);
}

async function searchFDA(query) {
  const clean = query.replace(/-/g, '');
  const urls = [
    `https://api.fda.gov/drug/ndc.json?search=product_ndc:"${query}"&limit=1`,
    `https://api.fda.gov/drug/ndc.json?search=package_ndc:"${query}"&limit=1`,
    `https://api.fda.gov/drug/ndc.json?search=product_ndc:"${clean}"&limit=1`,
    `https://api.fda.gov/drug/ndc.json?search=package_ndc:"${clean}"&limit=1`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      if (d.results?.[0]) return d.results[0];
    } catch { /* try next */ }
  }
  return null;
}

async function searchByName(name) {
  const searches = [
    `brand_name:"${name}"`,
    `generic_name:"${name}"`,
    `brand_name:${name}*`,
    `generic_name:${name}*`,
  ];
  for (const search of searches) {
    try {
      const r = await fetch(`https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(search)}&limit=1`);
      if (r.ok) { const d = await r.json(); if (d.results?.[0]) return d.results[0]; }
    } catch {}
  }
  return null;
}

function formatResult(result) {
  const strength = result.active_ingredients?.[0];
  const name = [result.brand_name || result.generic_name, strength?.strength].filter(Boolean).join(' ');
  return {
    found:       true,
    name:        name || result.brand_name || result.generic_name,
    genericName: result.generic_name,
    brandName:   result.brand_name,
    strength:    strength?.strength,
    dosageForm:  result.dosage_form,
    route:       result.route?.[0],
    packager:    result.labeler_name,
    packageSize: result.packaging?.[0]?.description,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { ndc, name } = req.query;

  if (name && !ndc) {
    const result = await searchByName(name);
    if (result) return res.status(200).json(formatResult(result));
    return res.status(200).json({ found: false });
  }

  if (!ndc) return res.status(400).json({ error: 'NDC or name required' });

  try {
    const candidates = extractCandidates(ndc);
    console.log('Trying', candidates.length, 'candidates for barcode:', ndc);

    for (const candidate of candidates) {
      const result = await searchFDA(candidate);
      if (result) {
        console.log('FOUND with candidate:', candidate);
        return res.status(200).json(formatResult(result));
      }
    }

    // Last resort - try the raw barcode as a text search
    try {
      const r = await fetch(`https://api.fda.gov/drug/ndc.json?search=product_ndc:${ndc.replace(/[^0-9]/g,'').slice(-10)}&limit=1`);
      if (r.ok) {
        const d = await r.json();
        if (d.results?.[0]) return res.status(200).json(formatResult(d.results[0]));
      }
    } catch {}

    return res.status(200).json({ found: false, ndc, candidates: candidates.slice(0, 10) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}