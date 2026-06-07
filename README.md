**InventoryHQ Self-Hosted App**

This app now runs as a Vite React frontend plus a local Node backend.

**Run Locally**

```bash
npm install
npm run build
npm start
```

Open `http://localhost:8787`.

The first registered user becomes the admin account.

**Google Login**

1. Create a Google OAuth 2.0 Web Client in Google Cloud.
2. Add this authorized redirect URI:

```text
http://localhost:8787/api/auth/google/callback
```

3. Copy `.env.example` to `.env` and fill in:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
PUBLIC_APP_URL=http://localhost:8787
GOOGLE_REDIRECT_URI=http://localhost:8787/api/auth/google/callback
```

4. Restart the server.

For production, set `PUBLIC_APP_URL` and `GOOGLE_REDIRECT_URI` to your hosted domain.

**Test Deploy With Supabase + Vercel**

Supabase is used for persistent app data. Vercel serves the React app and serverless API.

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Create a public Supabase Storage bucket named `uploads`.
4. Create a Vercel project from this repository.
5. Add these Vercel environment variables:

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STATE_ID=default
SUPABASE_STORAGE_BUCKET=uploads
PUBLIC_APP_URL=https://your-vercel-domain.vercel.app
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your-vercel-domain.vercel.app/api/auth/google/callback
```

6. In Google Cloud, add the production redirect URI:

```text
https://your-vercel-domain.vercel.app/api/auth/google/callback
```

7. Deploy on Vercel.

The first user to register or sign in with Google becomes the admin account.
