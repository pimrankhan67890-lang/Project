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

SEPARATE DEMO PREVIEW (RECOMMENDED)
Keep the Vercel Production environment on the real production database. For a demo,
create a second, empty PostgreSQL database and configure these variables under the
Vercel Preview environment only:

APP_ENV=production
DATABASE_URL=<a different PostgreSQL URL used only by Preview>
SETUP_BOOTSTRAP_TOKEN=<a separate one-time Preview setup token>
ENABLE_DEMO_DATA=true

Do not use the Production database URL in Preview. Keep APP_ENV=production so secure
cookies and production protections remain enabled. The demo flag is honored only
when Vercel identifies the deployment as Preview; the action is unavailable on the
Production deployment. Keep the optional Google Maps key separate or use the same
restricted browser key if its referrer restrictions include both Vercel domains.

After setting Preview variables, deploy a non-production Git branch to Vercel and
open its Preview URL. Create the first admin with the Preview bootstrap token and
choose the sample-data checkbox during setup, or sign in and open Student accounts
-> Load demo data. The generated synthetic student email and password are shown
once; save them immediately. Remove the Preview bootstrap token after setup.
Synthetic records are visibly marked and never count as real attendance. Demo
geofences cannot verify location in production mode.

If Production and Preview currently use the same DATABASE_URL, change Preview to
the separate demo database before seeding. Existing data in a database is not
replaced automatically.

IMPORTANT BEFORE REAL ATTENDANCE
The deployment is not connected to the university identity directory. Add approved
accounts and replace all demo geofences with institution-surveyed campus boundaries
before using it for attendance decisions. The app deliberately refuses presence
verification against demo boundaries in production. Location tracking requires
student consent, GPS permission, HTTPS, and the student page to remain open.

This folder is a standalone deployment copy. If the main application changes, copy
the updated server.py, requirements.txt, and public assets into this folder before
deploying again.
