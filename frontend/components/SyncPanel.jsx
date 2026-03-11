import React, { useState, useRef } from 'react';
import {
    useBase,
    useRecords,
    useGlobalConfig,
    Box,
    Text,
    Button,
    Input,
} from '@airtable/blocks/ui';
import { recordToFeature } from '../services/geojson';
import {
    syncFeatures,
    putFeatures,
    fetchAllMapAirtableIds,
    deleteFeaturesByAirtableIds,
    MAPSEMBLE_URL,
} from '../services/mapsemble';

const BATCH_SIZE = 1000;
const MAX_ERRORS = 10;

function SyncPanelInner({ table, tableId, mapId, onBack, onNext, showHeader, hasWebhook }) {
    const globalConfig = useGlobalConfig();
    const records = useRecords(table, { fields: table.fields.map(f => f.id) });

    const tableConfig = globalConfig.get(['tableConfigs', tableId]) || {};
    const activeMap   = (tableConfig.maps || []).find(m => m.mapId === mapId) || null;
    const lastSync    = activeMap?.lastSync  || null;

    const [syncing, setSyncing] = useState(false);
    const [progress, setProgress] = useState(null); // { phase: 'upsert'|'prune_read'|'prune_delete', done, total }
    const [errors, setErrors] = useState([]);
    const [mapNotFound, setMapNotFound] = useState(false);

    const abortRef = useRef(false);

    function getConfig() {
        return {
            url: MAPSEMBLE_URL,
            clientId: globalConfig.get('clientId'),
            clientSecret: globalConfig.get('clientSecret'),
            token: globalConfig.get('token'),
        };
    }

    function getFieldMapping() {
        const tc = globalConfig.get(['tableConfigs', tableId]) || {};
        const storedFields = tc.fieldMapping || {};
        const fields = {};
        for (const [fieldId, meta] of Object.entries(storedFields)) {
            const liveField = table.getFieldByIdIfExists(fieldId);
            fields[fieldId] = { ...meta, name: liveField ? liveField.name : (meta.name || fieldId) };
        }
        return {
            locationMode:   tc.locationMode || 'dual',
            latField:       tc.latField,
            lngField:       tc.lngField,
            locationColumn: tc.locationColumn,
            locationFormat: tc.locationFormat || 'auto',
            fields,
            labelField:     tc.labelField || null,
        };
    }

    async function updateActiveMap(patch) {
        const tc = globalConfig.get(['tableConfigs', tableId]) || {};
        const updatedMaps = (tc.maps || []).map(m =>
            m.mapId === mapId ? { ...m, ...patch } : m
        );
        await globalConfig.setAsync(['tableConfigs', tableId, 'maps'], updatedMaps);
    }

    async function removeActiveMap() {
        const tc = globalConfig.get(['tableConfigs', tableId]) || {};
        const updatedMaps = (tc.maps || []).filter(m => m.mapId !== mapId);
        await globalConfig.setAsync(['tableConfigs', tableId, 'maps'], updatedMaps);
    }

    function addError(msg) {
        setErrors(prev => [{ msg, ts: new Date().toISOString() }, ...prev].slice(0, MAX_ERRORS));
    }

    async function handleSync() {
        setSyncing(true);
        abortRef.current = false;
        setErrors([]);
        setMapNotFound(false);
        let mapGone = false;

        const fieldMapping = getFieldMapping();
        const config = getConfig();
        const setToken = (t) => globalConfig.setAsync('token', t);

        const features = records
            .map(r => recordToFeature(r, fieldMapping))
            .filter(Boolean);

        const total = features.length;

        if (total <= 1000) {
            // --- Tier 1: single PUT (full reconciliation) ---
            setProgress({ phase: 'upsert', done: 0, total });
            try {
                await putFeatures(mapId, features, config, setToken);
            } catch (err) {
                if (err.code === 'MAP_NOT_FOUND') { mapGone = true; setMapNotFound(true); }
                else { addError(`Sync failed: ${err.message}`); }
            }
            setProgress({ phase: 'upsert', done: total, total });
        } else {
            // --- Tier 2: batched POST upsert + GET-diff DELETE ---

            // Phase A — Upsert
            let upsertHadErrors = false;
            setProgress({ phase: 'upsert', done: 0, total });

            for (let i = 0; i < total; i += BATCH_SIZE) {
                if (abortRef.current) break;

                const batch = features.slice(i, i + BATCH_SIZE);
                try {
                    await syncFeatures(mapId, batch, config, setToken);
                } catch (err) {
                    if (err.code === 'MAP_NOT_FOUND') { mapGone = true; setMapNotFound(true); upsertHadErrors = true; }
                    else { addError(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${err.message}`); upsertHadErrors = true; }
                }

                setProgress({ phase: 'upsert', done: Math.min(i + BATCH_SIZE, total), total });
            }

            // Phase B — Prune removed records (skip if aborted or upsert had errors)
            if (!abortRef.current && !upsertHadErrors) {
                setProgress({ phase: 'prune_read', done: 0, total: 0 });

                let mapIds;
                try {
                    mapIds = await fetchAllMapAirtableIds(mapId, config, setToken);
                } catch (err) {
                    if (err.code === 'MAP_NOT_FOUND') { mapGone = true; setMapNotFound(true); }
                    else { addError(`Could not fetch existing map features for cleanup: ${err.message}`); }
                    mapIds = null;
                }

                if (mapIds !== null) {
                    const currentIds = new Set(features.map(f => f.properties._airtable_id));
                    const orphans = [...mapIds].filter(id => !currentIds.has(id));

                    if (orphans.length > 0) {
                        let deleteDone = 0;
                        for (let i = 0; i < orphans.length; i += BATCH_SIZE) {
                            if (abortRef.current) {
                                addError('Sync cancelled — some deleted records may still appear on the map.');
                                break;
                            }
                            const batch = orphans.slice(i, i + BATCH_SIZE);
                            try {
                                await deleteFeaturesByAirtableIds(mapId, batch, config, setToken);
                            } catch (err) {
                                addError(`Delete batch ${Math.floor(i / BATCH_SIZE) + 1}: ${err.message}`);
                            }
                            deleteDone = Math.min(i + BATCH_SIZE, orphans.length);
                            setProgress({ phase: 'prune_delete', done: deleteDone, total: orphans.length });
                        }
                    }
                }
            } else if (upsertHadErrors) {
                addError('Removal of deleted records skipped — re-sync after fixing errors above.');
            }
        }

        if (!abortRef.current && !mapGone) {
            await updateActiveMap({ lastSync: new Date().toISOString() });
        }
        setSyncing(false);
        setProgress(null);
    }

    function formatDate(iso) {
        if (!iso) return null;
        try {
            return new Date(iso).toLocaleString();
        } catch (_err) {
            return iso;
        }
    }

    const progressPct = progress && progress.total > 0
        ? Math.round((progress.done / progress.total) * 100)
        : 0;

    const progressLabel = progress
        ? progress.phase === 'prune_read'
            ? 'Checking for removed records…'
            : progress.phase === 'prune_delete'
                ? 'Removing deleted records…'
                : 'Syncing records…'
        : null;

    const progressBarColor = progress?.phase === 'prune_delete' ? '#ef4444' : '#3b82f6';

    return (
        <Box padding={3}>
            {showHeader && (
                <Box display="flex" alignItems="center" marginBottom={3}>
                    <Button onClick={onBack} variant="default" size="small">← Back</Button>
                    <Text marginLeft={2} fontWeight="strong">
                        {activeMap?.mapLabel} — {table.name}
                    </Text>
                </Box>
            )}

            {mapNotFound && (
                <Box padding={2} marginBottom={3} className="bg-red-50 border border-red-300 rounded-md">
                    <Text size="small" fontWeight="strong" className="text-red-700">
                        Map not found in Mapsemble
                    </Text>
                    <Text size="small" className="text-red-600 mt-1">
                        This map may have been deleted. Remove it from your list?
                    </Text>
                    <Button
                        onClick={async () => { await removeActiveMap(); onBack(); }}
                        variant="danger"
                        size="small"
                        marginTop={2}
                    >
                        Remove from list
                    </Button>
                </Box>
            )}

            {/* Sync now */}
            <Box marginBottom={4}>
                <Box display="flex" alignItems="center" justifyContent="space-between" marginBottom={2}>
                    <Text size="small" fontWeight="strong">Records: {records.length}</Text>
                    {lastSync && (
                        <Text size="small" textColor="light">
                            Last sync: {formatDate(lastSync)}
                        </Text>
                    )}
                </Box>

                {syncing && progress && (
                    <Box marginBottom={2}>
                        <Box display="flex" justifyContent="space-between" marginBottom={1}>
                            <Text size="small" textColor="light">{progressLabel}</Text>
                            {progress.phase !== 'prune_read' && (
                                <Text size="small" textColor="light">{progress.done} / {progress.total}</Text>
                            )}
                        </Box>
                        {/* Progress bar — hidden during prune_read phase (total unknown) */}
                        {progress.phase !== 'prune_read' && (
                            <Box className="bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                <Box
                                    className="h-full rounded-full transition-[width] duration-200"
                                    style={{ width: `${progressPct}%`, backgroundColor: progressBarColor }}
                                />
                            </Box>
                        )}
                    </Box>
                )}

                <Button
                    onClick={handleSync}
                    disabled={syncing || !mapId}
                    variant="primary"
                    width="100%"
                >
                    {syncing ? 'Syncing…' : 'Sync Now'}
                </Button>

                {syncing && (
                    <Button
                        onClick={() => { abortRef.current = true; }}
                        variant="default"
                        width="100%"
                        marginTop={1}
                    >
                        Cancel
                    </Button>
                )}
            </Box>

            {/* Auto-sync status */}
            {hasWebhook !== undefined && (
                <Box marginBottom={3}>
                    {hasWebhook ? (
                        <Box
                            display="inline-flex"
                            alignItems="center"
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
                        <Text size="small" className="text-gray-400">
                            Manual sync only
                        </Text>
                    )}
                </Box>
            )}

            {/* Error log */}
            {errors.length > 0 && (
                <Box>
                    <Text size="small" fontWeight="strong" marginBottom={1} className="text-red-700">
                        Recent errors
                    </Text>
                    <Box className="max-h-40 overflow-y-auto">
                        {errors.map((e, i) => (
                            <Box
                                key={i}
                                padding={1}
                                marginBottom={1}
                                className="bg-red-50 border border-red-100 rounded"
                            >
                                <Text size="small" className="text-red-600">
                                    <Box as="span" className="text-gray-400 mr-1">
                                        {formatDate(e.ts)}
                                    </Box>
                                    {e.msg}
                                </Text>
                            </Box>
                        ))}
                    </Box>
                    <Button
                        onClick={() => setErrors([])}
                        variant="default"
                        size="small"
                        marginTop={1}
                    >
                        Clear errors
                    </Button>
                </Box>
            )}

            {!showHeader && (
                <Box display="flex" justifyContent="space-between" alignItems="center" marginTop={3}>
                    {onBack && (
                        <Button onClick={onBack} variant="default" size="small">
                            ← Back
                        </Button>
                    )}
                    {onNext && (
                        <Button onClick={onNext} variant="primary" size="small" disabled={syncing}>
                            Next →
                        </Button>
                    )}
                </Box>
            )}
        </Box>
    );
}

export default function SyncPanel({ tableId, mapId, onBack, onNext, showHeader, hasWebhook }) {
    const base = useBase();

    const table = tableId ? base.getTableByIdIfExists(tableId) : null;

    if (!table) {
        return (
            <Box padding={3}>
                <Text size="small" textColor="light">
                    No table selected. Complete setup first.
                </Text>
            </Box>
        );
    }

    return (
        <SyncPanelInner
            table={table}
            tableId={tableId}
            mapId={mapId}
            onBack={onBack}
            onNext={onNext}
            showHeader={showHeader}
            hasWebhook={hasWebhook}
        />
    );
}
