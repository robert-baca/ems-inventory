require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { networkInterfaces } = require('os');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data', 'inventory.json');

if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]');
}

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/api/inventory', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch {
    res.json([]);
  }
});

app.post('/api/inventory', (req, res) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/scan', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
  try {
    const { image } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            {
              type: 'text',
              text: `You are an EMS medication and equipment inventory scanner. Extract all visible information from this label. Return ONLY a valid JSON object, no markdown, no explanation:
{
  "name": "complete item name including strength and concentration",
  "expiration": "YYYY-MM or YYYY-MM-DD, null if not found",
  "lot": "lot number as string, null if not found",
  "barcode": "NDC or barcode digits, null if not found",
  "quantity": "numeric amount as string, null if not found",
  "unit": "mL mg mcg g each etc, null if not found",
  "notes": "route storage requirements schedule etc, null if none"
}`
            }
          ]
        }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const text = (data.content || []).map(c => c.text || '').join('');
    res.json(JSON.parse(text.replace(/```json|```/g, '').trim()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/quickscan', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
  try {
    const { image, library = [] } = req.body;
    const libraryNames = library.map(d => `${d.id}|${d.name}`).join('\n');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            {
              type: 'text',
              text: `You are an EMS inventory scanner. Read this medication or supply label.

Library items (id|name):
${libraryNames || '(empty)'}

Return ONLY a valid JSON object, no markdown:
{
  "matchedId": "library id of best match or null",
  "matchedName": "item name you read from the label",
  "expiration": "YYYY-MM or YYYY-MM-DD from label, null if not found",
  "lot": "lot number as string or null",
  "barcode": "NDC or barcode digits or null"
}`
            }
          ]
        }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const text = (data.content || []).map(c => c.text || '').join('');
    res.json(JSON.parse(text.replace(/```json|```/g, '').trim()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  const p = path.join(__dirname, 'dist', 'index.html');
  fs.existsSync(p) ? res.sendFile(p) : res.send('Run npm run dev');
});

app.listen(PORT, '0.0.0.0', () => {
  const nets = networkInterfaces();
  let localIP = 'YOUR_IP';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
    }
  }
  console.log(`\n✅ EMS Inventory running`);
  console.log(`   Computer: http://localhost:5173`);
  console.log(`   Phone:    http://${localIP}:5173\n`);
});