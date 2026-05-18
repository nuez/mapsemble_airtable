import './style.css';
import { initializeBlock, useGlobalConfig, useBase, useCursor, useViewport, Box, Text, Button, Heading, Link } from '@airtable/blocks/ui';
import React, { useState, useEffect } from 'react';

import { updateMap, fetchMe, MAPSEMBLE_URL, NGROK_URL } from './services/mapsemble';
import { refreshAirtableWebhook, registerAirtableWebhook, deleteAirtableWebhook, listAirtableWebhooks } from './services/airtable';
import { buildSlugMap, deduplicateOptionKeys, toSlug } from './services/geojson';
import Setup from './components/Setup';
import HomeScreen from './components/HomeScreen';
import LocationMapper from './components/LocationMapper';
import FieldMapper from './components/FieldMapper';
import MapBuilder from './components/MapBuilder';
import SyncPanel from './components/SyncPanel';
import WebhookPanel from './components/WebhookPanel';
import MapPreview from './components/MapPreview';

async function migrateIfNeeded(globalConfig) {
    if (!globalConfig.get('mapId') || globalConfig.get('tableConfigs')) return;
    const tableId = globalConfig.get('selectedTableId');
    if (!tableId) return;

    const tableConfig = {
        locationMode:   globalConfig.get('locationMode') || 'dual',
        latField:       globalConfig.get('latField') || '',
        lngField:       globalConfig.get('lngField') || '',
        locationColumn: globalConfig.get('locationColumn') || '',
        locationFormat: globalConfig.get('locationFormat') || 'auto',
        labelField:     globalConfig.get('labelField') || '',
        fieldMapping:   globalConfig.get('fieldMapping') || {},
        maps: [{
            mapId:      globalConfig.get('mapId'),
            mapLabel:   globalConfig.get('mapLabel') || '',
            mapUrl:   globalConfig.get('mapUrl') || null,
            lastSync: globalConfig.get('lastSync') || null,
        }],
    };

    await globalConfig.setAsync(['tableConfigs', tableId], tableConfig);
    await globalConfig.setAsync('activeMapId', globalConfig.get('mapId'));

    for (const key of ['locationMode', 'latField', 'lngField', 'locationColumn', 'locationFormat',
        'labelField', 'fieldMapping', 'mapId', 'mapLabel', 'mapUrl', 'lastSync']) {
        await globalConfig.setAsync(key, null);
    }
}

