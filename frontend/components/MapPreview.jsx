import React, { useEffect, useRef, useState } from 'react';
import { useViewport, Box, Text, Button } from '@airtable/blocks/ui';
import { MAPSEMBLE_URL } from '../services/mapsemble';

export default function MapPreview({ mapId, mapLabel, onClose }) {
    const viewport = useViewport();
    const [iframeError, setIframeError] = useState(false);
    const wasFullscreen = useRef(false);
    const embedUrl = `${MAPSEMBLE_URL}/embed/${mapId}`;
    const mapUrl = `${MAPSEMBLE_URL}/map/${mapId}`;

    useEffect(() => {
        viewport.enterFullscreenIfPossible();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-close when fullscreen is exited externally (e.g. Airtable's native X)
    useEffect(() => {
        if (viewport.isFullscreen) {
            wasFullscreen.current = true;
        } else if (wasFullscreen.current) {
            wasFullscreen.current = false;
            onClose();
        }
    }, [viewport.isFullscreen]); // eslint-disable-line react-hooks/exhaustive-deps

    function handleClose() {
        if (viewport.isFullscreen) {
            viewport.exitFullscreen();
        } else {
            onClose();
        }
    }

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
                    <Text size="small" className="text-gray-400 hidden sm:block">
                        Style cards, popups &amp; markers · Add filters
                    </Text>
                    <Button
                        onClick={() => window.open(mapUrl, '_blank', 'noreferrer')}
                        variant="primary"
                        size="small"
                    >
                        <Box display="flex" alignItems="center" className="gap-1">
                            Customize in Mapsemble
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M7 17L17 7"/>
                                <path d="M7 7h10v10"/>
                            </svg>
                        </Box>
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
                        <Button
                            onClick={() => window.open(mapUrl, '_blank', 'noreferrer')}
                            variant="default"
                            size="small"
                        >
                            Open in Mapsemble instead
                        </Button>
                    </Box>
                ) : (
                    <iframe
                        src={embedUrl}
                        title={mapLabel || 'Map Preview'}
                        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
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
