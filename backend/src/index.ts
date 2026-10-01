import { app } from './app';
import { DB_LOCATION, initDb } from './db';

const PORT = Number(process.env.PORT ?? 4000);

// On Vercel the platform imports the default export; locally we start a server.
if (!process.env.VERCEL) {
  initDb()
    .then(() => app.listen(PORT, () => console.log(`AI Thermal Simulator API on http://localhost:${PORT}  (db: ${DB_LOCATION})`)))
    .catch((e) => { console.error(e); process.exit(1); });
}

export default app;
