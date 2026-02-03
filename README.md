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

# Download latest games
npm run download

# Build indexes
npm run build-indexes

# Test filters
npm run test:filters
```

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
- **chunk-*.json** - Game data split into 4000-game chunks (~4 MB each)

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
```

Get the API key from the Netlify project dashboard.

## Scripts

- **`downloadMasterGames.ts`** - Download PGN files from sources
- **`buildIndexes.ts`** - Generate all search indexes
- **`filterGame.ts`** - Quality filtering logic
- **`hashGame.ts`** - Game deduplication hashing
- **`types.ts`** - TypeScript interfaces

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

**Phase 3:** Planned
- Upload to Netlify Blobs
- Remove bundled JSON from fensterchess
- Automated monthly Lichess Elite downloads

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Related Projects

- [fensterchess](https://github.com/JeffML/fensterchess) - Main application
- [chessPGN](https://github.com/JeffML/chessPGN) - Chess library for parsing
- [eco.json](https://github.com/JeffML/eco.json) - Opening database
