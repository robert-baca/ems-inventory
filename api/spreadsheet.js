import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const KEY = 'ems-spreadsheet-ref';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try { res.status(200).json(await redis.get(KEY) || null); }
    catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }
  if (req.method === 'POST') {
    try {
      const { rows, clear } = req.body;
      if (clear) { await redis.del(KEY); return res.status(200).json({ ok: true }); }
      if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: 'rows required' });
      await redis.set(KEY, rows);
      res.status(200).json({ ok: true, count: rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }
  res.status(405).json({ error: 'Method not allowed' });
}
