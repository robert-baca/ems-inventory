import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try { res.status(200).json(await redis.get('ems-stock') || []); }
    catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }
  if (req.method === 'POST') {
    try {
      const { entries, upsert, deleteIds, replace } = req.body;

      if (entries) {
        // Append new entries (Quick Receive / Add Stock)
        const current = await redis.get('ems-stock') || [];
        const updated = [...current, ...entries];
        await redis.set('ems-stock', updated);
        return res.status(200).json(updated);
      }

      if (upsert) {
        // Update individual entries by id
        const current = await redis.get('ems-stock') || [];
        const upsertMap = Object.fromEntries(upsert.map(e => [e.id, e]));
        const updated = current.map(e => upsertMap[e.id] ?? e);
        await redis.set('ems-stock', updated);
        return res.status(200).json(updated);
      }

      if (deleteIds) {
        // Delete entries by id
        const current = await redis.get('ems-stock') || [];
        const idSet = new Set(deleteIds);
        const updated = current.filter(e => !idSet.has(e.id));
        await redis.set('ems-stock', updated);
        return res.status(200).json(updated);
      }

      if (replace) {
        await redis.set('ems-stock', replace);
        return res.status(200).json({ ok: true });
      }

      // Legacy full-replace fallback
      await redis.set('ems-stock', req.body);
      return res.status(200).json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }
  res.status(405).json({ error: 'Method not allowed' });
}
