# StockFlow

A compact inventory management MVP built for the SDE Intern assessment. It includes single-owner organization signup and login, tenant-scoped product management, low-stock dashboard summaries, and an organization-level default threshold. The app uses Python's standard library, SQLite, and vanilla JavaScript, so it has no third-party runtime dependencies.

## Run locally

Requires Python 3.10 or newer.

```powershell
python app.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000), create an account, and add products. Data is stored in `stockflow.db` beside the application. To use another database path or port:

```powershell
$env:STOCKFLOW_DB = "D:\data\stockflow.db"
$env:PORT = "8080"
python app.py
```

## Features

- Email and password signup/sign-in with scrypt password hashing and server-side sessions.
- Organization creation at signup, with all product and settings queries scoped to the authenticated organization.
- Product creation, editing, deletion, name/SKU search, and optional cost and selling prices.
- Dashboard totals for products, units, and low-stock items.
- Per-product thresholds with an organization-wide default (5 by default).
- Responsive desktop and mobile layouts, form validation, and confirmation before deletion.

## Run acceptance checks

```powershell
python -m unittest discover -s tests -v
node --check app.js
```

## Deployment notes

The service binds to `127.0.0.1` for local use. The included `Procfile` binds to `0.0.0.0`, uses the platform-provided `PORT`, and enables secure session cookies for HTTPS. For a single-instance host that supports persistent disks, point `STOCKFLOW_DB` at a persistent disk location. SQLite is suitable for a demo or a single app instance; a production multi-instance deployment should use a managed database and a production-grade HTTP server.

The assessment's separate submission instructions also call for emailing the confirmed start time and public GitHub repository link before starting, maintaining regular commits, and sharing a live deployment URL at submission. This workspace has a local Git repository and commit, but it is not connected to GitHub or a hosting account. Publishing and live deployment require access to those accounts. The pre-assessment email step cannot be completed retroactively.
