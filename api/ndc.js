function parseGS1(barcode) {
  const clean = barcode.replace(/[^0-9]/g, '');
  const results = new Set();

  results.add(clean);

  // Handle GS1 with AI prefix "01" + 14 digit GTIN
  // Raw: 01 + 14 digits = 16 total
  if (clean.length === 16 && clean.startsWith('01')) {
    const gtin14 = clean.slice(2); // remove "01" prefix → 14 digits
    results.add(gtin14);
    // Strip indicator (first digit) and check digit (last digit) → 12 digits
    const inner12 = gtin14.slice(1, 13);
    results.add(inner12);
    // Strip just leading digit → 13 digits
    const inner13 = gtin14.slice(1);
    results.add(inner13);
    // NDC is usually in positions 2-11 of the GTIN-14
    // Format: [indicator][5 labeler][4 product][2 package][check]
    const labeler = gtin14.slice(1, 6);
    const product = gtin14.slice(6, 10);
    const pkg     = gtin14.slice(10, 12);
    results.add(`${labeler}-${product}-${pkg}`);
    results.add(`${labeler}${product}${pkg}`);
    // Remove leading zeros from labeler
    results.add(`${labeler.replace(/^0+/, '')}-${product}-${pkg}`);
    // Try shifting by one
    const labeler2 = gtin14.slice(2, 7);
    const product2 = gtin14.slice(7, 11);
    const pkg2     = gtin14.slice(11, 13);
    results.add(`${labeler2}-${product2}-${pkg2}`);
    results.add(`${labeler2}${product2}${pkg2}`);
    results.add(`${labeler2.replace(/^0+/, '')}-${product2}-${pkg2}`);
  }

  // Standard GTIN-14 (14 digits, no AI prefix)
  if (clean.length === 14) {
    const inner12 = clean.slice(1, 13);
    results.add(inner12);
    results.add(inner12.slice(1));
    const labeler = clean.slice(1, 6);
    const product = clean.slice(6, 10);
    const pkg     = clean.slice(10, 12);
    results.add(`${labeler}-${product}-${pkg}`);
    results.add(`${labeler.replace(/^0+/, '')}-${product}-${pkg}`);
  }

  // GTIN-12 / UPC-A
  if (clean.length === 12) {
    results.add(clean.slice(0, 11));
    results.add(clean.slice(1, 11));
    results.add(clean.slice(1, 6) + '-' + clean.slice(6, 10) + '-' + clean.slice(10, 12));
  }

  // EAN-13
  if (clean.length === 13) {
    results.add(clean.slice(1, 12));
    results.add(clean.slice(0, 12));
  }

  // Add versions with dashes stripped and leading zeros removed
  const extras = new Set();
  results.forEach(r => {
    extras.add(r.replace(/-/g, ''));
    extras.add(r.replace(/^0+/, ''));
    extras.add(r.replace(/-/g, '').replace(/^0+/, ''));
  });
  extras.forEach(e => results.add(e));

  return [...results].filter(a => a.replace(/-/g, '').length >= 9);
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
    console.log('Trying NDC candidates:', candidates);
    for (const candidate of candidates) {
      const result = await searchFDA(candidate);
      if (result) return res.status(200).json(formatResult(result));
    }
    return res.status(200).json({ found: false, ndc, tried: candidates.slice(0, 8) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}