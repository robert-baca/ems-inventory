import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const KEY = 'ems-pending-items';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try { res.status(200).json(await redis.get(KEY) || []); }
    catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }
  if (req.method === 'POST') {
    try {
      const { item, deleteId } = req.body;
      const current = await redis.get(KEY);
      let items = Array.isArray(current) ? current : [];
      if (deleteId) {
        items = items.filter(i => i.id !== deleteId);
      } else if (item) {
        const idx = items.findIndex(i => i.id === item.id);
        if (idx >= 0) items[idx] = item;
        else items = [item, ...items];
      }
      await redis.set(KEY, items);
      res.status(200).json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }
  res.status(405).json({ error: 'Method not allowed' });
}
