function extractCandidates(barcode) {
  const clean = barcode.replace(/[^0-9]/g, '');
  const results = new Set();
  results.add(clean);

  let core = clean;
  if (clean.startsWith('01') && clean.length === 16) core = clean.slice(2);
  if (clean.startsWith('01') && clean.length === 15) core = clean.slice(2);
  results.add(core);

  for (let start = 0; start <= core.length - 10; start++) {
    results.add(core.slice(start, start + 10));
    if (start <= core.length - 11) results.add(core.slice(start, start + 11));
  }

  const withDashes = new Set();
  results.forEach(r => {
    const s = r.replace(/-/g, '');
    if (s.length === 10) {
      withDashes.add(s.slice(0,5) + '-' + s.slice(5,9) + '-' + s.slice(9,11));
      withDashes.add(s.slice(0,4) + '-' + s.slice(4,8) + '-' + s.slice(8,10));
      withDashes.add(s.slice(0,5) + '-' + s.slice(5,8) + '-' + s.slice(8,10));
    }
    if (s.length === 11) {
      withDashes.add(s.slice(0,5) + '-' + s.slice(5,9) + '-' + s.slice(9,11));
      withDashes.add(s.slice(0,5) + '-' + s.slice(5,8) + '-' + s.slice(8,11));
    }
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
    } catch { }
  }
  return null;
}

// Wildcard search using first 4-5 digits of NDC + generic name hint
async function searchFDAWildcard(candidates) {
  // Extract likely labeler codes (first 4-5 digits)
  const labelerCodes = new Set();
  candidates.forEach(c => {
    const digits = c.replace(/-/g, '');
    if (digits.length >= 9) {
      labelerCodes.add(digits.slice(0, 4));
      labelerCodes.add(digits.slice(0, 5));
    }
  });

  for (const code of labelerCodes) {
    try {
      const r = await fetch(`https://api.fda.gov/drug/ndc.json?search=product_ndc:${code}*&limit=5`);
      if (!r.ok) continue;
      const d = await r.json();
      if (d.results?.length > 0) {
        // Find best match by checking if full NDC digits appear in any result
        for (const result of d.results) {
          const resultNDC = (result.product_ndc || '').replace(/-/g, '');
          for (const candidate of candidates) {
            const candidateClean = candidate.replace(/-/g, '');
            if (resultNDC === candidateClean || candidateClean.includes(resultNDC) || resultNDC.includes(candidateClean.slice(0, 8))) {
              return result;
            }
          }
        }
        // Return first result if labeler matches
        return d.results[0];
      }
    } catch { }
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
    } catch { }
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

    // Step 1 — exact match
    for (const candidate of candidates) {
      const result = await searchFDA(candidate);
      if (result) return res.status(200).json(formatResult(result));
    }

    // Step 2 — wildcard match by labeler code
    const wildcardResult = await searchFDAWildcard(candidates);
    if (wildcardResult) return res.status(200).json(formatResult(wildcardResult));

    // Step 3 — last resort, search by the last 9 digits
    const lastNine = ndc.replace(/[^0-9]/g, '').slice(-9);
    try {
      const r = await fetch(`https://api.fda.gov/drug/ndc.json?search=product_ndc:*${lastNine.slice(0,4)}*&limit=1`);
      if (r.ok) {
        const d = await r.json();
        if (d.results?.[0]) return res.status(200).json(formatResult(d.results[0]));
      }
    } catch { }

    return res.status(200).json({ found: false, ndc, candidates: candidates.slice(0, 5) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}