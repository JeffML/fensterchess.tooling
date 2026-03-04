# fensterchess.tooling TODO List

## Documentation Direction

- [x] Keep web workflow UI as the primary operator path (`npm run workflow` → http://localhost:3030)
- [x] Keep README focused on workflow page behavior and troubleshooting
- [ ] Add a short `ARCHITECTURE.md` for deeper script internals and repository boundaries

## Technical Debt & Future Migrations

### ✅ DONE - Migrate fromToPositionIndexed.json generation to eco.json.tooling

**Current State:**  
`scripts/generateFromToIndex.ts` downloads fromTo.json from eco.json GitHub and transforms it to fromToPositionIndexed.json for fensterchess consumption.

**Why this is temporary:**

- eco.json data transformations should live in eco.json.tooling (correct architectural home)
- fensterchess.tooling should only process master games data
- This creates coupling to eco.json that shouldn't exist

**Migration Plan:**

1. Set up eco.json.tooling repository (following pattern from fensterchess.tooling)
2. Move `generateFromToIndex.ts` to eco.json.tooling
3. Have eco.json.tooling commit fromToPositionIndexed.json to eco.json repo
4. **Remove committed file from fensterchess repo** (fensterchess/data/fromToPositionIndexed.json)
5. Remove generation script from fensterchess.tooling
6. Update fensterchess serverless functions to remove local file fallback

**Completed:**

- eco.json.tooling repository created and cloned locally
- `fromToPositionIndexed.js` already existed in eco.json.tooling (using hayatbiralem source)
- Added `generate:fromto` npm script to eco.json.tooling
- Removed `generate:fromto` script and `generateFromToIndex.ts` from fensterchess.tooling
- Removed `data/fromToPositionIndexed.json` from fensterchess bundle
- Removed local file fallback from `getFromTosForFen.js`

**Impact if not done:**

- Architectural confusion (eco.json transformations in wrong repo)
- Duplicate effort if eco.json.tooling later generates the same file
- Harder to maintain as data evolves

**Related Files:**

- `scripts/generateFromToIndex.ts` - The script to migrate
- `fensterchess/netlify/functions/getFromTosForFen.js` - Consumer of the data
- eco.json GitHub: https://github.com/JeffML/eco.json

---

## Future Enhancements

### Download Infrastructure

- [ ] Add downloadLichess.ts for Lichess Elite monthly archives
- [ ] Add downloadTWIC.ts for The Week in Chess
- [ ] Document TWIC filtering strategy

### Workflow Improvements

- [x] Add diff/summary to upload script
- [x] Implement upload confirmation prompt
- [x] Add games-in-progress filter to filterGame.ts
- [ ] **Incremental index merging**: `buildIndexes` currently rebuilds all search indexes from all chunks on every run. When production indexes are current (e.g. after a restore), only new games need to be merged in. Load existing local indexes, enrich only unenriched games, merge new game contributions into each index, write back only changed index files. Avoids full rescan of 45K+ games when only a few hundred new games were added.

### Testing & Validation

- [x] Test full download flow with live pgnmentor.com
- [x] Update data pipeline diagram in README

### Documentation

- [ ] Create ARCHITECTURE.md explaining repository purpose and boundaries
- [ ] Document relationship with eco.json and fensterchess repositories

---

## Completed

- [x] Create downloadPgnmentor.ts for pgnmentor.com (250 player files)
- [x] Implement full pipeline: discover → download → parse → chunk
- [x] Load existing chunks and find max game ID for incremental updates
- [x] Hybrid index strategy: deduplication incremental, others batch
- [x] Create test/ directory with chunk and pipeline tests
- [x] Document indelible data principles
- [x] Document GameIndex direct usage pattern
- [x] Migrate to Netlify Blobs (complete)
- [x] Create workflow UI with SSE streaming
