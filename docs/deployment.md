# Production Deployment Guide: Vercel + Neon Setup

This document outlines the production deployment architecture and setup steps for hosting both the frontend UI and serverless GraphQL API on Vercel with a managed PostgreSQL database on Neon.

---

## 1. Managed Database Provisioning (Neon)

1. Open [neon.tech](https://neon.tech) and create or sign in to your account.
2. Create a new project:
   - **Project Name**: `releasecheck`
   - **Postgres Version**: 16 (or 17)
   - **Region**: Select the region closest to your primary user base (e.g., US East, Europe Central).
3. From the Neon dashboard, navigate to **Connection Details**.
4. Enable the **Pooled connection** toggle (uses PgBouncer to manage connection spikes across serverless invocations).
5. Copy the pooled connection string:
   ```text
   postgresql://<user>:<password>@<pooler-host>/neondb?sslmode=require
   ```
   *(Store this safely for environment variable configuration in Step 3).*

---

## 2. Git Repository Preparation

Ensure all latest changes, configurations (`vercel.json`, `package.json`), and schema definitions are committed to your repository:

```bash
git add .
git commit -m "Configure Vercel serverless deployment"
git push origin master
```

---

## 3. Serverless Deployment on Vercel

1. Log in to [vercel.com](https://vercel.com).
2. From the dashboard, select **Add New...** > **Project**.
3. Under **Import Git Repository**, select `Release Checklist Tool v2` and click **Import**.
4. Expand the **Environment Variables** panel:
   - **Key**: `DATABASE_URL`
   - **Value**: Paste the Neon pooled connection string obtained from Step 1.
   - Click **Add**.
5. Keep default build and output settings — Vercel automatically detects `package.json`, Vite frontend configuration, and the `/api` serverless handler.
6. Click **Deploy**.

---

## 4. Verification Checklist

Once Vercel completes building the frontend bundle and packaging the serverless functions:

1. **Frontend Rendering**: Navigate to the assigned Vercel URL (e.g. `https://<your-project>.vercel.app`) to verify that the release list and checklist dashboard load cleanly.
2. **Interactive Mutations**: Create a test release, toggle checklist steps, or update remarks to confirm mutations persist to Neon PostgreSQL.
3. **Data Durability**: Refresh the browser page to ensure changes remain stored in the database across sessions.
4. **GraphQL Endpoint**: Query the GraphQL endpoint directly at `https://<your-project>.vercel.app/graphql` to verify query resolution and error handling.
