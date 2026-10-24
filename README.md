# StockFlow

Inventory management for small teams, built for the SDE Intern assessment. It includes organization signup and login, tenant-scoped product management, low-stock dashboard summaries, and configurable stock thresholds.

## Stack

- React 19 + Vite frontend
- Node.js + Express 5 API
- SQLite with Prisma ORM
- JWT sessions in HttpOnly cookies; passwords hashed with bcrypt

## Run locally

Requires Node.js 20.19+ or 22.12+.

```powershell
npm install
Copy-Item .env.example .env
npx prisma migrate dev --name init
npm run dev
```

Vite serves the frontend at [http://127.0.0.1:5173](http://127.0.0.1:5173) and proxies API requests to Express on port 3000. Configure `DATABASE_URL`, `JWT_SECRET`, and `PORT` in `.env` as needed. The default SQLite database is `prisma/dev.db`.

## Production

Set `DATABASE_URL` and a random `JWT_SECRET` (at least 32 characters), then run `npm install`, `npm run build`, and `npm start`. The start command applies checked-in Prisma migrations before serving the built frontend and API. The `Procfile` is provided for Node-compatible hosts. SQLite is suitable for a single-instance demo; use PostgreSQL for multi-instance deployments.

## Checks

```powershell
npm test
npm run build
```

The test suite exercises authentication, organization isolation, product validation and CRUD, dashboard totals, and threshold settings against a separate SQLite test database.

## Deploy to Render

This repository includes a `render.yaml` Blueprint for a free Node web service. In Render, choose **New → Blueprint**, connect this GitHub repository, and select the Blueprint. Render builds the React app, applies Prisma migrations at startup, and generates `JWT_SECRET`. After the first successful deploy, open the service URL and create an account.

The free service uses SQLite on Render's ephemeral filesystem, so database contents can be lost when the service restarts, spins down, or redeploys. This is suitable for a short demo only. For durable data, use a paid Render web service with a persistent disk mounted at `/var/data` and set `DATABASE_URL=file:/var/data/stockflow.db`, or change the Prisma provider to PostgreSQL and connect a managed Render Postgres database. Free Render Postgres databases expire after 30 days. See [Render's free service limitations](https://render.com/docs/free) and [persistent disk documentation](https://render.com/docs/disks).