// The Mapsemble logo SVG
const LOGO_SVG = (
    <svg viewBox="0 0 353 77" width={8} fill="none" xmlns="http://www.w3.org/2000/svg" style={{ height: 28, width: 'auto' }}>
        <path d="M44.032 64V47.616C44.032 42.6667 42.3467 40.192 38.976 40.192C36.5013 40.192 34.6453 41.216 33.408 43.264C33.5787 43.9893 33.664 44.864 33.664 45.888V64H24V47.616C24 42.6667 22.3147 40.192 18.944 40.192C17.8773 40.192 16.8533 40.448 15.872 40.96C14.8907 41.472 14.144 42.1333 13.632 42.944V64H3.968V32H13.632V34.24C14.4 33.3867 15.4667 32.6827 16.832 32.128C18.24 31.5733 19.648 31.296 21.056 31.296C24.6827 31.296 27.6693 32.5973 30.016 35.2C32.448 32.5973 35.8827 31.296 40.32 31.296C44.8 31.296 48.1493 32.6613 50.368 35.392C52.5867 38.1227 53.696 41.6213 53.696 45.888V64H44.032ZM75.042 64.704C70.434 64.704 66.658 63.0827 63.714 59.84C60.77 56.5547 59.298 52.608 59.298 48C59.298 43.392 60.77 39.4667 63.714 36.224C66.658 32.9387 70.434 31.296 75.042 31.296C78.0713 31.296 80.5887 32.192 82.594 33.984V32H92.258V64H82.594V61.952C80.6313 63.7867 78.114 64.704 75.042 64.704ZM76.514 55.936C79.0313 55.936 81.058 54.912 82.594 52.864V43.072C81.0153 41.0667 78.9887 40.064 76.514 40.064C74.3807 40.064 72.6313 40.832 71.266 42.368C69.9433 43.904 69.282 45.7813 69.282 48C69.282 50.2187 69.9433 52.096 71.266 53.632C72.6313 55.168 74.3807 55.936 76.514 55.936ZM100.218 76.416V32H109.882V33.984C111.887 32.192 114.405 31.296 117.434 31.296C122.042 31.296 125.818 32.9387 128.762 36.224C131.706 39.4667 133.178 43.392 133.178 48C133.178 52.608 131.706 56.5547 128.762 59.84C125.818 63.0827 122.042 64.704 117.434 64.704C114.362 64.704 111.845 63.7867 109.882 61.952V76.416H100.218ZM115.962 55.936C118.095 55.936 119.823 55.168 121.146 53.632C122.511 52.096 123.194 50.2187 123.194 48C123.194 45.7813 122.511 43.904 121.146 42.368C119.823 40.832 118.095 40.064 115.962 40.064C113.487 40.064 111.461 41.0667 109.882 43.072V52.864C111.418 54.912 113.445 55.936 115.962 55.936ZM149.976 64.704C144.045 64.704 139.608 62.784 136.664 58.944L143.064 53.12C144.6 55.3387 146.904 56.448 149.976 56.448C151.939 56.448 152.92 55.8507 152.92 54.656C152.92 54.1013 152.664 53.6533 152.152 53.312C151.64 52.928 150.595 52.544 149.016 52.16L146.904 51.648C143.875 50.9227 141.571 49.6427 139.992 47.808C138.456 45.9733 137.731 43.7547 137.816 41.152C137.901 38.208 139.075 35.84 141.336 34.048C143.64 32.2133 146.563 31.296 150.104 31.296C155.053 31.296 158.808 33.0667 161.368 36.608L155.096 41.792C153.731 40.0853 152.045 39.232 150.04 39.232C148.291 39.232 147.416 39.7867 147.416 40.896C147.416 41.92 148.312 42.688 150.104 43.2L153.048 43.968C156.12 44.7787 158.445 45.9947 160.024 47.616C161.645 49.1947 162.456 51.3493 162.456 54.08C162.456 57.1093 161.24 59.648 158.808 61.696C156.419 63.7013 153.475 64.704 149.976 64.704ZM183.572 64.704C178.751 64.704 174.697 63.1893 171.412 60.16C168.169 57.088 166.548 53.0347 166.548 48C166.548 43.2213 168.148 39.2533 171.348 36.096C174.548 32.896 178.559 31.296 183.38 31.296C187.86 31.296 191.636 32.6613 194.708 35.392C197.78 38.1227 199.316 41.9627 199.316 46.912C199.316 48.1493 199.252 49.28 199.124 50.304H175.892C176.148 52.1387 177.023 53.5467 178.516 54.528C180.009 55.4667 181.737 55.936 183.7 55.936C185.449 55.936 187.007 55.5947 188.372 54.912C189.737 54.1867 190.761 53.312 191.444 52.288L198.612 57.664C197.076 59.84 195.007 61.568 192.404 62.848C189.801 64.0853 186.857 64.704 183.572 64.704ZM176.148 43.968H189.716C189.332 42.3893 188.521 41.1947 187.284 40.384C186.047 39.5733 184.66 39.168 183.124 39.168C181.503 39.168 180.031 39.5733 178.708 40.384C177.385 41.152 176.532 42.3467 176.148 43.968ZM245.47 64V47.616C245.47 42.6667 243.784 40.192 240.414 40.192C237.939 40.192 236.083 41.216 234.846 43.264C235.016 43.9893 235.102 44.864 235.102 45.888V64H225.438V47.616C225.438 42.6667 223.752 40.192 220.382 40.192C219.315 40.192 218.291 40.448 217.31 40.96C216.328 41.472 215.582 42.1333 215.07 42.944V64H205.406V32H215.07V34.24C215.838 33.3867 216.904 32.6827 218.27 32.128C219.678 31.5733 221.086 31.296 222.494 31.296C226.12 31.296 229.107 32.5973 231.454 35.2C233.886 32.5973 237.32 31.296 241.758 31.296C246.238 31.296 249.587 32.6613 251.806 35.392C254.024 38.1227 255.134 41.6213 255.134 45.888V64H245.47ZM279.872 64.704C276.8 64.704 274.282 63.7867 272.32 61.952V64H262.656V17.28H272.32V33.984C274.325 32.192 276.842 31.296 279.872 31.296C284.48 31.296 288.256 32.9387 291.2 36.224C294.144 39.4667 295.616 43.392 295.616 48C295.616 52.608 294.144 56.5547 291.2 59.84C288.256 63.0827 284.48 64.704 279.872 64.704ZM278.4 55.936C280.533 55.936 282.261 55.168 283.584 53.632C284.949 52.096 285.632 50.2187 285.632 48C285.632 45.7813 284.949 43.904 283.584 42.368C282.261 40.832 280.533 40.064 278.4 40.064C275.925 40.064 273.898 41.0667 272.32 43.072V52.864C273.856 54.912 275.882 55.936 278.4 55.936ZM301.718 64V17.28H311.382V64H301.718ZM334.447 64.704C329.626 64.704 325.572 63.1893 322.287 60.16C319.044 57.088 317.423 53.0347 317.423 48C317.423 43.2213 319.023 39.2533 322.223 36.096C325.423 32.896 329.434 31.296 334.255 31.296C338.735 31.296 342.511 32.6613 345.583 35.392C348.655 38.1227 350.191 41.9627 350.191 46.912C350.191 48.1493 350.127 49.28 349.999 50.304H326.767C327.023 52.1387 327.898 53.5467 329.391 54.528C330.884 55.4667 332.612 55.936 334.575 55.936C336.324 55.936 337.882 55.5947 339.247 54.912C340.612 54.1867 341.636 53.312 342.319 52.288L349.487 57.664C347.951 59.84 345.882 61.568 343.279 62.848C340.676 64.0853 337.732 64.704 334.447 64.704ZM327.023 43.968H340.591C340.207 42.3893 339.396 41.1947 338.159 40.384C336.922 39.5733 335.535 39.168 333.999 39.168C332.378 39.168 330.906 39.5733 329.583 40.384C328.26 41.152 327.407 42.3467 327.023 43.968Z" fill="#232455" />
        <path d="M142.078 11.0356C142.992 16.0591 137.893 26.2255 135.616 30.4517C135.069 31.4597 133.758 31.698 132.891 30.9472C129.272 27.7934 120.921 20.073 120.007 15.0495C118.899 8.95694 122.943 3.11496 129.036 2.00695C135.128 0.89894 140.97 4.94301 142.078 11.0356Z" fill="#F9BA17" />
    </svg>
);

