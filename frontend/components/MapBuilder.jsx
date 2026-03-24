import React, { useState, useEffect, useRef } from 'react';
import {
    useBase,
    useRecords,
    useGlobalConfig,
    Box,
    Text,
    Heading,
    Button,
    FormField,
    Input,
} from '@airtable/blocks/ui';
import { createMap, updateMap, MAPSEMBLE_URL } from '../services/mapsemble';
import { buildSlugMap, toSlug } from '../services/geojson';

function MapBuilderInner({ table, tableId, baseId, pendingConfig, onComplete, onBack }) {
    const globalConfig = useGlobalConfig();
    const canWrite = globalConfig.hasPermissionToSet();

    const neededFieldIds = (() => {
        const cfg = pendingConfig || (globalConfig.get(['tableConfigs', tableId]) || {});
        const fm = cfg.fieldMapping || {};
        const ids = new Set(
            Object.entries(fm)
                .filter(([, meta]) => meta.remoteType)
                .map(([id]) => id)
        );
        if (cfg.latField) ids.add(cfg.latField);
        if (cfg.lngField) ids.add(cfg.lngField);
        if (cfg.locationColumn) ids.add(cfg.locationColumn);
        if (cfg.labelField) ids.add(cfg.labelField);
        return [...ids].filter(id => table.getFieldByIdIfExists(id));
    })();
    const records = useRecords(table, { fields: neededFieldIds });

    const [mapName, setMapName] = useState(table.name);
    const [building, setBuilding] = useState(false);
    const [buildStep, setBuildStep] = useState(''); // 'creating' | 'generating'
    const [error, setError] = useState('');
    const [deletedFields, setDeletedFields] = useState([]);

    const isMounted = useRef(true);
    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    function getConfig() {
        return {
            url: MAPSEMBLE_URL,
            clientId: globalConfig.get('clientId'),
            clientSecret: globalConfig.get('clientSecret'),
            token: globalConfig.get('token'),
        };
    }

    function resolveFieldNames(rawFields) {
        const fields = {};
        const missing = [];
        for (const [fieldId, meta] of Object.entries(rawFields)) {
            const liveField = table.getFieldByIdIfExists(fieldId);
            if (!liveField) {
                missing.push(meta.name || fieldId);
            }
            fields[fieldId] = { ...meta, name: liveField ? liveField.name : (meta.name || fieldId) };
        }
        if (missing.length > 0) setDeletedFields(missing);
        return fields;
    }

    function getFieldMapping() {
        if (pendingConfig) {
            const locationColumnName = pendingConfig.locationColumn
                ? (table.getFieldByIdIfExists(pendingConfig.locationColumn)?.name || '')
                : '';
            return {
                locationMode:   pendingConfig.locationMode || 'dual',
                latField:       pendingConfig.latField,
                lngField:       pendingConfig.lngField,
                locationColumn: pendingConfig.locationColumn,
                locationFormat: pendingConfig.locationFormat || 'auto',
                locationColumnName,
                fields:         resolveFieldNames(pendingConfig.fieldMapping || {}),
                labelField:     pendingConfig.labelField || null,
            };
        }
        // fallback: read from globalConfig
        const tc = globalConfig.get(['tableConfigs', tableId]) || {};
        const locationColumnName = tc.locationColumn
            ? (table.getFieldByIdIfExists(tc.locationColumn)?.name || '')
            : '';
        return {
            locationMode:   tc.locationMode || 'dual',
            latField:       tc.latField,
            lngField:       tc.lngField,
            locationColumn: tc.locationColumn,
            locationFormat: tc.locationFormat || 'auto',
            locationColumnName,
            fields:         resolveFieldNames(tc.fieldMapping || {}),
            labelField:     tc.labelField || null,
        };
    }

    async function handleBuild() {
        setBuilding(true);
        setError('');

        try {
            const fieldMapping = getFieldMapping();
            const fieldEntries = Object.entries(fieldMapping.fields || {});
            const slugMap = buildSlugMap(fieldEntries.map(([fieldId, meta]) => ({ fieldId, name: meta.name || fieldId })));
            const fields = fieldEntries.map(([fieldId, meta], index) => {
                const fieldDef = {
                    slug:     slugMap[fieldId],
                    type:     meta.remoteType,
                    label:    meta.name || fieldId,
                    weight:   index,
                    required: false,
                };
                if (meta.remoteType === 'single_select' || meta.remoteType === 'multi_select') {
                    const airtableField = table.getFieldByIdIfExists(fieldId);
                    const choices = airtableField?.options?.choices || [];
                    fieldDef.config = {
                        options: choices.map((choice, i) => ({
                            key:    choice.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                            label:  choice.name,
                            weight: i + 1,
                        })),
                        allowMultiple: meta.remoteType === 'multi_select',
                    };
                }
                if (meta.remoteType === 'image') {
                    fieldDef.config = { allowMultiple: true };
                }
                return fieldDef;
            });
            fields.unshift({
                slug:     '_airtable_id',
                type:     'text',
                label:    'Airtable ID',
                weight:   -1,
                required: false,
            });

            // Add geocode field to schema when using address format
            if (fieldMapping.locationFormat === 'address' && fieldMapping.locationColumn) {
                const colName = table.getFieldByIdIfExists(fieldMapping.locationColumn)?.name || 'Address';
                fields.push({
                    slug: toSlug(colName),
                    type: 'text',
                    label: colName,
                    weight: fields.length,
                    required: false,
                });
            }

            // --- Step 1: Create map with fields only (no features, no AI) ---
            setBuildStep('creating');
            const geocodeField = fieldMapping.locationFormat === 'address' && fieldMapping.locationColumn
                ? toSlug(table.getFieldByIdIfExists(fieldMapping.locationColumn)?.name || 'Address')
                : '';
            const payload = {
                label: mapName,
                published: true,
                externalSource: 'airtable',
                config: { debug: false, remoteField: '_airtable_id', ...(geocodeField ? { geocodeField } : {}) },
                dataSource: {
                    type: 'airtable',
                    label: 'Data layer',
                    config: {
                        baseId: baseId || '',
                        tableId: tableId || '',
                        webhookId: '',
                        personalAccessToken: globalConfig.get('airtablePat') || '',
                        webhookCursor: null,
                        labelFieldName: fieldMapping.labelField
                            ? (table.getFieldByIdIfExists(fieldMapping.labelField)?.name ?? '')
                            : '',
                        locationMode: fieldMapping.locationMode || 'dual',
                        latFieldName: fieldMapping.latField
                            ? (table.getFieldByIdIfExists(fieldMapping.latField)?.name ?? '')
                            : '',
                        lngFieldName: fieldMapping.lngField
                            ? (table.getFieldByIdIfExists(fieldMapping.lngField)?.name ?? '')
                            : '',
                        locationColumnName: fieldMapping.locationColumn
                            ? (table.getFieldByIdIfExists(fieldMapping.locationColumn)?.name ?? '')
                            : '',
                        locationFormat: fieldMapping.locationFormat || 'auto',
                        fieldMappings: Object.fromEntries(
                            fieldEntries.map(([fieldId, meta]) => [
                                fieldId,
                                { ...meta, slug: slugMap[fieldId], airtableId: fieldId },
                            ])
                        ),
                    },
                },
                fields,
            };

            const cfg = getConfig();
            const setToken = (newToken) => globalConfig.setAsync('token', newToken);

            const map = await createMap(payload, cfg, setToken);

            // --- Step 2: Generate AI templates ---
            if (!isMounted.current) return;
            setBuildStep('generating');
            await updateMap(map.id, {
                config: { generateTemplates: true },
            }, cfg, setToken);

            const existingConfig = globalConfig.get(['tableConfigs', tableId]) || {};

            const newEntry = {
                mapId:          map.id,
                mapLabel:       map.label || mapName,
                mapUrl:         map.url || null,
                lastSync:       null,
                airtableBaseId: baseId || null,
            };
            await globalConfig.setAsync(['tableConfigs', tableId, 'maps'],
                [...(existingConfig.maps || []), newEntry]);
            await globalConfig.setAsync('activeMapId', map.id);

            if (onComplete) onComplete(map.id);
        } catch (err) {
            if (isMounted.current) setError(err.message);
        } finally {
            if (isMounted.current) setBuilding(false);
        }
    }

    if (building) {
        const stepLabel = buildStep === 'creating' ? 'Creating map...'
            : buildStep === 'generating' ? 'Generating templates...'
            : 'Working...';

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
                <Heading size="small" marginBottom={2}>{stepLabel}</Heading>
                <Text size="small" textColor="light">
                    This may take a moment
                </Text>
                <style>{`@keyframes mapsemble-spin { to { transform: rotate(360deg); } }`}</style>
            </Box>
        );
    }

    return (
        <Box padding={3}>
            {deletedFields.length > 0 && (
                <Box padding={2} marginBottom={2} className="bg-red-50 border border-red-200 rounded-md">
                    <Text size="small" className="text-red-700" marginBottom={1}>
                        Some mapped fields were deleted: {deletedFields.join(', ')}
                    </Text>
                    <Text size="small" className="text-red-600">
                        Please update your field mapping before creating the map.
                    </Text>
                    {onBack && (
                        <Button onClick={onBack} variant="default" size="small" marginTop={1}>
                            ← Update field mapping
                        </Button>
                    )}
                </Box>
            )}

            <Heading size="small" marginBottom={3}>Build Map</Heading>

            <Text size="small" textColor="light" marginBottom={3}>
                All records from <strong>{table.name}</strong> will be synced to Mapsemble.
            </Text>

            <FormField label="Map name" marginBottom={2}>
                <Input
                    value={mapName}
                    onChange={e => setMapName(e.target.value)}
                />
            </FormField>

            <Text size="small" textColor="light" marginBottom={3}>
                {records.length} record{records.length !== 1 ? 's' : ''} available
            </Text>

            {error && (
                <Box
                    padding={2}
                    marginBottom={2}
                    className="bg-red-50 border border-red-200 rounded"
                >
                    <Text size="small" className="text-red-700">{error}</Text>
                </Box>
            )}

            {!canWrite && (
                <Box padding={2} marginBottom={2} className="bg-amber-50 border border-amber-200 rounded-md">
                    <Text size="small" className="text-amber-700">
                        Read-only access. You need creator permissions to create maps.
                    </Text>
                </Box>
            )}

            <Box display="flex" className="gap-2">
                {onBack && (
                    <Button onClick={onBack} variant="default" flex="1">
                        ← Back
                    </Button>
                )}
                <Button
                    onClick={handleBuild}
                    disabled={!canWrite || !mapName.trim()}
                    variant="primary"
                    flex={onBack ? '2' : undefined}
                    width={onBack ? undefined : '100%'}
                >
                    Create Map in Mapsemble
                </Button>
            </Box>
        </Box>
    );
}

export default function MapBuilder({ tableId, pendingConfig, onComplete, onBack }) {
    const base = useBase();

    const table = tableId ? base.getTableByIdIfExists(tableId) : null;

    if (!table) {
        return (
            <Box padding={3}>
                <Text size="small" textColor="light">
                    No table selected. Go back to Column Mapping first.
                </Text>
            </Box>
        );
    }

    return (
        <MapBuilderInner
            table={table}
            tableId={tableId}
            baseId={base.id}
            pendingConfig={pendingConfig}
            onComplete={onComplete}
            onBack={onBack}
        />
    );
}
