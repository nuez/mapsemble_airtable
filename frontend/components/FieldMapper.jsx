import React, { useState, useEffect, useRef } from 'react';
import {
    useBase,
    useGlobalConfig,
    Box,
    Text,
    Heading,
    Button,
    FormField,
    Select,
} from '@airtable/blocks/ui';
import { FieldType } from '@airtable/blocks/models';
import { fetchSchema, MAPSEMBLE_URL } from '../services/mapsemble';
import { buildSlugMap } from '../services/geojson';

const FIELD_TYPE_MAP = {
    [FieldType.SINGLE_LINE_TEXT]:    'text',
    [FieldType.MULTILINE_TEXT]:      'multiline_text',
    [FieldType.NUMBER]:              'number',
    [FieldType.CURRENCY]:            'number',
    [FieldType.PERCENT]:             'number',
    [FieldType.RATING]:              'number',
    [FieldType.DURATION]:            'number',
    [FieldType.AUTO_NUMBER]:         'number',
    [FieldType.EMAIL]:               'text',
    [FieldType.URL]:                 'text',
    [FieldType.MULTIPLE_ATTACHMENTS]:'image',
    [FieldType.SINGLE_SELECT]:       'single_select',
    [FieldType.MULTIPLE_SELECTS]:    'multi_select',
    [FieldType.DATE]:                'date',
    [FieldType.DATE_TIME]:           'date',
    [FieldType.PHONE_NUMBER]:        'text',
};

const FALLBACK_TYPES = [
    { value: 'text',          label: 'Single line text' },
    { value: 'multiline_text', label: 'Long text' },
    { value: 'number',        label: 'Number' },
    { value: 'image',         label: 'Image' },
    { value: 'single_select', label: 'Single select' },
    { value: 'multi_select',  label: 'Multi select' },
    { value: 'date',          label: 'Date' },
];

