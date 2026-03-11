import React, { useState } from 'react';
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
import { createMap, putFeatures, syncFeatures, updateMap, MAPSEMBLE_URL, NGROK_URL } from '../services/mapsemble';
import { recordToFeature, buildSlugMap } from '../services/geojson';
import { registerAirtableWebhook } from '../services/airtable';

function MapBuilderInner({ table, tableId, baseId, pendingConfig, onComplete, onBack }) {
    const globalConfig = useGlobalConfig();

    const records = useRecords(table, { fields: table.fields.map(f => f.id) });

    const [mapName, setMapName] = useState(table.name);
    const [building, setBuilding] = useState(false);
    const [buildStep, setBuildStep] = useState(''); // 'creating' | 'syncing' | 'generating'
    const [error, setError] = useState('');

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
        for (const [fieldId, meta] of Object.entries(rawFields)) {
            const liveField = table.getFieldByIdIfExists(fieldId);
            fields[fieldId] = { ...meta, name: liveField ? liveField.name : (meta.name || fieldId) };
        }
        return fields;
    }

    function getFieldMapping() {
        if (pendingConfig) {
            return {
                locationMode:   pendingConfig.locationMode || 'dual',
                latField:       pendingConfig.latField,
                lngField:       pendingConfig.lngField,
                locationColumn: pendingConfig.locationColumn,
                locationFormat: pendingConfig.locationFormat || 'auto',
                fields:         resolveFieldNames(pendingConfig.fieldMapping || {}),
                labelField:     pendingConfig.labelField || null,
            };
        }
        // fallback: read from globalConfig
        const tc = globalConfig.get(['tableConfigs', tableId]) || {};
        return {
            locationMode:   tc.locationMode || 'dual',
            latField:       tc.latField,
            lngField:       tc.lngField,
            locationColumn: tc.locationColumn,
            locationFormat: tc.locationFormat || 'auto',
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

            // --- Step 1: Create map with fields only (no features, no AI) ---
            setBuildStep('creating');
            const payload = {
                label: mapName,
                published: true,
                externalSource: 'airtable',
                config: { debug: false, remoteField: '_airtable_id' },
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

            // --- Step 2: Sync all records as features ---
            setBuildStep('syncing');
            const allFeatures = records
                .map(r => recordToFeature(r, fieldMapping))
                .filter(f => f !== null && f !== undefined);

            if (allFeatures.length > 0) {
                if (allFeatures.length <= 1000) {
                    await putFeatures(map.id, allFeatures, cfg, setToken);
                } else {
                    // Batch in chunks of 1000 via POST (additive sync)
                    for (let i = 0; i < allFeatures.length; i += 1000) {
                        const batch = allFeatures.slice(i, i + 1000);
                        await syncFeatures(map.id, batch, cfg, setToken);
                    }
                }
            }

            // --- Step 3: Generate AI templates ---
            setBuildStep('generating');
            await updateMap(map.id, {
                config: { generateTemplates: true },
            }, cfg, setToken);

            // Attempt automatic webhook registration if a PAT is configured
            const pat = globalConfig.get('airtablePat');
            const existingConfig = globalConfig.get(['tableConfigs', tableId]) || {};
            // One webhook per table — check if one already exists before creating another
            const existingTableWebhookId = existingConfig.airtableWebhookId || null;
            let airtableWebhookId = existingTableWebhookId;

            if (pat && baseId && tableId) {
                try {
                    // 1. Fetch the webhook token / notification URL from Mapsemble
                    const dsRes = await fetch(
                        `${MAPSEMBLE_URL}/api/v1/webhook/airtable/${map.id}`,
                        {
                            method: 'GET',
                            headers: {
                                Authorization: `Bearer ${globalConfig.get('token')}`,
                                'Content-Type': 'application/json',
                            },
                        },
                    );
                    if (dsRes.ok) {
                        const dsData = await dsRes.json();
                        const rawNotificationUrl = dsData.notificationUrl;
                        const notificationUrl = NGROK_URL
                            ? rawNotificationUrl.replace(
                                new URL(MAPSEMBLE_URL).origin,
                                NGROK_URL.replace(/\/$/, ''),
                              )
                            : rawNotificationUrl;

                        if (!existingTableWebhookId) {
                            // 2. No existing table webhook — register a new one with Airtable
                            airtableWebhookId = await registerAirtableWebhook(baseId, tableId, notificationUrl, pat);
                        }

                        // 3. Register this map <-> webhook with the Mapsemble backend
                        const registerRes = await fetch(`${MAPSEMBLE_URL}/api/v1/webhook/airtable/register`, {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${globalConfig.get('token')}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                mapId: map.id,
                                baseId,
                                tableId,
                                webhookId: airtableWebhookId,
                                pat,
                            }),
                        });
                        if (!registerRes.ok) {
                            throw new Error(`Mapsemble webhook registration failed (${registerRes.status})`);
                        }
                    }
                } catch (webhookErr) {
                    // Non-fatal — map was created successfully, auto-sync just won't work
                    // eslint-disable-next-line no-console
                    console.warn('[Mapsemble] Webhook registration failed:', webhookErr.message);
                }
            }

            const newEntry = {
                mapId:          map.id,
                mapLabel:       map.label || mapName,
                mapUrl:         map.url || null,
                lastSync:       null,
                airtableBaseId: baseId || null,
            };
            await globalConfig.setAsync(['tableConfigs', tableId, 'maps'],
                [...(existingConfig.maps || []), newEntry]);
            // Store webhook at table level (skip if it was already there)
            if (airtableWebhookId && !existingTableWebhookId) {
                await globalConfig.setAsync(['tableConfigs', tableId, 'airtableWebhookId'], airtableWebhookId);
            }
            await globalConfig.setAsync('activeMapId', map.id);

            if (onComplete) onComplete(map.id);
        } catch (err) {
            setError(err.message);
        } finally {
            setBuilding(false);
        }
    }

    if (building) {
        const stepLabel = buildStep === 'creating' ? 'Creating map...'
            : buildStep === 'syncing' ? 'Syncing records...'
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

            <Box display="flex" className="gap-2">
                {onBack && (
                    <Button onClick={onBack} variant="default" flex="1">
                        ← Back
                    </Button>
                )}
                <Button
                    onClick={handleBuild}
                    disabled={!mapName.trim()}
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
