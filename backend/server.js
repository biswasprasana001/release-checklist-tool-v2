import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const TOTAL_STEPS = 7;

export function computeStatus(steps = []) {
  if (!steps || steps.length === 0) return 'Planned';
  if (steps.length >= TOTAL_STEPS) return 'Done';
  return 'Ongoing';
}

// shortcut: fallback in-memory store if DB is down, upgrade: require postgres in production
let memoryReleases = [
  { id: '1', name: 'Version 1.0.1', date: '2022-09-20', additionalInfo: '', completedSteps: [0,1,2,3,4,5,6] },
  { id: '2', name: 'Version 1.0.2', date: '2022-09-28', additionalInfo: '', completedSteps: [0,1,2,3,4,5,6] },
  { id: '3', name: 'Version 1.1.0', date: '2022-10-10', additionalInfo: 'Staging ready', completedSteps: [0,1,2] },
  { id: '4', name: 'Version 2 (beta)', date: '2022-11-01', additionalInfo: 'Major upgrade', completedSteps: [] }
];

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/releasecheck',
  connectionTimeoutMillis: 3000,
  max: 50,
  idleTimeoutMillis: 10000
});

// shortcut: in-memory process cache with single-flight deduplication (2s TTL), upgrade: redis if running multiple distributed backend instances
let cachedReleases = null;
let cacheExpiresAt = 0;
let inflightReleasesPromise = null;
const CACHE_TTL_MS = 2000;

export function invalidateCache() {
  cachedReleases = null;
  cacheExpiresAt = 0;
  inflightReleasesPromise = null;
}

let isDbConnected = false;

export async function initDb() {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS releases (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        additional_info TEXT,
        completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const count = await client.query('SELECT COUNT(*) FROM releases');
    if (parseInt(count.rows[0].count, 10) === 0) {
      for (const r of memoryReleases) {
        await client.query(
          'INSERT INTO releases (name, date, additional_info, completed_steps) VALUES ($1, $2, $3, $4)',
          [r.name, r.date, r.additionalInfo, JSON.stringify(r.completedSteps)]
        );
      }
    }
    client.release();
    isDbConnected = true;
    console.log('PostgreSQL connected and initialized');
  } catch (err) {
    console.warn('PostgreSQL not reachable, using memory store:', err.message);
    isDbConnected = false;
  }
}

function formatRow(r) {
  const steps = Array.isArray(r.completed_steps) ? r.completed_steps : JSON.parse(r.completed_steps || '[]');
  const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
  return {
    id: String(r.id),
    name: r.name,
    date: d,
    status: computeStatus(steps),
    additionalInfo: r.additional_info ?? r.additionalInfo ?? '',
    completedSteps: steps
  };
}

export const typeDefs = `#graphql
  type Release {
    id: ID!
    name: String!
    date: String!
    status: String!
    additionalInfo: String
    completedSteps: [Int!]!
  }
  type Query {
    releases: [Release!]!
    release(id: ID!): Release
  }
  type Mutation {
    createRelease(name: String!, date: String!, additionalInfo: String, completedSteps: [Int!]): Release!
    updateRelease(id: ID!, name: String, date: String, additionalInfo: String, completedSteps: [Int!]): Release!
    deleteRelease(id: ID!): Boolean!
    deleteStressTestData: Int!
  }
`;

