# fensterchess.tooling TODO List

## Technical Debt & Future Migrations

### 🔴 HIGH PRIORITY - Migrate fromToPositionIndexed.json generation to eco.json.tooling

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

**Blocked by:**  
- eco.json.tooling repository doesn't exist yet
- Need to establish eco.json data maintenance workflow

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
- [ ] Implement batch HEAD requests (HTTP Multipart) in downloadPgnmentor.ts
- [ ] Add downloadLichess.ts for Lichess Elite monthly archives
- [ ] Add downloadTWIC.ts for The Week in Chess
- [ ] Document TWIC filtering strategy

### Workflow Improvements
- [ ] Add diff/summary to upload script
- [ ] Implement upload confirmation prompt
- [ ] Add games-in-progress filter to filterGame.ts

### Testing & Validation
- [ ] Test full download flow with live pgnmentor.com
- [ ] Update data pipeline diagram in README

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