const CREATE_STEP_LABELS = ['Location', 'Label & Fields', 'Generate', 'Sync', 'Auto-sync', 'Preview'];

function CreateStepIndicator({ currentStep }) {
    return (
        <Box display="flex" alignItems="flex-start" style={{ gap: 0 }}>
            {CREATE_STEP_LABELS.map((label, i) => {
                const step = i + 1;
                const done = step < currentStep;
                const active = step === currentStep;
                return (
                    <React.Fragment key={step}>
                        <Box display="flex" flexDirection="column" alignItems="center" style={{ minWidth: 56 }}>
                            <Box
                                style={{
                                    width: 22,
                                    height: 22,
                                    borderRadius: '50%',
                                    backgroundColor: done ? '#2563eb' : active ? '#2563eb' : '#e5e7eb',
                                    color: done || active ? '#fff' : '#6b7280',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    flexShrink: 0,
                                }}
                            >
                                {done ? '✓' : step}
                            </Box>
                            <Text
                                size="small"
                                style={{
                                    marginTop: 3,
                                    color: active ? '#2563eb' : done ? '#6b7280' : '#9ca3af',
                                    fontWeight: active ? 600 : 400,
                                    textAlign: 'center',
                                    whiteSpace: 'nowrap',
                                    fontSize: 10,
                                }}
                            >
                                {label}
                            </Text>
                        </Box>
                        {i < CREATE_STEP_LABELS.length - 1 && (
                            <Box
                                flex="1"
                                style={{
                                    height: 2,
                                    marginTop: 10,
                                    backgroundColor: done ? '#2563eb' : '#e5e7eb',
                                    minWidth: 8,
                                }}
                            />
                        )}
                    </React.Fragment>
                );
            })}
        </Box>
    );
}

function CreatePreviewStep({ mapId, mapLabel, onDone, onFullscreen }) {
    const mapUrl = `${MAPSEMBLE_URL}/map/${mapId}`;

    return (
        <Box padding={3}>
            <Text fontWeight="strong" marginBottom={2}>{mapLabel}</Text>

            <Box
                padding={3}
                marginBottom={3}
                backgroundColor="#f0fdf4"
                borderColor="#bbf7d0"
                border="default"
                borderRadius="default"
            >
                <Text size="small">
                    Your map has been created and synced successfully.
                </Text>
            </Box>

            <Text size="small" textColor="light" marginBottom={3}>
                Style your map in Mapsemble: customize cards, popups, markers, and filters.
            </Text>

            <Box display="flex" justifyContent="space-between" alignItems="center" style={{ gap: 8 }}>
                <Box display="flex" alignItems="center" style={{ gap: 8 }}>
                    <Button
                        onClick={() => window.open(mapUrl, '_blank', 'noreferrer')}
                        variant="primary"
                        size="small"
                    >
                        <Box display="flex" alignItems="center" className="gap-1">
                            Customize in Mapsemble
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M7 17L17 7"/>
                                <path d="M7 7h10v10"/>
                            </svg>
                        </Box>
                    </Button>
                    <Button onClick={onFullscreen} variant="default" size="small">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: 'middle' }}>
                            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                        </svg>
                        Preview
                    </Button>
                </Box>
                <Button onClick={onDone} variant="primary" size="small">
                    Done
                </Button>
            </Box>
        </Box>
    );
}

function WebhookSetupStep({ onRegister, onNext, hasPat }) {
    const [status, setStatus] = useState('idle'); // 'idle' | 'registering' | 'success' | 'error'
    const [error, setError] = useState(null);

    async function handleRegister() {
        setStatus('registering');
        setError(null);
        try {
            await onRegister();
            setStatus('success');
        } catch (err) {
            setStatus('error');
            setError(err.message || 'Webhook registration failed.');
        }
    }

    return (
        <Box padding={3}>
            <Heading size="small" marginBottom={2}>Auto-sync Setup</Heading>

            <Text size="small" textColor="light" marginBottom={3}>
                Enable auto-sync so changes in Airtable automatically update your map.
            </Text>

            {status === 'registering' && (
                <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" style={{ minHeight: 160 }}>
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
                    <Text size="small" textColor="light">Registering webhook with Airtable...</Text>
                    <style>{`@keyframes mapsemble-spin { to { transform: rotate(360deg); } }`}</style>
                </Box>
            )}

            {status === 'success' && (
                <Box>
                    <Box padding={2} marginBottom={3} backgroundColor="#f0fdf4" borderColor="#bbf7d0" border="default" borderRadius="default">
                        <Box display="flex" alignItems="center" style={{ gap: 8 }}>
                            <Box
                                flexShrink={0}
                                style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10b981' }}
                            />
                            <Text size="small" style={{ color: '#065f46' }}>
                                Auto-sync enabled. Changes in Airtable will automatically update your map.
                            </Text>
                        </Box>
                    </Box>
                    <Button onClick={onNext} variant="primary" width="100%">
                        Next
                    </Button>
                </Box>
            )}

            {status === 'error' && (
                <Box>
                    <Box padding={2} marginBottom={3} className="bg-amber-50 border border-amber-200 rounded-md">
                        <Text size="small" fontWeight="strong" className="text-amber-700" marginBottom={1}>
                            Auto-sync could not be enabled
                        </Text>
                        <Text size="small" className="text-amber-700">
                            {error}
                        </Text>
                    </Box>
                    <Button onClick={handleRegister} variant="primary" width="100%" marginBottom={2}>
                        Retry
                    </Button>
                    <Button onClick={onNext} variant="default" width="100%">
                        Skip
                    </Button>
                </Box>
            )}

            {status === 'idle' && (
                <Box>
                    {!hasPat && (
                        <Box padding={2} marginBottom={3} className="bg-amber-50 border border-amber-200 rounded-md">
                            <Text size="small" className="text-amber-700">
                                No Personal Access Token configured. Auto-sync requires a PAT with webhook:manage scope. You can add one in Settings.
                            </Text>
                        </Box>
                    )}
                    <Button
                        onClick={handleRegister}
                        disabled={!hasPat}
                        variant="primary"
                        width="100%"
                        marginBottom={2}
                    >
                        Enable auto-sync
                    </Button>
                    <Button onClick={onNext} variant="default" width="100%">
                        Skip
                    </Button>
                </Box>
            )}
        </Box>
    );
}

