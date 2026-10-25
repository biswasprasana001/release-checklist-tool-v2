# ReleaseCheck

ReleaseCheck is an all-in-one release checklist tool.

It allows software development teams to track each release, compute completion states automatically from 7 checklist steps, and view, edit, and delete releases.

---

## Features

- **Releases List**: View all releases with name, formatted date, auto-calculated status badge, and view/delete actions.
- **Add & Edit Release**: Create new releases or update existing ones.
- **7-Step Checklist**:
  1. *All relevant GitHub pull requests have been merged*
  2. *CHANGELOG.md files have been updated*
  3. *All tests are passing*
  4. *Releases in Github created*
  5. *Deployed in demo*
  6. *Tested thoroughly in demo*
  7. *Deployed in production*
- **Auto-Calculated Status**:
  - `Planned`: 0 steps completed
  - `Ongoing`: 1 to 6 steps completed
  - `Done`: all 7 steps completed
- **Responsive Design**: Adapts cleanly across mobile, tablet, and desktop viewports.
- **GraphQL API Layer**: Clean query and mutation operations between frontend and backend.
- **PostgreSQL Database**: Persistent relational storage for releases and completed steps.

---

## Running Locally

### Environment Variables

Before starting the application, configure your environment variables. A template is provided in `backend/.env.example`:

```bash
# Copy template to .env inside the backend directory
cp backend/.env.example backend/.env
```

Key environment variables:
- `DATABASE_URL`: PostgreSQL connection string (defaults to `postgresql://postgres:postgres@localhost:5432/releasecheck` if unset).
- `PORT`: Backend server listening port (defaults to `4000`).

---

### Option 1: Docker (Recommended)

Make sure Docker Desktop is running, then build and start the containers:

```bash
docker compose up --build
```

Open your browser and navigate to:
**`http://localhost:4000`**

To run in the background (detached mode):
```bash
docker compose up -d
```

To stop containers:
```bash
docker compose down
```

---

### Option 2: Running Without Docker

#### Prerequisites
- Node.js (v18+)
- PostgreSQL (running on port 5432, or set `DATABASE_URL` in `backend/.env`)

#### 1. Start the Backend
```bash
cd backend
npm install
npm start
```
The backend server runs on `http://localhost:4000` with the GraphQL endpoint at `http://localhost:4000/graphql`.

#### 2. Start the Frontend
In a separate terminal:
```bash
cd frontend
npm install
npm run dev
```
The frontend dev server runs on `http://localhost:5173`. The Vite development server automatically proxies `/graphql` requests to `http://localhost:4000`.

---

### Automated Tests

Run the backend automated tests:

```bash
npm test --prefix backend
```
or:
```bash
node backend/test.js
```

This uses Node's built-in test runner (`node:test` and `node:assert/strict`) to verify:
1. Status calculation logic (`Planned`, `Ongoing`, `Done`).
2. Full CRUD flow for GraphQL resolvers (create, query, update steps, delete).
3. Stress test data purge mutation (`deleteStressTestData`).
4. In-memory caching reference identity.
5. Single-flight query deduplication under concurrent calls.

---

## Database Schema

Database engine: **PostgreSQL**

Table name: `releases`

```sql
CREATE TABLE IF NOT EXISTS releases (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  additional_info TEXT,
  completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Column Descriptions

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `SERIAL` | `PRIMARY KEY` | Unique release identifier (auto-incrementing integer). |
| `name` | `VARCHAR(255)` | `NOT NULL` | Release version or title (e.g. `Version 1.0.1`). |
| `date` | `DATE` | `NOT NULL` | Scheduled release date (`YYYY-MM-DD`). |
| `additional_info` | `TEXT` | `NULL` | Optional remarks, notes, or tasks. |
| `completed_steps` | `JSONB` | `NOT NULL DEFAULT '[]'` | JSON array of 0-indexed integers indicating completed steps (`[0..6]`). |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT CURRENT_TIMESTAMP` | Row creation timestamp with time zone. |

### Status Calculation Logic
The release status is dynamically computed based on `completed_steps.length`:
- **`Planned`**: 0 steps completed (`completed_steps.length === 0`).
- **`Ongoing`**: 1 to 6 steps completed (`completed_steps.length > 0 && completed_steps.length < 7`).
- **`Done`**: All 7 steps completed (`completed_steps.length >= 7`).

### Schema Design Rationale
- **Hybrid Relational + JSONB Modeling**: Storing the completed checklist steps as a `JSONB` array directly within the `releases` table eliminates the need for a separate junction/mapping table and expensive SQL `JOIN`s for a fixed 7-step checklist.
- **Computed Status vs. Stored Status**: Deriving status on-the-fly guarantees that release state cannot desynchronize from the actual checklist steps.
- **Idempotent Initialization**: On startup, the server automatically executes `CREATE TABLE IF NOT EXISTS` and populates initial sample data if the table is empty.

