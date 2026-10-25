# ReleaseCheck

ReleaseCheck is an all-in-one release checklist tool [a helper web app to track steps when launching software].

It allows software development teams to track each release, compute completion states automatically from 7 checklist steps, and view/edit/delete releases.

---

## Features

- **Releases List**: View all releases with name, formatted date, auto-calculated status, and view/delete actions.
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
- **Responsive Design**: Adapts cleanly across mobile, tablet, and desktop screens.
- **GraphQL API Layer**: Clean query and mutation operations between frontend and backend.
- **PostgreSQL Database**: Persistent storage for releases and completed steps.

---

## Running Locally

### Option 1: Docker (Recommended)

Make sure Docker Desktop is running, then run:

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
- PostgreSQL (running on port 5432, or set `DATABASE_URL`)

#### 1. Start the Backend
```bash
cd backend
npm install
npm start
```
The backend server runs on `http://localhost:4000` with the GraphQL endpoint at `http://localhost:4000/graphql`.

#### 2. Start the Frontend
```bash
cd frontend
npm install
npm run dev
```
The frontend dev server runs on `http://localhost:5173`.

---

## Automated Tests

Run the backend automated tests:

```bash
npm test --prefix backend
```
or:
```bash
node backend/test.js
```

This uses Node's built-in test runner (`node:test` and `node:assert`) to verify:
1. Status calculation logic (`Planned`, `Ongoing`, `Done`).
2. Full CRUD flow for GraphQL resolvers (create, query, update steps, delete).

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
- `id`: Unique identifier (auto-incrementing serial integer).
- `name`: Release title/version (e.g. `Version 1.0.1`), mandatory text.
- `date`: Release date (stored as SQL `DATE`), mandatory.
- `additional_info`: Free-form notes/remarks, optional text.
- `completed_steps`: JSON array storing the zero-indexed numbers of completed steps (e.g. `[0, 1, 2]`).
- `created_at`: Creation timestamp with time zone.

---

## API Documentation (GraphQL)

The API is exposed at `POST /graphql`.

### Schema Types

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
  createRelease(name: String!, date: String!, additionalInfo: String): Release!
  updateRelease(id: ID!, name: String, date: String, additionalInfo: String, completedSteps: [Int!]): Release!
  deleteRelease(id: ID!): Boolean!
}
```

### Example Queries

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

#### 2. Create a Release
```graphql
mutation CreateNewRelease {
  createRelease(name: "Version 2.0.0", date: "2026-12-01", additionalInfo: "Major release") {
    id
    name
    status
  }
}
```

#### 3. Update Checklist Steps & Remarks
```graphql
mutation UpdateReleaseSteps {
  updateRelease(
    id: "1",
    completedSteps: [0, 1, 2, 3, 4, 5, 6],
    additionalInfo: "All release steps verified"
  ) {
    id
    status
    completedSteps
  }
}
```

#### 4. Delete a Release
```graphql
mutation DeleteRelease {
  deleteRelease(id: "1")
}
```

---

## Design Decisions

1. **Ultra-Lean Architecture (Ponytail Senior Dev Mode)**:
   - Zero boilerplate or unnecessary dependencies.
   - Built with native browser `fetch` for GraphQL instead of heavy client libraries (like `@apollo/client` or `urql`), saving ~150KB of bundle size.
   - Server, GraphQL schema, resolvers, and DB logic are kept in a single clear file (`backend/server.js`) under 140 lines.
   - Automated tests utilize Node's native `node:test` without requiring Jest, Mocha, or Babel.

2. **Single-Page Application (SPA) Experience**:
   - Seamless transition between the release table view and the edit/detail screen with state-based routing.
   - Breadcrumb navigation (`All releases > Version X`) to match the mockup UX.

3. **Responsive UI Across Screen Sizes**:
   - Mockup styling implemented in pure Vanilla CSS matching color `#5c54e5`, font hierarchies, clean card layout, and button styling.
   - Flexbox with wrapping so input pairs sit side-by-side on desktop and stack cleanly on mobile.
   - Responsive table with smooth horizontal scroll container on small viewports.

4. **Zero-Downtime Fallback**:
   - If PostgreSQL is temporarily unavailable or during quick local scripts, the server gracefully falls back to an in-memory sample store initialized with the mockup data.

---

## Free & Unlimited Deployment Guide

When deploying online, prioritize free and unlimited solutions:

1. **Database**:
   - **Neon** (neon.tech) or **Supabase** (supabase.com): Free serverless PostgreSQL database with 0.5 GB storage and unlimited queries within tier limits.
   - Grab the connection string: `postgresql://user:password@ep-xyz.neon.tech/neondb?sslmode=require`.

2. **Backend**:
   - **Render** (render.com): Free web service tier. Connect repository, set build command `npm install --prefix backend` and start command `node backend/server.js`, and add environment variable `DATABASE_URL`.
   - Alternatively, deploy via Docker container on Render / Railway.

3. **Frontend**:
   - **Vercel** or **Netlify** or **Cloudflare Pages**: Free unlimited static hosting. Connect frontend directory with build command `npm run build` and output directory `dist`.
