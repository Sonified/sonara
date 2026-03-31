# Things to Revisit

## Storage Buffer Packing
The two-tier packed/unpacked connection shader approach works, but the packed tier has readability costs (offset arithmetic like `gridData[i + 256u]` instead of `gridOffsets[i]`) and mixed buffer usage flags. There's likely a cleaner abstraction or a way to reduce the number of distinct buffers needed in the first place — worth revisiting once the full pipeline is running and we can profile real usage patterns.
