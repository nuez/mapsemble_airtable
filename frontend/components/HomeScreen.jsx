import React, { useState, useEffect } from 'react';
import {
  useBase,
  useCursor,
  useGlobalConfig,
  useViewport,
  Box,
  Text,
  Button,
  Link,
} from '@airtable/blocks/ui';
import { fetchMaps, MAPSEMBLE_URL } from '../services/mapsemble';
import heroImage from '../assets/hero.js';
import ContactForm from './ContactForm';

function BtnSpinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: 10,
      height: 10,
      borderRadius: '50%',
      border: '1.5px solid currentColor',
      borderTopColor: 'transparent',
      animation: 'mapsemble-spin 0.6s linear infinite',
      flexShrink: 0,
    }} />
  );
}

function formatDate(iso) {
  if (!iso) {
    return null;
  }
  try {
    return new Date(iso).toLocaleString();
  } catch (_err) {
    return iso;
  }
}

export default function HomeScreen({ onCreateNew, onSync, onModify, onWebhook, onPreview, onConnect, showResyncNotice, onDismissResyncNotice, webhookFailed, onDismissWebhookFailed }) {
  const base = useBase();
  const cursor = useCursor();
  const globalConfig = useGlobalConfig();
  const viewport = useViewport();
  const canWrite = globalConfig.hasPermissionToSet();

  const connected = !!globalConfig.get('token');
  const activeTableId = cursor.activeTableId;
  const tableConfig = activeTableId
    ? (globalConfig.get(['tableConfigs', activeTableId]) || {})
    : {};
  const maps = connected ? (tableConfig.maps || []) : [];
  const activeTable = activeTableId ? base.getTableByIdIfExists(activeTableId) : null;

  const [missingMapIds, setMissingMapIds] = useState(new Set());
  const [loadingMaps, setLoadingMaps] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const wasExampleFullscreen = React.useRef(false);
  const [showContact, setShowContact] = useState(false);
  const [loadingBtn, setLoadingBtn] = useState(null);

  const mapIds = maps.map((m) => m.mapId).join(',');
  useEffect(() => {
    if (maps.length === 0) {
      setMissingMapIds(new Set());
      return;
    }
    const token = globalConfig.get('token');
    if (!token) {
      return;
    }

    const config = {
      clientId: globalConfig.get('clientId'),
      clientSecret: globalConfig.get('clientSecret'),
      token,
    };
    setLoadingMaps(true);
    fetchMaps(config, (newToken) => globalConfig.setAsync('token', newToken))
      .then(async (remoteMaps) => {
        const remoteById = new Map(remoteMaps.map((m) => [String(m.id), m]));
        setMissingMapIds(
          new Set(maps.filter((m) => !remoteById.has(String(m.mapId))).map((m) => m.mapId)),
        );

        // Persist remote status on each local map entry
        const tc = globalConfig.get(['tableConfigs', activeTableId]) || {};
        const updatedMaps = (tc.maps || []).map((m) => {
          const remote = remoteById.get(String(m.mapId));
          if (remote && remote.active !== undefined) {
            return { ...m, active: remote.active };
          }
          return m;
        });
        if (canWrite) {
          await globalConfig.setAsync(['tableConfigs', activeTableId, 'maps'], updatedMaps);
        }

        setLoadingMaps(false);
      })
      .catch(() => {
        setMissingMapIds(new Set());
        setLoadingMaps(false);
      });
  }, [activeTableId, mapIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter fullscreen when example is opened
  useEffect(() => {
    if (showExample) {
      viewport.enterFullscreenIfPossible();
    }
  }, [showExample]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-close example when fullscreen is exited externally
  useEffect(() => {
    if (viewport.isFullscreen && showExample) {
      wasExampleFullscreen.current = true;
    } else if (wasExampleFullscreen.current && !viewport.isFullscreen) {
      wasExampleFullscreen.current = false;
      setShowExample(false);
    }
  }, [viewport.isFullscreen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function removeMap(mapId) {
    const tc = globalConfig.get(['tableConfigs', activeTableId]) || {};
    const updatedMaps = (tc.maps || []).filter((m) => m.mapId !== mapId);
    await globalConfig.setAsync(['tableConfigs', activeTableId, 'maps'], updatedMaps);
  }

  return (
    <Box padding={3}>
      {/* Resync notice */}
      {showResyncNotice && (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          padding={2}
          marginBottom={3}
          className="bg-yellow-50 border border-yellow-300 rounded-md"
        >
          <Text size="small" className="text-amber-800">
            Column mapping updated - sync to apply changes.
          </Text>
          <Button
            onClick={onDismissResyncNotice}
            variant="default"
            size="small"
            className="ml-2 shrink-0"
          >
            Dismiss
          </Button>
        </Box>
      )}

      {/* Webhook failed notice */}
      {webhookFailed && (
        <Box
          display="flex"
          alignItems="flex-start"
          justifyContent="space-between"
          padding={2}
          marginBottom={3}
          className="bg-amber-50 border border-amber-200 rounded-md"
        >
          <Box>
            <Text size="small" fontWeight="strong" className="text-amber-700">
              Auto-sync could not be enabled
            </Text>
            <Text size="small" className="text-amber-700" marginTop={1}>
              There was a problem registering the webhook. You can set it up from the webhook panel.
            </Text>
          </Box>
          <Button onClick={onDismissWebhookFailed} variant="default" size="small" className="ml-2 shrink-0">
            Dismiss
          </Button>
        </Box>
      )}

      {/* Intro copy for new users */}
      {maps.length === 0 && !connected && (
        <Box className="mb-5">
          <h3 className="text-gray-700 font-bold !mb-2 mt-0 text-lg">
            Turn your Airtable data into filterable map listings
          </h3>
          <Box display="flex" className="gap-3 items-stretch" marginTop={3}>
            <Box display="flex" flexDirection="column" justifyContent="center" padding={3} className="bg-blue-50 rounded-md text-black/70 basis-1/2 flex-1">
              <p className=" text-sm m-0 font-semibold leading-tight">
                Connect any table with location data and get an interactive map your visitors can browse, filter, and search - like Airbnb or Booking.com.
              </p>
              <p className="text-black/60 text-xs mt-3 m-0">
                Great for real estate listings, vacation rentals, venue browsers, people directories, and more.
              </p>
            </Box>
            <Box
              padding={3}
              display="flex"
              flexDirection="column"
              justifyContent="center"
              className="bg-blue-50 rounded-md basis-1/2 flex-1"
            >
              <p  className="text-black/70  mb-2  text-sm m-0 font-semibold leading-tight">Features</p>
              <ul className="list-disc pl-5 space-y-1 m-0">
                <li className="text-xs">Rich popup cards with photos and details</li>
                <li className="text-xs">Filter by price, category, availability, or any field</li>
                <li className="text-xs">Auto-syncs when your Airtable changes</li>
                <li className="text-xs">Fully customizable: pins, cards, colors, layout</li>
              </ul>
            </Box>
          </Box>
        </Box>
      )}

      {/* Maps list */}
      {maps.length > 0 && (
        <Box marginBottom={3}>
          {loadingMaps && (
            <Box display="flex" alignItems="center" marginBottom={2}>
              <Text size="small" textColor="light">Checking maps...</Text>
            </Box>
          )}
          {maps.map((map) => (
            <Box
              key={map.mapId}
              padding={2}
              marginBottom={2}
              className="bg-white border border-gray-200 rounded-md"
            >
              <Box display="flex" alignItems="center"
                   justifyContent="space-between">
                <Box flex="1" className="min-w-0 mr-2">
                  <Text
                    size="default"
                    fontWeight="strong"
                    className="truncate"
                  >
                    {map.mapLabel || map.mapId}
                  </Text>
                  {map.lastSync ? (
                    <Text size="small" className="text-gray-400 mt-0.5">
                      Last synced: {formatDate(map.lastSync)}
                    </Text>
                  ) : (
                    <Text size="small" className="text-gray-400 mt-0.5">
                      Never synced
                    </Text>
                  )}
                  {map.limitReached && (
                    <Box
                      display="inline-flex"
                      alignItems="center"
                      marginTop={1}
                      className="bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                    >
                      <Text size="small" className="text-amber-800">
                        Location limit reached
                      </Text>
                    </Box>
                  )}
                  {map.autoSync && globalConfig.get('airtablePat') ? (
                    <Box
                      display="inline-flex"
                      alignItems="center"
                      marginTop={1}
                      onClick={() => onWebhook(activeTableId, map.mapId)}
                      style={{ cursor: 'pointer' }}
                      className="bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5"
                    >
                      <Box
                        flexShrink={0}
                        marginRight={1}
                        className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                      />
                      <Text size="small" className="text-emerald-800">
                        Auto-sync active
                      </Text>
                    </Box>
                  ) : (
                    <Box
                      display="inline-flex"
                      marginTop={1}
                      onClick={() => onWebhook(activeTableId, map.mapId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Text size="small"
                            className="text-blue-600 hover:underline">
                        Enable auto-sync
                      </Text>
                    </Box>
                  )}
                </Box>
                <Box display="flex" className="gap-1.5 shrink-0">
                  <Button
                    onClick={() => onPreview(map.mapId, map.mapLabel || map.mapId)}
                    variant="default"
                    size="small"
                    disabled={missingMapIds.has(map.mapId)}
                  >
                    Preview
                  </Button>
                  <Button
                    onClick={() => { setLoadingBtn({ mapId: map.mapId, action: 'modify' }); onModify(activeTableId, map.mapId); }}
                    variant="default"
                    size="small"
                    disabled={!canWrite || missingMapIds.has(map.mapId)}
                  >
                    <Box display="flex" alignItems="center" style={{ gap: 4 }}>
                      {loadingBtn?.mapId === map.mapId && loadingBtn?.action === 'modify' && <BtnSpinner />}
                      Modify
                    </Box>
                  </Button>
                  <Button
                    onClick={() => { setLoadingBtn({ mapId: map.mapId, action: 'sync' }); onSync(activeTableId, map.mapId); }}
                    variant="default"
                    size="small"
                    disabled={!canWrite || missingMapIds.has(map.mapId)}
                  >
                    <Box display="flex" alignItems="center" style={{ gap: 4 }}>
                      {loadingBtn?.mapId === map.mapId && loadingBtn?.action === 'sync' && <BtnSpinner />}
                      Sync
                    </Box>
                  </Button>
                  <Button
                    onClick={() => window.open(`${MAPSEMBLE_URL}/map/${map.mapId}`, '_blank', 'noreferrer')}
                    variant="primary"
                    size="small"
                    disabled={missingMapIds.has(map.mapId)}
                  >
                    <Box display="flex" alignItems="center" className="gap-1">
                      Customize
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 17L17 7"/>
                        <path d="M7 7h10v10"/>
                      </svg>
                    </Box>
                  </Button>
                </Box>
              </Box>
              {missingMapIds.has(map.mapId) && (
                <Box marginTop={2} padding={2}
                     className="bg-red-50 border border-red-300 rounded-md">
                  <Text size="small" fontWeight="strong"
                        className="text-red-700">
                    Map not found in Mapsemble
                  </Text>
                  <Text size="small" className="text-red-600 mt-1">
                    This map may have been deleted.
                  </Text>
                  <Button
                    onClick={() => removeMap(map.mapId)}
                    variant="danger"
                    size="small"
                    marginTop={2}
                    disabled={!canWrite}
                  >
                    Remove from list
                  </Button>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Short description for logged-in users with no maps */}
      {connected && maps.length === 0 && (
        <Box marginY={3}>
          <Text className="text-gray-500">
            Create a map from your <strong>{activeTable ? activeTable.name : 'current'}</strong> table to turn your location data into an interactive, filterable map.
          </Text>
        </Box>
      )}

      {/* Action buttons */}
      <Box display="flex" className="gap-2">
        {connected ? (
          <Button
            onClick={() => onCreateNew(activeTableId)}
            variant="primary"
            className="flex-1"
            disabled={!canWrite}
          >
            + Create a new map
          </Button>
        ) : (
          <Button
            onClick={onConnect}
            variant="primary"
            className="flex-1"
          >
            Connect to Mapsemble
          </Button>
        )}
        {!connected && (
          <Button
            onClick={() => setShowExample(true)}
            variant="default"
          >
            <Box display="flex" alignItems="center" className="gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                   width="14" height="14" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              Show example
            </Box>
          </Button>
        )}
      </Box>

      {/* Contact CTA */}
      <Box
        marginTop={3}
        padding={3}
        className="bg-blue-50 border border-blue-200 rounded-md"
        display="flex"
        flexDirection="column"
        alignItems="center"
      >
        <Text size="default" fontWeight="strong" className="text-gray-700 !mb-1" style={{ textAlign: 'center' }}>
          We'd love to help you get on board
        </Text>
        <Text size="small" className="text-gray-500 !mb-3" style={{ textAlign: 'center' }}>
          Tell us your idea and let us build your map together.
        </Text>
        <Button
          onClick={() => setShowContact(true)}
          variant="primary"
        >
          Tell us about your idea
        </Button>
      </Box>

      {/* Hero image - shown below buttons when not connected */}
      {!connected && maps.length === 0 && (
        <Box marginTop={3} className="rounded-md overflow-hidden">
          <img
            src={heroImage}
            alt="Mapsemble map example"
            style={{ width: '100%', display: 'block', borderRadius: 6 }}
          />
        </Box>
      )}

      {/* Contact form modal */}
      {showContact && <ContactForm onClose={() => setShowContact(false)} />}

      {/* Example map modal */}
      {showExample && (
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          display="flex"
          flexDirection="column"
          style={{ backgroundColor: '#fff', zIndex: 100 }}
        >
          <Box
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            paddingX={3}
            paddingY={2}
            borderBottom="default"
            flexShrink={0}
          >
            <Text fontWeight="strong">Map Example</Text>
            <Button onClick={() => {
              if (viewport.isFullscreen) {
                viewport.exitFullscreen();
              } else {
                setShowExample(false);
              }
            }} variant="default" size="small">
              Close
            </Button>
          </Box>
          <Box flex="auto" padding={0} style={{ position: 'relative' }}>
            <iframe
              src="https://app.mapsemble.com/embed/019c09be-4113-7222-95d8-c616d8d7efc1"
              title="Map Example"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                position: 'absolute',
                top: 0,
                left: 0,
              }}
            />
          </Box>
        </Box>
      )}
      <style>{`@keyframes mapsemble-spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}
