import express from 'express';
import cors from 'cors';
import { initDb } from './db';
import { api } from './routes';

/**
 * Express application (no listen() here) — used by the local server (index.ts)
 * and as the default export for Vercel's Express runtime.
 */
export const app = express();

// Same-origin deployments (Vercel rewrites /api → backend) need no CORS; for split hosting set
// CORS_ORIGIN to a comma-separated list of allowed origins. Unset = reflect any origin.
const origins = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins?.length ? origins : true, credentials: true, exposedHeaders: ['Content-Disposition'] }));
app.use(express.json({ limit: '25mb' }));

// Make sure the database schema/seed exist before any request (once per instance).
app.use(async (_req, res, next) => {
  try { await initDb(); next(); }
  catch (e) { console.error('Database init failed', e); res.status(500).json({ error: `Database init failed: ${(e as Error).message}` }); }
});

app.use('/api', api);
app.get('/', (_req, res) => { res.json({ name: 'AI Thermal Simulator API', health: '/api/health' }); });

export default app;
