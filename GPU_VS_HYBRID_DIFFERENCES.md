# GPU Render vs Hybrid: All Known Differences

Comparing two modes:
- **Hybrid** (GPU Render OFF): GPU physics + CPU connSearch + CPU connFade + WebGL line render
- **Full GPU** (GPU Render ON): GPU physics + GPU connSearch + GPU connFade + WebGPU line render

---

## 1. Connection Pool: Unlimited vs Capped

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| Storage | JS `Map()` -- no size limit | Fixed pool: `MAX_CONN_SLOTS = 4500` |
| Capacity | Grows as needed | Hard cap at 4500 connections |
| Impact | Can handle any number of connections | With 3000 particles and MAX_CONN=3, theoretical max = 4500. SuperConn or high density could exceed this, silently dropping new connections |

**Potential issue**: When free list is exhausted (`atomicSub` returns 0), new connections are silently skipped. No warning, no fallback.

---

## 2. Hash Table: No Tombstone Cleanup

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| Dedup method | `Map.set(ck, entry)` -- O(1), no collisions | Linear-probing hash table, 8192 slots, MAX_PROBE=32 |
| Cleanup | `Map.delete(ck)` -- instant | `atomicStore(slot, EMPTY)` -- leaves tombstone gaps in probe chains |
| Bulk reset | N/A | Never done (only initialized once at startup) |

**Potential issue**: Over time, deleted entries fragment the probe chains. A new connection whose hash lands in a formerly-dense region may fail to find an empty slot within 32 probes, silently dropping the connection.

---

## 3. Grid Search: Directional vs Full 3x3

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| Neighborhood | Half-sweep: `gx..gx+1` in X, `gy-1..gy+1` in Y (6 cells) | Full 3x3: `dx=-1..1, dy=-1..1` (9 cells) |
| Dedup | `jStart = ii + 1` within same cell | `j <= i` skip for all cells |
| Result | Each pair found exactly once | Each pair found exactly once |

Functionally equivalent -- both find the same pairs. Not a source of difference.

---

## 4. MAX_CONN Enforcement Timing

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| When checked | Sequential: `connCount[ai]` checked at outer loop, incremented inline | Parallel: `atomicLoad` checked per pair, `atomicAdd` after insertion |
| TOCTOU window | None (single-threaded) | Small race: two threads can both pass the check for the same particle before either increments |
| SuperConn behavior | `connCount[ai]` checked once at outer loop start (natural super-connector) | `iCountCached` read once with `atomicLoad` at kernel start |

**Potential issue**: Without SuperConn, the GPU's atomic check is TIGHTER than CPU's sequential check. The CPU allows some over-counting because `ai`'s count only gets checked at the outer loop, not re-checked per `bi`. The GPU re-checks both particles every pair. This means the GPU produces FEWER connections per particle on average.

---

## 5. Connection Target Update: Live vs Stale Positions

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| Position source | `gpuSlots[i]` -- readback from GPU, updated every frame | `pOut[i]` -- current GPU particle output buffer |
| Index tracking | Stores JS object reference (`entry.a = a`) | Stores indices (`idxA`, `idxB`) into pOut array |
| On re-found | Updates `entry.a = a, entry.b = b` (fresh reference) | Updates `idxA, idxB` (fresh indices) |

Functionally equivalent for position lookups. Not a direct source of difference.

---

## 6. Connection Fade: `doConnSearch` Scoping

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| Variable | JS `doConnSearch` bool, same scope as fade loop | `cu.doSearch` uniform, set once per frame |
| Fade timing | Search + fade run in same JS call, same frame | Search + fade are separate compute passes, same command encoder, properly ordered |

Functionally equivalent. Both mark unfound connections with target=0 on search frames only.

---

## 7. Dead Particle Handling

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| Detection | `entry.a.dead \|\| entry.b.dead` checked in fade loop | `pOut[c.idxA].flags & 1u` checked in connFade shader |
| Freeze | `entry.frozen = true`, snapshots x/y into entry | `c.state = 2u`, snapshots x/y into frozen fields |
| Wrap detection | Separate pre-pass checks for >25% position jumps, deletes immediately | `flags & 8u` check in connFade, deletes immediately |

Functionally equivalent.

---

