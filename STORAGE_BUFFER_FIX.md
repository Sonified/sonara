# Storage Buffer Limit Fix

## Problem

WebGPU default `maxStorageBuffersPerShaderStage` = 8. Our connection shader declares 11 storage bindings across all entry points. The validation fails at pipeline layout creation -- it counts ALL declared storage bindings, not just what any single entry point uses.

### Current bindings (11 storage + 1 uniform)

```
@group(0) @binding(0)  pOut            read-only-storage
@group(0) @binding(1)  connPool        storage
@group(0) @binding(2)  hashTable       storage (atomic)
@group(0) @binding(3)  gridCounts      storage (atomic)
@group(0) @binding(4)  gridOffsets     storage
@group(0) @binding(5)  gridIndices     storage
@group(0) @binding(6)  connAtomics     storage (atomic, 2 u32s)
@group(0) @binding(7)  cu              uniform
@group(1) @binding(0)  renderLines     storage (f32)
@group(1) @binding(1)  neighborCount   storage (atomic)
@group(1) @binding(2)  lineIndirect    storage (4 u32s)
@group(1) @binding(3)  connFreeList    storage
```

### Per-entry-point usage

| Entry point    | Storage buffers used                                                              | Count |
|----------------|-----------------------------------------------------------------------------------|-------|
| gridClear      | gridCounts, gridOffsets, neighborCount                                            | 3     |
| gridCount      | pOut, gridCounts                                                                  | 2     |
| gridPrefixSum  | gridCounts, gridOffsets                                                           | 2     |
| gridScatter    | pOut, gridCounts, gridOffsets, gridIndices                                        | 4     |
| buildFreeList  | connPool, connAtomics, connFreeList                                              | 3     |
| connSearch     | pOut, connPool, hashTable, gridCounts, gridOffsets, gridIndices, connAtomics, neighborCount, connFreeList | **9** |
| connFade       | pOut, connPool, hashTable, renderLines, connAtomics                              | 5     |
| writeIndirect  | connAtomics, lineIndirect                                                        | 2     |

**connSearch is the bottleneck at 9 storage.** Even alone it exceeds the limit.

---

## Solution: Two-Tier Approach

### Base Tier (default limit, 8 storage)

Pack 6 small buffers into 3 combined buffers, reducing 11 to 8 storage bindings.

**Pack 1: `gridData`** -- merge gridCounts + gridOffsets
- Layout: `array<atomic<u32>>`, size = 512
- `[0..255]` = grid counts (atomic operations)
- `[256..511]` = grid offsets (use atomicLoad/atomicStore instead of plain read/write)

