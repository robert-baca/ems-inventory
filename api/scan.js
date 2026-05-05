export default async function handler(req, res) {
  const { images } = req.body;
  if (!images || !images.length) return res.status(400).json({ error: 'No images provided' });

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

Respond with only valid JSON, no markdown.`
    }
  ];

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content }]
    });
    const text = message.content[0].text.trim().replace(/```json|```/g, '');
    res.status(200).json(JSON.parse(text));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}