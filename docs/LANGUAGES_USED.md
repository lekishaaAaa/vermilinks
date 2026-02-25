Project Languages Overview

This file lists the primary programming languages, markup, and configuration formats used in this repository, grouped by area. It includes examples of where they appear and common file extensions.

Frontend
- TypeScript / JavaScript
  - React components and pages: `frontend/src/*.tsx`, `frontend/src/*.ts`, some `.js` scripts
  - Examples: `frontend/src/pages/ContactPage.tsx`, `frontend/src/pages/PublicDashboard.tsx`
- CSS / Tailwind
  - Global and component styles: `frontend/src/index.css` (Tailwind utility classes used in JSX/TSX)
  - File extensions: `.css`
- HTML
  - Static entry and built files: `frontend/public/index.html`, `served_index.html`
  - File extensions: `.html`

Backend
- JavaScript (Node.js)
  - Server, routes, models, migrations, and helper scripts: `backend/server.js`, `backend/*.js`, `backend/models/*.js`
  - Uses Sequelize ORM for database interaction
  - File extensions: `.js`
- SQL (migrations / raw queries)
  - Migration files and SQL snippets: `backend/migration/`, `backend/models_sql/`
  - File extensions: `.sql`, but SQL also embedded in JS migration scripts
- PowerShell
  - Service start scripts and automation: `run-services.ps1`
  - File extensions: `.ps1`

Database & Tooling
- SQLite (database file)
  - Dev DB: `backend/data/dev.sqlite` (binary DB format)
- Python (tooling)
  - `sqlite-web` used to run a web UI for the SQLite DB; commands use Python interpreter
  - File extensions: `.py` for tooling packages (not necessarily repo code)
- PostgreSQL (production target)
  - Connection strings and some migration targets mention Postgres; SQL/Sequelize dialects are used

Scripts / Tooling
- JavaScript (Node.js)
  - Build/serve helpers and verification scripts: `frontend/scripts/serve-build.js`, Puppeteer scripts in `frontend/scripts/*.js`
- JSON / config
  - `package.json`, `ecosystem.config.js`, other `.json` files

Hardware / Embedded
- Arduino (C++ flavor)
  - ESP32 firmware under `esp32/` written in Arduino C++ (files: `.ino`, `.cpp`, `.h`)

Documentation & Assets
- Markdown (`.md`) for docs: `README.md`, `HOW_TO_TEST_BACKEND.md`, etc.
- Images: `.png`, other assets in repo root and `frontend` static assets

Notes
- Many source files use modern ECMAScript (ES6+) features.
- Frontend code is primarily TypeScript (`.ts`/`.tsx`) with some plain JavaScript utilities.
- Backend is plain JavaScript running on Node.js with Sequelize for DB access.
- Dev tooling includes Python (for `sqlite-web`) and PowerShell scripts for convenience.

If you want, I can also generate an inventory file that lists file extensions present in the repository and counts of each type.