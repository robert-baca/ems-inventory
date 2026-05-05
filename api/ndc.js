function extractCandidates(barcode) {
  const clean = barcode.replace(/[^0-9]/g, '');
  const results = new Set();
  results.add(clean);

  let core = clean;
  if (clean.startsWith('01') && clean.length === 16) core = clean.slice(2);
  if (clean.startsWith('01') && clean.length === 15) core = clean.slice(2);
  results.add(core);

  // Brute force every 10 and 11 digit substring
  for (let start = 0; start <= core.length - 10; start++) {
    results.add(core.slice(start, start + 10));
    if (start <= core.length - 11) results.add(core.slice(start, start + 11));
  }

  // Add dashed NDC formats for each candidate
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

  return [...results].filter(r => r.replace(/-/g, '').length >= 9);
}

async function searchFDA(query) {
  const clean = query.replace(/-/g, '');
  const searches = [
    `package_ndc:"${query}"`,
    `product_ndc:"${query}"`,
    `package_ndc:"${clean}"`,
    `product_ndc:"${clean}"`,
    `package_ndc:${query}`,
    `product_ndc:${query}`,
  ];
  for (const search of searches) {
    try {
      const url = `https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(search)}&limit=1`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      if (d.results?.[0]) return d.results[0];
    } catch { }
  }
  return null;
}

async function searchFDAWildcard(candidates) {
  // Only use wildcard if we can verify the digits actually match
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
      const url = `https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(`product_ndc:${code}*`)}&limit=10`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      if (!d.results?.length) continue;
      // Only return if we find a result whose NDC digits
      // actually appear in one of our candidates
      for (const result of d.results) {
        const resultNDC = (result.product_ndc || '').replace(/-/g, '');
        for (const candidate of candidates) {
          const candidateClean = candidate.replace(/-/g, '');
          if (resultNDC === candidateClean) return result;
          // Must match at least 8 consecutive digits
          if (candidateClean.length >= 8 && resultNDC.includes(candidateClean.slice(0, 8))) return result;
          if (resultNDC.length >= 8 && candidateClean.includes(resultNDC.slice(0, 8))) return result;
        }
      }
      // No verified match — don't return anything from this labeler
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
      const url = `https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(search)}&limit=1`;
      const r = await fetch(url);
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

  // Name-only search
  if (name && !ndc) {
    const result = await searchByName(name);
    if (result) return res.status(200).json(formatResult(result));
    return res.status(200).json({ found: false });
  }

  if (!ndc) return res.status(400).json({ error: 'NDC or name required' });

  try {
    const candidates = extractCandidates(ndc);

    // Step 1 — exact match on every candidate
    for (const candidate of candidates) {
      const result = await searchFDA(candidate);
      if (result) return res.status(200).json(formatResult(result));
    }

    // Step 2 — wildcard match by labeler code
    const wildcardResult = await searchFDAWildcard(candidates);
    if (wildcardResult) return res.status(200).json(formatResult(wildcardResult));

    

    return res.status(200).json({ found: false, ndc, candidates: candidates.slice(0, 5) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}