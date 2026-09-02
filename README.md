# ACAD-CONTROL: Supervisory Control Platform

The **ACAD Supervisory Control Platform** is a private, multi-tenant cloud control plane engineered for monitoring, licensing, feature gating, and remote orchestration of distributed **ACAD-EDGE** school server nodes.

---

## 🏛 Architecture Overview

```
                         INTERNET
                            │
                            ▼
              ┌───────────────────────────┐
              │    ACAD-CONTROL (Cloud)   │
              │  • Vercel (Next.js 14)    │
              │  • Render (Bun API + PG)  │
              └─────────────┬─────────────┘
                            │
             Outbound HTTPS │ (HMAC-SHA256 Signed Heartbeats & Telemetry)
                            ▼
       ┌────────────────────┴────────────────────┐
       │                                         │
┌──────▼──────────────┐                   ┌──────▼──────────────┐
│  ACAD-EDGE School A │                   │  ACAD-EDGE School B │
│ • Local School App  │                   │ • Local School App  │
│ • Local SQLite DB   │                   │ • Local SQLite DB   │
│ • Node Agent Bridge │                   │ • Node Agent Bridge │
└─────────────────────┘                   └─────────────────────┘
```

### Key Isolation Guarantees:
1. **Air-Gapped Academic Operations**: ACAD-EDGE nodes operate 100% offline during local outages. Local exams, grading, and reports never block on cloud connectivity.
2. **Outbound-Only Node Bridge**: ACAD-EDGE nodes never open inbound listening ports to the public internet. Nodes communicate outbound to ACAD-CONTROL via HMAC-signed pulses.
3. **Zero Secret Leakage**: Supervisory operator credentials, master database, and platform source code are never distributed inside school computers.

---

## 📁 Repository Structure

```
acad-control/
├── backend/                  # Standalone Bun / Node.js Control API server
│   ├── src/
│   │   ├── auth/             # JWT platform auth & HMAC node request verification
│   │   ├── database/         # Schema, seeders, and 15 repositories
│   │   ├── services/         # Health calculation engine, alert engine, license engine
│   │   ├── types/            # Platform & node data contracts
│   │   └── server.ts         # Fast Bun HTTP server with CORS & SSE
│   ├── tests/                # Automated integration tests
│   ├── Dockerfile            # Container definition for Render
│   └── package.json
├── frontend/                 # Standalone Next.js 14 Mission Control Dashboard
│   ├── app/                  # 14 supervisory subroutes (schools, telemetry, licenses, etc.)
│   ├── components/           # Control icons and UI elements
│   ├── lib/                  # API client & SSE real-time stream consumer
│   ├── vercel.json           # Vercel deployment configuration
│   └── package.json
├── database/
│   └── schema.sql            # PostgreSQL DDL for production cloud deployment
└── render.yaml               # Render Blueprint for automated Web Service + PostgreSQL
```

---

## 🚀 Cloud Deployment Guide

### 1. Backend on Render (Web Service + Managed PostgreSQL)
1. Push this repository or the `acad-control` branch to your private GitHub organization.
2. Connect your repository to **Render Blueprints** using `render.yaml`.
3. Render will automatically provision:
   - **PostgreSQL 16 Managed Database** (`acad-control-postgres`)
   - **Bun Docker Web Service** (`acad-control-api`) running on port `8002`
4. Set environment variables:
   - `CORS_ORIGIN`: Your production Vercel frontend URL (e.g. `https://control.acad.ng`)
   - `CONTROL_JWT_SECRET`: 256-bit cryptographic secret for platform JWTs
   - `CONTROL_ADMIN_EMAIL`: Initial root platform operator email (`owner@acad.ng`)
   - `CONTROL_ADMIN_PASSWORD`: Strong master operator password

### 2. Frontend on Vercel
1. Import the `acad-control/frontend` folder as a project in Vercel.
2. Configure environment variable:
   - `NEXT_PUBLIC_CONTROL_API_URL`: `https://<your-render-api>.onrender.com`
3. Deploy!

---

## 🔐 Security & Node Authentication

Every request from an `ACAD-EDGE` school node to `/api/node/*` must include cryptographic HMAC-SHA256 signature headers:

| Header | Description |
|---|---|
| `X-ACAD-Installation-Id` | Unique installation identifier (`INST-...`) |
| `X-ACAD-Timestamp` | Unix timestamp in seconds (enforces 5-minute replay window) |
| `X-ACAD-Signature` | `HMAC-SHA256("${installationId}:${timestamp}:${body}", secretKey)` |

---

## 💻 Local Development

### Run Backend:
```bash
cd acad-control/backend
bun install
bun run src/server.ts
# Server active at http://localhost:8002
# Health: http://localhost:8002/health
```

### Run Tests:
```bash
cd acad-control/backend
bun test
```

### Run Frontend:
```bash
cd acad-control/frontend
bun install
bun run dev
# Dashboard active at http://localhost:3001
```
