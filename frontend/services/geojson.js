import { detectFormat, parseToGeometry } from './locationParser.js';

/**
 * Converts a human-readable label to a URL/token-safe slug.
 * e.g. "First Name" → "first-name", "café au lait" → "caf-au-lait"
 */
export function toSlug(name) {
    return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Takes an array of options with a `key` property and returns a new array
 * where duplicate keys get a _2, _3, … suffix.
 */
export function deduplicateOptionKeys(options) {
    const seen = new Map();
    return options.map(opt => {
        const base = opt.key;
        const count = seen.get(base) || 0;
        seen.set(base, count + 1);
        return { ...opt, key: count === 0 ? base : `${base}_${count + 1}` };
    });
}

/**
 * Builds a fieldId → deduplicated-slug map from an ordered array of { fieldId, name }.
 * When two fields produce the same base slug, the second gets a _2 suffix, the third _3, etc.
 */
export function buildSlugMap(fieldEntries) {
    const seen = new Map(); // base slug → number of times seen so far
    const result = {};
    for (const { fieldId, name } of fieldEntries) {
        const base = toSlug(name || fieldId);
        const count = seen.get(base) || 0;
        seen.set(base, count + 1);
        result[fieldId] = count === 0 ? base : `${base}_${count + 1}`;
    }
    return result;
}

/**
 * Converts Airtable records + field mapping to a GeoJSON FeatureCollection.
 *
 * fieldMapping shape (from ColumnMapper):
 * {
 *   locationMode: 'dual' | 'single',   // defaults to 'dual'
 *   latField: 'fldXXX',                // used when locationMode === 'dual'
 *   lngField: 'fldXXX',
 *   locationColumn: 'fldXXX',          // used when locationMode === 'single'
 *   locationFormat: 'auto' | 'geojson' | 'wkt' | 'coordinate_pair' | 'address',
 *   fields: {
 *     fldXXX: { remoteType: 'text' | 'number' | ... },
 *     ...
 *   }
 * }
 */

/**
 * Returns the raw cell value from a record, normalised to a plain JS value.
 */
function getCellValue(record, fieldId) {
    // Guard against deleted fields - getCellValue throws if the field no longer exists
    if (!record.parentTable.getFieldByIdIfExists(fieldId)) return null;
    const val = record.getCellValue(fieldId);
    if (val === null || val === undefined) return null;

    // Attachments → array of URLs
    if (Array.isArray(val) && val.length > 0 && val[0] && val[0].url !== undefined) {
        return val.map(v => v.url);
    }

    // Multi-select → array of strings
    if (Array.isArray(val) && val.length > 0 && val[0] && val[0].name !== undefined) {
        return val.map(v => v.name);
    }

    // Single select / linked records
    if (typeof val === 'object' && val !== null && val.name !== undefined) {
        return val.name;
    }

    // Date strings, numbers, booleans, plain strings
    return val;
}

/**
 * Parses a coordinate cell value into a Number.
 * Accepts European decimal notation (single comma) by normalising to a dot.
 * Unwraps Airtable wrappers: single-element arrays (lookups) and { value }
 * objects (linked-record lookups returning { linkedRecordId, value }).
 * Returns { ok, value?, isEmpty?, raw? } so the caller can distinguish empty
 * cells (no warning) from non-numeric values (warning).
 */
function parseCoordinate(raw) {
    if (raw === null || raw === undefined) return { ok: false, isEmpty: true };

    let v = raw;
    if (Array.isArray(v)) {
        if (v.length === 0) return { ok: false, isEmpty: true };
        v = v[0];
    }
    if (v !== null && typeof v === 'object' && 'value' in v) {
        v = v.value;
    }
    if (v === null || v === undefined) return { ok: false, isEmpty: true };

    if (typeof v === 'number') {
        return isNaN(v)
            ? { ok: false, isEmpty: false, raw: String(raw) }
            : { ok: true, value: v };
    }

    if (typeof v === 'object') {
        return { ok: false, isEmpty: false, raw: `<${Object.keys(v).join(',') || 'object'}>` };
    }

    const str = String(v).trim();
    if (str === '') return { ok: false, isEmpty: true };
    const normalised = str.indexOf(',') === str.lastIndexOf(',')
        ? str.replace(',', '.')
        : str;
    if (!/^-?\d+(\.\d+)?$/.test(normalised)) {
        return { ok: false, isEmpty: false, raw: str };
    }
    return { ok: true, value: Number(normalised) };
}

/**
 * Converts a single Airtable record to a GeoJSON Feature.
 * Returns null when the row has no geometry and no address for server-side
 * geocoding — the caller filters these out so the prune phase deletes any
 * previously synced feature for that record.
 * If `skipped` is provided, the skipped record id is pushed to it.
 */
export function recordToFeature(record, fieldMapping, skipped = null) {
    const { locationMode, fields } = fieldMapping;
    let geometry = null;

    if (!locationMode || locationMode === 'dual') {
        const { latField, lngField } = fieldMapping;
        if (latField && lngField) {
            const latParsed = parseCoordinate(getCellValue(record, latField));
            const lngParsed = parseCoordinate(getCellValue(record, lngField));
            if (latParsed.ok && lngParsed.ok) {
                geometry = { type: 'Point', coordinates: [lngParsed.value, latParsed.value] };
            } else if (!latParsed.isEmpty || !lngParsed.isEmpty) {
                const latShow = latParsed.isEmpty ? '(empty)' : latParsed.raw;
                const lngShow = lngParsed.isEmpty ? '(empty)' : lngParsed.raw;
                // eslint-disable-next-line no-console
                console.warn(`[Mapsemble] Could not parse coordinates for record ${record.id} (lat: ${latShow}, lng: ${lngShow})`);
            }
        }
    } else if (locationMode === 'single') {
        const { locationColumn, locationFormat } = fieldMapping;
        if (locationColumn) {
            const rawValue = getCellValue(record, locationColumn);
            if (rawValue !== null && rawValue !== undefined) {
                const str = String(rawValue);
                const resolvedFormat = (!locationFormat || locationFormat === 'auto')
                    ? detectFormat(str)
                    : locationFormat;
                if (resolvedFormat !== 'address') {
                    geometry = parseToGeometry(str, resolvedFormat);
                    if (geometry === null) {
                        // eslint-disable-next-line no-console
                        console.warn(`[Mapsemble] Could not parse location for record ${record.id}`,
                            `(format: ${resolvedFormat}, value: ${str.slice(0, 80)})`);
                    }
                }
                // if resolvedFormat === 'address', geometry stays null (server geocodes)
            }
        }
    }

    const properties = {
        _airtable_id: record.id,
    };
    let hasAddressForGeocoding = false;

    // Include address value for geocoding
    if (locationMode === 'single' && fieldMapping.locationFormat === 'address' && fieldMapping.locationColumn) {
        const addressValue = getCellValue(record, fieldMapping.locationColumn);
        if (addressValue) {
            const addrSlug = toSlug(fieldMapping.locationColumnName || 'address');
            properties[addrSlug] = String(addressValue);
            hasAddressForGeocoding = true;
        }
    }

    if (geometry === null && !hasAddressForGeocoding) {
        if (skipped) skipped.push({ recordId: record.id });
        return null;
    }

    if (fields) {
        const slugMap = buildSlugMap(
            Object.entries(fields).map(([fieldId, meta]) => ({ fieldId, name: meta.name || fieldId }))
        );
        for (const [fieldId, fieldMeta] of Object.entries(fields)) {
            const value = getCellValue(record, fieldId);
            if (value !== null && value !== undefined) {
                properties[slugMap[fieldId]] = value;
            }
        }
    }

    if (fieldMapping.labelField) {
        const labelValue = getCellValue(record, fieldMapping.labelField);
        if (labelValue !== null && labelValue !== undefined) {
            properties.label = String(labelValue);
        }
    }

    return {
        type: 'Feature',
        geometry,
        properties,
    };
}

/**
 * Converts an array of Airtable records to a GeoJSON FeatureCollection.
 */
export function recordsToFeatureCollection(records, fieldMapping, skipped = null) {
    const features = records
        .map(record => recordToFeature(record, fieldMapping, skipped))
        .filter(f => f !== null && f !== undefined);

    return {
        type: 'FeatureCollection',
        features,
    };
}

/**
 * Builds the extended GeoJSON body expected by Mapsemble's from-geojson endpoint.
 * Includes field type metadata so Mapsemble can configure the popup template.
 */
export function buildFromGeoJsonPayload(label, records, fieldMapping) {
    const geojson = recordsToFeatureCollection(records, fieldMapping);

    // Attach field metadata as a top-level extension
    const fieldsMeta = {};
    if (fieldMapping.fields) {
        const slugMap = buildSlugMap(
            Object.entries(fieldMapping.fields).map(([fieldId, m]) => ({ fieldId, name: m.name || fieldId }))
        );
        for (const [fieldId, mapping] of Object.entries(fieldMapping.fields)) {
            fieldsMeta[slugMap[fieldId]] = { type: mapping.remoteType, label: mapping.name || fieldId };
        }
    }

    return {
        label,
        geojson: {
            ...geojson,
            _fieldsMeta: fieldsMeta,
        },
    };
}
