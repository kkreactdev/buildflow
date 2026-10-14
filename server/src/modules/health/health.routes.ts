import { Router } from 'express';
import mongoose from 'mongoose';
import { getCapabilities } from '../../config/db';
import { publicRoute } from '../../core/permissions/principal';

export const healthRoutes = Router();

/** Liveness: the process is up. */
healthRoutes.get('/health', publicRoute, (_req, res) => {
  res.json({ data: { status: 'ok' } });
});

/** Readiness: the database answers a ping. Reports transaction support. */
healthRoutes.get('/ready', publicRoute, async (_req, res) => {
  const caps = getCapabilities();
  try {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) throw new Error('not connected');
    await mongoose.connection.db.admin().ping();
    res.json({
      data: { status: 'ready', db: { topology: caps?.topology, supportsTransactions: caps?.supportsTransactions ?? false } },
    });
  } catch {
    res.status(503).json({ error: { code: 'NOT_READY', message: 'Database is not reachable' } });
  }
});