function AppHeader({ mode, activeTableId, createStep, onSettingsClick, onCancelCreate, connected }) {
    const base = useBase();
    const activeTable = activeTableId ? base.getTableByIdIfExists(activeTableId) : null;

    return (
        <Box
            flexShrink={0}
            backgroundColor="white"
            borderBottom="default"
        >
            {/* Top bar: logo + gear */}
            <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                paddingX={3}
                paddingY={2}

            >
              { LOGO_SVG }
                {connected && (
                    <Button
                        onClick={onSettingsClick}
                        variant="default"
                        size="small"
                        aria-label="Settings"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="12px"><path d="M259.1 73.5C262.1 58.7 275.2 48 290.4 48L350.2 48C365.4 48 378.5 58.7 381.5 73.5L396 143.5C410.1 149.5 423.3 157.2 435.3 166.3L503.1 143.8C517.5 139 533.3 145 540.9 158.2L570.8 210C578.4 223.2 575.7 239.8 564.3 249.9L511 297.3C511.9 304.7 512.3 312.3 512.3 320C512.3 327.7 511.8 335.3 511 342.7L564.4 390.2C575.8 400.3 578.4 417 570.9 430.1L541 481.9C533.4 495 517.6 501.1 503.2 496.3L435.4 473.8C423.3 482.9 410.1 490.5 396.1 496.6L381.7 566.5C378.6 581.4 365.5 592 350.4 592L290.6 592C275.4 592 262.3 581.3 259.3 566.5L244.9 496.6C230.8 490.6 217.7 482.9 205.6 473.8L137.5 496.3C123.1 501.1 107.3 495.1 99.7 481.9L69.8 430.1C62.2 416.9 64.9 400.3 76.3 390.2L129.7 342.7C128.8 335.3 128.4 327.7 128.4 320C128.4 312.3 128.9 304.7 129.7 297.3L76.3 249.8C64.9 239.7 62.3 223 69.8 209.9L99.7 158.1C107.3 144.9 123.1 138.9 137.5 143.7L205.3 166.2C217.4 157.1 230.6 149.5 244.6 143.4L259.1 73.5zM320.3 400C364.5 399.8 400.2 363.9 400 319.7C399.8 275.5 363.9 239.8 319.7 240C275.5 240.2 239.8 276.1 240 320.3C240.2 364.5 276.1 400.2 320.3 400z"/></svg>
                    </Button>
                )}
            </Box>

            {/* Sub-header for create mode */}
            {mode === 'create' && (
                <Box paddingX={3} paddingBottom={2}>
                    <Box display="flex" alignItems="center" justifyContent="space-between" marginBottom={2}>
                        <Text size="small" fontWeight="strong">
                            New map{activeTable ? ` for ${activeTable.name}` : ''}
                        </Text>
                        <Button onClick={onCancelCreate} variant="default" size="small">
                            Cancel
                        </Button>
                    </Box>
                    <CreateStepIndicator currentStep={createStep} />
                </Box>
            )}

            {/* Sub-header for sync mode */}
            {mode === 'sync' && activeTable && (
                <Box paddingX={3} paddingBottom={2}>
                    <Text size="small" style={{ color: '#6b7280' }}>Sync - {activeTable.name}</Text>
                </Box>
            )}

            {/* Sub-header for modify mode */}
            {mode === 'modify' && activeTable && (
                <Box paddingX={3} paddingBottom={2}>
                    <Text size="small" style={{ color: '#6b7280' }}>Modify mapping - {activeTable.name}</Text>
                </Box>
            )}
        </Box>
    );
}

