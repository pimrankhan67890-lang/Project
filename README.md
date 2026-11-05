# Vignan Smart Campus Presence

A focused campus presence and geofencing service built from the supplied problem statement. It covers student GPS verification, campus and sub-zone boundaries, entry/exit tracking, live presence, event notifications, administrative history, and consent/access controls. It does not attempt to replace a university management system.

## What is implemented

- Role-based administrator, security, and student accounts with password hashing, session expiry, sign-in throttling, CSRF checks, and audit events.
- First-run setup, student and staff account provisioning, staff access review/revocation, protected production bootstrap, and a separate campus boundary plus contained campus sub-zones.
- Student-controlled location consent. The browser asks for GPS only after consent and a student action; it checks the location while the student app is open and visible.
- An interactive OpenStreetMap view with configured geofence circles, the student's own current GPS point, and the latest consented locations for authorized administrators and security.
- Server-side distance and accuracy checks for campus entry, exit, and zone changes. The latest exact point is stored only for an active, consented session, cleared at stop/withdrawal/exit/sign-out/stale closure, and never written to event or audit history.
- Live presence dashboard, zone-level occupancy, notifications, activity history, and CSV export.
- Stale-session closure, configurable presence-history retention, and an audit trail for administrative changes.
- Responsive desktop and mobile screens using Vignan identity assets where available, with a local monogram fallback.

## Run locally on Windows

Requires Python 3.11 or newer. From this folder in PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
.\run.ps1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) for campus staff, or [http://127.0.0.1:8000/student](http://127.0.0.1:8000/student) for student sign-in. Create the first administrator in the setup screen; there are no default credentials. The workspace database is created in `data\vignan-campus.sqlite3`.

First-run setup offers synthetic example accounts and boundaries for exercising the flows. They are visibly marked as sample data, and the temporary student password is shown once. For a clean workspace, clear the sample-data checkbox before setup. Do not use synthetic records for real attendance decisions.

## Production deployment

The app includes a Docker/Compose deployment path, PostgreSQL support, readiness checks, and Alembic schema migrations. Copy `.env.example` to `.env`, replace every placeholder, and use URL-safe random secrets. Generate a one-time setup token with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Set the HTTPS `PUBLIC_BASE_URL`. `SETUP_BOOTSTRAP_TOKEN` is required while the production database has no administrator; the first setup screen asks for it. Remove that token after the first administrator is created. Production mode rejects SQLite and refuses to verify presence against a demo boundary. Administrators may explicitly load one set of clearly labeled synthetic demo data from Student accounts for a product walkthrough; those records appear in production dashboards, are not attendance evidence, and must not be used for real decisions.

### Railway deployment (Docker + PostgreSQL)

The repository's root `Dockerfile` builds the same FastAPI app used locally. Connect the GitHub repository to Railway, create a Railway project, then create an app service from `GaddipatiVinutnaChowdary/-project` on the `main` branch. Railway detects the Dockerfile, runs the included Alembic migrations at container start, and binds Uvicorn to Railway's assigned `PORT`.

Add a Railway PostgreSQL database service, then set these variables on the app service:

- `APP_ENV=production`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}` (use the actual PostgreSQL service name if it is not `Postgres`)
- `PUBLIC_BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`
- `SETUP_BOOTSTRAP_TOKEN` to a one-time random value
- `GOOGLE_MAPS_API_KEY` to the Maps JavaScript API key (optional; OpenStreetMap is used when unset)

Generate a public Railway domain and set the service health check path to `/api/health/ready`. Once the first deployment is healthy, open `/` and create the first administrator using the one-time setup token. Remove `SETUP_BOOTSTRAP_TOKEN` after setup and redeploy. Student sign-in is at `/student`; campus staff sign in at `/`.

The PostgreSQL service is persistent; the app container filesystem is not used for records. A fresh production database does not contain local SQLite or sample records. Production disables synthetic sample data and refuses presence verification against a demo boundary. Add approved student accounts and institution-surveyed campus boundaries through the admin interface before relying on attendance records. Restrict the Google key to the Maps JavaScript API and the exact Railway hostname (for example, `https://<service>.up.railway.app/*`) plus any approved custom domain. Never commit the key. Location tracking requires HTTPS, GPS permission, and the student app to stay open and visible.

