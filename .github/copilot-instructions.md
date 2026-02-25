# Copilot Instructions for fensterchess.tooling

## Project Purpose

This repository manages master-game data for fensterchess (download, filter, dedupe, index, chunk, upload).

**Primary operator path:**

- Use the web workflow UI first: `npm run workflow` → `http://localhost:3030`
- Use direct scripts only for debugging, targeted reruns, or script development

## Related Repositories

- [fensterchess](https://github.com/JeffML/fensterchess) - Runtime app consuming this data
- [chessPGN](https://github.com/JeffML/chessPGN) - PGN parsing library
- [eco.json](https://github.com/JeffML/eco.json) - Opening dataset used for enrichment

## Web Workflow (Default)

Workflow server: `scripts/workflowServer.js`

UI page: `public/index.html`

Run:

```bash
npm run workflow
```

Expected flow in the UI:

1. Download
2. Build indexes
3. Backup
4. Upload preview, then upload

Behavior:

- Streams command output to the browser via SSE
- Enforces step order (no skipping)
- Supports upload preview by auto-answering upload prompt with `n`

## Core Scripts

- `scripts/downloadPgnmentor.ts` - Incremental pgnmentor downloader
- `scripts/buildIndexes.ts` - Rebuilds query indexes from chunks
- `scripts/backupFromBlobs.ts` - Pulls current production blobs to timestamped backup folder
- `scripts/uploadToBlobs.js` - Diff-based upload with confirmation prompt
- `scripts/filterGame.ts` - Quality filtering logic
- `scripts/hashGame.ts` - Deterministic deduplication hash
- `scripts/types.ts` - Type definitions

## Environment & Netlify Blobs

Local scripts needing blob access require explicit credentials:

```bash
NETLIFY_AUTH_TOKEN=<token>
SITE_ID=<site-id>
```

Auth pattern:

- Local tooling scripts: `getStore({ name, siteID, token })`
- Deployed Netlify functions (in fensterchess): `getStore("master-games")`

Blob store name: `master-games`

Blob prefix convention: `indexes/`

## Data Sources & Filters

### pgnmentor

- Source: Players section
- Current baseline set: Carlsen, Kasparov, Nakamura, Anand, Fischer
- No title requirement

### Lichess Elite (planned/partial)

- Requires both players to have FIDE titles

### Common filters

- Standard chess only
- No FEN setup starts
- Both players ELO > 2400
- Time control rapid or slower (base ≥ 600 seconds)

## Indexes and Critical Lookup Rule

Indexes live in `data/indexes/` and include:

- `master-index.json`
- `player-index.json`
- `opening-by-fen.json`
- `opening-by-eco.json`
- `opening-by-name.json`
- `event-index.json`
- `date-index.json`
- `deduplication-index.json`
- `source-tracking.json`
- `chunk-*.json`

### Critical: `ecoJsonFen` is the opening lookup key

When querying `opening-by-fen.json`, use `ecoJsonFen` (ancestor opening FEN), not arbitrary current position FEN.

## Chunking and Indelible Data

Chunk rule:

- `chunkId = Math.floor(gameId / 4000)`

Do not alter these once written:

1. Game IDs (`idx`)
2. Game hashes
3. Existing chunk assignments
4. Source provenance fields

Rebuildable/derived data includes query indexes and opening enrichment fields.

## Operational Commands

### Preferred

```bash
npm run workflow
```

### Advanced / Direct

```bash
npm run download:pgnmentor
npm run build-indexes
npm run backup
npm run upload
```

Test with a smaller download:

```bash
MAX_FILES=3 npm run download:pgnmentor
```

## Validation Commands

```bash
npm run test:filters
npm run test:chunks
npm run test:pipeline
npm run type-check
```

## Current Temporary/Technical Debt

`scripts/generateFromToIndex.ts` is temporary and should migrate to eco.json.tooling when that repo/process is available.

## Common Pitfalls

1. Querying opening index by the wrong FEN (must use `ecoJsonFen` key)
2. Rebalancing chunks or rewriting IDs (breaks stable references)
3. Running backup/upload locally without `NETLIFY_AUTH_TOKEN` + `SITE_ID`
4. Treating direct scripts as default operator path instead of the workflow UI
5. Forgetting backup before production upload