export default function FieldMapper({ tableId, initialConfig, locationFieldIds = [], onComplete, onBack }) {
    const base = useBase();
    const globalConfig = useGlobalConfig();
    const canWrite = globalConfig.hasPermissionToSet();
    const table = base.getTableByIdIfExists(tableId);
    const fields = table ? table.fields : [];

    const firstTextField = fields.find(f =>
        f.type === FieldType.SINGLE_LINE_TEXT || f.type === FieldType.MULTILINE_TEXT
    );

    const [labelField, setLabelField] = useState(initialConfig?.labelField || '');
    const [fieldMapping, setFieldMapping] = useState(() => {
        const base = initialConfig?.fieldMapping || {};
        const skipped = Object.fromEntries(locationFieldIds.map(id => [id, { remoteType: '' }]));
        const result = { ...base, ...skipped };
        return result;
    });
    const [schemaTypes, setSchemaTypes] = useState(FALLBACK_TYPES);
    const [schemaFallback, setSchemaFallback] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const isMounted = useRef(true);

    useEffect(() => {
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

    useEffect(() => {
        fetchSchema(getConfig(), (newToken) => globalConfig.setAsync('token', newToken))
            .then(schema => {
                if (!isMounted.current) return;

                const raw = schema.fieldTypes;
                if (!raw) return;

                let types;
                if (Array.isArray(raw)) {
                    types = raw.map(item => ({
                        value: String(item.value ?? item.name ?? item),
                        label: String(item.label ?? item.name ?? item.value ?? item),
                    }));
                } else {
                    types = Object.entries(raw).map(([value, meta]) => ({
                        value,
                        label: typeof meta === 'string' ? meta : String(meta?.label ?? value),
                    }));
                }

                if (types.length > 0) setSchemaTypes(types);
            })
            .catch((err) => {
                // eslint-disable-next-line no-console
                console.warn('[Mapsemble] schema fetch failed, using fallback types:', err);
                if (isMounted.current) setSchemaFallback(true);
            });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    function getDefaultType(field) {
        const suggested = FIELD_TYPE_MAP[field.type];
        const match = suggested && schemaTypes.some(t => t.value === suggested);
        if (match) return suggested;
        return schemaTypes[0]?.value || '';
    }

    function handleFieldTypeChange(fieldId, remoteType) {
        setFieldMapping(prev => ({
            ...prev,
            [fieldId]: { remoteType },
        }));
    }

    function getFieldType(fieldId) {
        const field = fields.find(f => f.id === fieldId);
        if (!field) return '';
        const stored = fieldMapping[fieldId]?.remoteType;
        if (stored !== undefined) {
            const validValues = getFieldTypeOptions(field).map(t => t.value);
            if (stored === '' || validValues.includes(stored)) return stored;
        }
        return '';
    }

    function handleAutoDetect() {
        if (!labelField && firstTextField) {
            setLabelField(firstTextField.id);
        }
        const detected = {};
        for (const field of fields) {
            if (locationFieldIds.includes(field.id)) continue;
            detected[field.id] = { remoteType: getDefaultType(field) };
        }
        setFieldMapping(prev => ({ ...prev, ...detected }));
    }

    async function handleComplete() {
        const resolvedMapping = {};
        for (const field of fields) {
            const remoteType = getFieldType(field.id);
            if (remoteType) {
                resolvedMapping[field.id] = { remoteType, name: field.name };
            }
        }
        setIsSaving(true);
        setSaveError('');
        try {
            await onComplete({ labelField, fieldMapping: resolvedMapping });
        } catch (err) {
            if (isMounted.current) {
                setSaveError(err.message || 'Failed to save. Please try again.');
            }
        } finally {
            if (isMounted.current) {
                setIsSaving(false);
            }
        }
    }

    function getFieldTypeOptions(field) {
        const suggested = FIELD_TYPE_MAP[field.type];
        const available = suggested
            ? schemaTypes.filter(t => t.value === suggested)
            : schemaTypes;
        return [{ value: '', label: '- skip -' }, ...available];
    }

    function getSlugMap() {
        const activeFields = fields
            .filter(field => getFieldType(field.id) !== '')
            .map(field => ({ fieldId: field.id, name: field.name }));
        return buildSlugMap(activeFields);
    }

    if (!table) {
        return (
            <Box padding={3}>
                <Text size="small" textColor="light">Table not found.</Text>
            </Box>
        );
    }

    return (
        <Box padding={3}>
            <Heading size="small" marginBottom={1}>Map your fields</Heading>
            <Text className="text-gray-500" marginBottom={2}>
                Choose how each Airtable field is represented on your map pins. Fields marked <em>skip</em> won't be included.
            </Text>


            {schemaFallback && (
                <Box padding={2} marginBottom={2} className="bg-amber-50 border border-amber-200 rounded-md">
                    <Text size="small" className="text-amber-700">
                        Could not load field types from Mapsemble. Using default types - you can adjust them manually.
                    </Text>
                </Box>
            )}

            <Box
                padding={2}
                marginBottom={3}
                className="!bg-amber-50 border !border-amber-200 !rounded-md !my-5"
            >
                <Text fontWeight="strong" className="!text-amber-800 !mb-2">
                    Data will be shared publicly
                </Text>
                <Text  className="text-amber-700 mt-1 !mb-5">
                    Mapped fields are synchronised to Mapsemble and may be visible through markers, filters, cards and popups. Only include fields you intend to expose. Fields marked <em>skip</em> won't be synchronised.
                </Text>

                <Text  className="text-amber-700 mt-1">
                  Need the map data to stay private? contact us at <a href="mailto://help@mapsemble.com" className="text-amber-700 underline">help@mapsemble.com</a>
                </Text>
            </Box>
            <Box
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              padding={2}
              marginBottom={3}
              paddingBottom={3}
              className="!bg-blue-50 border !border-blue-200 !rounded-md"
            >
                <Box flex="1" marginRight={3}>
                    <Text  className="!text-blue-800">
                        Auto-configure fields
                    </Text>
                    <Text size="small" className="!text-blue-700 !mt-1">
                        Detects field types from your Airtable schema and sets the label to your first text field. You can adjust anything afterwards.
                    </Text>
                </Box>
                <Button variant="primary" size="small" onClick={handleAutoDetect} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                    Auto-detect
                </Button>
            </Box>
            <FormField
                label="Label field"
                description="Required. This field will be used as the display name for each map pin."
                marginBottom={3}
            >
                <Select
                    options={[
                        { value: '', label: '- select a label field -' },
                        ...fields.map(f => ({ value: f.id, label: f.name })),
                    ]}
                    value={labelField}
                    onChange={value => setLabelField(value)}
                />
            </FormField>

            {fields.length > 0 && (
                <Box marginBottom={3}>
                    <Box marginBottom={1}>
                        <Text size="small" className="text-gray-500 font-semibold uppercase tracking-[0.05em]">Field mapping</Text>
                    </Box>
                    <Box className="max-h-60 overflow-y-auto">
                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                            <colgroup>
                                <col style={{ width: '33.33%' }} />
                                <col style={{ width: '33.33%' }} />
                                <col style={{ width: '33.34%' }} />
                            </colgroup>
                            <thead style={{ position: 'sticky', top: 0, backgroundColor: '#fff', zIndex: 1 }}>
                                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                    <th style={{ textAlign: 'left', padding: '4px 4px 6px', fontWeight: 'normal' }}>
                                        <Text size="small" className="text-gray-500 font-semibold uppercase tracking-[0.05em]">Airtable field</Text>
                                    </th>
                                    <th style={{ textAlign: 'left', padding: '4px 4px 6px', fontWeight: 'normal' }}>
                                        <Text size="small" className="text-gray-500 font-semibold uppercase tracking-[0.05em] whitespace-nowrap">Mapsemble field</Text>
                                    </th>
                                    <th style={{ textAlign: 'left', padding: '4px 4px 6px', fontWeight: 'normal' }}>
                                        <Text size="small" className="text-gray-500 font-semibold uppercase tracking-[0.05em]">Field type</Text>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {(() => {
                                    const slugMap = getSlugMap();
                                    return fields.map(field => {
                                        const slug = slugMap[field.id];
                                        return (
                                            <tr key={field.id}>
                                                <td style={{ padding: '2px 4px', overflow: 'hidden' }}>
                                                    <Text size="small" className="truncate block" title={field.name}>
                                                        {field.name}
                                                    </Text>
                                                </td>
                                                <td style={{ padding: '2px 4px', overflow: 'hidden' }}>
                                                    {slug ? (
                                                        <Text size="small" className="font-mono text-gray-500 truncate block" title={slug}>
                                                            {slug}
                                                        </Text>
                                                    ) : (
                                                        <Text size="small" className="text-gray-300">-</Text>
                                                    )}
                                                </td>
                                                <td style={{ padding: '2px 4px' }}>
                                                    <Select
                                                        size="small"
                                                        options={getFieldTypeOptions(field)}
                                                        value={getFieldType(field.id)}
                                                        onChange={value => handleFieldTypeChange(field.id, value)}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    });
                                })()}
                            </tbody>
                        </table>
                    </Box>
                </Box>
            )}

            {saveError && (
                <Box
                    padding={2}
                    marginBottom={2}
                    className="bg-red-50 border border-red-200 rounded"
                >
                    <Text size="small" className="text-red-700">{saveError}</Text>
                </Box>
            )}

            <Box display="flex" className="gap-2">
                <Button onClick={onBack} variant="default" flex="1">
                    ← Back
                </Button>
                <Button
                    onClick={handleComplete}
                    disabled={!canWrite || !labelField || isSaving}
                    variant="primary"
                    flex="2"
                >
                    {isSaving ? 'Saving…' : 'Save and continue →'}
                </Button>
            </Box>
        </Box>
    );
}
