import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    useGlobalConfig,
    useBase,
    Box,
    Text,
    Heading,
    Button,
    FormField,
    Input,
    Link,
} from '@airtable/blocks/ui';
import { exchangeToken, fetchMe, pollCredentials, MAPSEMBLE_URL } from '../services/mapsemble';
import { checkPatScopes } from '../services/airtable';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export default function Setup({ onComplete, onDismiss, onDisconnect, onCreateMap }) {
    const globalConfig = useGlobalConfig();
    const canWrite = globalConfig.hasPermissionToSet();
    const base = useBase();

    const [clientId, setClientId] = useState(globalConfig.get('clientId') || '');
    const [clientSecret, setClientSecret] = useState(globalConfig.get('clientSecret') || '');
    const [airtablePat, setAirtablePat] = useState(globalConfig.get('airtablePat') || '');

    const [status, setStatus] = useState(null); // null | 'checking' | 'ok' | 'error' | 'polling'
    const [userName, setUserName] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [showManual, setShowManual] = useState(false);
    const [patValidating, setPatValidating] = useState(false);
    const [patErrors, setPatErrors] = useState([]);
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

    const pollTimerRef = useRef(null);
    const pollTimeoutRef = useRef(null);
    const popupRef = useRef(null);

    useEffect(() => {
        const savedToken = globalConfig.get('token');
        if (savedToken && clientId && clientSecret) {
            checkConnection({ clientId, clientSecret, token: savedToken });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        };
    }, []);

    async function checkConnection(config) {
        setStatus('checking');
        setErrorMsg('');
        try {
            let token = config.token;
            if (!token) {
                token = await exchangeToken(config.clientId, config.clientSecret);
            }

            const me = await fetchMe(
                { ...config, token },
                (newToken) => globalConfig.setAsync('token', newToken),
            );

            await globalConfig.setAsync('featureFlags', me.featureFlags || []);
            setUserName(me.name || me.email || 'Connected');
            setStatus('ok');
            return token;
        } catch (err) {
            setStatus('error');
            setErrorMsg(err.message);
            return null;
        }
    }

    async function handleSave() {
        const config = { clientId, clientSecret, token: null };

        const token = await checkConnection(config);
        if (!token) return;

        await globalConfig.setAsync('clientId', clientId);
        await globalConfig.setAsync('clientSecret', clientSecret);
        await globalConfig.setAsync('token', token);
        await globalConfig.setAsync('airtablePat', airtablePat || null);
    }

    const stopPolling = useCallback(() => {
        if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }
        if (pollTimeoutRef.current) {
            clearTimeout(pollTimeoutRef.current);
            pollTimeoutRef.current = null;
        }
    }, []);

    const handlePopupConnect = useCallback(async () => {
        const state = crypto.randomUUID();
        const popupUrl = `${MAPSEMBLE_URL}/airtable/authorize?state=${encodeURIComponent(state)}`;

        // Open popup
        const popup = window.open(popupUrl, 'mapsemble_connect', 'width=600,height=700,menubar=no,toolbar=no');
        popupRef.current = popup;

        if (!popup) {
            setStatus('error');
            setErrorMsg('Popup was blocked by your browser. Please allow popups for Airtable and try again.');
            return;
        }

        setStatus('polling');
        setErrorMsg('');

        // Start polling
        pollTimerRef.current = setInterval(async () => {
            // Check if popup was closed without completing
            if (popupRef.current && popupRef.current.closed) {
                // Give one last poll in case the credentials were just cached
                try {
                    const result = await pollCredentials(state);
                    if (result.found) {
                        stopPolling();
                        await onCredentialsReceived(result.clientId, result.clientSecret);
                        return;
                    }
                } catch (_e) {
                    // ignore
                }
                stopPolling();
                setStatus(null);
                return;
            }

            try {
                const result = await pollCredentials(state);
                if (result.found) {
                    stopPolling();
                    if (popupRef.current && !popupRef.current.closed) {
                        // Popup will auto-close itself via the auto-close stimulus controller
                    }
                    await onCredentialsReceived(result.clientId, result.clientSecret);
                }
            } catch (_err) {
                // Transient error, keep polling
            }
        }, POLL_INTERVAL_MS);

        // Set a 5-minute timeout
        pollTimeoutRef.current = setTimeout(() => {
            stopPolling();
            if (popupRef.current && !popupRef.current.closed) {
                popupRef.current.close();
            }
            setStatus('error');
            setErrorMsg('Connection timed out. Please try again.');
        }, POLL_TIMEOUT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stopPolling]);

    async function onCredentialsReceived(newClientId, newClientSecret) {
        setClientId(newClientId);
        setClientSecret(newClientSecret);

        // Exchange for token and verify
        setStatus('checking');
        try {
            const token = await exchangeToken(newClientId, newClientSecret);
            const me = await fetchMe(
                { clientId: newClientId, clientSecret: newClientSecret, token },
                (newToken) => globalConfig.setAsync('token', newToken),
            );

            await globalConfig.setAsync('clientId', newClientId);
            await globalConfig.setAsync('clientSecret', newClientSecret);
            await globalConfig.setAsync('token', token);
            await globalConfig.setAsync('featureFlags', me.featureFlags || []);

            setUserName(me.name || me.email || 'Connected');
            setStatus('ok');
        } catch (err) {
            setStatus('error');
            setErrorMsg(err.message);
        }
    }

    return (
        <Box padding={3} height="100%">
            <Heading size="small" marginBottom={2}>Mapsemble Connection</Heading>

            {!canWrite && (
                <Box padding={2} marginBottom={2} className="bg-amber-50 border border-amber-200 rounded-md">
                    <Text size="small" className="text-amber-700">
                        You don't have permission to modify settings. Contact a base collaborator with creator permissions.
                    </Text>
                </Box>
            )}

            <Text size="small" textColor="light" marginBottom={3}>
                Connecting to{' '}
                <Box as="span" fontFamily="monospace">{MAPSEMBLE_URL}</Box>
            </Text>

            {/* Primary: One-click popup flow */}
            {!showManual && status !== 'ok' && (
                <Box marginBottom={3}>
                    <Button
                        onClick={handlePopupConnect}
                        disabled={!canWrite || status === 'polling' || status === 'checking'}
                        variant="primary"
                        width="100%"
                        marginBottom={2}
                    >
                        {status === 'polling' ? 'Waiting for connection...' :
                         status === 'checking' ? 'Verifying...' :
                         'Connect with Mapsemble'}
                    </Button>

                    {status === 'polling' && (
                        <Text size="small" textColor="light" marginBottom={2}>
                            Complete the sign-in in the popup window. This will update automatically.
                        </Text>
                    )}

                    <Box display="flex" alignItems="center" justifyContent="center" marginTop={2}>
                        <Link
                            href="#"
                            size="small"
                            onClick={(e) => {
                                e.preventDefault();
                                stopPolling();
                                setShowManual(true);
                                setStatus(null);
                                setErrorMsg('');
                            }}
                            style={{ cursor: 'pointer' }}
                        >
                            Enter credentials manually
                        </Link>
                    </Box>
                </Box>
            )}

            {/* Secondary: Manual credential entry */}
            {showManual && status !== 'ok' && (
                <Box marginBottom={3}>
                    <FormField label="Client ID" marginBottom={2}>
                        <Input
                            value={clientId}
                            onChange={e => setClientId(e.target.value)}
                            placeholder="client_id"
                        />
                    </FormField>

                    <FormField label="Client Secret" marginBottom={3}>
                        <Input
                            value={clientSecret}
                            onChange={e => setClientSecret(e.target.value)}
                            placeholder="client_secret"
                            type="password"
                        />
                    </FormField>

                    <Button
                        onClick={handleSave}
                        disabled={!canWrite || status === 'checking' || !clientId || !clientSecret}
                        variant="primary"
                        width="100%"
                        marginBottom={2}
                    >
                        {status === 'checking' ? 'Connecting...' : 'Save & Connect'}
                    </Button>

                    <Box display="flex" alignItems="center" justifyContent="center" marginTop={2}>
                        <Link
                            href="#"
                            size="small"
                            onClick={(e) => {
                                e.preventDefault();
                                setShowManual(false);
                                setStatus(null);
                                setErrorMsg('');
                            }}
                            style={{ cursor: 'pointer' }}
                        >
                            Use one-click connection instead
                        </Link>
                    </Box>
                </Box>
            )}

            {/* PAT field - shown in both modes when not connected */}
            {status !== 'ok' && (showManual || false) && (
                <Box marginBottom={3}>
                    <FormField label="Personal Access Token (optional)" marginBottom={1}>
                        <Input
                            value={airtablePat}
                            onChange={e => setAirtablePat(e.target.value)}
                            placeholder="pat_..."
                            type="password"
                        />
                    </FormField>
                    <Text size="small" textColor="light">
                        Required for automatic sync. Create one at{' '}
                        <Box as="span" fontFamily="monospace">airtable.com/create/tokens</Box>
                        {' '}with scopes <Box as="span" fontFamily="monospace">data.records:read</Box>
                        {' '}and <Box as="span" fontFamily="monospace">webhook:manage</Box>.
                        Add the workspace or base you want to sync in the Access section.
                    </Text>
                </Box>
            )}

            {status === 'ok' && (
                <Box marginBottom={3}>
                    <Box
                        display="flex"
                        alignItems="center"
                        padding={2}
                        marginBottom={3}
                        backgroundColor="#f0fdf4"
                        borderColor="#bbf7d0"
                        border="default"
                        borderRadius="default"
                    >
                        <Text size="small">
                            Connected as <strong>{userName}</strong>
                        </Text>
                    </Box>

                    <Heading size="xsmall" marginBottom={1}>Automatic sync (optional)</Heading>
                    <Text size="small" textColor="light" marginBottom={2}>
                        To keep your map automatically in sync when Airtable data changes,
                        provide a Personal Access Token with the{' '}
                        <Box as="span" fontFamily="monospace">data.records:read</Box> and{' '}
                        <Box as="span" fontFamily="monospace">webhook:manage</Box> scopes.
                    </Text>
                    <Text size="small" textColor="light" marginBottom={2}>
                        In the token's <strong>Access</strong> section, add the workspace or
                        base you want to sync - the token can only access bases explicitly
                        listed there.
                    </Text>
                    <Text size="small" textColor="light" marginBottom={2}>
                        <Link
                            href="https://airtable.com/create/tokens"
                            target="_blank"
                            size="small"
                        >
                            Create a token at airtable.com/create/tokens
                        </Link>
                    </Text>

                    <FormField label="Personal Access Token" marginBottom={2}>
                        <Box display="flex" style={{ gap: 8 }}>
                            <Box flex="auto">
                                <Input
                                    value={airtablePat}
                                    onChange={e => {
                                        setAirtablePat(e.target.value);
                                        setPatErrors([]);
                                    }}
                                    placeholder="pat_..."
                                    type="password"
                                />
                            </Box>
                            <Button
                                onClick={async () => {
                                    if (airtablePat) {
                                        setPatValidating(true);
                                        setPatErrors([]);
                                        const firstTable = base.tables[0];
                                        const result = await checkPatScopes(base.id, firstTable?.id, airtablePat);
                                        setPatValidating(false);
                                        if (!result.ok) {
                                            setPatErrors(result.errors);
                                            return;
                                        }
                                    }
                                    await globalConfig.setAsync('airtablePat', airtablePat || null);
                                }}
                                disabled={!canWrite || patValidating || !airtablePat}
                                variant="default"
                            >
                                {patValidating ? 'Validating...' : 'Save'}
                            </Button>
                        </Box>
                    </FormField>

                    {patErrors.length > 0 && (
                        <Box
                            padding={2}
                            marginBottom={2}
                            backgroundColor="#fef2f2"
                            borderColor="#fecaca"
                            border="default"
                            borderRadius="default"
                        >
                            {patErrors.map((err, i) => (
                                <Text key={i} size="small" textColor="default">
                                    {err}
                                </Text>
                            ))}
                            <Text size="small" textColor="light" marginTop={1}>
                                Make sure the token has both{' '}
                                <Box as="span" fontFamily="monospace">data.records:read</Box> and{' '}
                                <Box as="span" fontFamily="monospace">webhook:manage</Box> scopes,
                                and that this base is included in its Access list.
                            </Text>
                        </Box>
                    )}

                </Box>
            )}

            {status === 'error' && (
                <Box
                    display="flex"
                    alignItems="flex-start"
                    padding={2}
                    marginTop={2}
                    backgroundColor="#fef2f2"
                    borderColor="#fecaca"
                    border="default"
                    borderRadius="default"
                >
                    <Text size="small" textColor="default">
                        {errorMsg || 'Connection failed'}
                    </Text>
                </Box>
            )}

            {status !== 'ok' && onDismiss && (
                <Button
                    onClick={onDismiss}
                    variant="default"
                    width="100%"
                    marginTop={2}
                >
                    Cancel
                </Button>
            )}

            {(onDisconnect || status === 'ok') && !confirmingDisconnect && (
                <Box display="flex" marginTop={2} style={{ gap: 8 }}>
                    {onDisconnect && (
                        <Button
                            onClick={() => setConfirmingDisconnect(true)}
                            variant="danger"
                            style={{ flex: '1 1 50%' }}
                        >
                            Disconnect
                        </Button>
                    )}

                    {status === 'ok' && (
                        <Button
                            onClick={() => {
                                if (onDismiss) onDismiss();
                                else if (onComplete) onComplete();
                            }}
                            variant="primary"
                            style={{ flex: '1 1 50%' }}
                        >
                            Continue
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4, verticalAlign: 'middle' }}>
                                <line x1="5" y1="12" x2="19" y2="12"/>
                                <polyline points="12 5 19 12 12 19"/>
                            </svg>
                        </Button>
                    )}
                </Box>
            )}

            {confirmingDisconnect && (
                <Box marginTop={2}>
                    <Box
                        padding={2}
                        marginBottom={2}
                        backgroundColor="#fef2f2"
                        borderColor="#fecaca"
                        border="default"
                        borderRadius="default"
                    >
                        <Text size="small">
                            Are you sure you want to disconnect? Your maps will remain on Mapsemble but will no longer sync from this extension.
                        </Text>
                    </Box>
                    <Box display="flex" style={{ gap: 8 }}>
                        <Button
                            onClick={() => setConfirmingDisconnect(false)}
                            variant="default"
                            style={{ flex: '1 1 50%' }}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={async () => {
                                stopPolling();
                                await globalConfig.setAsync('token', null);
                                await globalConfig.setAsync('clientId', null);
                                await globalConfig.setAsync('clientSecret', null);
                                await globalConfig.setAsync('airtablePat', null);
                                setConfirmingDisconnect(false);
                                setClientId('');
                                setClientSecret('');
                                setAirtablePat('');
                                setUserName(null);
                                setStatus(null);
                                setShowManual(false);
                                if (onDisconnect) onDisconnect();
                            }}
                            disabled={!canWrite}
                            variant="danger"
                            style={{ flex: '1 1 50%' }}
                        >
                            Confirm Disconnect
                        </Button>
                    </Box>
                </Box>
            )}
        </Box>
    );
}
