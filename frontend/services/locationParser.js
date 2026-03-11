import wellknown from 'wellknown';

const WKT_PREFIXES = [
    'POINT', 'POLYGON', 'LINESTRING', 'MULTIPOINT',
    'MULTIPOLYGON', 'MULTILINESTRING', 'GEOMETRYCOLLECTION', 'GEOMETRY',
];

const COORD_PAIR_RE = /^\s*-?\d+\.?\d*\s*[,;\s]\s*-?\d+\.?\d*\s*$/;

/**
 * Detects the format of a single location string value.
 * @param {string} value
 * @returns {'geojson' | 'wkt' | 'coordinate_pair' | 'address'}
 */
export function detectFormat(value) {
    const trimmed = String(value).trim();

    if (trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (
                parsed &&
                typeof parsed.type === 'string' &&
                (parsed.coordinates !== undefined ||
                 parsed.features !== undefined ||
                 parsed.geometries !== undefined)
            ) {
                return 'geojson';
            }
        } catch (_e) {
            // not valid JSON
        }
    }

    const upper = trimmed.toUpperCase();
    for (const prefix of WKT_PREFIXES) {
        if (upper.startsWith(prefix)) {
            return 'wkt';
        }
    }

    if (COORD_PAIR_RE.test(trimmed)) {
        return 'coordinate_pair';
    }

    return 'address';
}

/**
 * Detects the predominant format across a sample of values.
 * @param {string[]} sampleValues
 * @returns {{ format: string, hasMixed: boolean }}
 */
export function detectColumnFormat(sampleValues) {
    const sample = sampleValues.filter(v => v && String(v).trim() !== '').slice(0, 10);

    if (sample.length === 0) {
        return { format: 'address', hasMixed: false };
    }

    const counts = {};
    for (const val of sample) {
        const fmt = detectFormat(val);
        counts[fmt] = (counts[fmt] || 0) + 1;
    }

    // Find majority format
    let majorityFormat = 'address';
    let majorityCount = 0;
    for (const [fmt, count] of Object.entries(counts)) {
        if (count > majorityCount) {
            majorityCount = count;
            majorityFormat = fmt;
        }
    }

    // Mixed if more than one distinct non-address format found
    const nonAddressFormats = Object.keys(counts).filter(f => f !== 'address');
    const hasMixed = nonAddressFormats.length > 1;

    return { format: majorityFormat, hasMixed };
}

/**
 * Parses a GeoJSON string to a geometry object.
 * @param {string} str
 * @returns {object | null}
 */
export function parseGeoJSON(str) {
    try {
        const parsed = JSON.parse(str);
        if (!parsed || typeof parsed !== 'object') return null;

        if (parsed.type === 'Feature') {
            return parsed.geometry || null;
        }

        if (parsed.type === 'FeatureCollection') {
            const first = parsed.features && parsed.features[0];
            return (first && first.geometry) || null;
        }

        // Geometry types
        const geometryTypes = ['Point', 'Polygon', 'LineString', 'MultiPoint',
                               'MultiPolygon', 'MultiLineString', 'GeometryCollection'];
        if (geometryTypes.includes(parsed.type)) {
            return parsed;
        }

        return null;
    } catch (_e) {
        return null;
    }
}

/**
 * Parses a WKT string to a GeoJSON geometry.
 * @param {string} str
 * @returns {object | null}
 */
export function parseWKT(str) {
    return wellknown(str);
}

/**
 * Parses a coordinate pair string (lat, lng order) to a GeoJSON Point.
 * @param {string} str
 * @returns {object | null}
 */
export function parseCoordinatePair(str) {
    const parts = str.trim().split(/[,;\s]+/).filter(Boolean);
    if (parts.length !== 2) return null;

    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lng)) return null;

    // Input is lat, lng → GeoJSON coordinates are [lng, lat]
    return { type: 'Point', coordinates: [lng, lat] };
}

/**
 * Parses a value to a GeoJSON geometry based on the specified format.
 * Does NOT handle 'auto' — caller must call detectFormat first.
 * @param {string} value
 * @param {'geojson' | 'wkt' | 'coordinate_pair' | 'address'} format
 * @returns {object | null}
 */
export function parseToGeometry(value, format) {
    const str = String(value);
    switch (format) {
        case 'geojson':
            return parseGeoJSON(str);
        case 'wkt':
            return parseWKT(str);
        case 'coordinate_pair':
            return parseCoordinatePair(str);
        default:
            return null;
    }
}
