# fensterchess.tooling

Data maintenance tooling for [fensterchess](https://github.com/JeffML/fensterchess) master games database.

## Overview

This repository maintains a curated database of ~19,000 high-level chess games (2400+ ELO) used by the fensterchess opening research application. It handles:

- Downloading games from pgnmentor.com and Lichess Elite database
- Filtering for quality (ratings, time controls, titles)
- Deduplication via deterministic hashing
- Building searchable indexes by position, player, opening, event, and date
- Chunking data for efficient storage
- Uploading to Netlify Blobs for consumption by fensterchess

## Quick Start

```bash
# Install dependencies
npm install

# Download latest games (incremental)
npm run download:pgnmentor

# Build search indexes
npm run build-indexes

# Backup existing blobs (before upload)
npm run backup

# Upload to Netlify Blobs
npm run upload
```

## Complete Workflow

### 1. Download New Games (Incremental)

Downloads only files modified since last visit using two-level detection:

```bash
# Download all changed files (up to 250)
npm run download:pgnmentor

# OR limit for testing
MAX_FILES=3 npm run download:pgnmentor
```

**What it does:**

- Checks if `/files.html` page was modified (1 HEAD request)
- If changed, batch checks all 250 files concurrently (250 HEAD requests)
- Downloads only files modified since `lastPageVisit`
- Filters games (ELO >2400, rapid+, standard chess, no variants)
- Deduplicates via hash matching
- Appends to existing chunks or creates new ones
- Updates `deduplication-index.json` every 5 files
- Updates `source-tracking.json` with file metadata

**Output:**

- `data/indexes/chunk-*.json` (game data)
- `data/indexes/deduplication-index.json` (updated)
- `data/indexes/source-tracking.json` (updated)

### 2. Build Search Indexes (Batch Rebuild)

Rebuilds all query indexes from chunks:

```bash
npm run build-indexes
```

**What it does:**

- Loads all games from existing chunks
- Skips games already enriched with eco.json data (optimization)
- Enriches new games with opening analysis (moves → FEN → opening name)
- Rebuilds all 7 search indexes from scratch:
  - `opening-by-fen.json` - Search by position
  - `opening-by-name.json` - Search by opening name
  - `opening-by-eco.json` - Search by ECO code
  - `player-index.json` - Search by player
  - `event-index.json` - Search by event
  - `date-index.json` - Search by date
  - `game-to-players.json` - Lightweight player lookup array

**Performance:**

- Enrichment: ~16 games/sec
- Only processes games without `ecoJsonFen` (incremental optimization)
- Full rebuild: ~1-2 minutes after incremental update

**Output:** All indexes in `data/indexes/` refreshed

### 3. Backup Existing Blobs (Safety)

Downloads current production data before uploading changes:

```bash
npm run backup
```

**What it does:**

- Fetches all blobs from Netlify Blobs store
- Saves to `backups/<YYYY-MM-DDTHH-MM-SSZ>/indexes/`
- Preserves directory structure
- ~26 MB total (~19K games)

**Why:** Enables rollback if upload has issues

**Output:** `backups/2026-02-14T12-34-56Z/indexes/*.json`

### 4. Upload to Netlify Blobs

Uploads changed indexes to production with safety checks:

```bash
npm run upload
```

**What it does:**

- Compares local files with remote blobs (content diff)
- Shows summary:
  - 🆕 New files
  - ✏️ Modified files (with size diff)
  - ✓ Unchanged files
- Skips upload if nothing changed
- Prompts: "Continue with upload? [y/N]:"
- Uploads only new and modified files

**Safety features:**

- Diff before upload
- Manual confirmation required
- Only changed files uploaded
- Previous backup enables rollback

**Output:** Updated blobs in Netlify

### Testing Before Upload

```bash
# Test filters work correctly
npm run test:filters

# Test chunk logic and formulas
npm run test:chunks

# Check TypeScript compilation
npm run type-check
```

### Testing in fensterchess (After Upload)

Once blobs are uploaded, test the integration:

```bash
cd ../fensterchess

# Run local dev server with Netlify functions
netlify dev

# Or run fensterchess tests
npm test
```

**What to verify:**

- Master games appear in opening position searches
- Player search returns correct games
- Opening name filtering works
- Game moves load correctly
- New games from recent downloads are accessible

**Note:** fensterchess serverless functions load data from Netlify Blobs, not local files. Must upload to blobs before testing.

## Data Pipeline

```
Download → Filter → Hash/Dedupe → Build Indexes → Chunk → Upload to Blobs
```

Performance: ~16 games/sec manual SAN parsing (~20 minutes for 19K games)

## Data Sources

### pgnmentor.com (Players section)

- Masters: Carlsen, Kasparov, Nakamura, Anand, Fischer
- No title requirement
- ~19,000 games currently

### Lichess Elite Database

- Monthly downloads from https://database.lichess.org/elite/
- Requires BOTH players to have FIDE titles
- Expected: ~3K-5K games per month

## Filtering Criteria

**Common filters (all sources):**

- Standard chess only (no variants)
- Both players ELO >2400
- Rapid or slower time controls (≥600s base)
- No FEN setups (standard starting position only)

**Site-specific:**

- pgnmentor: No title requirement
- Lichess Elite: BOTH players must have FIDE titles (GM, IM, FM, etc.)

## Index Structure

All indexes stored in `data/indexes/`:

- **master-index.json** - Complete game metadata
- **player-index.json** - Search by player name
- **opening-by-fen.json** - Search by position (uses `ecoJsonFen` as key)
- **opening-by-eco.json** - Search by ECO code
- **opening-by-name.json** - Search by opening name
- **event-index.json** - Search by event/tournament
- **date-index.json** - Search by date range
- **deduplication-index.json** - Hash → game index mapping
- **source-tracking.json** - Source metadata and checksums
- **chunk-\*.json** - Game data split into 4000-game chunks (~4 MB each)

## Key Concepts

### Opening FEN (`ecoJsonFen`)

Each game is indexed by the FEN of its opening position, not its final position. This is stored in the `ecoJsonFen` field and is THE KEY for querying `opening-by-fen.json`.

**Example:** A game that plays 1.b3 d6 2.Bb2 is indexed under the FEN for 1.b3 (Nimzo-Larsen Attack), not the FEN after 2.Bb2.

### Deduplication

Games are hashed deterministically (players + result + date + first 20 moves) to prevent duplicates when merging data from multiple sources.

## Environment Setup

Create `.env` file:

```bash
NETLIFY_BLOB_STORE_API_KEY=<your-key>

# Optional: Limit files processed (for testing)
# MAX_FILES=3
```

Get the API key from the Netlify project dashboard.

**Environment Variables:**

- `NETLIFY_BLOB_STORE_API_KEY` - Required for backup and upload operations
- `MAX_FILES` - Optional, limits number of files processed by downloadPgnmentor.ts (useful for testing)

## Scripts

**Download:**

- **`downloadPgnmentor.ts`** - Site-specific downloader for pgnmentor.com (250 player files)
- **`downloadMasterGames.ts`** - Legacy downloader (to be deprecated)

**Build:**

- **`buildIndexes.ts`** - Generate all search indexes from chunks

**Deploy:**

- **`backupFromBlobs.ts`** - Download all indexes to timestamped backup folder
- **`uploadToBlobs.js`** - Upload indexes to Netlify Blobs with diff and confirmation

**Utilities:**

- **`filterGame.ts`** - Site-specific quality filtering logic
- **`hashGame.ts`** - Deterministic game hashing for deduplication
- **`types.ts`** - TypeScript interfaces (GameMetadata, indexes, etc.)

**Testing:**

- **`testFiltering.js`** - Validate filter logic
- **`testChunkLogic.ts`** - Validate chunk management
- **`testPipeline.ts`** - Pre-flight checks

## Integration with fensterchess

The fensterchess application queries this data via serverless functions:

- `queryMasterGamesByFen` - Returns openings/masters for a position
- `getMasterGameMoves` - Returns full PGN for a game

Runtime code stays in fensterchess; only build tooling lives here.

## Documentation

- [Copilot Instructions](.github/copilot-instructions.md) - Comprehensive development guide
- [Design Docs](.github/docs/) - Architecture and phase planning

## Current Status

**Phase 1:** Complete

- Downloaded 5 masters from pgnmentor
- Built indexes locally (~19K games, 5 chunks)
- Tested filtering and deduplication

**Phase 2:** In Progress

- UI integration in fensterchess
- Query optimization

**Phase 3:** Complete

- ✅ Uploaded all indexes to Netlify Blobs
- ✅ fensterchess serverless functions load from blobs
- ✅ Zero bundled JSON files (30.9 MB eliminated)
- ✅ Incremental update pipeline with safety features

## Common Scenarios

### First-Time Full Download

```bash
# Download all 250 player files from pgnmentor
npm run download:pgnmentor

# Expected: ~19K games, ~20 minutes
# Creates chunks 0-4, deduplication-index, source-tracking
```

### Testing with Limited Files

```bash
# Process only 3 files for quick validation
MAX_FILES=3 npm run download:pgnmentor

# Expected: ~7K games, ~5-7 minutes
# Useful for testing changes before full run
```

### Incremental Update

```bash
# Regular workflow - adds only new/changed games
npm run download:pgnmentor  # Downloads changed files only
npm run build-indexes        # Rebuilds search indexes
npm run backup               # Safety backup
npm run upload               # Upload to production
```

### Rollback After Bad Upload

```bash
# Restore from timestamped backup
cd backups/2026-02-14T12-34-56Z/indexes

# Upload old data back to blobs
# (modify uploadToBlobs.js temporarily to use backup path)
```

### Full Rebuild from Scratch

```bash
# Delete existing chunks and indexes
rm -rf data/indexes/*.json

# Re-download everything
npm run download:pgnmentor

# Rebuild indexes
npm run build-indexes

# Backup and upload
npm run backup
npm run upload
```

### Troubleshooting

**"Duplicate game detected"** - Working as intended, deduplication prevents re-adding

**"No eco.json data found"** - Ensure internet connection, eco.json downloads from GitHub

**Upload shows no changes** - Check if build-indexes completed, verify local file timestamps

**fensterchess doesn't show new games** - Did you upload to blobs? Functions read from remote, not local

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Related Projects

- [fensterchess](https://github.com/JeffML/fensterchess) - Main application
- [chessPGN](https://github.com/JeffML/chessPGN) - Chess library for parsing
- [eco.json](https://github.com/JeffML/eco.json) - Opening database