---

## API Endpoints & GraphQL Documentation

### HTTP Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/graphql` | Main GraphQL operational endpoint for queries and mutations. |
| `GET` | `/graphql` | Apollo Server Explorer / health check endpoint. |
| `GET` | `/*` | Serves compiled Single-Page Application (SPA) frontend bundle (`backend/public/index.html`). |

---

### GraphQL Schema Definition

```graphql
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
  createRelease(
    name: String!
    date: String!
    additionalInfo: String
    completedSteps: [Int!]
  ): Release!

  updateRelease(
    id: ID!
    name: String
    date: String
    additionalInfo: String
    completedSteps: [Int!]
  ): Release!

  deleteRelease(id: ID!): Boolean!

  deleteStressTestData: Int!
}
```

---

### GraphQL Operations & Examples

#### 1. Fetch All Releases
```graphql
query GetReleases {
  releases {
    id
    name
    date
    status
    additionalInfo
    completedSteps
  }
}
```

**cURL Example**:
```bash
curl -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "query { releases { id name date status completedSteps } }"}'
```

#### 2. Fetch Single Release by ID
```graphql
query GetReleaseById($id: ID!) {
  release(id: $id) {
    id
    name
    date
    status
    additionalInfo
    completedSteps
  }
}
```

#### 3. Create a Release
```graphql
mutation CreateNewRelease($name: String!, $date: String!, $additionalInfo: String, $completedSteps: [Int!]) {
  createRelease(name: $name, date: $date, additionalInfo: $additionalInfo, completedSteps: $completedSteps) {
    id
    name
    date
    status
    completedSteps
  }
}
```
*Variables*:
```json
{
  "name": "Version 2.0.0",
  "date": "2026-12-01",
  "additionalInfo": "Major production release",
  "completedSteps": [0, 1]
}
```

#### 4. Update Checklist Steps & Remarks
```graphql
mutation UpdateReleaseSteps($id: ID!, $completedSteps: [Int!], $additionalInfo: String) {
  updateRelease(id: $id, completedSteps: $completedSteps, additionalInfo: $additionalInfo) {
    id
    status
    completedSteps
    additionalInfo
  }
}
```
*Variables*:
```json
{
  "id": "1",
  "completedSteps": [0, 1, 2, 3, 4, 5, 6],
  "additionalInfo": "All 7 checklist steps verified"
}
```

#### 5. Delete a Release
```graphql
mutation DeleteRelease($id: ID!) {
  deleteRelease(id: $id)
}
```
*Variables*:
```json
{
  "id": "1"
}
```

#### 6. Purge Benchmark Stress Test Data
```graphql
mutation CleanStressTests {
  deleteStressTestData
}
```
*Removes all temporary records where `name LIKE '[STRESS_TEST]%'`.*

---

## Design Decisions

All architectural and engineering design decisions made across the Release Checklist Tool codebase are documented below:

### 1. Minimalist Architecture Philosophy
- **Zero Unnecessary Dependencies**: The system relies on native platform and runtime capabilities instead of importing heavy third-party packages.
- **Single-File Backend**: Core server logic, Apollo middleware integration, GraphQL schema type definitions, query/mutation resolvers, database connection pool, and in-memory fallback are maintained in a single clean, self-contained file (`backend/server.js`).
- **Native Test Runner**: Automated testing uses Node.js's built-in `node:test` and `node:assert/strict` modules, eliminating dependencies on external frameworks like Jest, Mocha, or Babel.

### 2. Frontend & Client-Side Design Decisions
- **Lightweight Native `fetch` (`gql`) Client**: Built an ultra-lightweight custom `fetch` wrapper in `frontend/src/App.jsx` instead of importing `@apollo/client` or `urql`. This shaved ~150KB off the client JavaScript bundle and avoided complex client-side cache normalization.
- **State-Based SPA Routing**: Navigating between the releases table and the create/edit release screens is managed through React component state (`current`), eliminating the need for `react-router-dom` or external routing libraries.
- **Pure Vanilla CSS**: Styled with custom Vanilla CSS conforming to the mockup specification (brand primary color `#5c54e5`, clean card elevation, responsive flexbox inputs, and badge states) without the build overhead or bundle cost of TailwindCSS or component libraries.
- **Relative API Pathing**: The frontend issues all network requests to the relative path `/graphql`. During local development, the Vite server proxies `/graphql` to `localhost:4000`. In production, Vercel routes `/graphql` to the serverless function. This ensures that no client-side API URL environment variables need to be compiled into the frontend bundle.

