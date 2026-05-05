function parseGS1(barcode) {
  const clean = barcode.replace(/[^0-9]/g, '');
  const results = [];

  // Direct attempts with the raw barcode
  results.push(clean);

  // GS1-128 Application Identifier parsing
  // AI (01) = GTIN-14, always 14 digits
  // AI (17) = expiration YYMMDD, 6 digits  
  // AI (10) = lot number, variable
  // AI (21) = serial, variable
  let i = 0;
  const ais = {};
  const str = clean;

  // Try to find AI 01 (GTIN) in the string
  for (let pos = 0; pos < str.length - 14; pos++) {
    if (str.slice(pos, pos+2) === '01') {
      const gtin = str.slice(pos+2, pos+16);
      if (gtin.length === 14) {
        ais['01'] = gtin;
        // Extract NDC from GTIN-14
        // Format: [1 indicator][5 labeler][4 product][2 package][1 check]
        const inner = gtin.slice(1, 13); // 12 digits after indicator, before check
        results.push(inner);
        results.push(inner.slice(1)); // 11 digits
        // Try splitting as NDC 5-4-2
        const labeler = inner.slice(1, 6);
        const product = inner.slice(6, 10);
        const pkg     = inner.slice(10, 12);
        results.push(`${labeler}-${product}-${pkg}`);
        results.push(`${labeler}${product}${pkg}`);
        // Also try removing leading zero from labeler
        results.push(`${labeler.replace(/^0/,'')}-${product}-${pkg}`);
      }
    }
  }

  // Standard GTIN-14 (14 digits)
  if (clean.length === 14) {
    const inner = clean.slice(1, 13);
    results.push(inner);
    results.push(inner.slice(1));
    results.push(clean.slice(1,6) + '-' + clean.slice(6,10) + '-' + clean.slice(10,12));
    results.push(clean.slice(2,7) + '-' + clean.slice(7,11) + '-' + clean.slice(11,13));
  }

  // UPC-A / GTIN-12
  if (clean.length === 12) {
    results.push(clean.slice(0,11));
    results.push(clean.slice(1,11));
    results.push(clean.slice(1,6)+'-'+clean.slice(6,10)+'-'+clean.slice(10,12));
  }

  // EAN-13
  if (clean.length === 13) {
    results.push(clean.slice(1,12));
    results.push(clean.slice(0,12));
  }

  // Also try removing all leading zeros from each attempt
  const withoutLeading = results.map(r => r.replace(/^0+/, ''));

  return [...new Set([...results, ...withoutLeading])].filter(a => a.replace(/-/g,'').length >= 9);
}

async function searchFDA(query) {
  const clean = query.replace(/-/g, '');
  const searches = [
    `product_ndc:"${query}"`,
    `package_ndc:"${query}"`,
    `product_ndc:"${clean}"`,
    `package_ndc:"${clean}"`,
  ];
  for (const search of searches) {
    try {
      const r = await fetch(`https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(search)}&limit=1`);
      if (r.ok) {
        const d = await r.json();
        if (d.results?.[0]) return d.results[0];
      }
    } catch { /* try next */ }
  }
  return null;
}

async function searchByName(name) {
  const searches = [
    `brand_name:"${name}"`,
    `generic_name:"${name}"`,
    `brand_name:${name}`,
    `generic_name:${name}`,
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
    const candidates = parseGS1(ndc);
    console.log('NDC candidates for', ndc, ':', candidates);
    for (const candidate of candidates) {
      const result = await searchFDA(candidate);
      if (result) return res.status(200).json(formatResult(result));
    }
    return res.status(200).json({ found: false, ndc, tried: candidates.slice(0, 5) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}