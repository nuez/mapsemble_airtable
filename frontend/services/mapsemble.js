/**
 * Mapsemble API client.
 *
 * Reads config from globalConfig (passed in at call time to keep this module
 * stateless and testable).
 *
 * config shape:
 * {
 *   clientId: '...',
 *   clientSecret: '...',
 *   token: '...',
 * }
 *
 * All public methods accept a `config` object and a `setToken` callback used
 * to persist a freshly-exchanged token back to globalConfig.
 */

export const MAPSEMBLE_URL = process.env.MAPSEMBLE_URL || 'https://app.mapsemble.com';


// Set NGROK_URL in .env (or environment) to route webhook registrations through ngrok.
// e.g. NGROK_URL=https://postelementary-juliet-crackly.ngrok-free.dev
export const NGROK_URL = process.env.NGROK_URL || null;

/**
 * Poll the Mapsemble authorization endpoint for credentials.
 * Used by the popup connection flow - no authentication required.
 * Returns { found, clientId, clientSecret } or { found: false }.
 */
export async function pollCredentials(state) {
    const res = await fetch(`${MAPSEMBLE_URL}/airtable/poll?state=${encodeURIComponent(state)}`);
    if (!res.ok && res.status !== 202) {
        throw new Error(`Poll request failed (${res.status})`);
    }
    return res.json();
}

/**
 * Exchange client credentials for a bearer token.
 * Returns the token string, or throws on failure.
 */
export async function exchangeToken(clientId, clientSecret) {
    let res;
    try {
        res = await fetch(`${MAPSEMBLE_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials_with_user',
                client_id: clientId,
                client_secret: clientSecret,
            }),
        });
    } catch (_err) {
        throw new Error(`Could not reach Mapsemble (${MAPSEMBLE_URL}). Check your internet connection.`);
    }

    if (!res.ok) {
        let message = `Authentication failed (${res.status})`;
        try {
            const body = await res.json();
            if (body.message) message = body.message;
            else if (body.error_description) message = body.error_description;
            else if (body.error) message = body.error;
        } catch (_e) {
            const text = await res.text().catch(() => '');
            if (text) message = `${message}: ${text}`;
        }
        throw new Error(message);
    }

    const data = await res.json();
    if (!data.access_token) {
        throw new Error('Token exchange response missing access_token');
    }
    return data.access_token;
}

/**
 * Internal fetch wrapper with automatic 401 retry.
 *
 * On a 401 response the client re-exchanges credentials, updates the token
 * via setToken(), then retries the request once.
 */
async function apiFetch(path, options, config, setToken) {
    const { clientId, clientSecret } = config;
    let { token } = config;

    const doRequest = async (t) => {
        try {
            return await fetch(`${MAPSEMBLE_URL}${path}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {}),
                    Authorization: `Bearer ${t}`,
                },
            });
        } catch (_err) {
            throw new Error(`Could not reach Mapsemble (${MAPSEMBLE_URL}). Check your internet connection.`);
        }
    };

    let res = await doRequest(token);

    if (res.status === 401) {
        // Re-exchange and retry once
        try {
            token = await exchangeToken(clientId, clientSecret);
            if (setToken) setToken(token);
        } catch (_err) {
            throw new Error('Session expired and re-authentication failed.');
        }
        res = await doRequest(token);
    }

    return res;
}

/**
 * Fetch the currently authenticated user profile.
 * Returns { name, email, ... } or throws.
 */
export async function fetchMe(config, setToken) {
    const res = await apiFetch('/api/v1/me', { method: 'GET' }, config, setToken);
    if (!res.ok) {
        let message = `Authentication failed (${res.status})`;
        try {
            const body = await res.json();
            if (body.message) message = body.message;
        } catch (_e) {}
        throw new Error(message);
    }
    return res.json();
}

/**
 * Create a map via POST /api/v1/maps.
 * payload: { label, fields: [{ slug, label, type, weight }] }
 * Returns the created map object { id, label, ... }.
 */
export async function createMap(payload, config, setToken) {
    const res = await apiFetch(
        '/api/v1/maps',
        {
            method: 'POST',
            body: JSON.stringify(payload),
        },
        config,
        setToken,
    );

    if (!res.ok) {
        let message = `Map creation failed (${res.status})`;
        try {
            const body = await res.json();
            if (body.message) {
                message = body.message;
            }
            if (body.errors) {
                const details = Object.entries(body.errors)
                    .map(([field, msgs]) => {
                        const val = Array.isArray(msgs)
                            ? msgs.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join(', ')
                            : (typeof msgs === 'string' ? msgs : JSON.stringify(msgs));
                        return `${field}: ${val}`;
                    })
                    .join(' | ');
                message = body.message ? `${body.message} - ${details}` : details;
            }
        } catch (_e) {
            const text = await res.text().catch(() => '');
            if (text) message = `${message}: ${text}`;
        }
        throw new Error(message);
    }

    return res.json();
}

