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
const FORMAT_DESCRIPTIONS = {
    geojson: 'GeoJSON geometry stored as a JSON string, e.g. {"type":"Point","coordinates":[2.35,48.85]}',
    wkt: 'Well-Known Text geometry, e.g. POINT(2.3522 48.8566)',
    coordinate_pair: 'Latitude and longitude in one field, e.g. 48.8566, 2.3522',
    address: 'Street address or place name - Mapsemble will geocode it to coordinates.',
    default: 'Coming soon',
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

export default function LocationMapper({ tableId, initialConfig, onComplete, onCancel, hasGeocoding, isMapActive }) {
    const base = useBase();
    const globalConfig = useGlobalConfig();
    const canWrite = globalConfig.hasPermissionToSet();
    const table = base.getTableByIdIfExists(tableId);
    const fields = table ? table.fields : [];

    const defaultLocationMode = (() => {
        if (initialConfig?.locationMode) return initialConfig.locationMode;
        const latPatterns = /^(lat|latitude)$/i;
        const lngPatterns = /^(lon|lng|longitude)$/i;
        const hasLat = fields.some(f => latPatterns.test(f.name));
        const hasLng = fields.some(f => lngPatterns.test(f.name));
        if (hasLat && hasLng) return 'dual';
        return 'single';
    })();
    const [locationMode, setLocationMode] = useState(defaultLocationMode);
    const [latField, setLatField] = useState(initialConfig?.latField || '');
    const [lngField, setLngField] = useState(initialConfig?.lngField || '');
    const [locationColumn, setLocationColumn] = useState(initialConfig?.locationColumn || '');
    const [locationFormat, setLocationFormat] = useState(
        initialConfig?.locationFormat && initialConfig.locationFormat !== 'auto'
            ? initialConfig.locationFormat
            : '',
    );

    // Re-detect location mode only when the user switches tables — never override
    // the saved/initial mode on first render.
    const didMountRef = useRef(false);
    useEffect(() => {
        if (!didMountRef.current) {
            didMountRef.current = true;
            return;
        }
        if (!fields.length) return;
        const latPatterns = /^(lat|latitude)$/i;
        const lngPatterns = /^(lon|lng|longitude)$/i;
        const hasLat = fields.some(f => latPatterns.test(f.name));
        const hasLng = fields.some(f => lngPatterns.test(f.name));
        setLocationMode(hasLat && hasLng ? 'dual' : 'single');
    }, [tableId]);

    // Auto-detect lat/lng fields in dual-column mode
    useEffect(() => {
        if (locationMode !== 'dual' || latField || lngField || !fields.length) return;
        const latPatterns = /^(lat|latitude)$/i;
        const lngPatterns = /^(lon|lng|longitude)$/i;
        const matchedLat = fields.find(f => latPatterns.test(f.name));
        const matchedLng = fields.find(f => lngPatterns.test(f.name));
        if (matchedLat) setLatField(matchedLat.id);
        if (matchedLng) setLngField(matchedLng.id);
    }, [locationMode, fields]);

    const geocodingAvailable = hasGeocoding && isMapActive !== false;
    const canAdvance = locationMode === 'dual'
        ? latField && lngField
        : locationColumn && locationFormat;

    const fieldOptions = [
        { value: '', label: '- none -' },
        ...fields.map(f => ({ value: f.id, label: f.name })),
    ];
    const locationColumnOptions = [
        { value: '', label: '- select column -' },
        ...fields.map(f => ({ value: f.id, label: f.name })),
    ];
    const locationFormatOptions = [
        { value: '', label: '- select format -' },
        { value: 'geojson', label: 'GeoJSON' },
        { value: 'wkt', label: 'WKT' },
        { value: 'coordinate_pair', label: 'Coordinate Pair (lat, lng)' },
        { value: 'address', label: geocodingAvailable ? 'Geocoding (PRO)' : 'Geocoding (PRO)' },
    ];

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
                    description="Location is in a single field - address, coordinates, WKT, or GeoJSON."
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
                            <FormField label="Format">
                                <Select
                                    size="small"
                                    options={locationFormatOptions}
                                    value={locationFormat}
                                    onChange={value => setLocationFormat(value)}
                                />
                            </FormField>
                            {locationFormat && (
                                <Text size="small" className="text-gray-500 mt-1">
                                    {FORMAT_DESCRIPTIONS[locationFormat] || ''}
                                </Text>
                            )}
                            {locationFormat === 'address' && !hasGeocoding && (
                                <Box padding={2} marginTop={2} className="bg-blue-50 border border-blue-200 rounded">
                                    <Text size="small" className="text-blue-800">
                                        Geocoding is only available on the PRO plan. Upgrade Mapsemble to PRO to use geocoding.
                                    </Text>
                                </Box>
                            )}
                            {locationFormat === 'address' && hasGeocoding && isMapActive === false && (
                                <Box padding={2} marginTop={2} className="bg-amber-50 border border-amber-200 rounded">
                                    <Text size="small" className="text-amber-800">
                                        Geocoding is only available on active maps. Activate your map in Mapsemble to enable geocoding.
                                    </Text>
                                </Box>
                            )}
                            {locationFormat === 'address' && geocodingAvailable && (
                                <Box padding={2} marginTop={2} className="bg-blue-50 border border-blue-200 rounded">
                                    <Text size="small" className="text-blue-800">
                                        Mapsemble will geocode addresses and text fields to coordinates automatically when you sync.
                                    </Text>
                                </Box>
                            )}
                        </>
                    )}
                </Box>
            )}

            {!canAdvance && (
                <Text size="small" marginBottom={2} className="text-amber-600">
                    {locationMode === 'dual'
                        ? 'Select both a latitude and a longitude field to continue.'
                        : 'Select a location column and format to continue.'}
                </Text>
            )}

            <Box display="flex" className="gap-2">
                <Button onClick={onCancel} variant="default" flex="1">
                    Cancel
                </Button>
                <Button
                    onClick={handleComplete}
                    disabled={!canWrite || !canAdvance}
                    variant="primary"
                    flex="2"
                >
                    Next: Map fields →
                </Button>
            </Box>
        </Box>
    );
}
