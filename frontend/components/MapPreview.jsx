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
