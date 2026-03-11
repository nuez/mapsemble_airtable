import React, { useState, useEffect } from 'react';
import {
    useBase,
    useRecords,
    useGlobalConfig,
    Box,
    Text,
    Heading,
    Button,
    FormField,
    Select,
} from '@airtable/blocks/ui';
import { detectColumnFormat } from '../services/locationParser.js';

const FORMAT_BADGE_CLASSES = {
    geojson: 'bg-emerald-100 text-emerald-900',
    wkt: 'bg-violet-100 text-violet-900',
    coordinate_pair: 'bg-blue-100 text-blue-800',
    default: 'bg-gray-100 text-gray-700',
};

const FORMAT_LABELS = {
    geojson: 'GeoJSON detected',
    wkt: 'WKT detected',
    coordinate_pair: 'Coordinate pair detected',
    default: 'Address detected',
};

const FORMAT_DESCRIPTIONS = {
    geojson: 'GeoJSON geometry stored as a JSON string, e.g. {"type":"Point","coordinates":[2.35,48.85]}',
    wkt: 'Well-Known Text geometry, e.g. POINT(2.3522 48.8566)',
    coordinate_pair: 'Latitude and longitude in one field, e.g. 48.8566, 2.3522',
    address: 'Plain text addresses — Mapsemble will geocode them automatically.',
    default: 'Plain text addresses — Mapsemble will geocode them automatically.',
};

function LocationModeCard({ selected, onClick, title, description }) {
    return (
        <Button
            onClick={onClick}
            variant={selected ? 'primary' : 'default'}
            flex="1"
            style={{ height: 'auto' }}
        >
            <Box style={{ margin: 5, whiteSpace: 'normal' }}>
                <Text fontWeight="strong" size="default" style={{ color: selected ? '#fff' : undefined }}>
                    {title}
                </Text>
                <Text size="small" style={{ color: selected ? 'rgba(255,255,255,0.7)' : undefined, opacity: selected ? 1 : 0.7, lineHeight: 1.4, marginTop: 2 }}>
                    {description}
                </Text>
            </Box>
        </Button>
    );
}

