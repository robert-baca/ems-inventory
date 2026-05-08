export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  try {
    const { images, spreadsheet } = req.body;
    if (!images || !images.length) return res.status(400).json({ error: 'No images provided' });

    let spreadsheetText = '';
    if (spreadsheet && spreadsheet.length) {
      const rows = spreadsheet.map(r => `Item: ${r.item || ''} | SFOT Par: ${r.sfotPar ?? ''} | HHA Par: ${r.hhaPar ?? ''}`).join('\n');
      spreadsheetText = `\n\nYou also have access to the following inventory reference spreadsheet. Find the row whose "Item" name best matches the drug in the photos (fuzzy match — ignore case, abbreviations, and minor spelling differences). If a match is found, use its SFOT Par and HHA Par values. If no match, return null for both.\n\nSpreadsheet:\n${rows}`;
    }

    const content = [
      ...images.map(img => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: img }
      })),
      {
        type: 'text',
        text: `You are reading EMS medication labels. Extract the following from these ${images.length} image(s) — different photos may show different parts of the same label:
- name: full drug name with strength (e.g. "Epinephrine 1mg/mL")
- expiration: MM/YYYY format only, or null if not visible
- lot: lot number or null
- category: one of drugs/disposables/airway/trauma/equipment
- packagingType: one of bulk_bottle/unit_dose/vial/multi_dose/each
- unit: unit of measure (mL, mg, tablet, etc)
- size: size or gauge if applicable
- notes: route of administration, storage requirements, controlled substance schedule
- sfotPar: integer from spreadsheet match, or null
- hhaPar: integer from spreadsheet match, or null
- spreadsheetMatch: the exact "Item" value from the matched spreadsheet row, or null${spreadsheetText}

Respond with only valid JSON, no markdown.`
      }
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const text = (data.content || []).map(c => c.text || '').join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    res.status(200).json(JSON.parse(match[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
