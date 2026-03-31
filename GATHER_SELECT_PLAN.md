# Gather-Then-Select: GPU Connection Search Redesign

## Context

The GPU connection search has a "drag" problem: fast-moving particles trail old connections behind them because the hash table persists across frames. Old connections get auto-renewed without competing against closer neighbors. On CPU, `connCount` resets to zero every search frame and sequential grid iteration means closer neighbors naturally claim slots first. The GPU has no such ordering.

**Root cause:** The hash table acts as memory. ConnSearch finds an existing hash entry and renews it — the connection never has to re-earn its slot. On CPU, every connection must be re-found from scratch each search frame, and close neighbors win due to sequential grid iteration order.

**Solution:** Two-pass "gather then select" — the standard GPU pattern for neighbor search with distance priority.

---

## How It Works

### Pass 1: connGather
Same grid iteration as current connSearch, but:
- NO MAX_CONN check (gather ALL candidates)
- NO hash table access
- NO free list allocation
- Just writes each found pair to both particles' candidate lists
- Caps at MAX_CANDIDATES (8) per particle

### Pass 2: connSelect
Per-particle thread:
1. Load its candidates (up to 8)
2. Sort by distance (insertion sort — 8 elements, trivial)
3. Take the closest MAX_CONN (typically 3)
4. For each winner: hash lookup → update existing OR allocate new connection
5. Losers (connections not in anyone's top-MAX_CONN) keep tgt=0 from connFade and fade out

### Why This Fixes Drag
- connFade sets tgt=0 for all state==1 connections on search frames (existing behavior)
- connSelect only re-activates the CLOSEST MAX_CONN per particle
- Far connections that used to get auto-renewed are now competing against closer ones
- If a far connection isn't in either particle's top-3, it stays at tgt=0 and fades out
- This exactly mirrors the CPU behavior where close neighbors claim slots first

---

## Toggle

"GatherSel:" checkbox on debugConnRow. When OFF, uses the old connSearch (single pass). When ON, uses connGather + connSelect (two pass). Both can be compared live.

---

## New Shader Code

### connGather (replaces grid iteration from connSearch)

```
Same grid 3x3 neighbor iteration as connSearch
For each valid pair (i, j) within CONN_REACH:
  Compute targetAlpha (same bucket + edge fade logic)
  Write candidate to particle i's list: atomicAdd candCount[i], store j/d2/alpha
  Write candidate to particle j's list: atomicAdd candCount[j], store i/d2/alpha
  Cap at MAX_CAND per particle (skip if full)
```

No atomics on connCount, no hash table, no free list. Pure gather.

### connSelect (new pass)

```
For each particle i:
  Load candidates[0..count-1]
  Insertion sort by d2 ascending
  For k = 0 to min(count, MAX_CONN):
    Hash lookup for this pair
    If found: update tgt + state=3 (same as current connSearch)
    If not found: allocate from free list, init connection, insert hash (same as current)
    Increment neighborCount[i]
```

### gridClear extension

Add `atomicStore(&candCount[i], 0u)` alongside the existing neighborCount reset.

---

## Buffer Layout

### Candidate data — merged into existing buffers (no new bindings needed for packed)

**Packed tier:** Extend `auxPool` buffer:
```
[0 .. 29999]                          connFreeList (existing)
[30000 .. 30000+P-1]                  neighborCount (existing)
[30000+P .. 30000+2P-1]               candCount (NEW)
[30000+2P .. 30000+2P+8P-1]           candOther (NEW, u32 indices)
[30000+2P+8P .. 30000+2P+16P-1]       candD2 (NEW, f32 as u32 via bitcast)
[30000+2P+16P .. 30000+2P+24P-1]      candAlpha (NEW, f32 as u32 via bitcast)
```

**Enhanced tier:** New `gpuCandidateData` buffer (1 new binding in group 1):
```
[0 .. P-1]             candCount
[P .. P+8P-1]          candOther
[P+8P .. P+16P-1]      candD2
[P+16P .. P+24P-1]     candAlpha
```

### Memory cost
~100 bytes per particle. For 1000 particles = 100 KB. Negligible vs the 1.4 MB connPool.

---

## Dispatch Order Change

Current (search frames):
1. gridClear → gridCount → gridPrefixSum → gridScatter
2. buildFreeList
3. **connSearch**
4. connFade → writeIndirect

New (when GatherSel ON):
1. gridClear (+ zero candCount) → gridCount → gridPrefixSum → gridScatter
2. buildFreeList
3. **connGather** (replaces connSearch)
4. **connSelect** (new pass)
5. connFade → writeIndirect

When GatherSel OFF: old connSearch path, unchanged.

---

## What Stays the Same

- **connFade**: Completely unchanged. Its state machine already handles "unfound connections fade out" perfectly.
- **Hash table + tombstone logic**: Reused as-is in connSelect.
- **Free list allocation**: Same pattern, just moved from connSearch to connSelect.
- **Connection struct**: No changes.
- **Render pipeline**: No changes.
- **writeIndirect**: No changes.

---

## Implementation Steps

### Step 1: Add candidate buffer infrastructure
- Add `GATHER_SELECT` localStorage variable and toggle checkbox
- Add `MAX_CAND = 8` constant
- Extend `auxPool` size (packed) / create `gpuCandidateData` buffer (enhanced)
- Add binding for enhanced tier (group 1, binding 4)
- Add shader offset constants (CCNT_OFF, COTHER_OFF, CD2_OFF, CALPHA_OFF)

### Step 2: Write connGather shader (both tiers)
- Copy grid iteration from connSearch
- Strip out hash table, free list, connCount logic
- Write candidates to buffer instead
- Add `connGather` entry point

### Step 3: Extend gridClear to zero candCount
- Add `atomicStore(&candCount[i], 0u)` in gridClear (both tiers)

### Step 4: Write connSelect shader (both tiers)
- Load + sort candidates per particle
- Hash lookup/insert logic (copied from connSearch)
- Free list allocation (copied from connSearch)
- neighborCount increment

### Step 5: Create pipelines + update dispatch
- Add `connGather` and `connSelect` to pipeline creation
- Add GATHER_SELECT conditional in dispatch code
- Keep old connSearch path for toggle comparison

### Step 6: Clean up eviction code
- The connEvict logic in connFade becomes unnecessary with gather-select
- Keep it gated behind connDrag for now, can clean up later

---

## Key Files

All changes in `/Users/robertalexander/GitHub/explorations/sonara/js/visuals.js`:

| Lines (approx) | What |
|------|------|
| ~154 | Add GATHER_SELECT variable |
| ~340 | Add to settings JSON |
| ~637 | Add GatherSel checkbox to HUD |
| ~2095 | Add candidate offset constants (packed shader) |
| ~2147 | Extend gridClear to zero candCount (packed) |
| ~2215 | Add connGather entry point (packed) |
| ~2330 | Add connSelect entry point (packed) |
| ~2490 | Add candidate offset constants (enhanced shader) |
| ~2552 | Extend gridClear (enhanced) |
| ~2620 | Add connGather (enhanced) |
| ~2735 | Add connSelect (enhanced) |
| ~3155 | Update enhanced bind group layout (add binding 4) |
| ~3190 | Add connGather + connSelect pipelines |
| ~3380 | Extend auxPool size / create candidate buffer |
| ~3430 | Update enhanced bind group |
| ~4200 | Add GATHER_SELECT dispatch conditional |

---

## Verification

1. Load localhost:3333, open debug HUD
2. GatherSel OFF: verify identical to current behavior
3. GatherSel ON: fast particles should release far connections and pick up close ones
4. Toggle back and forth to compare
5. Check connection count stays stable
6. Test with SuperConn on/off, different Conn values (2, 3, 5)