The included Alembic migrations support managed schema upgrades. Back up PostgreSQL and test restores through the institution's normal operations process.

Start the stack with `docker compose up --build -d`. Put an institution-managed HTTPS reverse proxy in front of the app and keep the database private. The Compose file binds the app to localhost for that purpose. Back up PostgreSQL and test restores through the university’s normal operations process. Apply schema changes with the included Alembic migrations.

The app is not connected to Vignan’s live identity or student directory. A real deployment still requires the university to supply and approve a surveyed campus boundary and zones, the student account lifecycle or identity integration, the retention and student notice policy, the production HTTPS hostname, and database operations ownership. The default map is centered at the university-published administrative-block location (16.232529, 80.547941); this is a map center, not a surveyed perimeter. All sample geofences are visibly marked and blocked in production until replaced. Set `PRESENCE_RETENTION_DAYS` and `LOCATION_ACCURACY_LIMIT_M` to university-approved values. Student location checks require GPS permission and the page open; this web app does not run background tracking when the browser is closed.

The map uses Google Maps when `GOOGLE_MAPS_API_KEY` is set in the local `.env` or Railway service variables; otherwise it uses OpenStreetMap. `run.ps1` reads `.env`, and Compose passes the same setting through. The Google key is necessarily visible to browser users, so restrict it in Google Cloud to the Maps JavaScript API and allowed website referrers. Add `http://127.0.0.1:8000/*` for local testing, then the real HTTPS hostname for a deployment. Google Maps requires the Maps JavaScript API enabled and an eligible billing setup.

The OpenStreetMap fallback requires internet access in the browser, shows visible attribution, and does not prefetch tiles. The public OSM tile service is best-effort and has no availability guarantee; use an institution-approved tile provider or self-hosted tile service for a public launch or high traffic.

For a lost administrator login, `python admin_recovery.py` runs a local break-glass recovery prompt. It never prints or logs the password, revokes existing sessions, and records an audit event. Production recovery requires `--allow-production`; creating a replacement administrator requires `--bootstrap` and no active administrator.

GPS alone cannot prove that a device is physically present or prevent location spoofing. The service enforces server-side boundaries and accuracy limits, but a production attendance policy should not treat an isolated GPS result as tamper-proof evidence.

## Research and scope

- The official ARMS description identifies a broad academic record system covering attendance, assignments, fees, hall tickets, results, revaluation, On-Duty approvals, course selection, and parent communications. That breadth is outside this problem statement; this app does not recreate those modules.
- The Viana/VStudy public entry point does not expose authenticated workflows in this review. The screenshots supplied with the request show mobile interaction patterns such as a dark shell, presence indicators, and compact navigation; those informed visual choices only.
- Vignan Connect describes itself as a centralized university portal directory. This presence app is designed as one focused service, rather than a replacement for university systems.
- The earlier front-end prototype had no server-side identity, persistent authoritative event store, enforced geofence checks, or real account/role enforcement. This implementation adds those controls, consent, live monitoring, alerts, history, and retention while keeping the scope to the supplied brief.

The public Vignan site and Vignan Connect informed the institutional branding direction. The interface references Vignan’s public logo and campus imagery; if a remote asset is unavailable, the logo has a local fallback and the hero returns to a solid campus color. Confirm brand asset use with the university before an external launch.

## Reference links

- [Saveetha ARMS](https://arms.sse.saveetha.com/)
- [Saveetha ARMS public feature description](https://civil.sse.saveetha.com/academics)
- [SIMATS examination reforms](https://www.saveetha.com/examination-reforms)
- [Saveetha admissions / Viana](https://admissions.saveetha.com/)
- [Vignan Connect](https://vignan.ac.in/vignanconnect/)
- [Vignan University](https://www.vignan.ac.in/)
- [Vignan campus facilities document with the administrative-block geotag](https://vignan.ac.in/aqardownload/4.1.3-Campus%20facilities-21-22.pdf)
- [Google Maps Platform API key security guidance](https://developers.google.com/maps/api-security-best-practices)
