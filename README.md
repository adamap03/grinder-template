# Grinder

A personal job-search workspace for finding the firms worth applying to, keeping track of applications and
preparing for them. Built for UK engineering and related fields, but the sector list is easy to change.

Data lives in **your own Notion workspace** (one database per table, created on first use) and the AI runs on
**Claude**. Nothing is stored anywhere else.

## What it does

| Page | |
| --- | --- |
| **Discover** | Firms from the directories you add, grouped by sector (Civil & structural, Surveyors, Planning, …). A clickable UK map with counts per area, size and sector tickboxes, a "Nationwide companies" filter, a search box driven by a Notion *Search terms* table, careers-page links, and a Claude fit rating for each firm against what you are looking for. *Just posted jobs* finds recent vacancies and hiring posts. |
| **Sources** | Each sector has a Sources pop-up: add a directory page (web page or PDF) and the app reads every page of it, adds the firms it lists (never twice), places them on the map and finds each firm's careers page. |
| **Shortlist** | Firms you want to follow, with their job board shown in place (or its vacancies read for you, all pages), your notes, sector tags and whether you have applied. |
| **Application tracker** | Every application with status, dates and links; response and rejection rates; "Applied" rows with no answer after 15 days become *Rejected (unanswered)*; filter by status and by map area. |
| **Calendar** | Closing and interview dates, contacts and recruiter correspondence. |
| **Preparation** | Fit quiz, repeatable answers, common interview questions and past cover letters. |
| **Resume** | Upload and edit your resume (templates, PDF/Word export) and keep a history of past CVs. |
| **My profile** | Languages (taken from your resume) and an assessment of your profile. |

## Run it

You need [Docker](https://www.docker.com/products/docker-desktop/), a Notion account and (for the AI features) a
Claude API key.

1. Download the code and start it:

   ```bash
   git clone https://github.com/adamap03/grinder-template.git grinder
   cd grinder
   docker compose -f napi.compose.yml up -d --build
   ```

2. Open http://localhost:8080. The **setup page** walks you through connecting Notion: create an internal
   integration, share an empty page with it, paste the secret and the page link (and optionally your Claude key).
   It asks for a **setup code** from the server log (Docker Desktop: the container's Logs, or
   `docker compose -f napi.compose.yml logs app`), so only whoever runs the server can connect it.
   The settings are saved in the app's Docker volume; Grinder then creates its tables in your page.
3. **Create an account. The first account becomes the admin** (admins can read sources and are not limited by the
   daily allowances). Further accounts are ordinary users; promote one by setting its Role to `admin` in the Notion
   *Users* table.
4. In Discover, open a sector's **Sources** and add a directory page, then press *Read … sources now*.

Another port: `NAPI_PORT=9000 docker compose -f napi.compose.yml up -d --build`. Settings can also be given in a
`.env.napi` file (see `.env.example`); those win over the setup page. For development: `bun install`, `bun run dev`.

## Update

Your copy is a git clone, so updating is pulling the latest code and rebuilding (your data stays in Notion and your
settings in the Docker volume):

```bash
git pull --ff-only
docker compose -f napi.compose.yml up -d --build
```

(or `npm run update`, which runs both).

The Notion page fills with tables as you use the app. You can group them into section pages (Discover, Shortlist,
Application tracker, …); the app finds tables one level down. Footer links (GitHub, YouTube, LinkedIn) are set in the
Notion *Site links* table.

## Where things are

- `src/routes/`: pages; `src/components/`: UI pieces.
- `src/lib/notion-db.server.ts`: the Notion data layer and its access rules (each user only reaches their own rows).
- `src/lib/sectors.ts`: the one list of sectors. `src/lib/firm-key.ts`: how firms are matched (no duplicates).
  `src/lib/locate.ts`: how firms are placed on the map. `src/lib/directory.server.ts`: reading sources.
- `scripts/directory-import/`: for directories the app cannot read itself (sites that block automated readers or build
  their list in the browser): read them in a browser, then import (see its README).
- `scripts/check-*.ts`: quick self-checks (`node --experimental-strip-types scripts/check-sectors.ts`, …).

## Privacy and security

- Every request carries a sign-in token; tables holding personal data (resumes, profile, applications, documents)
  only ever return the signed-in user's rows, and account data is server-only.
- Requests are rate limited per client, sign-in attempts are limited per address and email, pages are marked
  `noindex` and robots.txt asks crawlers to stay out, and the server refuses to fetch internal network addresses.
- Reading directories is polite (about one request a second, an honest User-Agent). Do not use services that
  defeat a site's bot protection; if a site blocks the reader, ask the site or read it in a browser by hand.
- Secrets live in the app's Docker volume (saved by the setup page) or in `.env.napi`; git ignores both. The setup
  page only works until Notion is connected and needs the setup code from the server log.
- No analytics or third-party tracking.

## Credits

Started as a fork of [GrinderResume by Maahin Panchal](https://github.com/MaahinVPanchal/grindresume) (MIT); since
reworked to run on Notion and Claude with the Discover, Shortlist and tracking features above. See `LICENSE`.
