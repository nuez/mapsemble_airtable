const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

/**
 * Register a webhook with the Airtable API for a given base/table.
 *
 * @param {string} baseId       - Airtable base ID (e.g. "appXXX")
 * @param {string} tableId      - Airtable table ID (e.g. "tblXXX") used as recordChangeScope
 * @param {string} notificationUrl - Full URL Airtable will POST to on changes
 * @param {string} pat          - Airtable Personal Access Token with webhook:manage scope
 * @returns {Promise<string>}   Resolves with the new webhook ID (e.g. "achXXX")
 */
export async function registerAirtableWebhook(baseId, tableId, notificationUrl, pat) {
    const url = `${AIRTABLE_API_BASE}/bases/${baseId}/webhooks`;

    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${pat}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                notificationUrl,
                specification: {
                    options: {
                        filters: {
                            fromSources: ['client'],
                            dataTypes: ['tableData'],
                            recordChangeScope: tableId,
                        },
                    },
                },
            }),
        });
    } catch (_err) {
        throw new Error('Could not reach Airtable API. Check your internet connection.');
    }

    if (!res.ok) {
        let message = `Airtable webhook registration failed (${res.status})`;
        try {
            const body = await res.json();
            if (body.error?.message) message = body.error.message;
            else if (body.message) message = body.message;
        } catch (_e) { /* ignore */ }
        throw new Error(message);
    }

    const data = await res.json();
    if (!data.id) {
        throw new Error('Airtable webhook registration response missing id');
    }
    return data.id;
}

/**
 * Check whether the given PAT has access to list webhooks for a base.
 *
 * @param {string} baseId - Airtable base ID (e.g. "appXXX")
 * @param {string} pat    - Airtable Personal Access Token
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function checkAirtableWebhookAccess(baseId, pat) {
    const url = `${AIRTABLE_API_BASE}/bases/${baseId}/webhooks`;

    let res;
    try {
        res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${pat}`,
            },
        });
    } catch (_err) {
        return { ok: false, message: 'Could not reach Airtable API. Check your internet connection.' };
    }

    if (res.ok) {
        return { ok: true };
    }

    let message = `Request failed (${res.status})`;
    try {
        const body = await res.json();
        if (body.error?.message) message = body.error.message;
        else if (body.message) message = body.message;
        if (res.status === 401) message = 'Invalid PAT - check your token in Settings.';
        if (res.status === 403) message = body.error?.message || 'Missing scope or base access. Ensure the PAT has data.records:read and webhook:manage scopes and that this base is in the token\'s Access list.';
    } catch (_e) { /* ignore */ }

    return { ok: false, message };
}

/**
 * Delete an Airtable webhook. Best-effort - errors are swallowed.
 *
 * @param {string} baseId     - Airtable base ID
 * @param {string} webhookId  - Airtable webhook ID
 * @param {string} pat        - Airtable Personal Access Token
 * @returns {Promise<void>}
 */
export async function deleteAirtableWebhook(baseId, webhookId, pat) {
    const url = `${AIRTABLE_API_BASE}/bases/${baseId}/webhooks/${webhookId}`;

    try {
        await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${pat}`,
            },
        });
    } catch (_err) {
        // best-effort, ignore errors
    }
}

/**
 * Fetch the notificationUrl for a specific webhook from Airtable.
 *
 * @param {string} baseId     - Airtable base ID (e.g. "appXXX")
 * @param {string} webhookId  - Airtable webhook ID (e.g. "achXXX")
 * @param {string} pat        - Airtable Personal Access Token
 * @returns {Promise<string|null>} The notificationUrl, or null if not found
 */
export async function getAirtableWebhookNotificationUrl(baseId, webhookId, pat) {
    const url = `${AIRTABLE_API_BASE}/bases/${baseId}/webhooks`;

    let res;
    try {
        res = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${pat}` },
        });
    } catch (_err) {
        return null;
    }

    if (!res.ok) return null;

    const data = await res.json();
    const webhooks = data?.webhooks ?? [];
    const match = webhooks.find(w => w.id === webhookId);
    if (!match) return null;

    return match.notificationUrl
        ?? match.specification?.options?.notificationUrl
        ?? null;
}

/**
 * Check whether the given PAT has the required scopes for full sync:
 *   - webhook:manage  (tested via GET /bases/{baseId}/webhooks)
 *   - data.records:read (tested via GET /v0/{baseId}/{tableId}?maxRecords=0)
 *
 * Also detects when the PAT doesn't have the base in its Access list.
 *
 * @param {string} baseId  - Airtable base ID (e.g. "appXXX")
 * @param {string} tableId - Airtable table ID (e.g. "tblXXX")
 * @param {string} pat     - Airtable Personal Access Token
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
export async function checkPatScopes(baseId, tableId, pat) {
    const errors = [];

    // Test webhook:manage scope (+ base access)
    try {
        const whRes = await fetch(`${AIRTABLE_API_BASE}/bases/${baseId}/webhooks`, {
            headers: { 'Authorization': `Bearer ${pat}` },
        });
        if (whRes.status === 401) {
            return { ok: false, errors: ['Invalid token. Please check your Personal Access Token.'] };
        }
        if (whRes.status === 403 || whRes.status === 404) {
            // Could be missing scope OR missing base access - Airtable returns 404 for bases not in Access list
            const body = await whRes.json().catch(() => ({}));
            const msg = body.error?.message || '';
            if (msg.toLowerCase().includes('scope')) {
                errors.push('Missing webhook:manage scope.');
            } else {
                errors.push('Missing webhook:manage scope, or this base is not included in the token\'s Access list.');
            }
        }
    } catch (_err) {
        return { ok: false, errors: ['Could not reach Airtable API. Check your internet connection.'] };
    }

    // Test data.records:read scope
    try {
        const recRes = await fetch(`${AIRTABLE_API_BASE}/${baseId}/${tableId}?maxRecords=0`, {
            headers: { 'Authorization': `Bearer ${pat}` },
        });
        if (recRes.status === 403 || recRes.status === 404) {
            const body = await recRes.json().catch(() => ({}));
            const msg = body.error?.message || '';
            if (msg.toLowerCase().includes('scope')) {
                errors.push('Missing data.records:read scope.');
            } else if (!errors.length) {
                // Only add base-access error if we didn't already flag it above
                errors.push('Missing data.records:read scope, or this base is not included in the token\'s Access list.');
            }
        }
    } catch (_err) {
        // Already checked connectivity above, so ignore
    }

    return { ok: errors.length === 0, errors };
}

/**
 * List all webhooks for a base.
 *
 * @param {string} baseId - Airtable base ID
 * @param {string} pat    - Airtable Personal Access Token
 * @returns {Promise<Array>} Array of webhook objects, or empty array on error
 */
export async function listAirtableWebhooks(baseId, pat) {
    const res = await fetch(`${AIRTABLE_API_BASE}/bases/${baseId}/webhooks`, {
        headers: { 'Authorization': `Bearer ${pat}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.webhooks ?? [];
}

/**
 * Refresh (extend by 7 days) an existing Airtable webhook.
 *
 * @param {string} baseId     - Airtable base ID
 * @param {string} webhookId  - Airtable webhook ID
 * @param {string} pat        - Airtable Personal Access Token
 * @returns {Promise<void>}
 */
export async function refreshAirtableWebhook(baseId, webhookId, pat) {
    const url = `${AIRTABLE_API_BASE}/bases/${baseId}/webhooks/${webhookId}/refresh`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${pat}`,
                'Content-Type': 'application/json',
            },
        });
        return res.ok;
    } catch (_err) {
        return false;
    }
}
