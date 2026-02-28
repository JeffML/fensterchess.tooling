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

Tracking behavior:

- Download updates **local** source tracking for incremental reruns
- Production/source-of-truth tracking is finalized after successful upload to Netlify Blobs
- The log message "Production tracking is still finalized after upload to Netlify Blobs" means local tracking changed, production has not yet changed

## Core Scripts

- `scripts/downloadPgnmentor.ts` - Incremental pgnmentor downloader; **sole authority on chunk assignment** via `saveGamesToChunks()`
- `scripts/buildIndexes.ts` - Enriches games with eco.json data in-place; rebuilds query indexes; **does NOT rechunk**
- `scripts/backupFromBlobs.ts` - Pulls current production blobs to timestamped backup folder
- `scripts/uploadToBlobs.js` - Diff-based upload with confirmation prompt; deletes orphan blobs in production
- `scripts/filterGame.ts` - Quality filtering logic
- `scripts/hashGame.ts` - Deterministic deduplication hash
- `scripts/types.ts` - Type definitions
- `scripts/rechunkByHash.ts` - **One-time repair script only.** Deduplicates by hash, sorts by hash, and re-slices into clean chunks. Run only when chunks contain duplicate games. Running it routinely will reshuffle all chunk boundaries.

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
- ELO requirement is disabled for this source (historic games often lack ELO headers)

### Lichess Elite (planned/partial)

- Requires both players to have FIDE titles

### Common filters

- Standard chess only
- No FEN setup starts
- Both players ELO > 2400 (applies to sources where ELO filtering is enabled)
- Time control rapid or slower (base ≥ 600 seconds)

## Indexes and Critical Lookup Rule

Indexes live in `data/indexes/` and include:

- `master-index.json`
- `player-index.json`
- `opening-by-fen.json`
- `opening-by-eco.json`
- `opening-by-name.json`
- `game-to-chunk.json` - idx → chunkId mapping for correct chunk lookup in serverless functions
- `event-index.json`
- `date-index.json`
- `deduplication-index.json`
- `source-tracking.json`
- `chunk-*.json`

### Critical: `ecoJsonFen` is the opening lookup key

When querying `opening-by-fen.json`, use `ecoJsonFen` (ancestor opening FEN), not arbitrary current position FEN.

## Game Identity

- **`hash`** — SHA-256 of `event|white|black|date|round`. Globally unique per game. The true identity key.
- **`idx`** — Per-source-file sequential integer. **NOT globally unique** across all sources (e.g. 66,664 records but only ~45,209 unique `idx` values). Do not use `idx` for deduplication or cross-chunk identity.

## Chunking Model

Chunks are **insertion-order, append-only**. The authoritative chunk assigner is `saveGamesToChunks()` in `downloadPgnmentor.ts`:

- New games are appended to the last in-progress chunk
- When a chunk reaches 4,000 games, a new chunk is started
- `CHUNK_SIZE = 4000` (defined in both `buildIndexes.ts` and `downloadPgnmentor.ts`)
- Chunk files written by the downloader contain `{ games: [...] }` only — no `chunkId` field in the JSON. `buildIndexes.ts` derives the chunkId from the filename.
- **`buildIndexes.ts` does NOT rechunk.** It loads each chunk preserving its membership, enriches games in-place with eco.json data, and rewrites only chunks that gained new `ecoJsonFen` values. Unchanged chunks are skipped.

**Do not alter once written:**

1. Game hashes
2. Existing chunk membership (which games are in which chunk file)
3. Source provenance fields

**Rebuildable/derived data:** query indexes, opening enrichment fields (`ecoJsonFen`, `ecoJsonOpening`, `ecoJsonEco`, `movesBack`), `master-index.json`.

### Why not hash-sorted chunking?

Hash-sorted sequential slicing causes **cascading boundary shifts**: adding any new games anywhere in the hash space moves games across chunk boundaries throughout the entire dataset, causing every chunk to be re-uploaded. Since there is no fixed upper bound on the number of games, consistent hashing is also not viable. Insertion-order chunking is the only stable model.

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

1. Querying opening index by the wrong FEN (must use `ecoJsonFen` key, not arbitrary current position FEN)
2. Running `rechunkByHash.ts` routinely — it reshuffles all chunk boundaries; use only for one-time repair when duplicates exist
3. Calling `buildGameChunks()` from `buildIndexes` — this hash-sorts and re-slices, destroying insertion-order boundaries; `buildIndexes` must never rechunk
4. Using `idx` for game identity or deduplication — it is per-source-file sequential and not globally unique; use `hash` instead
5. Using `processed-games.json` as the primary data source — chunks are the source of truth; `processed-games.json` is a legacy fallback only for the very first import when no chunks exist yet
6. Running backup/upload locally without `NETLIFY_AUTH_TOKEN` + `SITE_ID`
7. Treating direct scripts as default operator path instead of the workflow UI
8. Forgetting backup before production upload
9. Using `Math.floor(idx / 4000)` to locate a game's chunk — after `rechunkByHash` sorted chunks by hash, this formula returns wrong results. The serverless function `queryMasterGamesByFen.js` must use `game-to-chunk.json` via `getChunkIdForGame()`. Regenerate and upload `game-to-chunk.json` whenever chunks change.
