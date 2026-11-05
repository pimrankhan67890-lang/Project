VIGNAN SMART CAMPUS - VERCEL UPLOAD FOLDER

DEPLOY
Vercel's FastAPI deployment flow uses Git import or the Vercel CLI. The "Drop your
project" page can fail to read a local folder; that is a limitation of that upload
flow, not an error message from the application.

Recommended: deploy this folder with the Vercel CLI from Windows PowerShell:
1. Install Node.js if it is not already installed.
2. Open PowerShell in this "Vinutna Project Deploy" folder.
3. Run: npx vercel login
4. Run: npx vercel link, then follow the prompts to create or link the project.
5. Add the required environment variables below in Vercel Project Settings ->
   Environment Variables, selecting Production.
6. Run: npx vercel --prod

Alternatively, import the source repository in Vercel and set this folder as its
Root Directory. Do not upload the parent project or its .env file.

The root server.py is the FastAPI entrypoint. Vercel serves files in public/ from
its CDN; the app configuration intentionally does not rewrite every request to an
API-only route, so the app's normal page and API paths are preserved.

REQUIRED ENVIRONMENT VARIABLES
APP_ENV=production
DATABASE_URL=<PostgreSQL connection URL from a persistent PostgreSQL provider>
SETUP_BOOTSTRAP_TOKEN=<long, one-time random value>

Vercel supplies the deployment URL automatically. Optionally set PUBLIC_BASE_URL
to your canonical HTTPS domain if you add a custom domain later.

The app requires PostgreSQL in production; Vercel's temporary filesystem and SQLite
are not suitable for its user, attendance, and session records. Create a PostgreSQL
database separately and use its connection URL as DATABASE_URL. Never put secrets
in this folder or commit them to Git. Ensure the database provider allows connections
from Vercel and use its pooled URL if available.

OPTIONAL MAPS API KEY
GOOGLE_MAPS_API_KEY=<restricted browser Maps JavaScript API key>

The key is optional. The map uses OpenStreetMap when it is unset. You can add the
key later in Vercel project settings and redeploy. Restrict it in Google Cloud to
the Maps JavaScript API and your exact deployed website referrer.

FIRST ADMINISTRATOR
After deployment, open the Vercel production URL and complete first-run setup with
the one-time SETUP_BOOTSTRAP_TOKEN. Once an administrator has been created, remove
that variable from Vercel and redeploy. Do not share the token.

OPTIONAL WALKTHROUGH DATA
After signing in as the administrator, open Student accounts -> Load demo data and
confirm. The app creates clearly labeled fictional student accounts, example
presence activity, and demo geofences in this production database. A generated
student email and temporary password are shown once; save them immediately. This
action is one-time only. Synthetic records appear in production dashboards and must
not be used as attendance evidence. Presence verification remains blocked for demo
geofences.

IMPORTANT BEFORE REAL ATTENDANCE
The deployment is not connected to the university identity directory. Add approved
accounts and replace all demo geofences with institution-surveyed campus boundaries
before using it for attendance decisions. The app deliberately refuses presence
verification against demo boundaries in production. Location tracking requires
student consent, GPS permission, HTTPS, and the student page to remain open.

This folder is a standalone deployment copy. If the main application changes, copy
the updated server.py, requirements.txt, and public assets into this folder before
deploying again.