export const resolvers = {
  Query: {
    releases: async () => {
      const now = Date.now();
      if (cachedReleases) {
        if (now >= cacheExpiresAt && !inflightReleasesPromise) {
          cacheExpiresAt = now + CACHE_TTL_MS;
          inflightReleasesPromise = (async () => {
            try {
              if (isDbConnected) {
                const res = await pool.query('SELECT * FROM releases ORDER BY id ASC');
                cachedReleases = res.rows.map(formatRow);
              }
            } catch {
              // keep existing cache on error
            } finally {
              inflightReleasesPromise = null;
            }
          })();
        }
        return cachedReleases;
      }

      if (inflightReleasesPromise) {
        return inflightReleasesPromise;
      }
      inflightReleasesPromise = (async () => {
        try {
          if (!isDbConnected) {
            cachedReleases = memoryReleases.map(r => ({ ...r, status: computeStatus(r.completedSteps) }));
          } else {
            const res = await pool.query('SELECT * FROM releases ORDER BY id ASC');
            cachedReleases = res.rows.map(formatRow);
          }
          cacheExpiresAt = Date.now() + CACHE_TTL_MS;
          return cachedReleases;
        } finally {
          inflightReleasesPromise = null;
        }
      })();
      return inflightReleasesPromise;
    },
    release: async (_, { id }) => {
      if (!isDbConnected) {
        const item = memoryReleases.find(r => r.id === id);
        return item ? { ...item, status: computeStatus(item.completedSteps) } : null;
      }
      const res = await pool.query('SELECT * FROM releases WHERE id = $1', [id]);
      return res.rows[0] ? formatRow(res.rows[0]) : null;
    }
  },
  Mutation: {
    createRelease: async (_, { name, date, additionalInfo = '', completedSteps = [] }) => {
      invalidateCache();
      if (!isDbConnected) {
        const newItem = { id: String(Date.now()), name, date, additionalInfo, completedSteps };
        memoryReleases.push(newItem);
        return { ...newItem, status: computeStatus(completedSteps) };
      }
      const res = await pool.query(
        'INSERT INTO releases (name, date, additional_info, completed_steps) VALUES ($1, $2, $3, $4) RETURNING *',
        [name, date, additionalInfo, JSON.stringify(completedSteps)]
      );
      return formatRow(res.rows[0]);
    },
    updateRelease: async (_, { id, name, date, additionalInfo, completedSteps }) => {
      invalidateCache();
      if (!isDbConnected) {
        const item = memoryReleases.find(r => r.id === id);
        if (!item) throw new Error('Release not found');
        if (name !== undefined) item.name = name;
        if (date !== undefined) item.date = date;
        if (additionalInfo !== undefined) item.additionalInfo = additionalInfo;
        if (completedSteps !== undefined) item.completedSteps = completedSteps;
        return { ...item, status: computeStatus(item.completedSteps) };
      }
      const existing = await pool.query('SELECT * FROM releases WHERE id = $1', [id]);
      if (!existing.rows[0]) throw new Error('Release not found');
      const cur = existing.rows[0];
      const res = await pool.query(
        `UPDATE releases SET 
          name = COALESCE($1, name),
          date = COALESCE($2, date),
          additional_info = COALESCE($3, additional_info),
          completed_steps = COALESCE($4, completed_steps)
        WHERE id = $5 RETURNING *`,
        [name, date, additionalInfo, completedSteps ? JSON.stringify(completedSteps) : null, id]
      );
      return formatRow(res.rows[0]);
    },
    deleteRelease: async (_, { id }) => {
      invalidateCache();
      if (!isDbConnected) {
        const len = memoryReleases.length;
        memoryReleases = memoryReleases.filter(r => r.id !== id);
        return memoryReleases.length < len;
      }
      const res = await pool.query('DELETE FROM releases WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    },
    deleteStressTestData: async () => {
      invalidateCache();
      if (!isDbConnected) {
        const before = memoryReleases.length;
        memoryReleases = memoryReleases.filter(r => !r.name?.startsWith('[STRESS_TEST]'));
        return before - memoryReleases.length;
      }
      const res = await pool.query("DELETE FROM releases WHERE name LIKE '[STRESS_TEST]%'");
      return res.rowCount ?? 0;
    }
  }
};

export async function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = new ApolloServer({ typeDefs, resolvers });
  await server.start();
  app.use('/graphql', expressMiddleware(server));

  // Serve static frontend in production
  const distPath = path.join(__dirname, 'public');
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/graphql')) return next();
    res.sendFile(path.join(distPath, 'index.html'), err => {
      if (err) res.json({ status: 'ReleaseCheck API ready', graphql: '/graphql' });
    });
  });

  return app;
}

if (process.env.NODE_ENV !== 'test' && !process.argv[1]?.endsWith('test.js')) {
  await initDb();
  const app = await createApp();
  const server = app.listen(PORT, () => console.log(`Server ready at http://localhost:${PORT}/graphql`));
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}
