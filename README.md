# fensterchess.tooling

Web-based workflow manager for maintaining the Fenster Chess master-games data in Netlify Blobs.

## What This Repo Is For

Use the workflow page to run the full data update process safely:

1. Download new games
2. Build indexes
3. Backup production blobs
4. Upload changes

The web UI is the primary interface for this repository.

## Start the Web Workflow

```bash
npm install
npm run workflow
```

Open: <http://localhost:3030>

The page is served from [public/index.html](public/index.html) by [scripts/workflowServer.js](scripts/workflowServer.js).

## Required Environment

Create a `.env` file in the repo root:

```bash
NETLIFY_AUTH_TOKEN=<your-netlify-token>
SITE_ID=<your-netlify-site-id>
```

Optional:

```bash
MAX_FILES=3
```

Use `MAX_FILES` only for testing smaller download runs.

## Workflow Page Behavior

The page orchestrates a strict, ordered workflow with live output:

- **Step 1: Download**
  - Runs `downloadPgnmentor.ts`
  - Pulls new/changed source files and updates local chunk/index artifacts
- **Step 2: Build Indexes**
  - Runs `buildIndexes.ts`
  - Rebuilds searchable indexes from local chunk data
- **Step 3: Backup**
  - Runs `backupFromBlobs.ts`
  - Downloads current production blobs to a timestamped local backup folder
- **Step 4: Upload**
  - Runs `uploadToBlobs.js`
  - Shows diff/summary and uploads changed files after confirmation handling

### Real-Time Output

- Terminal output is streamed to the browser (SSE)
- Step status is visible in the UI
- The workflow enforces sequence and prevents skipping required prior steps

## Safety Model

- Backup happens before upload in the intended flow
- Upload is change-aware (diff-based), reducing accidental overwrites
- If upload issues occur, restore from a timestamped backup in `backups/`

## Troubleshooting

- **UI does not load**
  - Confirm `npm run workflow` is running and open <http://localhost:3030>
- **Backup or upload auth failures**
  - Verify `.env` has valid `NETLIFY_AUTH_TOKEN` and `SITE_ID`
- **No visible data changes to upload**
  - Re-run download + build and review logs for filtered/unchanged inputs
- **Need a safe dry run**
  - Set `MAX_FILES=3` and run workflow again

## Advanced (CLI Scripts)

If needed, scripts can still be run directly:

- [scripts/downloadPgnmentor.ts](scripts/downloadPgnmentor.ts)
- [scripts/buildIndexes.ts](scripts/buildIndexes.ts)
- [scripts/backupFromBlobs.ts](scripts/backupFromBlobs.ts)
- [scripts/uploadToBlobs.js](scripts/uploadToBlobs.js)

The recommended path remains the web workflow page.

## Related Repositories

- [fensterchess](https://github.com/JeffML/fensterchess)
- [chessPGN](https://github.com/JeffML/chessPGN)
- [eco.json](https://github.com/JeffML/eco.json)
