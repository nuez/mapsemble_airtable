import React, { useState, useEffect } from 'react';
import {
    useBase,
    useCursor,
    useGlobalConfig,
    Box,
    Text,
    Button,
    Link,
} from '@airtable/blocks/ui';
import { fetchMaps } from '../services/mapsemble';

function formatDate(iso) {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleString();
    } catch (_err) {
        return iso;
    }
}

export default function HomeScreen({ onCreateNew, onSync, onModify, onWebhook, onPreview, showResyncNotice, onDismissResyncNotice }) {
    const base = useBase();
    const cursor = useCursor();
    const globalConfig = useGlobalConfig();

    const activeTableId = cursor.activeTableId;
    const tableConfig = activeTableId
        ? (globalConfig.get(['tableConfigs', activeTableId]) || {})
        : {};
    const maps = tableConfig.maps || [];
    const activeTable = activeTableId ? base.getTableByIdIfExists(activeTableId) : null;

    const [missingMapIds, setMissingMapIds] = useState(new Set());

    const mapIds = maps.map((m) => m.mapId).join(',');
    useEffect(() => {
        if (maps.length === 0) {
            setMissingMapIds(new Set());
            return;
        }
        const token = globalConfig.get('token');
        if (!token) return;

        const config = {
            clientId:     globalConfig.get('clientId'),
            clientSecret: globalConfig.get('clientSecret'),
            token,
        };
        fetchMaps(config, (newToken) => globalConfig.setAsync('token', newToken))
            .then((remoteMaps) => {
                const remoteIds = new Set(remoteMaps.map((m) => String(m.id)));
                setMissingMapIds(
                    new Set(maps.filter((m) => !remoteIds.has(String(m.mapId))).map((m) => m.mapId))
                );
            })
            .catch(() => {
                setMissingMapIds(new Set());
            });
    }, [activeTableId, mapIds]); // eslint-disable-line react-hooks/exhaustive-deps

    async function removeMap(mapId) {
        const tc = globalConfig.get(['tableConfigs', activeTableId]) || {};
        const updatedMaps = (tc.maps || []).filter((m) => m.mapId !== mapId);
        await globalConfig.setAsync(['tableConfigs', activeTableId, 'maps'], updatedMaps);
    }

    return (
        <Box padding={3}>
            {/* Resync notice */}
            {showResyncNotice && (
                <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    padding={2}
                    marginBottom={3}
                    className="bg-yellow-50 border border-yellow-300 rounded-md"
                >
                    <Text size="small" className="text-amber-800">
                        Column mapping updated — sync to apply changes.
                    </Text>
                    <Button
                        onClick={onDismissResyncNotice}
                        variant="default"
                        size="small"
                        className="ml-2 shrink-0"
                    >
                        Dismiss
                    </Button>
                </Box>
            )}

            {/* Maps list */}
            {maps.length === 0 ? (
                <Box
                    padding={3}
                    marginBottom={3}
                    className="bg-gray-50 border border-gray-200 rounded-md text-center"
                >
                    <Text size="small" className="text-gray-500">
                        No maps for {activeTable ? activeTable.name : 'this table'}. Create your first map.
                    </Text>
                </Box>
            ) : (
                <Box marginBottom={3}>
                    {maps.map((map) => (
                        <Box
                            key={map.mapId}
                            padding={2}
                            marginBottom={2}
                            className="bg-white border border-gray-200 rounded-md"
                        >
                            <Box display="flex" alignItems="flex-start" justifyContent="space-between">
                                <Box flex="1" className="min-w-0 mr-2">
                                    <Text
                                        size="small"
                                        fontWeight="strong"
                                        className="truncate"
                                    >
                                        {map.mapLabel || map.mapId}
                                    </Text>
                                    {map.lastSync ? (
                                        <Text size="small" className="text-gray-400 mt-0.5">
                                            Last synced: {formatDate(map.lastSync)}
                                        </Text>
                                    ) : (
                                        <Text size="small" className="text-gray-400 mt-0.5">
                                            Never synced
                                        </Text>
                                    )}
                                    {tableConfig.airtableWebhookId ? (
                                        <Box
                                            display="inline-flex"
                                            alignItems="center"
                                            marginTop={1}
                                            className="bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5"
                                        >
                                            <Box
                                                flexShrink={0}
                                                marginRight={1}
                                                className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                                            />
                                            <Text size="small" className="text-emerald-800">
                                                Auto-sync active
                                            </Text>
                                        </Box>
                                    ) : (
                                        <Text size="small" className="text-gray-400 mt-0.5">
                                            Manual sync only
                                        </Text>
                                    )}
                                    {map.mapUrl && (
                                        <Box marginTop={1}>
                                            <Link href={map.mapUrl} target="_blank" rel="noreferrer" size="small">
                                                Open in Mapsemble
                                            </Link>
                                        </Box>
                                    )}
                                </Box>
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
                                        variant="primary"
                                        size="small"
                                        disabled={missingMapIds.has(map.mapId)}
                                    >
                                        Sync
                                    </Button>
                                    <Button
                                        onClick={() => onModify(activeTableId, map.mapId)}
                                        variant="default"
                                        size="small"
                                        disabled={missingMapIds.has(map.mapId)}
                                    >
                                        Modify
                                    </Button>
                                    <Button
                                        onClick={() => onWebhook(activeTableId, map.mapId)}
                                        variant="default"
                                        size="small"
                                        disabled={missingMapIds.has(map.mapId)}
                                    >
                                        Webhook
                                    </Button>
                                </Box>
                            </Box>
                            {missingMapIds.has(map.mapId) && (
                                <Box marginTop={2} padding={2} className="bg-red-50 border border-red-300 rounded-md">
                                    <Text size="small" fontWeight="strong" className="text-red-700">
                                        Map not found in Mapsemble
                                    </Text>
                                    <Text size="small" className="text-red-600 mt-1">
                                        This map may have been deleted.
                                    </Text>
                                    <Button
                                        onClick={() => removeMap(map.mapId)}
                                        variant="danger"
                                        size="small"
                                        marginTop={2}
                                    >
                                        Remove from list
                                    </Button>
                                </Box>
                            )}
                        </Box>
                    ))}
                </Box>
            )}

            {/* Create new map button */}
            <Button
                onClick={() => onCreateNew(activeTableId)}
                variant="primary"
                width="100%"
            >
                + Create a new map
            </Button>
        </Box>
    );
}