### 3. Backend & Service Layer Design Decisions
- **GraphQL Over REST**: GraphQL provides a typed query and mutation contract where the frontend requests only the specific fields needed, preventing over-fetching and under-fetching.
- **Zero-Downtime In-Memory Fallback**: If PostgreSQL is unavailable (e.g. during rapid local testing or when database credentials are not yet configured), the backend gracefully falls back to an in-memory mock store pre-populated with sample releases. This allows the application and test suite to function seamlessly offline.
- **HTTP Keep-Alive Connection Reuse**: Express HTTP server explicitly sets `keepAliveTimeout = 65000` and `headersTimeout = 66000`. This allows clients and stress test runners to reuse persistent TCP connections, eliminating TLS/TCP handshake latency during traffic bursts.

### 4. Database & Data Modeling Decisions
- **Relational PostgreSQL Foundation**: Selected for reliable ACID transactions, strong data durability, and schema predictability.
- **Hybrid Relational + JSONB Schema**: Completed checklist step indices are stored as a `JSONB` array (`completed_steps`) within the `releases` table. For a fixed 7-step checklist, this provides atomic reads and updates in a single query while avoiding the complexity and overhead of many-to-many junction tables.
- **Dynamic Status Derivation**: Release status (`Planned`, `Ongoing`, `Done`) is calculated dynamically from the number of completed steps rather than stored as a mutable database column. This prevents status desynchronization bugs.
- **Self-Healing / Idempotent Initialization**: On server boot, `initDb()` creates the table if missing and seeds default releases if the table is empty, ensuring a turnkey development experience.

### 5. High-Concurrency Read Performance Decisions
Through systematic benchmark evaluations documented in [docs/benchmarks/read-benchmark.md](docs/benchmarks/read-benchmark.md), four read-path optimizations were implemented:
- **2-Second In-Memory RAM Caching**: A process-level memory cache (`cachedReleases` with `CACHE_TTL_MS = 2000`) serves high-frequency list queries directly from RAM in sub-millisecond time, bypassing database disk reads.
- **Single-Flight Query Deduplication (`inflightReleasesPromise`)**: When the RAM cache expires under concurrent load, only a single database query is executed. All concurrent incoming requests hook into the identical promise, completely eliminating cache stampedes.
- **Stale-While-Revalidate**: Cached data returns immediately (0 ms wait), while an asynchronous background refresh queries PostgreSQL to update the cache for subsequent callers.
- **Immediate Cache Invalidation**: All write mutations (`createRelease`, `updateRelease`, `deleteRelease`, `deleteStressTestData`) immediately invoke `invalidateCache()`, guaranteeing read-after-write consistency.

### 6. Write Path, Durability & Queue Decisions
Through write stress tests documented in [docs/benchmarks/write-benchmark.md](docs/benchmarks/write-benchmark.md):
- **Direct Synchronous Writes**: Write operations commit directly to PostgreSQL disk and WAL (Write-Ahead Log) via the connection pool, sustaining ~2,400 durable writes/second with sub-50 ms response times.
- **Asynchronous Background Queue (TODO)**: Introducing an asynchronous queue (such as BullMQ with Redis) was evaluated and marked as a **TODO** for future scaling milestones. It was intentionally bypassed in the current architecture because users expect immediate visual confirmation when saving release changes, direct writes already handle peak requirements (~144,000 writes/minute), and avoiding external message brokers reduces operational complexity.
- **Benchmark Data Isolation**: Added a dedicated `deleteStressTestData` resolver to purge automated test records prefixed with `[STRESS_TEST]` without affecting production data.

### 7. Deployment & Serverless Architecture Decisions
- **Dual-Mode Runtime Compatibility**: The application is architected to run as a long-lived Node.js server (`backend/server.js`) for Docker/local environments and as a serverless handler (`api/graphql.js`) for Vercel.
- **Unified Full-Stack Hosting on Vercel**: Both the static frontend bundle and the serverless GraphQL API are hosted within a single Vercel project using `vercel.json` rewrite rules (`/graphql` -> `/api/graphql`), eliminating CORS overhead and separate hosting bills.
- **Neon Managed Database with Connection Pooling**: Production deployment utilizes Neon serverless PostgreSQL with PgBouncer connection pooling enabled to prevent serverless function scaling from exhausting database sockets.
- **Environment Variable Separation**: Sensitive connection credentials are kept in `.env` (excluded by `.gitignore`) locally and managed via Vercel dashboard environment variables in production.

---

## Documentation & Performance Benchmarks

In-depth technical architecture, deployment instructions, and stress test analyses are located in the [`docs/`](docs/) directory:

- **[Production Deployment Guide](docs/deployment.md)**: Full setup instructions for hosting on Vercel with Neon serverless PostgreSQL.
- **[Read Stress Test Analysis](docs/benchmarks/read-benchmark.md)**: Read performance evaluation, single-flight query deduplication, and cache stampede resolution up to 10,000 concurrent users.
- **[Write Stress Test Analysis](docs/benchmarks/write-benchmark.md)**: Write capacity evaluation, PostgreSQL connection pool optimization, and durability benchmarks under surge loads.
