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

If `/api/health` reports `persistence: "temporary"`, the Vercel deployment is missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`. Login and register may work, but accounts and app data will not reliably persist until Supabase is configured.

**Preview Database Setup**

Vercel supports separate environment variables for Production and Preview deployments. Use that to keep test data out of production.

Recommended setup:

1. Create a second Supabase project for Preview.
2. Run `supabase/schema.sql` in that Preview Supabase project.
3. Create a public Storage bucket named `uploads`.
4. In Vercel, set these variables for the `Preview` environment only:

```text
SUPABASE_URL=https://your-preview-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-preview-service-role-key
SUPABASE_STATE_ID=preview
SUPABASE_STORAGE_BUCKET=uploads
```

5. Keep Production pointed at the production Supabase project:

```text
SUPABASE_URL=https://your-production-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-production-service-role-key
SUPABASE_STATE_ID=default
SUPABASE_STORAGE_BUCKET=uploads
```

Lighter setup:

Use the same Supabase project for both environments, but set `SUPABASE_STATE_ID=preview` for Vercel Preview and `SUPABASE_STATE_ID=default` for Production. This separates the app data into different `public.app_state` rows, but uploads still share the same Supabase project unless you also use a separate preview bucket.

After deploy, visit `/api/health`. Preview should show `environment: "preview"` and `supabase_state_id: "preview"`. Production should show `environment: "production"` and `supabase_state_id: "default"`.
