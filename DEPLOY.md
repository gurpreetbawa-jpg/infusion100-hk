# Infusion100 HK — Deployment Guide

## Prerequisites

- GitHub account with this repo pushed (`gurpreetbawa-jpg/infusion100-hk`)
- A Google account
- A GitHub account
- (Optional) A Strava account

---

## Step 1 — Get OAuth Credentials

### 1a. Google OAuth

1. Go to https://console.cloud.google.com
2. Create a new project (name it `infusion100-hk`)
3. **APIs & Services → OAuth consent screen**
   - Choose **External**
   - App name: `Infusion100 HK`
   - User support email: your email
   - Developer contact email: your email
   - Click **Save and Continue** through the remaining screens
4. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `Infusion100 HK Web`
   - Authorized redirect URIs (add both):
     - `http://localhost:3000/auth/callback/google`
     - `https://infusion100.onrender.com/auth/callback/google`
   - Click **Create**
5. Copy the **Client ID** and **Client Secret** — you'll need them in Step 3

### 1b. GitHub OAuth

1. Go to https://github.com/settings/developers → **New OAuth App**
2. Fill in:
   - Application name: `Infusion100 HK`
   - Homepage URL: `https://infusion100.onrender.com`
   - Authorization callback URL: `https://infusion100.onrender.com/auth/callback/github`
3. Click **Register application**
4. Click **Generate a new client secret**
5. Copy the **Client ID** and **Client Secret** — you'll need them in Step 3

### 1c. Strava OAuth (optional — for activity sync)

1. Go to https://www.strava.com/settings/api
2. Fill in:
   - Application Name: `Infusion100 HK`
   - Category: `Charity`
   - Website: `https://infusion100.onrender.com`
   - Application Description: Charity walk tracking app
   - Authorization Callback Domain: `infusion100.onrender.com`
3. Agree to terms → **Create**
4. Copy the **Client ID** and **Client Secret** — you'll need them in Step 3

---

## Step 2 — Deploy on Render

1. Go to https://render.com
2. Sign up / sign in with your GitHub account
3. Click **New → Blueprint**
4. Connect your GitHub repo: `gurpreetbawa-jpg/infusion100-hk`
5. Render reads `render.yaml` and creates two services automatically:
   - **infusion100-db** — PostgreSQL database (free tier)
   - **infusion100** — Web service (free tier)
6. Wait for the first deploy to finish (~3-5 minutes). You'll see "Build successful" in the logs.
7. Note your app URL — it will be something like `https://infusion100.onrender.com`

---

## Step 3 — Set Environment Variables

1. In Render dashboard, go to **infusion100 → Environment**
2. Add these variables:

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | *(from Step 1a)* |
| `GOOGLE_CLIENT_SECRET` | *(from Step 1a)* |
| `GOOGLE_CALLBACK_URL` | `https://infusion100.onrender.com/auth/callback/google` |
| `GITHUB_CLIENT_ID` | *(from Step 1b)* |
| `GITHUB_CLIENT_SECRET` | *(from Step 1b)* |
| `GITHUB_CALLBACK_URL` | `https://infusion100.onrender.com/auth/callback/github` |
| `STRAVA_CLIENT_ID` | *(from Step 1c, or skip)* |
| `STRAVA_CLIENT_SECRET` | *(from Step 1c, or skip)* |
| `STRAVA_CALLBACK_URL` | `https://infusion100.onrender.com/auth/callback/strava` |
| `ADMIN_EMAILS` | `gurpreetbawa@gmail.com` |

3. **Do NOT touch these** — Render auto-generated them:
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `ENCRYPTION_KEY`

4. Click **Save Changes** — Render will redeploy automatically

---

## Step 4 — Fix Cold Starts (optional but recommended)

Free Render tier spins down after 15 minutes of inactivity. The next request takes ~30-60 seconds to wake up.

To keep it always warm:

1. Go to https://uptimerobot.com → create a free account
2. **Add New Monitor**
   - Monitor Type: `HTTP(s)`
   - Friendly Name: `Infusion100 HK`
   - URL: `https://infusion100.onrender.com`
   - Monitoring Interval: `5 minutes`
3. Click **Create Monitor**

This pings your app every 5 minutes, keeping it from sleeping. Costs nothing.

---

## Step 5 — Verify Everything Works

1. Visit `https://infusion100.onrender.com` — you should see the landing page
2. Click **Sign in with Google** — should redirect you to `/register` for profile completion
3. After completing registration, visit `https://infusion100.onrender.com/admin` — you should have admin access (your email is set in `ADMIN_EMAILS`)

---

## Important Notes

### Database Backups

Render's free PostgreSQL expires after **90 days**. Before it expires:

1. Go to `https://infusion100.onrender.com/admin`
2. Use the **Backup** button to download a full database dump
3. Create a new free database on Render and restore the backup

### Strava Linking

Only `gurpreetbawa@gmail.com` can link Strava (configured in `config/strava-eligible.js`). To allow more users, edit that file and push.

### Custom Domain (optional)

If you want your own domain:
1. Add it in Render dashboard → **infusion100 → Settings → Custom Domain**
2. Update all `*_CALLBACK_URL` env vars to use your domain
3. Update OAuth redirect URIs in Google/GitHub/Strava developer consoles

### Updating the App

Push to the `main` branch on GitHub. Render auto-deploys on every push.