/**
 * Sync a batch of GeoJSON features to a map.
 * features: array of GeoJSON Feature objects with _airtable_id in properties.
 * Returns the API response body.
 */
export async function syncFeatures(mapId, features, config, setToken) {
    const BATCH_SIZE = 500;
    const batches = [];
    for (let i = 0; i < features.length; i += BATCH_SIZE) {
        batches.push(features.slice(i, i + BATCH_SIZE));
    }

    let lastResult;
    for (const batch of batches) {
        const requestBody = {
            type: 'FeatureCollection',
            features: batch,
            remoteField: '_airtable_id',
        };
        const res = await apiFetch(
            `/api/v1/maps/${mapId}/features`,
            {
                method: 'POST',
                body: JSON.stringify(requestBody),
            },
            config,
            setToken,
        );

        if (res.status === 404) {
            const e = new Error('Map not found - it may have been deleted in Mapsemble (404)');
            e.code = 'MAP_NOT_FOUND';
            throw e;
        }

        if (!res.ok) {
            console.log('[syncFeatures] Response status:', res.status);
            let message = `Feature sync failed (${res.status})`;
            try {
                const body = await res.json();
                console.log('[syncFeatures] Response body:', body);
                if (body.message) {
                    message = body.message;
                }
                if (body.errors) {
                    const details = Object.entries(body.errors)
                        .map(([field, msgs]) => {
                            const val = Array.isArray(msgs)
                                ? msgs.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join(', ')
                                : (typeof msgs === 'string' ? msgs : JSON.stringify(msgs));
                            return `${field}: ${val}`;
                        })
                        .join(' | ');
                    message = body.message ? `${body.message} - ${details}` : details;
                }
            } catch (_e) {
                const text = await res.text().catch(() => '');
                if (text) message = `${message}: ${text}`;
            }
            throw new Error(message);
        }

        lastResult = await res.json();
    }

    return lastResult;
}

/**
 * Full-reconciliation sync via PUT /api/v1/maps/{mapId}/features.
 * The backend upserts matching features and deletes unmatched ones.
 * features: array of GeoJSON Feature objects with _airtable_id in properties.
 * Only usable for ≤1000 features (backend hard limit).
 */
export async function putFeatures(mapId, features, config, setToken) {
    const requestBody = {
        type: 'FeatureCollection',
        features,
        remoteField: '_airtable_id',
    };
    const res = await apiFetch(
        `/api/v1/maps/${mapId}/features`,
        {
            method: 'PUT',
            body: JSON.stringify(requestBody),
        },
        config,
        setToken,
    );

    if (res.status === 404) {
        const e = new Error('Map not found - it may have been deleted in Mapsemble (404)');
        e.code = 'MAP_NOT_FOUND';
        throw e;
    }

    if (!res.ok) {
        let message = `Feature PUT failed (${res.status})`;
        try {
            const body = await res.json();
            if (body.message) message = body.message;
            if (body.errors) {
                const details = Object.entries(body.errors)
                    .map(([field, msgs]) => {
                        const val = Array.isArray(msgs)
                            ? msgs.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join(', ')
                            : (typeof msgs === 'string' ? msgs : JSON.stringify(msgs));
                        return `${field}: ${val}`;
                    })
                    .join(' | ');
                message = body.message ? `${body.message} - ${details}` : details;
            }
        } catch (_e) {
            const text = await res.text().catch(() => '');
            if (text) message = `${message}: ${text}`;
        }
        throw new Error(message);
    }

    return res.json();
}

/**
 * Paginate GET /api/v1/maps/{mapId}/features and collect all _airtable_id values.
 * Requires the backend to support ?page=N&per_page=500.
 * Returns a Set<string> of all _airtable_id values currently on the map.
 */
