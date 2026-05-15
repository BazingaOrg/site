# Photo HDR Strategy

## Scope

This site currently supports HDR-related work at the metadata and delivery-policy level.
It also generates standard dynamic range WebP derivatives for page delivery.
It does not yet implement true HDR-aware image rendering or browser-specific HDR format negotiation.

## Current Decision

### Asset preservation

- Preserve the originally uploaded asset.
- Generate SDR WebP derivatives for normal page delivery.
- Keep the original file extension and treat it as the source of truth.

### Metadata policy

Each photo may carry:

- `sourceFormat`
- `mimeType`
- `dynamicRange`
- `hdrCandidate`
- `assetPolicy`
- `fallbackStrategy`
- `fallbackGenerated`

This allows the frontend to explain what the browser is likely doing without pretending that HDR rendering is guaranteed.

### Frontend delivery

- Use generated derivatives in the current `<img>` flow.
- Keep the original asset available as canonical metadata and archival source.
- Use `srcset`/`sizes` for responsive delivery instead of `<picture>` format branching.
- Surface non-invasive hints in photo details instead of forcing a rendering claim the browser may not honor.

## Why This Strategy

### Stability first

Generated derivatives now live in the repository so GitHub Pages can serve them without a deployment-time image pipeline.
This keeps the static-site workflow predictable while reducing default image transfer size.

### Honest UX

The site can reliably say:

- what the source format is
- whether the asset is an HDR candidate
- what the current browser reports about display capability
- whether generated delivery variants exist

The site cannot yet reliably promise:

- that the browser is rendering full HDR
- that every device will produce the same visual result
- that generated SDR derivatives preserve HDR appearance

### Future expansion path

If the project later stores multiple formats per derivative, then `<picture>`-based delivery becomes reasonable.
Until then, one WebP derivative set plus the original asset is the least surprising behavior.

## What Would Change This Decision

The current strategy should be revisited only if at least one of these becomes true:

1. The upload pipeline gains a dependable image-processing step for HDR-to-SDR conversion.
2. The repo starts storing multiple output formats per derivative.
3. Real-device testing shows major compatibility failures for preserved HDR-candidate assets.
4. The site explicitly wants to optimize image delivery per browser instead of treating the uploaded asset as canonical.
