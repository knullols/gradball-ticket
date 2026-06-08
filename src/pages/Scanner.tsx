import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';

export interface SerialEntry {
  serialNumber: string;
  label: string;
  qrLabel?: string;
  mainLabel?: string;
  status: string;
  qrValue: string;
  event_id?: string;
  scanned_at?: string;
}

export interface EventEntry {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface ScanResult {
  ok: boolean;
  message: string;
  entry?: SerialEntry;
}

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function readQrPayload(payload: string) {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as { serialNumber?: string; serial?: string; ticketId?: string };
    return parsed.serialNumber || parsed.serial || parsed.ticketId || trimmed;
  } catch {
    return trimmed;
  }
}

import { supabase } from '../lib/supabaseClient';

export default function Scanner() {
  const [serials, setSerials] = useState<SerialEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [notification, setNotification] = useState<{message: string, entry?: SerialEntry} | null>(null);
  
  // Events & full screen state
  const [activeEvent, setActiveEvent] = useState<EventEntry | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [scannedTickets, setScannedTickets] = useState<SerialEntry[]>([]);
  const [isTicketsModalOpen, setIsTicketsModalOpen] = useState(false);
  const [ticketFilter, setTicketFilter] = useState<'all' | 'Pending' | 'Scanned'>('all');
  const [ticketSearch, setTicketSearch] = useState('');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const isCheckingRef = useRef(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);

  const serialIndex = useMemo(() => {
    const map = new Map<string, SerialEntry>();
    serials.forEach((entry) => {
      map.set(entry.serialNumber.toLowerCase(), entry);
      map.set(entry.qrValue.toLowerCase(), entry);
    });
    return map;
  }, [serials]);

  // Auto-dismiss notification after 4 seconds
  useEffect(() => {
    if (!notification) return;
    const timeout = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timeout);
  }, [notification]);

  // Initial silent sync on mount
  useEffect(() => {
    loadActiveEventAndTickets();
    // Auto-refresh scanned list every 10s
    const interval = setInterval(refreshScannedList, 10000);
    return () => {
      scannerControlsRef.current?.stop();
      clearInterval(interval);
    };
  }, []);

  async function loadActiveEventAndTickets() {
    setEventLoading(true);
    const { data: eventData } = await supabase
      .from('events')
      .select('*')
      .eq('is_active', true)
      .single();

    if (eventData) {
      setActiveEvent(eventData as EventEntry);
      await syncFromSupabase(eventData.id, true);
      await refreshScannedList(eventData.id);
    }
    setEventLoading(false);
  }

  async function refreshScannedList(eventId?: string) {
    const eid = eventId ?? activeEvent?.id;
    if (!eid) return;
    const { data } = await supabase
      .from('tickets')
      .select('*')
      .eq('event_id', eid)
      .eq('status', 'Scanned')
      .order('scanned_at', { ascending: false });
    if (data) setScannedTickets(data as SerialEntry[]);
  }

  async function syncFromSupabase(eventId?: string | boolean, silent = false) {
    // handle calling as syncFromSupabase(true) for backward compat
    const isJustSilent = typeof eventId === 'boolean';
    const eid = isJustSilent ? activeEvent?.id : eventId as string;
    const isSilent = isJustSilent ? eventId : silent;

    try {
      if (!isSilent) {
        setSyncing(true);
        setSyncMessage('Fetching database from Supabase...');
      }
      
      let query = supabase.from('tickets').select('*');
      if (eid) {
        query = query.eq('event_id', eid);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      if (data && data.length > 0) {
        setSerials(data as SerialEntry[]);
        if (!isSilent) {
          setSyncMessage(`Success! Loaded ${data.length} tickets.`);
        }
      } else {
        setSerials([]);
        if (!isSilent) setSyncMessage('Connected, but the tickets table is empty.');
      }
    } catch (err: any) {
      console.error('Supabase error:', err);
      if (isSilent) return;
      const errMsg = err?.message || String(err);
      setSyncMessage(`Error: ${errMsg.slice(0, 50)}. Ensure URL/Key are correct.`);
    } finally {
      if (!isSilent) setSyncing(false);
    }
  }

  async function startScanner() {
    setCameraError('');
    setScanResult(null);
    if (!videoRef.current) {
      setCameraError('Camera preview is not ready.');
      return;
    }

    setScanning(true);
    const reader = new BrowserMultiFormatReader();

    try {
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, async (result, error, activeControls) => {
        scannerControlsRef.current = activeControls;

        if (result && !isCheckingRef.current) {
          isCheckingRef.current = true;
          const payload = readQrPayload(result.getText());
          
          if (!payload) {
            setScanResult({ ok: false, message: 'Invalid QR code format.' });
            setTimeout(() => { isCheckingRef.current = false; }, 2000);
            return;
          }

          try {
            setScanResult({ ok: true, message: 'Verifying with database...', entry: undefined });
            
            const { data, error: fetchErr } = await supabase
              .from('tickets')
              .select('*')
              .or(`serialNumber.ilike.${payload},qrValue.ilike.${payload}`)
              .single();
              
            if (fetchErr || !data) {
              setScanResult({ ok: false, message: 'QR code detected but no matching ticket found in database.' });
            } else if (data.status === 'Scanned') {
              setScanResult({ ok: false, message: 'ALREADY SCANNED!', entry: data });
            } else {
              const { error: updateErr } = await supabase
                .from('tickets')
                .update({ status: 'Scanned', scanned_at: new Date().toISOString() })
                .eq('serialNumber', data.serialNumber);
                
              if (updateErr) throw updateErr;
              setScanResult({ ok: true, message: 'Valid ticket. Marked as Scanned.', entry: data });
              setNotification({ message: 'Ticket validated & scanned!', entry: data });
              // Refresh scanned list immediately
              refreshScannedList();
            }
          } catch (e: any) {
             setScanResult({ ok: false, message: `Database error: ${e.message}` });
          } finally {
             // Wait 2 seconds before allowing next scan to prevent rapid firing
             setTimeout(() => { isCheckingRef.current = false; }, 2000);
          }
        }

        if (error && error.name !== 'NotFoundException') {
          console.warn('Scan error:', error);
        }
      });
      scannerControlsRef.current = controls;
    } catch (err) {
      setCameraError('Camera access failed. Check permissions and try again.');
      setScanning(false);
    }
  }

  function stopScanner() {
    scannerControlsRef.current?.stop();
    setScanning(false);
    setScanResult(null);
  }

  return (
    <div className="app-shell" style={{ padding: '20px' }}>
      <div className="backdrop backdrop-left" />
      <div className="backdrop backdrop-right" />

      {!isFullScreen && (
        <header style={{ marginBottom: '24px', padding: '24px', border: '1px solid rgba(255, 214, 117, 0.18)', borderRadius: '28px', background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))', backdropFilter: 'blur(16px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '2.5rem', color: '#fff1cb', textShadow: '0 0 28px rgba(255, 206, 105, 0.35)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Nocturne Scanner</h1>
            {activeEvent
              ? <p style={{ marginTop: '8px', color: 'rgba(245, 232, 198, 0.82)' }}>Event: <strong style={{ color: '#ffd675' }}>{activeEvent.name}</strong></p>
              : <p style={{ marginTop: '8px', color: '#ef7070' }}>⚠ No active event set. Contact admin.</p>
            }
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="secondary-button" onClick={() => setIsTicketsModalOpen(true)} style={{ whiteSpace: 'nowrap' }}>
              All Tickets
            </button>
            <button className="secondary-button" onClick={() => supabase.auth.signOut()} style={{ background: 'rgba(239, 112, 112, 0.1)', borderColor: 'rgba(239, 112, 112, 0.3)', color: '#ef7070' }}>
              Sign Out
            </button>
          </div>
        </header>
      )}

      <main className="workspace" style={{ gridTemplateColumns: '1fr', maxWidth: '800px', margin: '0 auto', display: isFullScreen ? 'none' : 'grid' }}>
        
        {/* Database Sync Panel */}
        <section className="panel controls" style={{ position: 'relative', top: '0', marginBottom: '24px' }}>
          <div className="section-header">
            <div>
              <p className="section-eyebrow">Database Connection</p>
              <h2>Supabase Sync</h2>
            </div>
            <div className="section-chip">{serials.length} Loaded</div>
          </div>
          
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexDirection: 'column' }}>
            <button className="primary-button" onClick={() => syncFromSupabase()} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Sync Database'}
            </button>
            {syncMessage && (
              <p style={{ marginTop: '8px', fontSize: '0.9rem', color: syncing ? '#f8e9c5' : (serials.length > 0 ? '#76c684' : '#ff7b7b') }}>
                {syncMessage}
              </p>
            )}
          </div>
        </section>

        {/* Scanner Panel (Standard) */}
        <section className="panel preview" style={isFullScreen ? { backdropFilter: 'none', background: 'none', border: 'none', boxShadow: 'none' } : undefined}>
          <div className="section-header" style={{ marginBottom: '16px' }}>
            <div>
              <p className="section-eyebrow">On-site verification</p>
              <h2>QR Scanner</h2>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="primary-button" style={{ padding: '0 12px', minHeight: '34px', borderRadius: '8px' }} onClick={() => setIsFullScreen(true)}>
                Camera Mode
              </button>
              <div className={scanning ? 'section-chip success' : 'section-chip'}>{scanning ? 'Scanning' : 'Idle'}</div>
            </div>
          </div>
          <p className="section-description">Use the camera to scan a serial QR and match it against the database.</p>

          {/* Actual Scanner Shell - Renders Inline or Full Screen */}
          <div className={isFullScreen ? "fullscreen-scanner" : "scanner-shell"} style={{ marginTop: isFullScreen ? 0 : '20px', maxWidth: isFullScreen ? 'none' : '100%', margin: isFullScreen ? 0 : '0 auto' }}>
            
            {isFullScreen && (
              <button className="fullscreen-scanner-close" onClick={() => setIsFullScreen(false)}>
                &times;
              </button>
            )}

            <div className="scanner-box">
              <video ref={videoRef} autoPlay muted playsInline />
              {!scanning ? <div className="scanner-overlay">Camera idle</div> : null}
            </div>
            
            {isFullScreen && (
              <div className="fullscreen-scanner-alerts">
                {cameraError ? <div className="alert alert-error" style={{ backdropFilter: 'blur(10px)' }}>{cameraError}</div> : null}
                {scanResult ? (
                  <div className={scanResult.ok ? 'alert alert-success' : 'alert alert-error'} style={{ backdropFilter: 'blur(10px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                    <strong style={{ fontSize: '1.2rem', display: 'block', marginBottom: '4px' }}>{scanResult.ok ? '✓ Valid Ticket' : '✕ Invalid Ticket'}</strong>
                    <div style={{ opacity: 0.9 }}>{scanResult.message}</div>
                    {scanResult.entry && (
                      <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontFamily: 'monospace' }}>
                        <div style={{ fontWeight: 'bold' }}>{scanResult.entry.serialNumber}</div>
                        {scanResult.entry.mainLabel && <div>Center Label: {scanResult.entry.mainLabel}</div>}
                        {scanResult.entry.label && <div>Vertical Label: {scanResult.entry.label}</div>}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            <div className="scanner-actions" style={{ marginTop: isFullScreen ? 0 : '16px' }}>
              <button className="primary-button" onClick={startScanner} disabled={scanning}>
                Start camera
              </button>
              <button className="secondary-button" onClick={stopScanner} disabled={!scanning}>
                Stop camera
              </button>
            </div>
          </div>

          {/* Standard Alerts (only shown when not fullscreen) */}
          {!isFullScreen && (
            <div style={{ width: '100%' }}>
              {cameraError ? <div className="alert alert-error" style={{ marginTop: '16px' }}>{cameraError}</div> : null}
              {scanResult ? (
                <div className={scanResult.ok ? 'alert alert-success' : 'alert alert-warning'} style={{ marginTop: '16px' }}>
                  <strong>{scanResult.ok ? 'Valid' : 'Invalid'}</strong> {scanResult.message}
                  {scanResult.entry && (
                    <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                      <strong style={{ fontFamily: 'monospace' }}>{scanResult.entry.serialNumber}</strong>
                      <div style={{ fontSize: '0.9rem', opacity: 0.8, marginTop: '4px' }}>
                        {scanResult.entry.mainLabel && <div>Center Label: {scanResult.entry.mainLabel}</div>}
                        {scanResult.entry.label && <div>Vertical Label: {scanResult.entry.label}</div>}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* Scanned Tickets List */}
        {!isFullScreen && (
          <section className="panel controls" style={{ marginTop: '20px' }}>
            <div className="section-header">
              <div>
                <p className="section-eyebrow">Live Activity</p>
                <h2>Scanned Tickets</h2>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div className="section-chip success">{scannedTickets.length} Scanned</div>
                <button className="secondary-button" style={{ padding: '4px 12px', fontSize: '0.8rem', minHeight: 'unset' }} onClick={() => refreshScannedList()}>↻ Refresh</button>
              </div>
            </div>
            <p className="section-description">Live list of tickets that have been scanned for <strong style={{ color: '#ffd675' }}>{activeEvent?.name ?? 'this event'}</strong>. Auto-refreshes every 10 seconds.</p>

            {scannedTickets.length === 0 ? (
              <div style={{ marginTop: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '32px 0' }}>
                No tickets scanned yet.
              </div>
            ) : (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
                {scannedTickets.map(ticket => (
                  <div key={ticket.serialNumber} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '12px', background: 'rgba(118, 198, 132, 0.06)', border: '1px solid rgba(118, 198, 132, 0.2)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'monospace', fontWeight: 600, color: '#76c684' }}>{ticket.serialNumber}</div>
                      <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                        {ticket.mainLabel && <span>{ticket.mainLabel}</span>}
                        {ticket.mainLabel && ticket.label && <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>}
                        {ticket.label && <span>{ticket.label}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>
                      {ticket.scanned_at ? new Date(ticket.scanned_at).toLocaleTimeString() : ''}
                    </div>
                    <span style={{ padding: '2px 8px', borderRadius: '20px', background: 'rgba(118,198,132,0.15)', color: '#76c684', fontSize: '0.75rem', fontWeight: 600 }}>✓</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* All Tickets Modal */}
      {isTicketsModalOpen && (() => {
        const filtered = serials
          .filter(t => ticketFilter === 'all' || t.status === ticketFilter)
          .filter(t => {
            if (!ticketSearch) return true;
            const q = ticketSearch.toLowerCase();
            return t.serialNumber.toLowerCase().includes(q) ||
              (t.label || '').toLowerCase().includes(q) ||
              (t.mainLabel || '').toLowerCase().includes(q);
          });

        const pendingCount = serials.filter(t => t.status === 'Pending').length;
        const scannedCount = serials.filter(t => t.status === 'Scanned').length;

        return (
          <div className="modal-overlay" style={{ zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
            <div className="modal" style={{ width: '100%', maxWidth: '640px', margin: '20px 0', padding: '28px' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.3rem', color: '#fff1cb' }}>All Tickets</h3>
                  <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)' }}>
                    {activeEvent?.name} &middot; {serials.length} total &middot; <span style={{ color: '#76c684' }}>{scannedCount} scanned</span> &middot; <span style={{ color: 'rgba(255,255,255,0.5)' }}>{pendingCount} pending</span>
                  </p>
                </div>
                <button onClick={() => { setIsTicketsModalOpen(false); setTicketSearch(''); setTicketFilter('all'); }} style={{ background: 'none', border: 'none', color: '#f8e9c5', opacity: 0.6, cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1 }}>&times;</button>
              </div>

              {/* Search & Filter */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={ticketSearch}
                  onChange={e => setTicketSearch(e.target.value)}
                  placeholder="Search serial, label..."
                  style={{ flex: 1, minWidth: '160px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,214,117,0.2)', color: '#fff', fontSize: '0.95rem' }}
                />
                {(['all', 'Pending', 'Scanned'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setTicketFilter(f)}
                    style={{ padding: '8px 16px', borderRadius: '10px', border: `1px solid ${ticketFilter === f ? 'rgba(255,214,117,0.5)' : 'rgba(255,255,255,0.1)'}`, background: ticketFilter === f ? 'rgba(255,214,117,0.1)' : 'transparent', color: ticketFilter === f ? '#ffd675' : 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '0.85rem', textTransform: 'capitalize' }}
                  >{f}</button>
                ))}
              </div>

              {/* Ticket list */}
              <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filtered.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.3)' }}>No tickets match.</div>
                ) : filtered.map(ticket => (
                  <div key={ticket.serialNumber} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '10px', background: ticket.status === 'Scanned' ? 'rgba(118,198,132,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${ticket.status === 'Scanned' ? 'rgba(118,198,132,0.25)' : 'rgba(255,255,255,0.07)'}` }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 600, color: ticket.status === 'Scanned' ? '#76c684' : '#fff' }}>{ticket.serialNumber}</div>
                      <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)', marginTop: '2px' }}>
                        {[ticket.mainLabel, ticket.label].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600, background: ticket.status === 'Scanned' ? 'rgba(118,198,132,0.15)' : 'rgba(255,255,255,0.08)', color: ticket.status === 'Scanned' ? '#76c684' : 'rgba(255,255,255,0.4)' }}>
                      {ticket.status}
                    </span>
                    {ticket.status === 'Scanned' && ticket.scanned_at && (
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>
                        {new Date(ticket.scanned_at).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Success Notification Toast */}
      {notification && (
        <div className="notification-toast">
          <div className="notification-icon">✓</div>
          <div className="notification-content">
            <div className="notification-message">{notification.message}</div>
            {notification.entry && (
              <div className="notification-details">
                <div className="notification-serial">{notification.entry.serialNumber}</div>
                {(notification.entry.mainLabel || notification.entry.label) && (
                  <div className="notification-labels">
                    {[notification.entry.mainLabel, notification.entry.label].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
