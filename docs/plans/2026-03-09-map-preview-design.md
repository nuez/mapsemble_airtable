# Map Preview Dialog - Design

## Overview

Show the Mapsemble map inside the Airtable block via an iframe embed, triggered from the HomeScreen. Uses the Airtable viewport fullscreen API to maximize available space.

## Approach

Embed the map using Mapsemble's iframe-friendly embed URL (derived from `mapUrl` by appending `/embed`). If the iframe is blocked by CSP in production, a visible "Open in Mapsemble" link serves as a fallback.

## UI Trigger

A "Preview" button on each map card in HomeScreen, alongside the existing Sync/Modify/Webhook buttons. Disabled when the map is missing from Mapsemble.

## MapPreview Component

New component: `frontend/components/MapPreview.jsx`

**Behavior:**
- On open: calls `viewport.enterFullscreenIfPossible()` to expand the block panel
- On close: calls `viewport.exitFullscreen()` and returns to HomeScreen

**Layout:**
- Full-size overlay with backdrop (same pattern as Setup/Webhook modals)
- Header bar: map name, "Open in Mapsemble" link (new tab), Close button
- Body: `<iframe src="{mapUrl}/embed">` filling remaining height
- Fallback text if iframe fails to load

## Data Flow

1. HomeScreen receives `onPreview` callback prop
2. HomeScreen calls `onPreview(mapUrl, mapLabel)` on button click
3. MapsembleApp (index.js) manages `previewModal` state (`{ mapUrl, mapLabel }` or `null`)
4. When set, renders MapPreview in the modal overlay slot
5. MapPreview derives embed URL: `${mapUrl}/embed`

No new API calls, service functions, or config storage needed.

## File Changes

| File | Change |
|------|--------|
| `frontend/components/MapPreview.jsx` | New. ~40 lines. Overlay with iframe, header, fallback, fullscreen management. |
| `frontend/components/HomeScreen.jsx` | Add `onPreview` prop. Add "Preview" button to each map card. |
| `frontend/index.js` | Add `previewModal` state. Pass `onPreview` to HomeScreen. Render MapPreview. |

No new dependencies. No config changes.
