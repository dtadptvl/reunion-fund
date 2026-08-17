import { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

export async function healthRoutes(app: FastifyInstance, options: { db: Database.Database }) {
  // Liveness probe: Is process alive and responding?
  app.get('/health/live', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness probe: Can the application query the SQLite database?
  app.get('/health/ready', async (_request, reply) => {
    try {
      const row = options.db.prepare('SELECT 1 as healthy').get() as { healthy: number };
      if (row && row.healthy === 1) {
        return reply.status(200).send({
          status: 'ready',
          database: 'healthy',
          timestamp: new Date().toISOString(),
        });
      }
      return reply.status(503).send({ status: 'unready', database: 'query_failed' });
    } catch (err: any) {
      return reply.status(503).send({ status: 'unready', error: err?.message });
    }
  });
}
