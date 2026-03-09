# Map Preview Dialog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the Mapsemble map inside the Airtable block via an iframe embed dialog, triggered from the HomeScreen with fullscreen viewport.

**Architecture:** A new MapPreview component renders a fullscreen overlay with an iframe pointing to `{mapUrl}/embed`. HomeScreen gets a Preview button per map card. MapsembleApp orchestrates the modal state.

**Tech Stack:** React 16, Airtable Blocks SDK (`useViewport`, `Box`, `Text`, `Button`, `Link`), iframe embed

---

### Task 1: Create MapPreview component

**Files:**
- Create: `frontend/components/MapPreview.jsx`

**Step 1: Create the component file**

```jsx
import React, { useEffect, useState } from 'react';
import { useViewport, Box, Text, Button, Link } from '@airtable/blocks/ui';

export default function MapPreview({ mapUrl, mapLabel, onClose }) {
    const viewport = useViewport();
    const [iframeError, setIframeError] = useState(false);
    const embedUrl = `${mapUrl}/embed`;

    useEffect(() => {
        viewport.enterFullscreenIfPossible();
        return () => {
            if (viewport.isFullscreen) {
                viewport.exitFullscreen();
            }
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <Box
            position="absolute"
            top={0}
            left={0}
            right={0}
            bottom={0}
            display="flex"
            flexDirection="column"
            style={{ backgroundColor: '#fff', zIndex: 100 }}
        >
            {/* Header */}
            <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                paddingX={3}
                paddingY={2}
                borderBottom="default"
                flexShrink={0}
            >
                <Text fontWeight="strong" className="truncate" style={{ flex: 1, minWidth: 0 }}>
                    {mapLabel || 'Map Preview'}
                </Text>
                <Box display="flex" alignItems="center" className="gap-2 shrink-0 ml-2">
                    <Link
                        href={mapUrl}
                        target="_blank"
                        rel="noreferrer"
                        size="small"
                    >
                        Open in Mapsemble
                    </Link>
                    <Button onClick={onClose} variant="default" size="small">
                        Close
                    </Button>
                </Box>
            </Box>

            {/* Iframe body */}
            <Box flex="auto" padding={0} style={{ position: 'relative' }}>
                {iframeError ? (
                    <Box
                        display="flex"
                        flexDirection="column"
                        alignItems="center"
                        justifyContent="center"
                        height="100%"
                        padding={3}
                    >
                        <Text size="large" className="text-gray-500 mb-2">
                            Preview unavailable
                        </Text>
                        <Link href={mapUrl} target="_blank" rel="noreferrer">
                            Open in Mapsemble instead
                        </Link>
                    </Box>
                ) : (
                    <iframe
                        src={embedUrl}
                        title={mapLabel || 'Map Preview'}
                        style={{
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                        }}
                        onError={() => setIframeError(true)}
                    />
                )}
            </Box>
        </Box>
    );
}
```

**Step 2: Verify no syntax errors**

Run: `ESLINT_USE_FLAT_CONFIG=false npx eslint frontend/components/MapPreview.jsx`
Expected: No errors (warnings about exhaustive-deps are acceptable)

**Step 3: Commit**

```bash
git add frontend/components/MapPreview.jsx
git commit -m "feat: add MapPreview component with iframe embed and fullscreen"
```

---

### Task 2: Add Preview button to HomeScreen

**Files:**
- Modify: `frontend/components/HomeScreen.jsx`

**Step 1: Add `onPreview` to the component props**

In `HomeScreen.jsx`, add `onPreview` to the destructured props on line 22:

```jsx
export default function HomeScreen({ onCreateNew, onSync, onModify, onWebhook, onPreview, showResyncNotice, onDismissResyncNotice }) {
```

**Step 2: Add the Preview button to each map card**

In the button group (inside `<Box display="flex" className="gap-1.5 shrink-0">`), add a Preview button before the Sync button. Find this block around line 161-185:

```jsx
<Box display="flex" className="gap-1.5 shrink-0">
    <Button
        onClick={() => onPreview(map.mapUrl, map.mapLabel || map.mapId)}
        variant="default"
        size="small"
        disabled={missingMapIds.has(map.mapId) || !map.mapUrl}
    >
        Preview
    </Button>
    <Button
        onClick={() => onSync(activeTableId, map.mapId)}
        ...existing Sync button...
```

The Preview button is disabled when the map is missing OR has no `mapUrl`.

**Step 3: Verify no lint errors**

Run: `ESLINT_USE_FLAT_CONFIG=false npx eslint frontend/components/HomeScreen.jsx`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/components/HomeScreen.jsx
git commit -m "feat: add Preview button to HomeScreen map cards"
```

---

### Task 3: Wire up MapPreview in MapsembleApp

**Files:**
- Modify: `frontend/index.js`

**Step 1: Add the MapPreview import**

At the top of `index.js`, after the existing component imports (around line 14), add:

```jsx
import MapPreview from './components/MapPreview';
```

**Step 2: Add previewModal state**

In the `MapsembleApp` function, after the `webhookModal` state declaration (line 190), add:

```jsx
const [previewModal, setPreviewModal] = useState(null); // null | { mapUrl, mapLabel }
```

**Step 3: Pass onPreview to HomeScreen**

Find the `<HomeScreen` render (around line 506) and add the `onPreview` prop:

```jsx
<HomeScreen
    onCreateNew={startCreate}
    onSync={startSync}
    onModify={startModify}
    onWebhook={onWebhook}
    onPreview={(mapUrl, mapLabel) => setPreviewModal({ mapUrl, mapLabel })}
    showResyncNotice={showResyncNotice}
    onDismissResyncNotice={() => setShowResyncNotice(false)}
/>
```

**Step 4: Render MapPreview when previewModal is set**

After the `webhookModal` render block (after line 652, before the closing `</Box>`), add:

```jsx
{previewModal && (
    <MapPreview
        mapUrl={previewModal.mapUrl}
        mapLabel={previewModal.mapLabel}
        onClose={() => setPreviewModal(null)}
    />
)}
```

**Step 5: Verify no lint errors**

Run: `ESLINT_USE_FLAT_CONFIG=false npx eslint frontend/index.js`
Expected: No errors

**Step 6: Commit**

```bash
git add frontend/index.js
git commit -m "feat: wire MapPreview modal into MapsembleApp"
```

---

### Task 4: Manual testing

**Step 1: Start the dev server**

Run: `block run`

**Step 2: Verify in Airtable**

1. Open the Airtable base with the block installed
2. Confirm a "Preview" button appears on each map card in HomeScreen
3. Click "Preview" — block should go fullscreen and show the map in an iframe
4. Verify the "Open in Mapsemble" link works (opens new tab)
5. Click "Close" — block should exit fullscreen and return to HomeScreen
6. Verify "Preview" is disabled for maps marked as missing

**Step 3: Final commit if any adjustments needed**