**Pack 2: `auxCounters`** -- merge connAtomics + lineIndirect
- Layout: `array<atomic<u32>>`, size = 8
- `[0]` = line count (atomic)
- `[1]` = free list count (atomic)
- `[2..5]` = indirect draw params (use atomicStore for writes, plain isn't needed since writeIndirect is the only writer)

**Pack 3: `auxPool`** -- merge connFreeList + neighborCount
- Layout: `array<atomic<u32>>`, size = MAX_CONN_SLOTS + maxParticles
- `[0..4499]` = free list entries (read via atomicLoad)
- `[4500..4500+count]` = neighbor counts (atomic operations)

### Packed bindings (8 storage + 1 uniform)

```
@group(0) @binding(0)  pOut            read-only-storage    (unchanged)
@group(0) @binding(1)  connPool        storage              (unchanged)
@group(0) @binding(2)  hashTable       storage (atomic)     (unchanged)
@group(0) @binding(3)  gridData        storage (atomic)     (PACKED: gridCounts + gridOffsets)
@group(0) @binding(4)  gridIndices     storage              (unchanged)
@group(0) @binding(5)  renderLines     storage (f32)        (unchanged)
@group(0) @binding(6)  auxCounters     storage (atomic)     (PACKED: connAtomics + lineIndirect)
@group(0) @binding(7)  auxPool         storage (atomic)     (PACKED: connFreeList + neighborCount)
@group(1) @binding(0)  cu              uniform              (moved to group 1 to keep group 0 at 8)
```

Wait -- 8 storage in one group should be fine. The limit is per-stage, not per-group. Let me reconsider:

```
@group(0) @binding(0)  pOut            read-only-storage
@group(0) @binding(1)  connPool        storage
@group(0) @binding(2)  hashTable       storage (atomic)
@group(0) @binding(3)  gridData        storage (atomic)
@group(0) @binding(4)  gridIndices     storage
@group(0) @binding(5)  renderLines     storage (f32)
@group(0) @binding(6)  auxCounters     storage (atomic)
@group(0) @binding(7)  uniform         cu: ConnUniforms
@group(0) @binding(8)  auxPool         storage (atomic)
```

That's 8 storage + 1 uniform in one group. Total per-stage storage = 8. Valid.

### Packed connSearch usage: 7 storage

| Original buffer   | Packed into    | Access pattern in connSearch                    |
|--------------------|---------------|------------------------------------------------|
| gridCounts         | gridData[i]   | `atomicLoad(&gridData[nk])`                    |
| gridOffsets        | gridData[i+256] | `atomicLoad(&gridData[nk + 256u])`           |
| connAtomics        | auxCounters   | `atomicSub(&auxCounters[1], 1u)`              |
| neighborCount      | auxPool[i+4500] | `atomicLoad(&auxPool[i + 4500u])`            |
| connFreeList       | auxPool[i]    | `atomicLoad(&auxPool[i])`                      |

Remaining direct buffers: pOut, connPool, hashTable, gridIndices = 4
Packed buffers: gridData, auxCounters, auxPool = 3
Total: **7 storage**. Under the limit.

### Shader body changes (base tier)

Each entry point needs its buffer references updated:

**gridClear:**
- `atomicStore(&gridCounts[i], 0u)` -> `atomicStore(&gridData[i], 0u)`
- `gridOffsets[i] = 0u` -> `atomicStore(&gridData[i + 256u], 0u)`
- `atomicStore(&neighborCount[i], 0u)` -> `atomicStore(&auxPool[i + ${MAX_CONN_SLOTS}u], 0u)`

**gridCount:**
- `atomicAdd(&gridCounts[ck], 1u)` -> `atomicAdd(&gridData[ck], 1u)`

**gridPrefixSum:**
- `atomicLoad(&gridCounts[i])` -> `atomicLoad(&gridData[i])`
- `gridOffsets[i] = ...` -> `atomicStore(&gridData[i + 256u], ...)`
- `atomicStore(&gridCounts[i], 0u)` -> `atomicStore(&gridData[i], 0u)`

**gridScatter:**
- `gridOffsets[ck]` -> `atomicLoad(&gridData[ck + 256u])`
- `atomicAdd(&gridCounts[ck], 1u)` -> `atomicAdd(&gridData[ck], 1u)`

**buildFreeList:**
- `atomicAdd(&connAtomics[1], 1u)` -> `atomicAdd(&auxCounters[1], 1u)`
- `connFreeList[idx] = i` -> `atomicStore(&auxPool[idx], i)`

**connSearch:**
- `atomicLoad(&gridCounts[nk])` -> `atomicLoad(&gridData[nk])`
- `gridOffsets[nk]` -> `atomicLoad(&gridData[nk + 256u])`
- `atomicLoad(&neighborCount[i])` -> `atomicLoad(&auxPool[i + ${MAX_CONN_SLOTS}u])`
- `atomicAdd(&neighborCount[i], 1u)` -> `atomicAdd(&auxPool[i + ${MAX_CONN_SLOTS}u], 1u)`
- `atomicSub(&connAtomics[1], 1u)` -> `atomicSub(&auxCounters[1], 1u)`
- `atomicAdd(&connAtomics[1], 1u)` -> `atomicAdd(&auxCounters[1], 1u)`
- `connFreeList[freeIdx - 1u]` -> `atomicLoad(&auxPool[freeIdx - 1u])`

**connFade:**
- `atomicAdd(&connAtomics[0], 1u)` -> `atomicAdd(&auxCounters[0], 1u)`

**writeIndirect:**
- `atomicLoad(&connAtomics[0])` -> `atomicLoad(&auxCounters[0])`
- `lineIndirect[i] = ...` -> `atomicStore(&auxCounters[i + 2u], ...)`

### JS-side buffer changes (base tier)

**New buffers:**
- `gpuGridData`: 512 * 4 = 2KB (replaces gpuGridCounts + gpuGridOffsets)
- `gpuAuxCounters`: 8 * 4 = 32B (replaces gpuConnAtomics + gpuLineIndirectBuf)
  - Usage: STORAGE | COPY_DST | INDIRECT (because it contains the indirect draw params)
  - `drawIndirect` offset: 8 bytes (skip the 2 atomic counter u32s)
- `gpuAuxPool`: (4500 + maxParticles) * 4 bytes (replaces gpuConnFreeList + gpuNeighborCount)

**Removed buffers:**
- gpuGridCounts, gpuGridOffsets (merged into gpuGridData)
- gpuConnAtomics, gpuLineIndirectBuf (merged into gpuAuxCounters)
- gpuConnFreeList, gpuNeighborCount (merged into gpuAuxPool)

**Bind group:** single group(0) with 9 entries (8 storage + 1 uniform)

**Atomic reset:** `writeBuffer(gpuAuxCounters, 0, new Uint32Array([0, 0]))` -- same as before, first 2 slots

**drawIndirect call:** `renderPass.drawIndirect(gpuAuxCounters, 8)` -- offset 8 bytes to skip the 2 counter u32s

**Particle render bind group:** neighborCount is now inside auxPool at offset 4500. The particle vertex shader reads neighborCount for the whiten calculation. It needs to bind auxPool and know the offset. Add a `neighborCountOffset` uniform to the render uniforms.

---

### Enhanced Tier (adapter limit >= 12)

If `adapter.limits.maxStorageBuffersPerShaderStage >= 12`:
1. Request the higher limit in `requestDevice`
2. Use the original unpacked 11-binding shader (cleaner, no offset math)
3. Create individual buffers as originally designed
4. Standard drawIndirect with dedicated lineIndirect buffer

### Detection + selection

```js
const maxStorage = adapter.limits.maxStorageBuffersPerShaderStage;
const usePackedConn = maxStorage < 12;

const device = await adapter.requestDevice({
  requiredFeatures: hasF16 ? ['shader-f16'] : [],
  requiredLimits: {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
    ...(!usePackedConn ? { maxStorageBuffersPerShaderStage: 12 } : {}),
  }
});

// Generate shader with correct bindings
const connShaderCode = makeConnWGSL(hasF16, usePackedConn);
```

### Typical GPU limits

| GPU Family       | maxStorageBuffersPerShaderStage | Tier    |
|-----------------|-------------------------------|---------|
| Apple Silicon   | 96                            | Enhanced |
| NVIDIA (Vulkan) | 8-16 (varies by driver)       | Base or Enhanced |
| AMD (Vulkan)    | 8-16 (varies)                 | Base or Enhanced |
| Intel (Vulkan)  | 8                             | Base    |

---

## Implementation Order

1. Add `usePackedConn` detection to `initWebGPU()`
2. Update `makeConnWGSL(hasF16, packed)` to generate packed or unpacked bindings + buffer references
3. Update bind group layout creation (1 group of 9 for packed, 2 groups for unpacked)
4. Update buffer creation in `createGPUBuffers()` (packed or individual)
5. Update bind group creation
6. Update `drawIndirect` call (offset 8 for packed, offset 0 for unpacked)
7. Update particle render shader to read neighborCount from auxPool when packed
8. Test both tiers
