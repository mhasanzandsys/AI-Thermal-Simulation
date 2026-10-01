import express from 'express';
import cors from 'cors';
import { seed, DATA_DIR } from './db';
import { api } from './routes';

seed();
const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

app.use(cors({ origin: ORIGIN.split(','), credentials: true, exposedHeaders: ['Content-Disposition'] }));
app.use(express.json({ limit: '25mb' }));
app.use('/api', api);
app.get('/', (_req, res) => { res.json({ name: 'AI Thermal Simulator API', docs: '/api/health' }); });

app.listen(PORT, () => {
  console.log(`AI Thermal Simulator API listening on http://localhost:${PORT}  (data: ${DATA_DIR})`);
});
