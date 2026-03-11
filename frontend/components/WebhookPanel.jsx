import React, { useState } from 'react';
import { Box, Text, Button } from '@airtable/blocks/ui';
import { checkAirtableWebhookAccess, getAirtableWebhookNotificationUrl } from '../services/airtable';

export default function WebhookPanel({ map, tableId, pat, onRegister, onClose }) {
    const [checking, setChecking] = useState(false);
    const [registering, setRegistering] = useState(false);
    const [checkResult, setCheckResult] = useState(null);
    const [registeredUrl, setRegisteredUrl] = useState(null);
    const [opResult, setOpResult] = useState(null);

    async function handleCheckAccess() {
        setChecking(true);
        setCheckResult(null);
        setRegisteredUrl(null);
        try {
            const result = await checkAirtableWebhookAccess(map.airtableBaseId, pat);
            setCheckResult(result);
            if (result.ok && map?.airtableWebhookId) {
                const url = await getAirtableWebhookNotificationUrl(
                    map.airtableBaseId,
                    map.airtableWebhookId,
                    pat,
                );
                setRegisteredUrl(url !== null ? url : 'NOT_FOUND');
            }
        } catch (err) {
            setCheckResult({ ok: false, message: err.message });
        } finally {
            setChecking(false);
        }
    }

    async function handleRegister() {
        setRegistering(true);
        setOpResult(null);
        try {
            await onRegister();
            setOpResult({ ok: true, message: 'Webhook registered successfully.' });
        } catch (err) {
            setOpResult({ ok: false, message: err.message || 'Registration failed.' });
        } finally {
            setRegistering(false);
        }
    }

    const hasWebhook = !!map?.airtableWebhookId;

    return (
        <Box
            style={{
                backgroundColor: '#fff',
                borderRadius: 8,
                boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
                width: '90%',
                maxWidth: 400,
                padding: 24,
            }}
        >
            {/* Header */}
            <Box marginBottom={3}>
                <Text fontWeight="strong" size="default">
                    Webhook — {map?.mapLabel || map?.mapId || 'Map'}
                </Text>
            </Box>

            {!pat ? (
                /* No PAT configured */
                <Box>
                    <Box
                        padding={2}
                        marginBottom={3}
                        style={{
                            backgroundColor: '#fef3c7',
                            border: '1px solid #fcd34d',
                            borderRadius: 6,
                        }}
                    >
                        <Text size="small" style={{ color: '#92400e' }}>
                            No Airtable PAT configured — go to Settings to add one.
                        </Text>
                    </Box>
                    <Button onClick={onClose} variant="default" size="small">
                        Close
                    </Button>
                </Box>
            ) : (
                /* PAT present */
                <Box>
                    {/* Current status */}
                    <Box marginBottom={3}>
                        <Text size="small" textColor="light" marginBottom={1}>
                            Current status
                        </Text>
                        {hasWebhook ? (
                            <Box
                                display="inline-flex"
                                alignItems="center"
                                style={{
                                    backgroundColor: '#ecfdf5',
                                    border: '1px solid #a7f3d0',
                                    borderRadius: 4,
                                    padding: '2px 8px',
                                }}
                            >
                                <Box
                                    flexShrink={0}
                                    marginRight={1}
                                    style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        backgroundColor: '#10b981',
                                    }}
                                />
                                <Text size="small" style={{ color: '#065f46' }}>
                                    Auto-sync active
                                </Text>
                            </Box>
                        ) : (
                            <Text size="small" textColor="light">
                                No webhook registered
                            </Text>
                        )}
                    </Box>

                    {/* Check access */}
                    <Box marginBottom={2}>
                        <Button
                            onClick={handleCheckAccess}
                            disabled={checking}
                            variant="default"
                            size="small"
                        >
                            {checking ? 'Checking…' : 'Check access'}
                        </Button>
                        {checkResult && (
                            <Box marginTop={1}>
                                <Text
                                    size="small"
                                    style={{ color: checkResult.ok ? '#065f46' : '#b91c1c' }}
                                >
                                    {checkResult.ok
                                        ? '✓ PAT has access to this base'
                                        : `✗ ${checkResult.message}`}
                                </Text>
                                {checkResult.ok && registeredUrl && (
                                    <Text size="small" textColor="light" marginTop={1}>
                                        {registeredUrl === 'NOT_FOUND'
                                            ? '⚠ Webhook ID not found on Airtable — re-register.'
                                            : `Registered URL: ${registeredUrl}`}
                                    </Text>
                                )}
                            </Box>
                        )}
                    </Box>

                    {/* Register / Re-register */}
                    <Box marginBottom={3}>
                        <Button
                            onClick={handleRegister}
                            disabled={registering}
                            variant="primary"
                            size="small"
                        >
                            {registering
                                ? 'Registering…'
                                : hasWebhook
                                    ? 'Re-register webhook'
                                    : 'Register webhook'}
                        </Button>
                        {opResult && (
                            <Box marginTop={1}>
                                <Text
                                    size="small"
                                    style={{ color: opResult.ok ? '#065f46' : '#b91c1c' }}
                                >
                                    {opResult.ok ? `✓ ${opResult.message}` : `✗ ${opResult.message}`}
                                </Text>
                            </Box>
                        )}
                    </Box>

                    <Button onClick={onClose} variant="default" size="small">
                        Close
                    </Button>
                </Box>
            )}
        </Box>
    );
}
