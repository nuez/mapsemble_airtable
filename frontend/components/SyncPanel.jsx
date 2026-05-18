import React, { useState, useRef, useEffect } from 'react';
import {
    useBase,
    useRecords,
    useGlobalConfig,
    Box,
    Text,
    Heading,
    Button,
    Input,
} from '@airtable/blocks/ui';
import { recordToFeature } from '../services/geojson';
import {
    syncFeatures,
    fetchAllMapAirtableIds,
    deleteFeaturesByAirtableIds,
    MAPSEMBLE_URL,
} from '../services/mapsemble';

function getBatchSize(total) {
    return Math.min(1000, Math.max(50, Math.ceil(total / 10)));
}
const MIN_BATCH_SIZE = 25;
const MAX_ERRORS = 10;

function SyncPanelInner({ table, tableId, mapId, onBack, onNext, showHeader, skipConfirm, hasWebhook, webhookFailed, hasGeocoding, isMapActive, onConnect }) {
    const globalConfig = useGlobalConfig();
    const canWrite = globalConfig.hasPermissionToSet();
    const neededFieldIds = (() => {
        const tc = globalConfig.get(['tableConfigs', tableId]) || {};
        const fm = tc.fieldMapping || {};
        const ids = new Set(
            Object.entries(fm)
                .filter(([, meta]) => meta.remoteType)
                .map(([id]) => id)
        );
        if (tc.latField) ids.add(tc.latField);
        if (tc.lngField) ids.add(tc.lngField);
        if (tc.locationColumn) ids.add(tc.locationColumn);
        if (tc.labelField) ids.add(tc.labelField);
        // Filter to fields that still exist on the table
        return [...ids].filter(id => table.getFieldByIdIfExists(id));
    })();
    const records = useRecords(table, { fields: neededFieldIds });

    const tableConfig = globalConfig.get(['tableConfigs', tableId]) || {};
    const activeMap   = (tableConfig.maps || []).find(m => m.mapId === mapId) || null;
    const lastSync    = activeMap?.lastSync  || null;

    const usesGeocoding = tableConfig.locationFormat === 'address';
    const geocodingBlocked = usesGeocoding && (!hasGeocoding || !isMapActive);

    const [deletedFields, setDeletedFields] = useState([]);
    const [confirmSync, setConfirmSync] = useState(false);
    const [unauthorized, setUnauthorized] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncDone, setSyncDone] = useState(false);
    const [progress, setProgress] = useState(null); // { phase: 'upsert'|'prune_read'|'prune_delete', done, total }
    const [errors, setErrors] = useState([]);
    const [mapNotFound, setMapNotFound] = useState(false);
    const [limitInfo, setLimitInfo] = useState(null); // { limit, current, totalRecords }

    const abortRef = useRef(false);
    const autoStarted = useRef(false);

    useEffect(() => {
        if (skipConfirm && !autoStarted.current && canWrite && mapId && !geocodingBlocked) {
            autoStarted.current = true;
            handleSync();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        const missing = [];
        for (const [fieldId, meta] of Object.entries(storedFields)) {
            const liveField = table.getFieldByIdIfExists(fieldId);
            if (!liveField) {
                if (meta.remoteType) missing.push(meta.name || fieldId);
                continue; // skip deleted fields
            }
            fields[fieldId] = { ...meta, name: liveField.name };
        }
        if (missing.length > 0 && deletedFields.length === 0) setDeletedFields(missing);
        const locationColumnName = tc.locationColumn
            ? (table.getFieldByIdIfExists(tc.locationColumn)?.name || '')
            : '';
        return {
            locationMode:   tc.locationMode || 'dual',
            latField:       tc.latField && table.getFieldByIdIfExists(tc.latField) ? tc.latField : null,
            lngField:       tc.lngField && table.getFieldByIdIfExists(tc.lngField) ? tc.lngField : null,
            locationColumn: tc.locationColumn && table.getFieldByIdIfExists(tc.locationColumn) ? tc.locationColumn : null,
            locationFormat: tc.locationFormat || 'auto',
            locationColumnName,
            fields,
            labelField:     tc.labelField && table.getFieldByIdIfExists(tc.labelField) ? tc.labelField : null,
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
        setLimitInfo(null);
        setUnauthorized(false);
        let mapGone = false;
        let wasUnauthorized = false;

        const fieldMapping = getFieldMapping();
        const config = getConfig();
        const setToken = (t) => globalConfig.setAsync('token', t);

        const features = records
            .map(r => recordToFeature(r, fieldMapping))
            .filter(Boolean);

        const total = features.length;

        let limitReached = false;
        let hadAnyError = false;

        // Pre-fetch existing map IDs for pruning (skip on first sync - nothing to prune)
        let mapIds = null;
        if (lastSync) {
            setProgress({ phase: 'prune_read', done: 0, total: 0 });
            try {
                mapIds = await fetchAllMapAirtableIds(mapId, config, setToken, (count, total) => {
                    setProgress({ phase: 'prune_read', done: count, total: total || 0 });
                });
            } catch (err) {
                if (err.code === 'UNAUTHORIZED') { wasUnauthorized = true; }
                else if (err.code === 'MAP_NOT_FOUND') { mapGone = true; setMapNotFound(true); }
                else { addError(`Could not fetch existing map features for cleanup: ${err.message}`); hadAnyError = true; }
            }
        }

        // Phase A - Upsert
        let upsertHadErrors = false;
        let dynamicBatchSize = getBatchSize(total);
        let i = 0;
        setProgress({ phase: 'upsert', done: 0, total });

        while (i < total) {
            if (abortRef.current || limitReached || wasUnauthorized) break;

            const batch = features.slice(i, i + dynamicBatchSize);
            try {
                const result = await syncFeatures(mapId, batch, config, setToken);
                const failed = result?.failed || [];
                const limitFail = failed.find(
                    f => f.code === 'location_limit_reached'
                );
                if (limitFail) {
                    limitReached = true;
                    setLimitInfo({ limit: limitFail.limit, current: limitFail.current, totalRecords: total });
                }
                const otherFailures = failed.filter(f => f.code !== 'location_limit_reached');
                if (otherFailures.length > 0) {
                    const grouped = otherFailures.reduce((acc, f) => {
                        const msg = f.message || 'Unknown error';
                        acc[msg] = (acc[msg] || 0) + 1;
                        return acc;
                    }, {});
                    const batchLabel = `records ${i + 1}–${Math.min(i + dynamicBatchSize, total)}`;
                    Object.entries(grouped).forEach(([msg, count]) => {
                        addError(`Batch (${batchLabel}): ${count} record${count !== 1 ? 's' : ''} failed - ${msg}`);
                    });
                    upsertHadErrors = true;
                    hadAnyError = true;
                }
                i += dynamicBatchSize;
            } catch (err) {
                if (err.code === 'BATCH_TOO_LARGE' && dynamicBatchSize > MIN_BATCH_SIZE) {
                    // Batch too large — halve the size and retry the same batch
                    dynamicBatchSize = Math.max(MIN_BATCH_SIZE, Math.floor(dynamicBatchSize / 2));
                    continue;
                }
                // Non-recoverable error — log and skip this batch
                if (err.code === 'UNAUTHORIZED') {
                    wasUnauthorized = true; upsertHadErrors = true;
                } else if (err.code === 'MAP_NOT_FOUND') {
                    mapGone = true; setMapNotFound(true); upsertHadErrors = true;
                } else {
                    const batchLabel = `records ${i + 1}–${Math.min(i + dynamicBatchSize, total)}`;
                    addError(`Batch (${batchLabel}): ${err.message}`);
                    upsertHadErrors = true;
                    hadAnyError = true;
                }
                i += dynamicBatchSize;
            }

            await new Promise(r => setTimeout(r, 200));
            setProgress({ phase: 'upsert', done: Math.min(i, total), total });
        }

        // Phase B - Prune removed records (skip if aborted, upsert had errors, limit reached, or no pre-fetched IDs)
        if (!abortRef.current && !upsertHadErrors && !limitReached && mapIds !== null) {
            const currentIds = new Set(features.map(f => f.properties._airtable_id));
            const orphans = [...mapIds].filter(id => !currentIds.has(id));

            if (orphans.length > 0) {
                const deleteBatchSize = getBatchSize(orphans.length);
                let deleteDone = 0;
                for (let i = 0; i < orphans.length; i += deleteBatchSize) {
                    if (abortRef.current) {
                        addError('Sync cancelled - some deleted records may still appear on the map.');
                        break;
                    }
                    const batch = orphans.slice(i, i + deleteBatchSize);
                    try {
                        await deleteFeaturesByAirtableIds(mapId, batch, config, setToken);
                    } catch (err) {
                        if (err.code === 'UNAUTHORIZED') { wasUnauthorized = true; break; }
                        addError(`Delete batch ${Math.floor(i / deleteBatchSize) + 1}: ${err.message}`);
                    }
                    await new Promise(r => setTimeout(r, 200));
                    deleteDone = Math.min(i + deleteBatchSize, orphans.length);
                    setProgress({ phase: 'prune_delete', done: deleteDone, total: orphans.length });
                }
            }
        } else if (upsertHadErrors) {
            addError('Removal of deleted records skipped - re-sync after fixing errors above.');
            hadAnyError = true;
        }

        if (wasUnauthorized) {
            setUnauthorized(true);
            setSyncing(false);
            setProgress(null);
            return;
        }

        if (!abortRef.current && !mapGone) {
            await updateActiveMap({
                lastSync: new Date().toISOString(),
                ...(limitReached ? { limitReached: true } : { limitReached: false }),
            });
        }
        setSyncing(false);
        setProgress(null);

        // Auto-advance to next step after successful sync (wizard mode)
        if (!abortRef.current && !mapGone && onNext) {
            onNext();
        } else if (!abortRef.current && !mapGone && !onNext && !limitReached && !hadAnyError) {
            setSyncDone(true);
        }
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

    if (syncing) {
        return (
            <Box
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                padding={3}
                style={{ height: '100%', minHeight: 300 }}
            >
                <Box
                    style={{
                        width: 40,
                        height: 40,
                        border: '3px solid #e5e7eb',
                        borderTopColor: '#2563eb',
                        borderRadius: '50%',
                        animation: 'mapsemble-spin 0.8s linear infinite',
                        marginBottom: 16,
                    }}
                />
                <Heading size="small" marginBottom={2}>{progressLabel || 'Syncing...'}</Heading>
                {progress && (
                    <Box width="80%" marginBottom={2}>
                        <Box display="flex" justifyContent="center" marginBottom={1}>
                            <Text size="small" textColor="light">
                                {progress.phase === 'prune_read'
                                    ? (progress.total > 0 ? `${progress.done} / ${progress.total} checked` : `${progress.done} checked`)
                                    : `${progress.done} / ${progress.total}`}
                            </Text>
                        </Box>
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
                {errors.length > 0 && (
                    <Box width="80%" marginTop={3}>
                        {errors.map((e, i) => (
                            <Box key={i} padding={2} marginBottom={1} className="bg-red-50 border border-red-200 rounded-md">
                                <Text size="small" className="text-red-700">{e.msg}</Text>
                            </Box>
                        ))}
                    </Box>
                )}
                <Button
                    onClick={() => { abortRef.current = true; }}
                    variant="default"
                    size="small"
                    marginTop={2}
                >
                    Cancel
                </Button>
                <style>{`@keyframes mapsemble-spin { to { transform: rotate(360deg); } }`}</style>
            </Box>
        );
    }

    if (unauthorized) {
        return (
            <Box
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                padding={3}
                style={{ height: '100%', minHeight: 300 }}
            >
                <Box
                    style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        backgroundColor: '#fee2e2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 16,
                        fontSize: 24,
                    }}
                >
                    ✕
                </Box>
                <Heading size="small" marginBottom={1}>Session expired</Heading>
                <Text size="small" textColor="light" marginBottom={3} style={{ textAlign: 'center' }}>
                    Your connection to Mapsemble is no longer valid. Please reconnect to continue.
                </Text>
                {onConnect && (
                    <Button onClick={onConnect} variant="primary">
                        Reconnect to Mapsemble
                    </Button>
                )}
            </Box>
        );
    }

    if (syncDone) {
        return (
            <Box
                display="flex"
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                padding={3}
                style={{ height: '100%', minHeight: 300 }}
            >
                <Box
                    style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        backgroundColor: '#d1fae5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 16,
                        fontSize: 24,
                    }}
                >
                    ✓
                </Box>
                <Heading size="small" marginBottom={1}>Sync complete</Heading>
                <Text size="small" textColor="light" marginBottom={3}>
                    {records.length} record{records.length !== 1 ? 's' : ''} synced to Mapsemble.
                </Text>
                <Button onClick={onBack} variant="default">
                    ← Back to list
                </Button>
            </Box>
        );
    }

    return (
        <Box padding={3}>
            {showHeader && (
                <Box display="flex" alignItems="center" marginBottom={3}>
                    <Button onClick={onBack} variant="default" size="small">← Back</Button>
                    <Text marginLeft={2} fontWeight="strong">
                        {activeMap?.mapLabel} - {table.name}
                    </Text>
                </Box>
            )}

            {deletedFields.length > 0 && (
                <Box padding={2} marginBottom={2} className="bg-red-50 border border-red-200 rounded-md">
                    <Text size="small" className="text-red-700" marginBottom={1}>
                        Some mapped fields were deleted: {deletedFields.join(', ')}
                    </Text>
                    <Text size="small" className="text-red-600">
                        Update your field mapping to avoid missing data.
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
                        disabled={!canWrite}
                    >
                        Remove from list
                    </Button>
                </Box>
            )}

            {limitInfo && (
                <Box padding={2} marginBottom={3} className="bg-amber-50 border border-amber-300 rounded-md">
                    <Text size="small" fontWeight="strong" className="text-amber-800">
                        Location limit reached
                    </Text>
                    <Text size="small" className="text-amber-700 mt-1">
                        Your plan allows up to {limitInfo.limit} locations per map.
                        {limitInfo.totalRecords} records were found in Airtable but only {limitInfo.limit} were synced.{' '}
                        <a href={`${MAPSEMBLE_URL}/map/${mapId}`} target="_blank" rel="noreferrer" className="text-amber-800 underline font-medium">
                            Upgrade to increase limit
                        </a>
                    </Text>
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

                <Box
                    padding={2}
                    marginBottom={2}
                    className="bg-amber-50 border border-amber-200 rounded-md"
                >
                  <Text fontWeight="strong" className="!text-amber-800 !mb-2">
                    Data will be shared publicly
                  </Text>
                  <Text  className="text-amber-700 mt-1 !mb-5">
                    Mapped fields are synchronised to Mapsemble and may be visible through markers, filters, cards and popups. Only include fields you intend to expose.
                  </Text>
                </Box>

                {geocodingBlocked && (
                    <Box padding={2} marginBottom={2} className="bg-amber-50 border border-amber-200 rounded-md">
                        <Text size="small" fontWeight="strong" className="text-amber-800">
                            Geocoding unavailable
                        </Text>
                        <Text size="small" className="text-amber-700" marginTop={1}>
                            {!hasGeocoding
                                ? 'Geocoding is only available on the PRO plan. Upgrade Mapsemble to PRO to sync address data.'
                                : 'Geocoding is only available on active maps. Activate your map in Mapsemble to sync address data.'}
                        </Text>
                    </Box>
                )}

                {!canWrite && (
                    <Box padding={2} marginBottom={2} className="bg-amber-50 border border-amber-200 rounded-md">
                        <Text size="small" className="text-amber-700">
                            Read-only access. You need creator permissions to sync data.
                        </Text>
                    </Box>
                )}

                {!confirmSync ? (
                    <Button
                        onClick={() => skipConfirm ? handleSync() : setConfirmSync(true)}
                        disabled={!canWrite || syncing || !mapId || geocodingBlocked}
                        variant="primary"
                        width="100%"
                    >
                        Sync Now
                    </Button>
                ) : (
                    <Box padding={2} marginBottom={2} className="bg-blue-50 border border-blue-200 rounded-md">
                        <Text size="small" marginBottom={2}>
                            This will send {records.length} record{records.length !== 1 ? 's' : ''} from <strong>{table.name}</strong> to Mapsemble. Continue?
                        </Text>
                        <Box display="flex" className="gap-2">
                            <Button onClick={() => setConfirmSync(false)} variant="default" flex="1">
                                Cancel
                            </Button>
                            <Button
                                onClick={() => { setConfirmSync(false); handleSync(); }}
                                variant="primary"
                                flex="1"
                            >
                                Confirm Sync
                            </Button>
                        </Box>
                    </Box>
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
                    ) : webhookFailed ? (
                        <Box padding={2} className="bg-amber-50 border border-amber-200 rounded-md">
                            <Text size="small" fontWeight="strong" className="text-amber-700">
                                Auto-sync could not be enabled
                            </Text>
                            <Text size="small" className="text-amber-700" marginTop={1}>
                                There was a problem registering the webhook. You can set up auto-sync manually from the webhook panel after saving.
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

export default function SyncPanel({ tableId, mapId, onBack, onNext, showHeader, skipConfirm, hasWebhook, webhookFailed, hasGeocoding, isMapActive, onConnect }) {
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
            skipConfirm={skipConfirm}
            hasWebhook={hasWebhook}
            webhookFailed={webhookFailed}
            hasGeocoding={hasGeocoding}
            isMapActive={isMapActive}
            onConnect={onConnect}
        />
    );
}
