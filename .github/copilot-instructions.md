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

- **`downloadMasterGames.ts`** - Downloads PGN files from pgnmentor.com and Lichess Elite
- **`buildIndexes.ts`** - Generates all search indexes from processed games
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

### Download Latest Games

```bash
npm run download
# or
tsx scripts/downloadMasterGames.ts
```

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
tsx scripts/testFiltering.js
```

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

## Planned Refactor: Incremental Updates

**Goal**: Refactor scripts to support incremental game additions without full rebuilds.

### New Architecture

**Site-Specific Scripts** (run independently):
- `downloadPgnmentor.ts` - Downloads from pgnmentor.com (5 masters)
- `downloadLichess.ts` - Downloads Lichess Elite monthly archives
- `downloadTWIC.ts` - Downloads The Week in Chess archives (TODO)

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

### Source Tracking (Already Implemented)

**Track downloaded files** in `source-tracking.json`:
```json
{
  "pgnmentor": {
    "Carlsen": {
      "url": "https://pgnmentor.com/players/Carlsen.zip",
      "etag": "abc123...",
      "lastModified": "2024-12-15T10:30:00Z",
      "localFile": "data/pgn-downloads/Carlsen.zip",
      "downloadDate": "2024-12-20T14:22:00Z",
      "gameCount": 3845
    }
  },
  "lichess": { /* similar */ }
}
```

**Update detection**:
- Make HEAD request to check ETag/Last-Modified
- Only download if changed
- Update source-tracking.json after successful download

### Throttling (Already Implemented)

**Rate limits per site**:
- pgnmentor.com: 1 request / 2 seconds (conservative)
- Lichess: 2 requests / second (documented rate limit)
- TWIC: 1 request / 2 seconds (TBD based on site)

**Implementation**:
```typescript
async function downloadWithThrottle(urls: string[], delayMs: number) {
  for (const url of urls) {
    await download(url);
    await sleep(delayMs);
  }
}
```

### Deduplication

**Strategy**: Load existing deduplication index from blobs first
```typescript
// Load from backups/<date>/deduplication-index.json
const existingHashes = await loadDeduplicationIndex();

// Filter new games
const newUniqueGames = newGames.filter(game => {
  const hash = hashGame(game);
  return !existingHashes[hash];
});
```

**Goal**: Avoid duplicate games across all sources

### Filter: Games in Progress

**Detection**: Result field = "*" indicates game not finished
```typescript
function filterGame(game: ParsedGame): boolean {
  // ... existing filters ...
  
  // Exclude games in progress
  if (game.headers.Result === '*') {
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

**TODO**:
- [ ] Refactor downloadMasterGames.ts → 3 site-specific scripts
- [ ] Implement backup script (download all blobs)
- [ ] Modify buildIndexes.ts for incremental mode
- [ ] Add diff/summary to upload script
- [ ] Implement upload confirmation prompt
- [ ] Add games-in-progress filter to filterGame.ts
- [ ] Add downloadTWIC.ts for The Week in Chess
- [ ] Document TWIC filtering strategy
- [ ] Test incremental flow end-to-end
- [ ] Update data pipeline diagram in README

## Common Pitfalls

1. **Opening FEN confusion** - Always use `ecoJsonFen` from GameMetadata to query `opening-by-fen.json`, NOT the current position's FEN
2. **Title requirements** - Lichess Elite requires BOTH players to have FIDE titles, not just one
3. **Manual parsing** - Don't use `loadPgn()` for bulk processing; parse SAN manually for performance
4. **Chunk size** - Keep chunks under 5 MB for Netlify Blobs
5. **Source tracking** - Always update `source-tracking.json` when adding new data
6. **Deduplication** - Run hash check before merging new games to avoid duplicates

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
