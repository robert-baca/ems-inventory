export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  try {
    const { image, library } = req.body;
    const itemList = (library || []).map((d, i) => `${i + 1}. [${d.id}] ${d.name}`).join('\n');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: `You are an EMS inventory receiving scanner. Match this label against the library.

LIBRARY:
${itemList || '(empty)'}

Return ONLY valid JSON, no markdown:
{
  "matchedId": "exact id string from library if clearly the same item, null if uncertain or not found",
  "matchedName": "name from library if matched, otherwise the full name you read from the label",
  "expiration": "MM/YYYY format if visible e.g. 09/2026, null if not visible",
  "lot": "lot number if visible, null if not",
  "confidence": "high or low"
}` }
        ]}]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const text = (data.content || []).map(c => c.text || '').join('');
    res.status(200).json(JSON.parse(text.replace(/```json|```/g, '').trim()));
  } catch (e) { res.status(500).json({ error: e.message }); }
}