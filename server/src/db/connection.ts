import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance: Database.Database | null = null;

export function getDatabase(customPath?: string): Database.Database {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath || config.DATABASE_PATH;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath, {
    timeout: 5000,
  });

  // Apply SQLite performance and reliability pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // Run migrations
  runMigrations(db);

  if (!customPath) {
    dbInstance = db;
  }

  return db;
}

export function runMigrations(db: Database.Database): void {
  // Create schema_migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const candidateDirs = [
    path.join(__dirname, 'migrations'),
    path.join(__dirname, '../../src/db/migrations'),
    path.join(process.cwd(), 'server/src/db/migrations'),
    path.join(process.cwd(), 'server/dist/db/migrations'),
  ];

  let migrationsDir: string | null = null;
  for (const dir of candidateDirs) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.sql'))) {
      migrationsDir = dir;
      break;
    }
  }

  if (!migrationsDir) {
    return;
  }

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  const isApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const recordMigration = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');

  for (const file of files) {
    const row = isApplied.get(file);
    if (!row) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      db.transaction(() => {
        db.exec(sql);
        recordMigration.run(file);
      })();
    }
  }
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
