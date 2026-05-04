export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  const { ndc } = req.query;
  if (!ndc) return res.status(400).json({ error: 'NDC required' });

  try {
    // Clean the NDC - remove dashes and spaces
    const cleaned = ndc.replace(/[-\s]/g, '');
    
    // Try FDA API first
    const fdaRes = await fetch(
      `https://api.fda.gov/drug/ndc.json?search=product_ndc:"${cleaned}"&limit=1`
    );
    
    if (fdaRes.ok) {
      const fdaData = await fdaRes.json();
      const result  = fdaData.results?.[0];
      if (result) {
        const strength = result.active_ingredients?.[0];
        const name = [
          result.brand_name || result.generic_name,
          strength ? `${strength.strength}` : null,
          result.dosage_form,
        ].filter(Boolean).join(' ');
        
        return res.status(200).json({
          found:        true,
          name:         name || result.brand_name || result.generic_name,
          genericName:  result.generic_name,
          brandName:    result.brand_name,
          strength:     strength?.strength,
          dosageForm:   result.dosage_form,
          route:        result.route?.[0],
          packager:     result.labeler_name,
          ndc:          cleaned,
          packageSize:  result.packaging?.[0]?.description,
        });
      }
    }

    // Fallback — try OpenFDA with package NDC format
    const altRes = await fetch(
      `https://api.fda.gov/drug/ndc.json?search=package_ndc:"${cleaned}"&limit=1`
    );
    if (altRes.ok) {
      const altData = await altRes.json();
      const result  = altData.results?.[0];
      if (result) {
        const strength = result.active_ingredients?.[0];
        const name = [
          result.brand_name || result.generic_name,
          strength ? `${strength.strength}` : null,
        ].filter(Boolean).join(' ');
        return res.status(200).json({
          found:       true,
          name:        name,
          genericName: result.generic_name,
          brandName:   result.brand_name,
          strength:    strength?.strength,
          dosageForm:  result.dosage_form,
          route:       result.route?.[0],
          packager:    result.labeler_name,
          ndc:         cleaned,
        });
      }
    }

    return res.status(200).json({ found: false, ndc: cleaned });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}