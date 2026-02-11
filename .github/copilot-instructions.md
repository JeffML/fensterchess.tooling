# Copilot Instructions for fensterchess.tooling

## Project Overview

This repository contains data maintenance tooling for fensterchess's master games database. It handles downloading, filtering, indexing, and uploading ~19,000 high-level chess games (2400+ ELO) to Netlify Blobs for consumption by the fensterchess application.

**Related repositories:**

- [fensterchess](https://github.com/JeffML/fensterchess) - Main application (consumes the data)
- [chessPGN](https://github.com/JeffML/chessPGN) - Chess library used for parsing
- [eco.json](https://github.com/JeffML/eco.json) - Opening database used for lookup

## Architecture

### Data Pipeline

```
Download → Filter → Hash/Dedupe → Build Indexes → Chunk → Upload to Netlify Blobs
```

**Performance:** Manual SAN parsing ~16 games/sec (~20 minutes for 19K games)

### Scripts

- **`downloadPgnmentor.ts`** - Site-specific downloader for pgnmentor.com player files
  - Discovers 250 player files from /files.html page
  - Downloads, extracts, parses, filters, and chunks games
  - Incremental updates: loads existing chunks, continues from max game ID
  - Updates deduplication index during download
  - Periodic saves every 5 files with progress checkpoints
- **`downloadMasterGames.ts`** - Legacy downloader (to be deprecated)
- **`buildIndexes.ts`** - Generates all search indexes from chunks
- **`filterGame.ts`** - Site-specific quality filters
- **`hashGame.ts`** - Deterministic game hashing for deduplication
- **`types.ts`** - TypeScript interfaces for GameMetadata, indexes, etc.

## Data Sources

### pgnmentor.com

- **Section:** Players only
- **Current masters:** Carlsen, Kasparov, Nakamura, Anand, Fischer
- **Games:** ~19,000
- **No title requirement** - accepts all 2400+ rated games

### Lichess Elite Database

- **Source:** Monthly database downloads
- **Requirement:** BOTH players must have FIDE titles (GM, IM, FM, WGM, WIM, WFM, CM, WCM, NM, WNM)
- **Expected:** ~3K-5K titled player games per month
- **URL pattern:** `https://database.lichess.org/elite/lichess_elite_YYYY-MM.pgn.zst`

## Filtering Strategy

### Common Filters (All Sources)

- Standard chess only (no variants)
- No FEN setups (must start from standard position)
- Both players ELO >2400
- Time control rapid or slower (≥600 seconds base time)

### Site-Specific Filters

Implemented in `filterGame.ts`:

```typescript
// pgnmentor: No title requirement
filterGame(game, "pgnmentor", { requireTitle: false });

// Lichess Elite: Requires BOTH players to have FIDE titles
filterGame(game, "lichess", { requireTitle: true });
```

**Critical:** The `requireTitle` option enforces that both White and Black have FIDE titles in their headers.

## Index Structure

All indexes stored in `data/indexes/`:

### Core Indexes

- **`master-index.json`** - Complete game metadata
  - Array of GameMetadata objects
  - Each game has: players, ELO, result, event, date, opening info

- **`player-index.json`** - Search by player name
  - Keys: player names (normalized)
  - Values: arrays of game indexes

- **`opening-by-fen.json`** - Search by position FEN ⚠️ **CRITICAL**
  - Keys: `ecoJsonFen` (THE opening position FEN, not current position)
  - Values: arrays of game indexes
  - See "GameMetadata Opening Fields" section below

- **`opening-by-eco.json`** - Search by ECO code
  - Keys: ECO codes (e.g., "B03")
  - Values: arrays of game indexes

- **`opening-by-name.json`** - Search by opening name
  - Keys: opening names (normalized)
  - Values: arrays of game indexes

- **`event-index.json`** - Search by event/tournament

- **`date-index.json`** - Search by date range

- **`deduplication-index.json`** - Hash → game index mapping
  - Prevents duplicate games from being added

- **`source-tracking.json`** - Source metadata and checksums
  - Tracks which files were processed and their versions

### Chunk Files

- **`chunk-*.json`** - Game data split into chunks
- **Size:** 4000 games per chunk (~4-5 MB)
- **Why:** Netlify Blobs has size limits; chunking enables efficient partial loading
- **Format:** `{ games: GameMetadata[] }`

## GameMetadata Structure

### Opening Fields ⚠️ CRITICAL UNDERSTANDING

Each game in the index has these fields for opening lookup:

```typescript
interface GameMetadata {
  // ... player, result, event fields ...

  ecoJsonFen: string; // THE KEY for opening-by-fen.json index
  ecoJsonOpening: string; // Opening name (e.g., "Nimzo-Larsen Attack")
  ecoJsonEco: string; // ECO code (e.g., "A01")
  movesBack: number; // Half-moves from end to this opening position
}
```

**Why this matters:**

When a user is at a position that has NO named opening (e.g., 1.b3 d6), to find relevant games:

1. Look up the nearest ANCESTOR opening (e.g., 1.b3 = "Nimzo-Larsen Attack")
2. Use THAT opening's FEN as the key in `opening-by-fen.json`
3. The game metadata stores this as `ecoJsonFen` - it's the INDEX KEY

**Example:** A game ending at move 40 that plays 1.b3 d6 2.Bb2:

- `ecoJsonFen`: FEN after 1.b3 (the Nimzo-Larsen Attack position - the INDEX KEY)
- `ecoJsonOpening`: "Nimzo-Larsen Attack"
- `ecoJsonEco`: "A01"
- `movesBack`: 3 (d6 and Bb2 are 2 more half-moves after 1.b3)

**DO NOT** use the current position's FEN to query `opening-by-fen.json` - use the opening's FEN stored in `ecoJsonFen`.

## Netlify Blobs Integration

### Setup

**Environment Variable:**

```bash
NETLIFY_BLOB_STORE_API_KEY=<your-key>
```

Set in Netlify project dashboard or `.env` file locally.

### Blob Structure

**Store name:** `master-games` (or similar - document actual name here)

**Blobs:**

```
/indexes/master-index.json
/indexes/player-index.json
/indexes/opening-by-fen.json
/indexes/opening-by-eco.json
/indexes/opening-by-name.json
/indexes/event-index.json
/indexes/date-index.json
/indexes/deduplication-index.json
/indexes/source-tracking.json
/chunks/chunk-0.json
/chunks/chunk-1.json
/chunks/chunk-2.json
/chunks/chunk-3.json
/chunks/chunk-4.json
```

**Upload pattern:**

```typescript
import { getStore } from "@netlify/blobs";

const store = getStore("master-games");
await store.set("indexes/master-index.json", JSON.stringify(masterIndex));
```

### Migration from Bundled JSON

**Current state (fensterchess):**

- Indexes bundled in `data/indexes/` directory
- Deployed with application bundle

**Future state:**

- Indexes stored in Netlify Blobs
- Serverless functions query blobs
- Smaller application bundle
- Independent data updates

## Dependencies

```json
{
  "dependencies": {
    "@chess-pgn/chess-pgn": "^1.0.0",
    "@chess-openings/eco.json": "^1.1.0",
    "@netlify/blobs": "latest",
    "tsx": "latest"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
```

## Common Operations

### Download Latest Games (Legacy)

```bash
npm run download
# or
tsx scripts/downloadMasterGames.ts
```

### Download from pgnmentor.com

```bash
npm run download:pgnmentor
# or
tsx scripts/downloadPgnmentor.ts
```

This will:

1. Discover all 250 player files from pgnmentor.com/files.html
2. Compare with existing tracking data
3. Download and process new/modified files only
4. Update chunks incrementally
5. Update deduplication index
6. Save progress every 5 files

### Build Indexes

```bash
npm run build-indexes
# or
tsx scripts/buildIndexes.ts
```

### Upload to Netlify Blobs

```bash
npm run upload
# or
tsx scripts/uploadToBlobs.ts  # TODO: Create this script
```

### Test Filters

```bash
npm run test:filters
# or
tsx test/testFiltering.js
```

### Test Chunk Logic

```bash
npm run test:chunks
# Validates chunk boundaries, formula, and deduplication index
```

### Test Pipeline

```bash
npm run test:pipeline
# Pre-flight checks: imports, current state, existing files
```

## Index Update Strategy

**Hybrid Approach** - Incremental deduplication, batch rebuild for everything else:

### During Download

- **`deduplication-index.json`** - Update incrementally (REQUIRED)
  - Loaded at start to prevent duplicate imports
  - Updated after each file is processed
  - Enables filtering during 20-minute download process

### After Download

- **All other indexes** - Batch rebuild from chunks
  - Run `npm run build-indexes` after downloads complete
  - Simple, atomic operation - all or nothing
  - Easy error recovery - just rebuild
  - Indexes may be stale during download (acceptable)

**Rationale:**

- Deduplication must work during download to prevent duplicate games
- Query indexes (player, opening, ECO, etc.) can be rebuilt anytime
- Simpler error handling - if download fails, just rebuild indexes
- Chunks are source of truth - all other data is derived

## Indelible Data Principles

**Critical data that MUST be preserved and NEVER changed:**

1. **Game IDs (`idx`)** - Primary key used everywhere as reference
   - Once assigned, never changes
   - All indexes reference these IDs
   - Formula: Continue from max existing game ID + 1

2. **Game hashes** - Must remain stable for deduplication
   - Same game from different sources = same hash
   - Stored in chunks and deduplication index
   - Prevents re-adding games on re-download

3. **Chunk assignments** - Formula-based, no rebalancing
   - `chunkId = Math.floor(gameId / 4000)`
   - Once game 8000 is in chunk-2, it stays there
   - Never rebalance to avoid breaking game ID → chunk mapping

4. **Source provenance** - Audit trail
   - `source`: "pgnmentor", "lichess", etc. (which site)
   - `sourceFile`: Which specific file (e.g., "Carlsen.zip")
   - Download timestamps in source tracking

**Rebuildable data (can recalculate anytime):**

- All query indexes (player, opening, ECO, date, event)
- Opening analysis (ecoJsonFen, ecoJsonOpening)
- Statistics in master-index.json
- Ancestor-to-descendants navigation tree

**Why this matters:**

- Chunks are the source of truth - preserve indelible data there
- Indexes are derived - can be rebuilt from chunks
- Game IDs enable stable references across the system
- Source provenance enables "where did game 12345 come from?"

## GameIndex Usage Pattern

**Efficient filtering without full parsing:**

```typescript
import { indexPgnGames } from "@chess-pgn/chess-pgn";
import { shouldImportGame } from "./filterGame.js";

// Index game boundaries (fast, extracts headers)
const indices = indexPgnGames(pgnContent);

for (const gameMetadata of indices) {
  // gameMetadata has .headers, .startOffset, .endOffset

  // shouldImportGame() handles both IChessGame and metadata objects
  if (!shouldImportGame(gameMetadata, { requireTitles: false })) {
    continue;
  }

  // Only extract moves section if game passes filters
  const pgnChunk = pgnContent.slice(
    gameMetadata.startOffset,
    gameMetadata.endOffset,
  );
  // ... process accepted game
}
```

**Key insight:** `indexPgnGames()` returns metadata with `.headers` property already parsed. No need to create full Game objects for filtering - just pass metadata directly to `shouldImportGame()`.

**Benefits:**

- ~16 games/sec parsing speed (manual SAN parsing)
- Early rejection of filtered games (before full parse)
- Simple, efficient code

## Testing Structure

**All tests in `test/` directory at project root:**

- **`test/testChunkLogic.ts`** - Validates chunk management
  - Chunk ID formula verification
  - Existing chunk structure validation
  - Simulates adding games to chunks
  - Deduplication index integrity

- **`test/testPipeline.ts`** - Pre-flight checks
  - Script import validation
  - Current database state
  - Existing files inventory
  - Source tracking status

- **`test/testFiltering.js`** - Filter validation
  - ELO requirements
  - Time controls
  - Title requirements (Lichess)
  - Variant detection

**Run all tests:**

```bash
npm run test:chunks    # Chunk logic validation
npm run test:pipeline  # Pre-flight checks
npm run test:filters   # Filter verification
```

**All tests are read-only** - they validate existing data without modifying anything.

## Testing and Validation

### Filter Verification

Run test filtering to ensure quality filters work:

```bash
npm run test:filters
```

Checks:

- ELO requirements enforced
- Time controls validated
- Title requirements (for Lichess)
- Variant detection

### Index Integrity

After building indexes, verify:

- All game indexes in range [0, totalGames)
- No broken references
- `ecoJsonFen` populated for all games
- Chunk sizes reasonable (<5 MB)

### Deduplication Check

```bash
# Count unique hashes vs total games
node -e "const idx = require('./data/indexes/deduplication-index.json'); console.log('Unique:', Object.keys(idx).length);"
```

## Integration with fensterchess

### Serverless Functions

fensterchess queries the indexes via serverless functions:

- **`queryMasterGamesByFen.js`** - Returns openings/masters for a FEN
  - Queries `opening-by-fen.json` using `ecoJsonFen` as key
  - Groups by opening, counts games, lists top masters

- **`getMasterGameMoves.js`** - Returns full PGN for a game
  - Looks up game in appropriate chunk
  - Returns move sequence for board loading

### Runtime Code (stays in fensterchess)

- `src/datasource/fetchMasterGames.ts` - API calls to serverless functions
- `src/searchPage/MasterGames.tsx` - UI components
- `src/types.ts` - Shared TypeScript interfaces

## Design Documentation

See `.github/docs/` directory for detailed design docs:

- `masterGameDatabase.md` - Original design and requirements
- `masterGameDatabasePhase0.md` - Foundation implementation
- `masterGameDatabasePhase1-3.md` - Rollout phases

**Current Phase:** Phase 1 complete (downloaded 5 masters, indexes built locally)
**Next Phase:** Phase 2 (UI integration and query optimization)
**Current Phase:** Phase 3 complete - Data now in Netlify Blobs

## Incremental Update Implementation

**Status**: Partially implemented - downloadPgnmentor.ts demonstrates the pattern.

**Architecture** - Site-specific scripts run independently:

- ✅ `downloadPgnmentor.ts` - Downloads from pgnmentor.com (250 player files)
- ⏳ `downloadLichess.ts` - Downloads Lichess Elite monthly archives (TODO)
- ⏳ `downloadTWIC.ts` - Downloads The Week in Chess archives (TODO)

**Workflow Steps**:

1. **Backup existing data** - Download all blobs to `backups/<date>/`
2. **Download new games** - Site-specific script with throttling
3. **Filter and deduplicate** - Check against existing game hashes
4. **Build incremental indexes** - Append to existing data
5. **Review changes** - Show diff summary ("+150 games, 3 indexes modified")
6. **Upload to blobs** - Separate step with confirmation

### Backup Strategy

**Before any update:**

```bash
npm run backup  # Downloads all Netlify Blobs to backups/<YYYY-MM-DD>/
```

**Backup contents** (~26 MB):

- 10 index files (opening-by-name, chunks, etc.)
- Allows rollback if update fails
- Timestamped for audit trail

**Alternative**: Only backup indexes being modified (smaller, faster)

### Incremental Game IDs

**Strategy**: Continue from max existing game ID

```typescript
// Load existing chunks from blobs
const maxExistingId = getMaxGameIdFromChunks(existingChunks);
const newGameStartId = maxExistingId + 1;

// Assign IDs to new games
newGames.forEach((game, i) => {
  game.idx = newGameStartId + i;
});
```

**Chunking**: Add new chunks as needed (chunk-5.json, chunk-6.json, etc.)

- Keep chunks ~4000 games each
- Don't rebalance existing chunks (avoids breaking game ID → chunk mapping)

### Chunk Management Strategy

**Formula**: `chunkId = Math.floor(gameId / 4000)`

**Clean boundaries**:

- Chunk 0: games 0-3999
- Chunk 1: games 4000-7999
- Chunk 2: games 8000-11999
- Chunk 3: games 12000-15999
- Chunk 4: games 16000-19999 (currently ~3100 games, room for 900 more)
- Chunk 5: games 20000+ (new)

**Incremental update algorithm**:

```typescript
// Given max existing game ID = 19000
const maxExistingId = 19000;
const newGameStartId = maxExistingId + 1; // = 19001

// Assign IDs to new games
newGames.forEach((game, i) => {
  game.idx = newGameStartId + i;
  game.chunkId = Math.floor(game.idx / 4000);
});

// Group new games by chunk
const gamesByChunk = groupBy(newGames, "chunkId");
// Result: { 4: [150 games], 5: [50 games] }

// Load only affected chunks from blobs
for (const [chunkId, games] of Object.entries(gamesByChunk)) {
  const chunk = await loadChunkFromBlobs(chunkId); // or create new if doesn't exist
  chunk.games.push(...games);
  chunk.games.sort((a, b) => a.idx - b.idx); // keep sorted by game ID
  await saveChunkToBlobs(chunkId, chunk);
}
```

**Benefits**:

- Formula maintains clean boundaries
- Chunks naturally stay ~4000 games
- No rebalancing needed
- Game ID → chunk lookup always works: `Math.floor(gameId / 4000)`
- Only update chunks that receive new games

**Edge case handling**:

- Chunk 4 has 3100 games → can accept 900 more before chunk 5
- Add 200 games → all go in chunk 4 (still under 4000)
- Add 1000 games → 900 in chunk 4, 100 in chunk 5
- Clean and predictable

### Source Tracking (Already Implemented)

**Two-level update detection strategy:**

1. **Page-level check** (1 HEAD request):
   - Check `/files.html` Last-Modified header
   - Compare with `lastPageVisit` from tracking file
   - If page unchanged → skip all processing (early exit)
   - If page modified → proceed to file-level checks

2. **File-level checks** (250 HEAD requests, only if page changed):
   - Batch check all ZIP files using concurrent HEAD requests
   - Compare each file's Last-Modified with `lastPageVisit` time
   - Download only files modified after last page visit

**Track state** in `source-tracking.json` (multi-site structure):

```json
{
  "pgnmentor": {
    "lastPageVisit": "2024-12-20T14:22:00Z",
    "files": {
      "Carlsen.zip": {
        "filename": "Carlsen.zip",
        "url": "https://pgnmentor.com/players/Carlsen.zip",
        "downloadDate": "2024-12-20T14:22:00Z",
        "lastModified": "2024-12-15T10:00:00Z",
        "etag": "\"abc123...\"",
        "gameCount": 3845
      }
    }
  },
  "lichess": {
    "lastPageVisit": "2024-12-22T10:00:00Z",
    "files": {
      "lichess_elite_2024-12.pgn.zst": {
        "filename": "lichess_elite_2024-12.pgn.zst",
        "url": "https://database.lichess.org/elite/lichess_elite_2024-12.pgn.zst",
        "downloadDate": "2024-12-22T10:15:00Z",
        "lastModified": "2024-12-01T00:00:00Z",
        "gameCount": 4521
      }
    }
  }
}
```

**Key insight**: File metadata is for audit/record-keeping. The decision to download is based purely on:
- Page Last-Modified vs lastPageVisit (page changed?)
- File Last-Modified vs lastPageVisit (file changed?)

### Throttling (Already Implemented)

**Rate limits per site**:

- pgnmentor.com: 1 request / 2 seconds between downloads (conservative)
- Lichess: 2 requests / second (documented rate limit)
- TWIC: 1 request / 2 seconds (TBD based on site)

**HEAD request strategy**:

- **Page check**: 1 HEAD request to `/files.html` (every run)
- **File checks**: 250 concurrent HEAD requests (only if page changed)
- Uses k6-style batch pattern: `Promise.all()` for all files at once
- Most runs skip file checks entirely (page unchanged)

**For actual downloads** (after HEAD checks identify changed files):

```typescript
async function downloadWithThrottle(urls: string[], options) {
  for (let i = 0; i < urls.length; i++) {
    await download(urls[i]);

    // Processing time provides natural throttling (3-5 min per file)
    // Prompt checkpoints for monitoring/control
    if ((i + 1) % 5 === 0 || timeSinceStart > 30 * 60 * 1000) {
      const answer = await promptUser(
        `Downloaded ${i + 1}/${urls.length} files. Continue? [Y/n]`,
      );
      if (answer === "n") break;
    }

    // Only explicit delay if downloading many small files rapidly
    if (needsThrottling) {
      await sleep(2000);
    }
  }
}
```

**Note**: Processing each PGN file takes 3-5 minutes (parsing, filtering, hashing). This provides natural spacing between download requests for most scenarios.

### Deduplication

**Strategy**: Load existing deduplication index from blobs first

```typescript
// Load from backups/<date>/deduplication-index.json
const existingHashes = await loadDeduplicationIndex();

// Filter new games
const newUniqueGames = newGames.filter((game) => {
  const hash = hashGame(game);
  return !existingHashes[hash];
});
```

**Goal**: Avoid duplicate games across all sources

### Filter: Games in Progress

**Detection**: Result field = "\*" indicates game not finished

```typescript
function filterGame(game: ParsedGame): boolean {
  // ... existing filters ...

  // Exclude games in progress
  if (game.headers.Result === "*") {
    return false;
  }

  return true;
}
```

**Why**: In-progress games lack final result, may change later

### Upload Script with Confirmation

**Show diff before upload**:

```
=== Upload Summary ===
New games: +150
Modified indexes:
  - opening-by-name.json (+25 entries)
  - chunk-5.json (new file, 150 games)
  - game-to-players.json (+150 entries)

Total changes: 3 files, 150 games added

Continue with upload? [y/N]
```

**Confirmation required**: Prevents accidental overwrites

### Migration Tasks

**Completed**:

- [x] Create downloadPgnmentor.ts for pgnmentor.com (250 player files)
- [x] Implement full pipeline: discover → download → parse → chunk
- [x] Load existing chunks and find max game ID for incremental updates
- [x] Hybrid index strategy: deduplication incremental, others batch
- [x] Create test/ directory with chunk and pipeline tests
- [x] Document indelible data principles
- [x] Document GameIndex direct usage pattern

**TODO**:

- [ ] Implement backup script (download all blobs)
- [ ] Implement batch HEAD requests (HTTP Multipart) in downloadPgnmentor.ts
- [ ] Add diff/summary to upload script
- [ ] Implement upload confirmation prompt
- [ ] Add games-in-progress filter to filterGame.ts
- [ ] Add downloadLichess.ts for Lichess Elite monthly archives
- [ ] Add downloadTWIC.ts for The Week in Chess
- [ ] Document TWIC filtering strategy
- [ ] Test full download flow with live pgnmentor.com
- [ ] Update data pipeline diagram in README

## Common Pitfalls

1. **Opening FEN confusion** - Always use `ecoJsonFen` from GameMetadata to query `opening-by-fen.json`, NOT the current position's FEN
2. **Title requirements** - Lichess Elite requires BOTH players to have FIDE titles, not just one
3. **GameIndex usage** - Use metadata objects directly with `shouldImportGame()`, don't create full Game objects for filtering
4. **Chunk size** - Keep chunks under 5 MB for Netlify Blobs (4000 games per chunk)
5. **Source tracking** - Always update tracking files when adding new data
6. **Deduplication** - Update deduplication-index.json incrementally during download
7. **Indelible data** - Never change game IDs, hashes, or chunk assignments

## Development Workflow

1. **Add new data source:**
   - Update `downloadMasterGames.ts` with new download logic
   - Add site-specific filter in `filterGame.ts`
   - Update `source-tracking.json` with new source metadata

2. **Rebuild indexes:**
   - Run `npm run build-indexes`
   - Verify integrity
   - Test queries locally

3. **Upload to Netlify Blobs:**
   - Set `NETLIFY_BLOB_STORE_API_KEY`
   - Run upload script
   - Verify serverless functions can query

4. **Update fensterchess:**
   - If interfaces changed, update TypeScript types
   - Update serverless functions if query logic changed
   - Test UI integration

## Version Strategy

Use semantic versioning for data releases:

- **Major (x.0.0)** - Breaking changes to index structure or GameMetadata format
- **Minor (1.x.0)** - New data sources, additional fields (backward compatible)
- **Patch (1.0.x)** - Game updates, bug fixes, no schema changes

Tag releases in git and document in `CHANGELOG.md`.

## Future Enhancements

- [x] Automate monthly Lichess Elite downloads (see Planned Refactor)
- [ ] Add The Week in Chess (TWIC) as data source (see Migration Tasks)
- [ ] Expand to more pgnmentor masters
- [ ] Add opening repertoire analysis
- [ ] Player vs player statistics
- [ ] Time control distribution analysis
- [ ] Result prediction based on opening choice
- [ ] Automatic backup retention policy (keep last N days)

## Questions?

For issues or feature requests, use the [Issues](https://github.com/JeffML/fensterchess.tooling/issues) tab or open a [Discussion](https://github.com/JeffML/fensterchess.tooling/discussions).
