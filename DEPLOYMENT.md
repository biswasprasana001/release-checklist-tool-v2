# Deployment Guide: Free & Fast Setup (Vercel + Neon)

This guide shows you how to deploy (put your app on the internet for everyone to use) both the UI (user interface, the visual screens and buttons you click) and API (the background helper that saves and reads data) for **$0 forever** with zero sleep delays.

---

## Step 1: Create Your Free Database (Neon)

1. Open [neon.tech](https://neon.tech) in your web browser.
2. Click **Sign Up** (or log in with your GitHub account).
3. Click **Create Project**:
   - Name: `releasecheck`
   - Postgres version: Default (16 or 17)
   - Region: Choose the location closest to you (e.g. US East or Europe Frankfurt).
4. After creation, your Neon dashboard will display your **Connection Details**.
5. Make sure the toggle or checkbox for **Pooled connection** (a helper setting that lets many web requests connect at the same time smoothly) is turned on.
6. Copy the connection string (the secret text address starting with `postgresql://...` and ending with `?sslmode=require`).
   - Example:
     ```text
     postgresql://alex:AbCdEf123@ep-cool-fog-123456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
     ```
   *(Keep this string safe — you will paste it into Vercel in Step 3).*

---

## Step 2: Push Your Code to GitHub

Make sure your latest code and settings are pushed to your GitHub repository (the online storage space where your code lives):

```bash
git add .
git commit -m "Configure Vercel serverless deployment"
git push origin master
```

---

## Step 3: Deploy to Vercel

1. Open [vercel.com](https://vercel.com) and log in to your account.
2. On your Vercel dashboard, click **Add New...** and select **Project**.
3. Under **Import Git Repository**, find your `Release Checklist Tool v2` repository and click **Import**.
4. Expand the **Environment Variables** (special settings passed to the app) section:
   - Key: `DATABASE_URL`
   - Value: Paste your Neon pooled connection string from Step 1.
   - Click **Add**.
5. Leave all other build and directory settings as default — Vercel reads your `package.json` and `vercel.json` automatically!
6. Click **Deploy**.

---

## Step 4: Verify Your Live App

1. Vercel will build your frontend, package your serverless API (small pieces of code that run instantly on demand), and launch your site in seconds.
2. Click on the public URL provided by Vercel (e.g. `https://your-project-name.vercel.app`).
3. What to check:
   - **Checklist loads**: The main screen opens and displays the sample releases.
   - **Interactive edits**: Click on a release, check off checklist steps, or add a new release.
   - **Permanent storage**: Refresh your browser — all your updates stay saved permanently in your Neon PostgreSQL database!
   - **GraphQL API**: The GraphQL endpoint responds directly at `https://your-project-name.vercel.app/graphql`.
