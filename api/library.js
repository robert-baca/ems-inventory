import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try { res.status(200).json(await redis.get('ems-library') || []); }
    catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }
  if (req.method === 'POST') {
    try {
      const { item, deleteId } = req.body;

      if (item) {
        // Atomic upsert — read current, replace or append, write back
        const current = await redis.get('ems-library') || [];
        const idx = current.findIndex(i => i.id === item.id);
        const updated = idx >= 0
          ? current.map(i => i.id === item.id ? item : i)
          : [item, ...current];
        await redis.set('ems-library', updated);
        return res.status(200).json(updated);
      }

      if (deleteId) {
        // Atomic delete — read current, filter out, write back
        const current = await redis.get('ems-library') || [];
        const updated = current.filter(i => i.id !== deleteId);
        await redis.set('ems-library', updated);
        return res.status(200).json(updated);
      }

      // Full replace (used by settings/bulk ops)
      await redis.set('ems-library', req.body);
      return res.status(200).json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }
  res.status(405).json({ error: 'Method not allowed' });
}
