# Photo HDR Strategy

## Scope

This site currently supports HDR-related work at the metadata and delivery-policy level.
It does not yet implement true HDR-aware image rendering, browser-specific format negotiation, or generated SDR derivatives.

## Current Decision

### Asset preservation

- Preserve the originally uploaded asset.
- Do not auto-generate SDR fallback files during upload.
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

- Use the original asset in the current `<img>` flow.
- Do not introduce `<picture>`-based format branching until the repo has more than one concrete asset variant for the same photo.
- Surface non-invasive hints in photo details instead of forcing a rendering claim the browser may not honor.

## Why This Strategy

### Stability first

Generating SDR fallbacks would require a reliable image-processing step, format-specific tooling, and clear quality rules.
That is outside the current static-site workflow and would add more operational risk than value right now.

### Honest UX

The site can reliably say:

- what the source format is
- whether the asset is an HDR candidate
- what the current browser reports about display capability
- whether a fallback exists

The site cannot yet reliably promise:

- that the browser is rendering full HDR
- that every device will produce the same visual result
- that a hidden SDR derivative exists

### Future expansion path

If the project later adds generated variants, then `<picture>`-based delivery becomes reasonable.
Until then, a single original asset plus clear metadata is the least surprising behavior.

## What Would Change This Decision

The current strategy should be revisited only if at least one of these becomes true:

1. The upload pipeline gains a dependable image-processing step for HDR-to-SDR conversion.
2. The repo starts storing multiple render variants per photo.
3. Real-device testing shows major compatibility failures for preserved HDR-candidate assets.
4. The site explicitly wants to optimize image delivery per browser instead of treating the uploaded asset as canonical.