function MapsembleApp() {
    const globalConfig = useGlobalConfig();
    const base = useBase();
    const cursor = useCursor();
    const viewport = useViewport();
    const cursorTableId = cursor.activeTableId;
    const [migrated, setMigrated] = useState(false);
    const [mode, setMode] = useState(null);
    const [createStep, setCreateStep] = useState(1);
    const [modifyStep, setModifyStep] = useState(1);
    const [activeTableId, setActiveTableId] = useState(null);
    const [activeMapId, setActiveMapId] = useState(null);
    const [pendingLocConfig, setPendingLocConfig] = useState(null);
    const [pendingFieldConfig, setPendingFieldConfig] = useState(null);
    const [showSetupModal, setShowSetupModal] = useState(false);
    const [showResyncNotice, setShowResyncNotice] = useState(false);
    const [webhookNotice, setWebhookNotice] = useState(null);
    const [webhookFailed, setWebhookFailed] = useState(false);
    const [webhookModal, setWebhookModal] = useState(null); // null | { tableId, mapId }
    const [previewModal, setPreviewModal] = useState(null); // null | { mapId, mapLabel }

    const hasToken = !!globalConfig.get('token');
    const featureFlags = globalConfig.get('featureFlags');

    const hasGeocoding = featureFlags != null && typeof featureFlags === 'object' && featureFlags['geocoding'] === true;


    useEffect(() => {
        migrateIfNeeded(globalConfig)
            .then(() => {
                setMode('home');

                // Best-effort: refresh feature flags on block open
                if (hasToken) {
                    const config = {
                        url: MAPSEMBLE_URL,
                        clientId: globalConfig.get('clientId'),
                        clientSecret: globalConfig.get('clientSecret'),
                        token: globalConfig.get('token'),
                    };
                    fetchMe(config, (newToken) => globalConfig.setAsync('token', newToken))
                        .then((me) => globalConfig.setAsync('featureFlags', me.featureFlags || []))
                        .catch(() => {});
                }

                // Best-effort: refresh all stored Airtable webhooks on block open
                if (hasToken) {
                    const pat = globalConfig.get('airtablePat');
                    if (pat) {
                        const tableConfigs = globalConfig.get('tableConfigs') || {};
                        for (const [tableId, tableConfig] of Object.entries(tableConfigs)) {
                            // One webhook per table - stored at table level
                            const baseId = (tableConfig.maps || []).find(m => m.airtableBaseId)?.airtableBaseId;
                            const webhookId = tableConfig.airtableWebhookId
                                // backward-compat: fall back to per-map if table-level not yet set
                                || (tableConfig.maps || []).find(m => m.airtableWebhookId)?.airtableWebhookId;
                            if (baseId && webhookId) {
                                refreshAirtableWebhook(baseId, webhookId, pat).then((ok) => {
                                    if (!ok) {
                                        // Webhook no longer exists on Airtable — clear the stale ID
                                        globalConfig.setAsync(['tableConfigs', tableId, 'airtableWebhookId'], null)
                                            .catch(() => {});
                                    }
                                });
                            }
                        }
                    }
                }
            })
            .catch(() => {
                setMode('home');
            })
            .finally(() => {
                setMigrated(true);
            });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!migrated) {
        return (
            <Box display="flex" alignItems="center" justifyContent="center" height="100vh">
                <Text size="small" textColor="light">Loading…</Text>
            </Box>
        );
    }

    // Seed functions - read existing config from globalConfig for a tableId
    function seedLocConfig(tableId) {
        const tc = globalConfig.get(['tableConfigs', tableId]) || {};
        return {
            locationMode:   tc.locationMode || 'dual',
            latField:       tc.latField || '',
            lngField:       tc.lngField || '',
            locationColumn: tc.locationColumn || '',
            locationFormat: tc.locationFormat || 'auto',
        };
    }

    function seedFieldConfig(tableId) {
        const tc = globalConfig.get(['tableConfigs', tableId]) || {};
        return {
            labelField:   tc.labelField || '',
            fieldMapping: tc.fieldMapping || {},
        };
    }

    // ── Transition handlers ─────────────────────────────────────────────────

    function startCreate(tableId) {
        setActiveTableId(tableId);
        setPendingLocConfig(null);
        setPendingFieldConfig(null);
        setWebhookFailed(false);
        setCreateStep(1);
        setMode('create');
    }

    async function startSync(tableId, mapId) {
        setActiveTableId(tableId);
        setActiveMapId(mapId);
        if (globalConfig.hasPermissionToSet()) {
            await globalConfig.setAsync('activeMapId', mapId);
            await globalConfig.setAsync('selectedTableId', tableId);
        }
        setMode('sync');
    }

    function startModify(tableId, mapId) {
        setWebhookFailed(false);
        setActiveTableId(tableId);
        setActiveMapId(mapId);
        setPendingLocConfig(null);
        setPendingFieldConfig(null);
        setModifyStep(1);
        setMode('modify');
    }

    // Create step 1 → 2
    function handleLocationComplete(locConfig) {
        setPendingLocConfig(locConfig);
        setCreateStep(2);
    }

    // Create step 2 → 3 (writes to globalConfig here)
    async function handleFieldsComplete(fieldConfig) {
        const existing = globalConfig.get(['tableConfigs', activeTableId]) || {};
        await Promise.all([
            globalConfig.setAsync(['tableConfigs', activeTableId], {
                ...existing,
                ...pendingLocConfig,
                ...fieldConfig,
                maps: existing.maps || [],
            }),
            globalConfig.setAsync('selectedTableId', activeTableId),
        ]);
        setPendingFieldConfig(fieldConfig);
        setCreateStep(3);
    }

    // Create step 4 → 5 (auto-sync setup)
    function handleSyncComplete() {
        setCreateStep(5);
    }

    // Create step 5 → 6
    function handleWebhookSetupComplete() {
        setCreateStep(6);
    }

    // Create step 3 → 4 (called by MapBuilder after successful map creation)
    function handleMapBuilt(newMapId) {
        if (newMapId) setActiveMapId(newMapId);
        setCreateStep(4);
    }

    // Modify step 1 → 2
    function handleModifyLocationComplete(locConfig) {
        setPendingLocConfig(locConfig);
        setModifyStep(2);
    }

    // Modify step 2 → home (save, preserve maps, update Mapsemble)
    async function handleModifyFieldsComplete(fieldConfig) {
        const existing = globalConfig.get(['tableConfigs', activeTableId]) || {};
        await globalConfig.setAsync(['tableConfigs', activeTableId], {
            ...existing,
            ...pendingLocConfig,
            ...fieldConfig,
            maps: existing.maps || [],
        });

        const table = base.getTableByIdIfExists(activeTableId);
        if (table && activeMapId) {
            const fieldEntries = Object.entries(fieldConfig.fieldMapping || {});
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
                        options: deduplicateOptionKeys(choices.map((choice, i) => ({
                            key:    choice.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                            label:  choice.name,
                            weight: i + 1,
                        }))),
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

            // Add geocode field to schema when using address format
            const locationColumnName = pendingLocConfig?.locationColumn
                ? (table.getFieldByIdIfExists(pendingLocConfig.locationColumn)?.name || '')
                : '';
            const geocodeFieldSlug = pendingLocConfig?.locationFormat === 'address' && locationColumnName
                ? toSlug(locationColumnName)
                : '';
            if (geocodeFieldSlug) {
                fields.push({
                    slug: geocodeFieldSlug,
                    type: 'text',
                    label: locationColumnName,
                    weight: fields.length,
                    required: false,
                });
            }

            const config = {
                url:          MAPSEMBLE_URL,
                clientId:     globalConfig.get('clientId'),
                clientSecret: globalConfig.get('clientSecret'),
                token:        globalConfig.get('token'),
            };

            const resolveFieldName = (fieldId) =>
                fieldId ? (table.getFieldByIdIfExists(fieldId)?.name ?? '') : '';

            try {
                await updateMap(
                    activeMapId,
                    {
                        fields,
                        config: { remoteField: '_airtable_id', ...(geocodeFieldSlug ? { geocodeField: geocodeFieldSlug } : {}) },
                        dataSource: {
                            mode: 'synced',
                            provider: 'airtable',
                            config: {
                                labelFieldName:     resolveFieldName(fieldConfig.labelField),
                                locationMode:       pendingLocConfig?.locationMode || 'dual',
                                latFieldName:       resolveFieldName(pendingLocConfig?.latField),
                                lngFieldName:       resolveFieldName(pendingLocConfig?.lngField),
                                locationColumnName: resolveFieldName(pendingLocConfig?.locationColumn),
                                locationFormat:     pendingLocConfig?.locationFormat || 'auto',
                            },
                        },
                    },
                    config,
                    (newToken) => globalConfig.setAsync('token', newToken),
                );
            } catch (err) { throw err; }

            // Best-effort: auto-register webhook if not yet registered for this table
            const updatedTableConfig = globalConfig.get(['tableConfigs', activeTableId]) || {};
            const pat = globalConfig.get('airtablePat');
            if (pat && !updatedTableConfig.airtableWebhookId) {
                const mapEntry = (updatedTableConfig.maps || []).find((m) => m.mapId === activeMapId);
                if (mapEntry?.airtableBaseId) {
                    try {
                        await performWebhookRegistration(activeTableId, activeMapId, mapEntry.airtableBaseId);
                    } catch (webhookErr) {
                        setWebhookNotice('Auto-sync could not be enabled. You can set it up later from the webhook panel.');
                        setWebhookFailed(true);
                    }
                }
            }
        }

        setShowResyncNotice(true);
        setMode('home');
    }

    function goHome() {
        setMode('home');
    }

    async function performWebhookRegistration(tableId, mapId, baseId) {
        const pat = globalConfig.get('airtablePat');
        const config = {
            url:          MAPSEMBLE_URL,
            clientId:     globalConfig.get('clientId'),
            clientSecret: globalConfig.get('clientSecret'),
            token:        globalConfig.get('token'),
        };

        const dsRes = await fetch(
            `${MAPSEMBLE_URL}/api/v1/webhook/airtable/${mapId}/config`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    'Content-Type': 'application/json',
                },
            },
        );
        if (!dsRes.ok) {
            const msg = dsRes.status === 404
                ? 'Webhook endpoint not found on Mapsemble - the map may not support auto-sync yet.'
                : `Failed to fetch webhook info (${dsRes.status})`;
            throw new Error(msg);
        }
        const dsData = await dsRes.json();
        const rawNotificationUrl = dsData.notificationUrl;
        const notificationUrl = NGROK_URL
            ? rawNotificationUrl.replace(
                new URL(MAPSEMBLE_URL).origin,
                NGROK_URL.replace(/\/$/, ''),
              )
            : rawNotificationUrl;

        // Delete ALL existing Airtable webhooks scoped to this table before registering a new one
        const allWebhooks = await listAirtableWebhooks(baseId, pat);
        const tableWebhooks = allWebhooks.filter(
            (w) => w.specification?.options?.filters?.recordChangeScope === tableId,
        );
        await Promise.all(tableWebhooks.map((w) => deleteAirtableWebhook(baseId, w.id, pat)));

        const webhookId = await registerAirtableWebhook(baseId, tableId, notificationUrl, pat);

        await fetch(`${MAPSEMBLE_URL}/api/v1/airtable/webhook/register`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ mapId, baseId, tableId, webhookId, pat }),
        });

        // Store webhook at table level - shared by all maps for this table
        await globalConfig.setAsync(['tableConfigs', tableId, 'airtableWebhookId'], webhookId);

        // Mark this specific map as auto-sync enabled
        const tc = globalConfig.get(['tableConfigs', tableId]) || {};
        const updatedMaps = (tc.maps || []).map(m =>
            m.mapId === mapId ? { ...m, autoSync: true } : m
        );
        await globalConfig.setAsync(['tableConfigs', tableId, 'maps'], updatedMaps);

        return webhookId;
    }

    function onWebhook(tableId, mapId) {
        setWebhookModal({ tableId, mapId });
    }

    // ── Build pendingConfig for MapBuilder ──────────────────────────────────
    // At step 3 (MapBuilder), we combine pendingLocConfig + pendingFieldConfig
    // which were staged during steps 1 and 2.
    const combinedPendingConfig = (pendingLocConfig && pendingFieldConfig)
        ? { ...pendingLocConfig, ...pendingFieldConfig }
        : null;

    const tableMismatch = (mode === 'create' || mode === 'modify') && cursorTableId !== activeTableId;
    const mismatchTableName = activeTableId ? (base.getTableByIdIfExists(activeTableId)?.name ?? 'unknown table') : 'unknown table';

    // ── Setup modal overlay ─────────────────────────────────────────────────
    // (rendered on top of main layout when showSetupModal is true)

    return (
        <Box display="flex" flexDirection="column" height="100vh">
            <AppHeader
                mode={mode}
                activeTableId={activeTableId}
                createStep={createStep}
                connected={!!globalConfig.get('token')}
                onSettingsClick={() => setShowSetupModal(true)}
                onCancelCreate={goHome}
            />

            <Box flex="auto" overflow="hidden" style={{ overflowY: 'auto' }}>
              <Box style={{ maxWidth: viewport.isFullscreen ? 720 : undefined, marginLeft: 'auto', marginRight: 'auto' }}>
                {webhookNotice && (
                    <Box padding={2} margin={2} className="bg-amber-50 border border-amber-200 rounded-md">
                        <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Text size="small" className="text-amber-700">{webhookNotice}</Text>
                            <Button onClick={() => setWebhookNotice(null)} variant="default" size="small">
                                Dismiss
                            </Button>
                        </Box>
                    </Box>
                )}
                {tableMismatch && (
                    <Box padding={3} display="flex" flexDirection="column" alignItems="center" justifyContent="center" style={{ minHeight: 200 }}>
                        <Text size="default" marginBottom={2}>
                            You are <strong>{mode === 'create' ? 'creating' : 'modifying'}</strong> a map for <strong>{mismatchTableName}</strong>.
                        </Text>
                        <Text size="small" textColor="light" marginBottom={3}>
                            Select the table to continue.
                        </Text>
                        <Button onClick={goHome} variant="default" size="small">
                            Cancel
                        </Button>
                    </Box>
                )}

                {mode === 'home' && (
                    <HomeScreen
                        onCreateNew={startCreate}
                        onSync={startSync}
                        onModify={startModify}
                        onWebhook={onWebhook}
                        onPreview={(mapId, mapLabel) => setPreviewModal({ mapId, mapLabel })}
                        onConnect={() => setShowSetupModal(true)}
                        showResyncNotice={showResyncNotice}
                        onDismissResyncNotice={() => setShowResyncNotice(false)}
                        webhookFailed={webhookFailed}
                        onDismissWebhookFailed={() => setWebhookFailed(false)}
                    />
                )}

                {!tableMismatch && mode === 'create' && createStep === 1 && (
                    <LocationMapper
                        tableId={activeTableId}
                        initialConfig={pendingLocConfig || { locationMode: 'dual', latField: '', lngField: '', locationColumn: '', locationFormat: 'auto' }}
                        onComplete={handleLocationComplete}
                        onCancel={goHome}
                        hasGeocoding={hasGeocoding}
                    />
                )}

                {!tableMismatch && mode === 'create' && createStep === 2 && (
                    <FieldMapper
                        tableId={activeTableId}
                        initialConfig={{ labelField: '', fieldMapping: {} }}
                        locationFieldIds={[pendingLocConfig?.latField, pendingLocConfig?.lngField, pendingLocConfig?.locationColumn].filter(Boolean)}
                        onComplete={handleFieldsComplete}
                        onBack={() => setCreateStep(1)}
                    />
                )}

                {!tableMismatch && mode === 'create' && createStep === 3 && (
                    <MapBuilder
                        tableId={activeTableId}
                        pendingConfig={combinedPendingConfig}
                        onComplete={handleMapBuilt}
                        onBack={() => setCreateStep(2)}
                    />
                )}

                {!tableMismatch && mode === 'create' && createStep === 4 && (() => {
                    const tc = globalConfig.get(['tableConfigs', activeTableId]) || {};
                    const mapEntry = (tc.maps || []).find(m => m.mapId === activeMapId);
                    return (
                        <SyncPanel
                            tableId={activeTableId}
                            mapId={activeMapId}
                            onBack={goHome}
                            onNext={handleSyncComplete}
                            showHeader={false}
                            hasGeocoding={hasGeocoding}
                            isMapActive={mapEntry?.active === true}
                            onConnect={() => setShowSetupModal(true)}
                        />
                    );
                })()}

                {!tableMismatch && mode === 'create' && createStep === 5 && (() => {
                    const tc = globalConfig.get(['tableConfigs', activeTableId]) || {};
                    const mapEntry = (tc.maps || []).find(m => m.mapId === activeMapId);
                    return (
                        <WebhookSetupStep
                            hasPat={!!globalConfig.get('airtablePat')}
                            onRegister={() => performWebhookRegistration(
                                activeTableId,
                                activeMapId,
                                mapEntry?.airtableBaseId,
                            )}
                            onNext={handleWebhookSetupComplete}
                        />
                    );
                })()}

                {!tableMismatch && mode === 'create' && createStep === 6 && (
                    <CreatePreviewStep
                        mapId={activeMapId}
                        mapLabel={(() => {
                            const tc = globalConfig.get(['tableConfigs', activeTableId]) || {};
                            const m = (tc.maps || []).find(m => m.mapId === activeMapId);
                            return m?.mapLabel || 'Your map';
                        })()}
                        onDone={goHome}
                        onFullscreen={() => setPreviewModal({ mapId: activeMapId, mapLabel: (() => {
                            const tc = globalConfig.get(['tableConfigs', activeTableId]) || {};
                            const m = (tc.maps || []).find(m => m.mapId === activeMapId);
                            return m?.mapLabel || 'Your map';
                        })() })}
                    />
                )}

                {mode === 'sync' && (() => {
                    const tc = globalConfig.get(['tableConfigs', activeTableId]) || {};
                    const mapEntry = (tc.maps || []).find(m => m.mapId === activeMapId);
                    return (
                        <SyncPanel
                            tableId={activeTableId}
                            mapId={activeMapId}
                            onBack={goHome}
                            showHeader={true}
                            skipConfirm={true}
                            hasGeocoding={hasGeocoding}
                            isMapActive={mapEntry?.active === true}
                            onConnect={() => setShowSetupModal(true)}
                        />
                    );
                })()}

                {!tableMismatch && mode === 'modify' && modifyStep === 1 && (() => {
                    const tc = globalConfig.get(['tableConfigs', activeTableId]) || {};
                    const mapEntry = (tc.maps || []).find(m => m.mapId === activeMapId);
                    return (
                        <LocationMapper
                            tableId={activeTableId}
                            initialConfig={pendingLocConfig || seedLocConfig(activeTableId)}
                            onComplete={handleModifyLocationComplete}
                            onCancel={goHome}
                            hasGeocoding={hasGeocoding}
                            isMapActive={mapEntry?.active === true}
                        />
                    );
                })()}

                {!tableMismatch && mode === 'modify' && modifyStep === 2 && (
                    <FieldMapper
                        tableId={activeTableId}
                        initialConfig={seedFieldConfig(activeTableId)}
                        locationFieldIds={[pendingLocConfig?.latField, pendingLocConfig?.lngField, pendingLocConfig?.locationColumn].filter(Boolean)}
                        onComplete={handleModifyFieldsComplete}
                        onBack={() => setModifyStep(1)}
                    />
                )}
              </Box>
            </Box>

            {showSetupModal && (
                <Box
                    position="absolute"
                    top={0}
                    left={0}
                    right={0}
                    bottom={0}
                    tabIndex={0}
                    ref={(el) => el && el.focus()}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') setShowSetupModal(false);
                    }}
                    style={{
                        backgroundColor: 'rgba(0,0,0,0.4)',
                        zIndex: 100,
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'center',
                        paddingTop: 40,
                        outline: 'none',
                    }}
                >
                    <Box
                        style={{
                            backgroundColor: '#fff',
                            borderRadius: 8,
                            boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
                            width: '90%',
                            maxWidth: 400,
                            position: 'relative',
                        }}
                    >
                        <button
                            onClick={() => setShowSetupModal(false)}
                            style={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 4,
                                lineHeight: 1,
                                fontSize: 18,
                                color: '#6b7280',
                                zIndex: 1,
                            }}
                            aria-label="Close"
                        >
                            ✕
                        </button>
                        <Setup
                            onComplete={() => {
                                setShowSetupModal(false);
                                setMode('home');
                            }}
                            onDismiss={() => setShowSetupModal(false)}
                            onCreateMap={() => {
                                setShowSetupModal(false);
                                const tableId = base.tables[0]?.id;
                                if (tableId) startCreate(tableId);
                            }}
                            onDisconnect={globalConfig.get('token') ? () => {
                                setMode('home');
                            } : undefined}
                        />
                    </Box>
                </Box>
            )}

            {webhookModal && (() => {
                const wTableConfig = globalConfig.get(['tableConfigs', webhookModal.tableId]) || {};
                const wMaps = wTableConfig.maps || [];
                const resolvedMapBase = wMaps.find((m) => m.mapId === webhookModal.mapId) || null;
                // Inject table-level webhook ID so WebhookPanel can show/manage it
                const resolvedMap = resolvedMapBase
                    ? { ...resolvedMapBase, airtableWebhookId: wTableConfig.airtableWebhookId || null }
                    : null;
                return (
                    <Box
                        position="absolute"
                        top={0}
                        left={0}
                        right={0}
                        bottom={0}
                        style={{
                            backgroundColor: 'rgba(0,0,0,0.4)',
                            zIndex: 100,
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'center',
                            paddingTop: 40,
                        }}
                    >
                        <WebhookPanel
                            map={resolvedMap}
                            tableId={webhookModal.tableId}
                            pat={globalConfig.get('airtablePat')}
                            onRegister={() => performWebhookRegistration(
                                webhookModal.tableId,
                                webhookModal.mapId,
                                resolvedMap?.airtableBaseId,
                            )}
                            onClose={() => setWebhookModal(null)}
                        />
                    </Box>
                );
            })()}

            {previewModal && (
                <MapPreview
                    mapId={previewModal.mapId}
                    mapLabel={previewModal.mapLabel}
                    onClose={() => setPreviewModal(null)}
                />
            )}
        </Box>
    );
}

initializeBlock(() => <MapsembleApp />);