export async function fetchAllMapAirtableIds(mapId, config, setToken, onProgress) {
    const ids = new Set();
    let page = 1;
    const perPage = 500;

    while (true) {
        const res = await apiFetch(
            `/api/v1/maps/${mapId}/features?page=${page}&per_page=${perPage}`,
            { method: 'GET' },
            config,
            setToken,
        );

        if (res.status === 404) {
            const e = new Error('Map not found - it may have been deleted in Mapsemble (404)');
            e.code = 'MAP_NOT_FOUND';
            throw e;
        }

        if (!res.ok) {
            let message = `Failed to fetch map features (${res.status})`;
            try {
                const body = await res.json();
                if (body.message) message = body.message;
            } catch (_e) {}
            throw new Error(message);
        }

        const data = await res.json();
        const features = data?.featureCollection?.features ?? [];
        const total = data?.featureCollection?.properties?.total ?? null;

        for (const f of features) {
            const id = f?.properties?._airtable_id;
            if (id) ids.add(id);
        }

        if (onProgress) onProgress(ids.size, total);

        if (features.length < perPage) break;
        page++;
    }

    return ids;
}

/**
 * Delete map features by their _airtable_id values via DELETE /api/v1/maps/{mapId}/features.
 * airtableIds: array of _airtable_id strings (max 1000 per call).
 */
export async function deleteFeaturesByAirtableIds(mapId, airtableIds, config, setToken) {
    const requestBody = {
        type: 'FeatureCollection',
        remoteField: '_airtable_id',
        features: airtableIds.map(id => ({
            type: 'Feature',
            geometry: null,
            properties: { _airtable_id: id },
        })),
    };

    const res = await apiFetch(
        `/api/v1/maps/${mapId}/features`,
        {
            method: 'DELETE',
            body: JSON.stringify(requestBody),
        },
        config,
        setToken,
    );

    // 204 No Content is a success
    if (res.status === 204) return;

    if (!res.ok) {
        let message = `Feature deletion failed (${res.status})`;
        try {
            const body = await res.json();
            if (body.message) message = body.message;
            if (body.errors) {
                const details = Object.entries(body.errors)
                    .map(([field, msgs]) => {
                        const val = Array.isArray(msgs)
                            ? msgs.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join(', ')
                            : (typeof msgs === 'string' ? msgs : JSON.stringify(msgs));
                        return `${field}: ${val}`;
                    })
                    .join(' | ');
                message = body.message ? `${body.message} - ${details}` : details;
            }
        } catch (_e) {
            const text = await res.text().catch(() => '');
            if (text) message = `${message}: ${text}`;
        }
        throw new Error(message);
    }
}

/**
 * Update an existing map's field definitions via PATCH /api/v1/maps/{mapId}.
 * payload: { fields: [{ slug, label, type, weight, required, config? }] }
 * Returns the updated map object or throws.
 */
export async function updateMap(mapId, payload, config, setToken) {
  const res = await apiFetch(
        `/api/v1/maps/${mapId}`,
        {
            method: 'PATCH',
            body: JSON.stringify(payload),
        },
        config,
        setToken,
    );

    if (!res.ok) {
        let message = `Map update failed (${res.status})`;
        try {
            const body = await res.json();
            if (body.message) message = body.message;
            if (body.errors) {
                const details = Object.entries(body.errors)
                    .map(([field, msgs]) => {
                        const val = Array.isArray(msgs)
                            ? msgs.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join(', ')
                            : (typeof msgs === 'string' ? msgs : JSON.stringify(msgs));
                        return `${field}: ${val}`;
                    })
                    .join(' | ');
                message = body.message ? `${body.message} - ${details}` : details;
            }
        } catch (_e) {
            const text = await res.text().catch(() => '');
            if (text) message = `${message}: ${text}`;
        }
        throw new Error(message);
    }

    return res.json();
}

/**
 * Fetch all maps accessible by the authenticated user via GET /api/v1/maps.
 * Returns an array of map objects (each with at least { id }) or throws.
 */
export async function fetchMaps(config, setToken) {
    const res = await apiFetch('/api/v1/maps', { method: 'GET' }, config, setToken);
    if (!res.ok) throw new Error(`Failed to fetch maps (${res.status})`);
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    return [];
}

/**
 * Fetch the API schema, including available field types.
 * Returns the schema object or throws.
 *
 * Expected response shape:
 *   { fieldTypes: [{ value: 'text', label: 'Text' }, ...] }
 *   or { fieldTypes: { text: 'Text', ... } }
 */
export async function fetchSchema(config, setToken) {
    const res = await apiFetch('/api/v1/schema', { method: 'GET' }, config, setToken);
    if (!res.ok) throw new Error(`Failed to load field types from Mapsemble (${res.status})`);
    return res.json();
}