export default function LocationMapper({ tableId, initialConfig, onComplete, onCancel }) {
    const base = useBase();
    const table = base.getTableByIdIfExists(tableId);
    const fields = table ? table.fields : [];

    const [locationMode, setLocationMode] = useState(initialConfig?.locationMode || 'dual');
    const [latField, setLatField] = useState(initialConfig?.latField || '');
    const [lngField, setLngField] = useState(initialConfig?.lngField || '');
    const [locationColumn, setLocationColumn] = useState(initialConfig?.locationColumn || '');
    const [locationFormat, setLocationFormat] = useState(initialConfig?.locationFormat || 'auto');
    const [detectedFormat, setDetectedFormat] = useState(null);
    const [hasMixed, setHasMixed] = useState(false);

    const sampleRecords = useRecords(table, {
        fields: table
            ? (locationColumn ? [locationColumn] : [table.fields[0]?.id].filter(Boolean))
            : [],
    });

    useEffect(() => {
        if (locationMode !== 'single' || !locationColumn || !sampleRecords?.length) {
            setDetectedFormat(null);
            setHasMixed(false);
            return;
        }
        const sampleValues = sampleRecords
            .slice(0, 50)
            .map(r => {
                const val = r.getCellValue(locationColumn);
                return val !== null && val !== undefined ? String(val) : '';
            })
            .filter(v => v.trim() !== '');
        const result = detectColumnFormat(sampleValues);
        setDetectedFormat(result.format);
        setHasMixed(result.hasMixed);
    }, [locationMode, locationColumn, sampleRecords]);

    const canAdvance = locationMode === 'dual'
        ? latField && lngField
        : locationColumn;

    const fieldOptions = [
        { value: '', label: '— none —' },
        ...fields.map(f => ({ value: f.id, label: f.name })),
    ];
    const locationColumnOptions = [
        { value: '', label: '— select column —' },
        ...fields.map(f => ({ value: f.id, label: f.name })),
    ];
    const locationFormatOptions = [
        { value: 'auto', label: 'Auto-detect' },
        { value: 'geojson', label: 'GeoJSON' },
        { value: 'wkt', label: 'WKT' },
        { value: 'coordinate_pair', label: 'Coordinate Pair (lat, lng)' },
        { value: 'address', label: 'Address (server geocoded)' },
    ];

    const formatBadgeClasses = FORMAT_BADGE_CLASSES[detectedFormat] || FORMAT_BADGE_CLASSES.default;
    const formatLabel = FORMAT_LABELS[detectedFormat] || FORMAT_LABELS.default;
    const formatDescription = FORMAT_DESCRIPTIONS[detectedFormat] || FORMAT_DESCRIPTIONS.default;

    function handleComplete() {
        onComplete({
            locationMode,
            latField: locationMode === 'dual' ? latField : '',
            lngField: locationMode === 'dual' ? lngField : '',
            locationColumn: locationMode === 'single' ? locationColumn : '',
            locationFormat: locationMode === 'single' ? locationFormat : 'auto',
        });
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
            <Heading size="small" marginBottom={1}>Where is your location data?</Heading>
            <Text size="small" className="text-gray-500" marginBottom={3}>
                Tell us how location is stored in <strong>{table.name}</strong> so we can place your records on the map.
            </Text>

            {/* Mode cards */}
            <Box className="grid grid-cols-2 gap-5">
                <LocationModeCard
                    selected={locationMode === 'dual'}
                    onClick={() => setLocationMode('dual')}
                    title="Separate columns"
                    description="You have a Latitude column and a Longitude column."
                />
                <LocationModeCard
                    selected={locationMode === 'single'}
                    onClick={() => setLocationMode('single')}
                    title="One column"
                    description="Location is in a single field — address, coordinates, WKT, or GeoJSON."
                />
            </Box>

            {/* Dual mode fields */}
            {locationMode === 'dual' && (
                <Box


                    backgroundColor="white"
                    className="grid grid-cols-2 my-5 gap-5"
                >
                  <FormField label="Latitude field" flex="1">
                    <Select
                      size="small"
                      options={fieldOptions}
                      value={latField}
                      onChange={value => setLatField(value)}
                    />
                  </FormField>
                  <FormField label="Longitude field" flex="1">
                    <Select
                      size="small"
                      options={fieldOptions}
                      value={lngField}
                      onChange={value => setLngField(value)}
                    />
                  </FormField>
                </Box>
            )}

            {/* Single mode fields */}
            {locationMode === 'single' && (
                <Box
                    padding={2}
                    marginBottom={3}
                    className="bg-gray-50 border border-gray-200 rounded-md"
                >
                    <FormField label="Location column" marginBottom={locationColumn ? 2 : 0}>
                        <Select
                            size="small"
                            options={locationColumnOptions}
                            value={locationColumn}
                            onChange={value => setLocationColumn(value)}
                        />
                    </FormField>

                    {locationColumn && (
                        <>
                            {/* Detection result */}
                            <Box
                                padding={2}
                                marginBottom={2}
                                className="bg-white border border-gray-200 rounded"
                            >
                                <Box display="flex" alignItems="center" marginBottom={1} className="gap-1.5">
                                    {detectedFormat && (
                                        <Box
                                            as="span"
                                            className={`${formatBadgeClasses} rounded text-[11px] font-semibold py-0.5 px-2`}
                                        >
                                            {formatLabel}
                                        </Box>
                                    )}
                                    {hasMixed && (
                                        <Box
                                            as="span"
                                            className="bg-yellow-100 text-yellow-800 rounded text-[11px] font-semibold py-0.5 px-2"
                                        >
                                            Mixed formats
                                        </Box>
                                    )}
                                </Box>
                                <Text size="small" className="text-gray-500">
                                    {formatDescription}
                                </Text>
                                {hasMixed && (
                                    <Text size="small" className="text-amber-800 mt-1">
                                        Multiple formats found. Use the override below to pick one consistently.
                                    </Text>
                                )}
                            </Box>

                            <FormField label="Format override">
                                <Select
                                    size="small"
                                    options={locationFormatOptions}
                                    value={locationFormat}
                                    onChange={value => setLocationFormat(value)}
                                />
                            </FormField>
                        </>
                    )}
                </Box>
            )}

            {!canAdvance && (
                <Text size="small" marginBottom={2} className="text-amber-600">
                    {locationMode === 'dual'
                        ? 'Select both a latitude and a longitude field to continue.'
                        : 'Select a location column to continue.'}
                </Text>
            )}

            <Box display="flex" className="gap-2">
                <Button onClick={onCancel} variant="default" flex="1">
                    Cancel
                </Button>
                <Button
                    onClick={handleComplete}
                    disabled={!canAdvance}
                    variant="primary"
                    flex="2"
                >
                    Next: Map fields →
                </Button>
            </Box>
        </Box>
    );
}
