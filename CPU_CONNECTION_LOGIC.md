# CPU Hybrid Connection Logic — Complete Reference

How connections work when GPU Render is OFF (hybrid mode: GPU physics + CPU connections + WebGL lines).

---

## Architecture

Two data structures:
- **`connFade`** — `Map<compositeKey, entry>` — lives forever, no size limit
- **`neighborCount[]`** — per-particle connection count, rebuilt from zero every search frame

An entry looks like:
```js
{ alpha, target, a, b, frozen, ax, ay, bx, by }
```
- `a`, `b` are live references to particle objects (position updates automatically)
- `alpha` = current rendered opacity
- `target` = what alpha is fading toward
- `frozen` = particle died, snapshot positions

The composite key: `ck = min(pidA, pidB) * 65536 + max(pidA, pidB)`

---

## Frame Lifecycle

### Every frame:
1. **Fade loop** runs over ALL entries in `connFade`
2. Dead particle check → freeze + set target=0
3. If this is a search frame AND entry wasn't found in search → target=0
4. Alpha moves toward target: `alpha += (target - alpha) * rate`
5. If alpha < CONN_KILL_ALPHA and target=0 → **delete entry from Map**
6. Write line vertices for rendering

### On search frames only (every CONN_SEARCH_INTERVAL frames):

#### Step 1: Build spatial grid
```
CELL = CONN_REACH
For each alive particle → grid[cellKey].push(particleIndex)
```

#### Step 2: Reset ALL neighbor counts to zero
```
neighborCount.fill(0)
```
**THIS IS KEY.** Every search frame starts fresh. No memory of previous connections.

#### Step 3: Half-sweep neighbor search
```
For each grid cell (gx, gy):
  For nx = gx to gx+1:          ← current column + right column
    For ny = gy-1 to gy+1:      ← row above, same row, row below
      Skip if (nx == gx && ny < gy)  ← avoid double-counting
```
This visits 6 cells (not 9) — equivalent to full 3x3 with dedup.

#### Step 4: For each particle pair (ai, bi) in neighboring cells:
```
if connCount[ai] >= MAX_CONN → skip ai entirely (break inner loop)
if connCount[bi] >= MAX_CONN → skip this pair (continue)
if both are burst particles → skip
compute d2 = distance squared
if d2 >= CONN_REACH_SQ → skip

// Connection is valid!
compute targetAlpha from distance bucket + edge fade
compute composite key ck

framePairs.add(ck)  ← mark as "found this frame"

if connFade.has(ck):
  update entry.target = targetAlpha
  update entry.a = a, entry.b = b  (fresh position refs)
  entry.frozen = false
else:
  create new entry { alpha: 0, target: targetAlpha, a, b }
  connFade.set(ck, entry)

connCount[ai]++
connCount[bi]++
```

#### Step 5: After search, in the fade loop:
```
if doConnSearch && !framePairs.has(ck):
  entry.target = 0  ← not found this frame, start fading out
```

---

## Why CPU Connections "Let Go" Naturally

### The critical insight: connCount resets to zero every search frame.

1. Frame N (search): particle A connects to B, C, D (MAX_CONN=3). All three are in range. connCount[A] = 3.

2. Frame N+10 (next search): connCount resets to 0. Grid rebuilds. The search iterates cells **sequentially** starting from A's cell, then right, then above-right.

3. The iteration order creates **implicit spatial priority**: particles in A's own cell and immediate neighbors get checked first. If A has moved, its NEW closest neighbors are physically in the same/adjacent cells and get checked early.

4. Say A moved and now E, F are closer than B. The search finds E first (same cell), connCount[A]→1. Finds F next (adjacent cell), connCount[A]→2. Finds G, connCount[A]→3. **A is now full.**

5. When the search reaches B (now farther away, maybe 2 cells over), `connCount[A] >= MAX_CONN` → **skip**. B is never added to framePairs.

6. In the fade loop: `!framePairs.has(ck_AB)` → `entry.target = 0` → B starts fading out.

### So the CPU doesn't "evict" — it just **forgets**.

- connCount resets to zero every search
- Sequential grid iteration fills slots with spatially-close neighbors first
- Far-away old connections simply aren't re-found because slots are already full
- Unfound connections get target=0 and fade out naturally

### The sequential iteration order is the secret sauce:
- Same cell particles → checked first
- Adjacent cells (right, above) → checked next
- This means closer particles (same/adjacent cells) naturally claim slots before farther ones
- It's not designed this way — it's an emergent property of grid iteration order

---

## Connection Lifecycle Summary

```
BORN:      search finds pair in range, creates entry with alpha=0, target=alphaValue
ALIVE:     each search frame re-finds it → updates target alpha (may change with distance)
           each frame → alpha fades toward target
NOT FOUND: search frame runs, pair not re-found → target=0
FADING:    alpha decreases toward 0 each frame
DEAD:      alpha < CONN_KILL_ALPHA → entry deleted from Map
FROZEN:    particle died → snapshot positions, target=0, fade to death
```

**Average connection lifespan when particles move apart:**
- Search frame: not re-found → target=0
- ~40-100 frames to fade below kill threshold (depends on CONN_FADE_OUT rate)
- Total: 1 search interval + fade time

**Why there's no "drag":**
- On search frame, connCount rebuilds from zero
- Close neighbors claim slots first (grid iteration order)
- Far neighbor never gets re-added → immediately starts fading
- No explicit eviction needed — the absence of re-finding IS the eviction

---

## Key Constants

| Name | Default | Purpose |
|------|---------|---------|
| CONN_REACH | 170 | Max connection distance (pixels) |
| CONN_REACH_SQ | 28900 | CONN_REACH² |
| CONN_FADE_START_SQ | ~14450 | Distance² where edge fade begins |
| CONN_BUCKET_DIV | ~5780 | CONN_REACH_SQ / 5, for alpha buckets |
| MAX_CONN | 3 | Per-particle connection limit |
| CONN_FADE_IN | 0.04 | Alpha approach rate (toward target) |
| CONN_FADE_OUT | 0.025 | Alpha approach rate (toward 0) |
| CONN_KILL_ALPHA | 0.01 | Below this → delete connection |
| CONN_SEARCH_INTERVAL | 10 | Frames between searches |
| LINE_BASE | 0.08 | Base line alpha before brightness |

---

## What the GPU Version Must Replicate

The core behavior that makes CPU connections feel "alive":

1. **Fresh count every search** — don't carry over old counts
2. **Spatial priority** — closer neighbors should win slots over farther ones
3. **Absence = death** — if search doesn't re-find a pair, it fades
4. **No memory between searches** — the Map persists but connCount doesn't

The GPU currently fails at #2: all pairs race simultaneously via atomics, so there's no distance preference. A connection at 90% of range has equal priority to one at 10%.
