import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try { res.status(200).json(await redis.get('ems-library') || []); }
    catch (e) { res.status(500).json({ error: e.message }); }
  } else if (req.method === 'POST') {
    try { await redis.set('ems-library', req.body); res.status(200).json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  } else { res.status(405).json({ error: 'Method not allowed' }); }
}