## 8. Line Rendering: WebGL vs WebGPU

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| API | WebGL2 `gl.drawArrays(gl.LINES, ...)` | WebGPU `renderPass.drawIndirect(...)` with `topology: 'line-list'` |
| Line width | WebGL default = 1px (no explicit lineWidth set for hero lines) | WebGPU line-list = always 1px (spec does not support lineWidth > 1) |
| Canvas resolution | Same canvas: `offsetWidth * dpr` x `offsetHeight * dpr` | Same resolution (shared `w, h`) |
| Fragment shader | `fragColor = vec4(0.831*a, 0.659*a, 0.263*a, a)` | `return vec4f(0.831*a, 0.659*a, 0.263*a, a)` |
| Blend mode | `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)` | `srcFactor: 'one', dstFactor: 'one-minus-src-alpha'` |
| Upload | `gl.bufferSubData` from CPU Float32Array | Lines written directly by connFade compute shader |

Shaders and blend modes are identical. Line width is nominally the same (1px). However:

**Potential issue**: WebGL implementations commonly render `GL_LINES` with anti-aliasing that makes them appear slightly thicker than WebGPU's line-list, which varies by GPU vendor. This is implementation-defined behavior.

---

## 9. Indirect Draw: Line Count Accuracy

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| Line count | `lineVertCount = lineIdx / 3` -- exact, sequential | `atomicAdd(&auxCounters[0], 1u)` -- exact, but written by connFade |
| Vertex count | `lineVertCount` (verts = lines * 2) | `writeIndirect` shader reads `auxCounters[0]` and writes `vertexCount = lineCount * 2` |

Functionally equivalent.

---

## 10. Hash Table: Deletion Race with Linear Probing

When connFade kills a connection, it sets the hash slot to EMPTY. But with linear probing, this can break existing probe chains:

Example:
1. Keys A, B, C hash to slots 5, 5, 5 (stored at 5, 6, 7)
2. B is killed, slot 6 set to EMPTY
3. Lookup for C starts at slot 5 (occupied by A), probes to slot 6 (EMPTY), stops -- **C not found**
4. C's connection is now orphaned in the pool but unreachable via hash lookup
5. connSearch can't find C to update it, so it creates a duplicate
6. Both old C (slowly fading) and new C (fading in) coexist

**This causes "sticky" connections**: The old entry keeps rendering with stale target alpha while the new entry fades in. You'd see ghost connections that linger longer than expected.

---

## 11. SuperConn: Atomic vs Sequential Count Caching

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| Cache point | `connCount[ai]` read at outer loop iteration | `atomicLoad(&auxPool[i + NCNT_OFF])` at kernel start |
| Freshness | Count reflects connections made by all previous outer iterations | Count reflects connections made by OTHER threads only (this thread hasn't run yet) |
| Effect | ai accumulates connections across all inner iterations freely | i accumulates connections from parallel threads, which may have already incremented its count |

The CPU SuperConn is "stickier" because the cached count stays frozen across ALL inner loop iterations. The GPU SuperConn still gets incremented by other threads between iterations. This means GPU SuperConn produces fewer super-connectors than CPU SuperConn.

---

## 12. Render Line Buffer: f16 vs f32

| | Hybrid (CPU) | Full GPU |
|---|---|---|
| Buffer type | Float32Array (always f32) | `MAX_CONN_SLOTS * 6 * (gpuHasF16 ? 2 : 4)` -- may use f16 |
| Precision | Full f32 alpha | Potentially f16 alpha (half precision) |

**Potential issue**: With f16, alpha values have ~3 decimal digits of precision. Very dim connections (alpha ~0.01) could quantize differently, affecting visual smoothness of fade-out.

---

## Summary: Most Likely Impact Sources

### Why fewer lines on GPU:
1. **Pool cap (4500)** -- silently drops connections when full
2. **Hash probe failures** -- broken chains from EMPTY tombstones cause missed lookups, creating duplicates and orphans
3. **Tighter MAX_CONN enforcement** -- atomics re-check both particles every pair (CPU only checks ai once per outer loop)

### Why connections "stick" longer on GPU:
1. **Hash chain breakage (#10)** -- orphaned connections can't be found/updated, fade slowly on their own
2. **Duplicate connections** -- same pair gets multiple pool entries, both rendering

### Why lines appear thinner on GPU:
1. **Vendor-specific line rendering** -- WebGL vs WebGPU line anti-aliasing varies
2. **f16 alpha quantization** -- may dim already-faint connections

### Why super-connectors behave differently:
1. **Parallel count caching (#11)** -- GPU threads increment each other's counts even with cached value
