export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  try {
    const { images } = req.body;
    const imageBlocks = images.map(b64 => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }));
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 600,
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: `You are an EMS medication and equipment scanner. Read every detail on this label carefully. Return ONLY valid JSON, no markdown:
{
  "name": "complete item name and strength e.g. Aspirin 325mg, Epinephrine 1mg/mL 10mL, NPA 28fr, Nitrile Gloves Large",
  "expiration": "expiration date in MM/YYYY format e.g. 09/2026, null if not visible or not applicable",
  "lot": "lot number as string, null if not visible",
  "category": "one of: drugs, disposables, airway, trauma, equipment — pick the most appropriate based on what this item is",
  "packagingType": "one of: bulk_bottle (bottles of tabs like ASA), unit_dose (individually wrapped ODT blister packs), vial (vials ampules prefilled syringes), multi_dose (multi-dose vials IV bags), each (equipment devices individual items)",
  "unit": "most clinically relevant unit e.g. mg mL mcg g tablet each, null if not applicable",
  "size": "size or gauge or french size if applicable e.g. 28fr 7.5 Large 18ga, null if not applicable",
  "notes": "clinically important info: route of administration, storage requirements, controlled substance schedule, concentration — null if none"
}` }] }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const text = (data.content || []).map(c => c.text || '').join('');
    res.status(200).json(JSON.parse(text.replace(/```json|```/g, '').trim()));
  } catch (e) { res.status(500).json({ error: e.message }); }
}