import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { QRCodeCanvas } from 'qrcode.react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import ctuLogo from '../assets/ctu-logo.png';
import councilLogo from '../assets/council-logo.png';

type SerialEntry = {
  serialNumber: string;
  label: string;
  qrLabel?: string;
  mainLabel?: string;
  status: string;
  qrValue: string;
  event_id?: string;
};

type EventEntry = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

type ScanResult = {
  ok: boolean;
  message: string;
  entry?: SerialEntry;
};

type SerialFormState = {
  count: string;
  prefix: string;
  startNumber: string;
  label: string;
  customLabel: string;
  qrLabel: string;
  customQrLabel: string;
  mainLabel: string;
  customMainLabel: string;
};

const placeholderSerial: SerialEntry = {
  serialNumber: 'NC-XXXXXX-XXXX',
  label: 'MASQUERADER',
  qrLabel: 'GATEPASS',
  mainLabel: 'GATEPASS',
  status: 'Demo',
  qrValue: 'NC-XXXXXX-XXXX',
};

const defaultFormState: SerialFormState = {
  count: '10',
  prefix: 'NC',
  startNumber: '1',
  label: 'MASQUERADER',
  customLabel: '',
  qrLabel: 'GATEPASS',
  customQrLabel: '',
  mainLabel: 'GATEPASS',
  customMainLabel: '',
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function createSerialEntries(count: number, prefix: string, startNumber: number, label: string, qrLabel: string, mainLabel: string) {
  const dateStamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');

  return Array.from({ length: count }, (_, index) => {
    const serialNumber = `${prefix.toUpperCase()}-${dateStamp}-${String(startNumber + index).padStart(4, '0')}`;

    return {
      serialNumber,
      label,
      qrLabel,
      mainLabel,
      status: 'Generated',
      qrValue: serialNumber,
    } satisfies SerialEntry;
  });
}

function readQrPayload(payload: string) {
  const trimmed = payload.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as { serialNumber?: string; serial?: string; ticketId?: string };
    return parsed.serialNumber || parsed.serial || parsed.ticketId || trimmed;
  } catch {
    return trimmed;
  }
}

import { supabase } from '../lib/supabaseClient';
import { ConfirmationModal } from '../components/ConfirmationModal';

export default function AdminStudio() {
  const [serials, setSerials] = useState<SerialEntry[]>([]);
  const [activeMode, setActiveMode] = useState<'generate' | 'scan'>('generate');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [generateMode, setGenerateMode] = useState<'overwrite' | 'append'>('overwrite');
  const [serialForm, setSerialForm] = useState<SerialFormState>(defaultFormState);
  const [modalError, setModalError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedSerialIds, setSelectedSerialIds] = useState<Set<string>>(new Set());
  const [isFullScreen, setIsFullScreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);

  // Events state
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [activeEvent, setActiveEventState] = useState<EventEntry | null>(null);
  const [newEventName, setNewEventName] = useState('');
  const [eventsLoading, setEventsLoading] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [pendingExportIds, setPendingExportIds] = useState<Set<string>>(new Set());
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    description?: string;
    confirmButtonLabel?: string;
    onConfirm: () => void | Promise<void>;
    isDangerous?: boolean;
  } | null>(null);

  const selectedSerial = serials[selectedIndex] ?? placeholderSerial;
  const generatedCountLabel = `${serials.length} serial${serials.length === 1 ? '' : 's'}`;

  const serialIndex = useMemo(() => {
    const map = new Map<string, SerialEntry>();
    serials.forEach((entry) => {
      map.set(entry.serialNumber.toLowerCase(), entry);
      map.set(entry.qrValue.toLowerCase(), entry);
    });
    return map;
  }, [serials]);

  useEffect(() => {
    loadEvents();
    return () => {
      scannerControlsRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    async function loadTicketsForActiveEvent() {
      if (!activeEvent) {
        setSerials([]);
        setPendingExportIds(new Set());
        return;
      }
      try {
        const { data, error } = await supabase
          .from('tickets')
          .select('*')
          .eq('event_id', activeEvent.id);
        
        if (!error && data) {
          setSerials(data as SerialEntry[]);
          setPendingExportIds(new Set());
          setSelectedIndex(0);
        } else {
          setSerials([]);
          setPendingExportIds(new Set());
        }
      } catch (err) {
        console.error('Error loading tickets for active event:', err);
      }
    }
    loadTicketsForActiveEvent();
  }, [activeEvent]);

  async function loadEvents() {
    setEventsLoading(true);
    const { data, error } = await supabase.from('events').select('*').order('created_at', { ascending: false });
    if (!error && data) {
      setEvents(data as EventEntry[]);
      const active = (data as EventEntry[]).find(e => e.is_active) || null;
      setActiveEventState(active);
    }
    setEventsLoading(false);
  }

  async function createEvent() {
    const name = newEventName.trim();
    if (!name) return;
    const { data, error } = await supabase.from('events').insert({ name }).select().single();
    if (!error && data) {
      setEvents(prev => [data as EventEntry, ...prev]);
      setNewEventName('');
    }
  }

  async function setActiveEvent(event: EventEntry) {
    // Deactivate all, then activate selected
    await supabase.from('events').update({ is_active: false }).neq('id', 'none');
    await supabase.from('events').update({ is_active: true }).eq('id', event.id);
    await loadEvents();
  }

  async function deleteEvent(eventId: string) {
    setConfirmationModal({
      isOpen: true,
      title: 'Delete Event',
      message: 'Delete this event? All tickets linked to it will lose their association.',
      description: 'This action cannot be undone.',
      confirmButtonLabel: 'Delete Event',
      isDangerous: true,
      onConfirm: async () => {
        await supabase.from('events').delete().eq('id', eventId);
        await loadEvents();
        setConfirmationModal(null);
      },
    });
  }

  async function syncAdminFromSupabase() {
    try {
      setScanResult({ ok: true, message: 'Fetching database from Supabase...' });

      let query = supabase.from('tickets').select('*');
      if (activeEvent) {
        query = query.eq('event_id', activeEvent.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      if (data && data.length > 0) {
        setSerials(data as SerialEntry[]);
        setSelectedIndex(0);
        setScanResult({ ok: true, message: `Success! Loaded ${data.length} tickets from Supabase.` });
      } else {
        setSerials([]);
        setScanResult({ ok: false, message: 'Connected, but the tickets table is empty.' });
      }
    } catch (err: any) {
      console.error('Supabase error:', err);
      const errMsg = err?.message || String(err);
      setScanResult({ ok: false, message: `Error: ${errMsg.slice(0, 50)}. Ensure URL/Key are correct and tickets table exists.` });
    }
  }

  function openGenerateModal(mode: 'overwrite' | 'append' = 'overwrite') {
    setGenerateMode(mode);
    
    let initialStartNumber = '1';
    let initialPrefix = defaultFormState.prefix;
    
    if (mode === 'append' && serials.length > 0) {
      const lastSerial = serials[serials.length - 1].serialNumber;
      const parts = lastSerial.split('-');
      if (parts.length >= 3) {
        initialPrefix = parts[0];
        const lastNumStr = parts[parts.length - 1];
        const lastNum = parseInt(lastNumStr, 10);
        if (!isNaN(lastNum)) {
          initialStartNumber = String(lastNum + 1);
        }
      } else {
        const match = lastSerial.match(/(\d+)$/);
        if (match) {
          const lastNum = parseInt(match[1], 10);
          initialStartNumber = String(lastNum + 1);
        }
      }
    }

    setSerialForm({
      ...defaultFormState,
      prefix: initialPrefix,
      startNumber: initialStartNumber,
    });
    setIsGenerateModalOpen(true);
  }

  function closeGenerateModal() {
    setIsGenerateModalOpen(false);
    setModalError('');
  }

  async function handleGenerateSerials() {
    setModalError('');
    const count = Number.parseInt(serialForm.count, 10);
    const startNumber = Number.parseInt(serialForm.startNumber, 10);
    const prefix = serialForm.prefix.trim() || 'SN';
    const label = serialForm.label === 'Custom' ? serialForm.customLabel.trim() || 'Custom' : serialForm.label;
    const qrLabel = serialForm.qrLabel === 'Custom' ? serialForm.customQrLabel.trim() || 'Custom' : serialForm.qrLabel;
    const mainLabel = serialForm.mainLabel === 'Custom' ? serialForm.customMainLabel.trim() || 'Custom' : serialForm.mainLabel;

    if (!Number.isFinite(count) || count <= 0) {
      setModalError('Enter a valid serial count greater than zero.');
      return;
    }

    if (!Number.isFinite(startNumber) || startNumber < 0) {
      setModalError('Enter a valid starting number.');
      return;
    }

    const generated = createSerialEntries(count, prefix, startNumber, label, qrLabel, mainLabel);
    const withEvent = generated.map(t => ({ ...t, event_id: activeEvent?.id }));

    setIsGenerating(true);
    try {
      const { error } = await supabase
        .from('tickets')
        .upsert(withEvent, { onConflict: 'serialNumber', ignoreDuplicates: true });
      if (error) throw error;
    } catch (err: any) {
      const msg = String(err.message ?? '');
      if (msg.toLowerCase().includes('conflict') || msg.toLowerCase().includes('duplicate') || msg.includes('23505')) {
        setModalError('These serial numbers already exist. Change the Start Number or Prefix to generate unique tickets.');
      } else {
        setModalError(`Error: ${msg}`);
      }
      setIsGenerating(false);
      return;
    }
    setIsGenerating(false);

    const newIds = new Set(withEvent.map(t => t.serialNumber));

    if (generateMode === 'append') {
      setSerials((current) => [...current, ...withEvent]);
      setPendingExportIds(prev => { const next = new Set(prev); newIds.forEach(id => next.add(id)); return next; });
      setScanResult({ ok: true, message: `Added ${generated.length} serial numbers. Total: ${serials.length + generated.length}.` });
    } else {
      setSerials(withEvent);
      setPendingExportIds(newIds);
      setSelectedIndex(0);
      setScanResult({ ok: true, message: `Generated ${generated.length} serial numbers.` });
    }

    setIsGenerateModalOpen(false);
    setModalError('');
  }

  function handleToggleSelectMode() {
    setIsSelectMode(prev => !prev);
    setSelectedSerialIds(new Set());
  }

  function handleToggleSelectSerial(serialNumber: string) {
    setSelectedSerialIds(prev => {
      const next = new Set(prev);
      if (next.has(serialNumber)) next.delete(serialNumber);
      else next.add(serialNumber);
      return next;
    });
  }

  function handleSelectAll() {
    if (selectedSerialIds.size === serials.length) {
      setSelectedSerialIds(new Set());
    } else {
      setSelectedSerialIds(new Set(serials.map(s => s.serialNumber)));
    }
  }

  async function handleDeleteSelected() {
    if (selectedSerialIds.size === 0) return;
    const count = selectedSerialIds.size;
    const ids = Array.from(selectedSerialIds);

    setConfirmationModal({
      isOpen: true,
      title: 'Delete Tickets',
      message: `Delete ${count} ticket${count === 1 ? '' : 's'}? This will permanently remove ${count === 1 ? 'it' : 'them'} from the database.`,
      description: 'This action cannot be undone.',
      confirmButtonLabel: `Delete ${count} Ticket${count === 1 ? '' : 's'}`,
      isDangerous: true,
      onConfirm: async () => {
        try {
          setScanResult({ ok: true, message: `Deleting ${count} tickets from database...` });
          const { error } = await supabase.from('tickets').delete().in('serialNumber', ids);
          if (error) throw error;
          setSerials(prev => prev.filter(s => !selectedSerialIds.has(s.serialNumber)));
          setPendingExportIds(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.delete(id));
            return next;
          });
          setSelectedSerialIds(new Set());
          setIsSelectMode(false);
          setSelectedIndex(0);
          setScanResult({ ok: true, message: `Deleted ${count} ticket${count === 1 ? '' : 's'} successfully.` });
        } catch (err: any) {
          setScanResult({ ok: false, message: `Delete failed: ${err.message}` });
        }
        setConfirmationModal(null);
      },
    });
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
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, error, activeControls) => {
        scannerControlsRef.current = activeControls;

        if (result) {
          const payload = readQrPayload(result.getText());
          const matched = payload ? serialIndex.get(payload.toLowerCase()) : undefined;

          if (matched) {
            setScanResult({ ok: true, message: 'Valid serial found.', entry: matched });
          } else {
            setScanResult({ ok: false, message: 'QR code detected but no matching serial was found.' });
          }

          activeControls.stop();
          setScanning(false);
          return;
        }

        if (error && error.name !== 'NotFoundException') {
          setCameraError('Scanner stopped because the camera stream reported an error.');
          activeControls.stop();
          setScanning(false);
        }
      });

      scannerControlsRef.current = controls;
    } catch {
      setCameraError('Camera access failed. Check permissions and try again.');
      setScanning(false);
    }
  }

  function stopScanner() {
    scannerControlsRef.current?.stop();
    setScanning(false);
  }

  
const exportAllPdfs = async () => {
    if (serials.length === 0) return;

    try {
      setExporting(true);
      setExportProgress(0);

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'legal',
      });

      const cols = 2;
      const rows = 9;
      const itemsPerPage = cols * rows;

      const ticketW = 283.33;
      const ticketH = 100;
      const gapX = 9.34;
      const gapY = 10;

      const marginX = 18;
      const marginY = 14;

      for (let i = 0; i < serials.length; i++) {
        setExportProgress(Math.round(((i + 1) / serials.length) * 100));

        const element = document.getElementById(`hidden-ticket-card-${i}`);
        if (!element) continue;

        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
        });

        const imgData = canvas.toDataURL('image/png');

        if (i > 0 && i % itemsPerPage === 0) {
          pdf.addPage('legal', 'portrait');
        }

        const indexOnPage = i % itemsPerPage;
        const col = indexOnPage % cols;
        const row = Math.floor(indexOnPage / cols);

        const x = marginX + col * (ticketW + gapX);
        const y = marginY + row * (ticketH + gapY);

        pdf.addImage(imgData, 'PNG', x, y, ticketW, ticketH);
      }

      pdf.save(`tickets-batch-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error('Failed to export batch PDF:', error);
      alert('Failed to generate batch PDF. Check console for details.');
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  const exportPendingPdfs = async () => {
    const pending = serials.filter(s => pendingExportIds.has(s.serialNumber));
    if (pending.length === 0) return;

    try {
      setExporting(true);
      setExportProgress(0);

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'legal',
      });

      const cols = 2;
      const rows = 9;
      const itemsPerPage = cols * rows;

      const ticketW = 283.33;
      const ticketH = 100;
      const gapX = 9.34;
      const gapY = 10;

      const marginX = 18;
      const marginY = 14;

      let exportedCount = 0;
      for (let i = 0; i < pending.length; i++) {
        setExportProgress(Math.round(((i + 1) / pending.length) * 100));

        const entry = pending[i];
        const indexInSerials = serials.findIndex(s => s.serialNumber === entry.serialNumber);
        if (indexInSerials === -1) continue;

        const element = document.getElementById(`hidden-ticket-card-${indexInSerials}`);
        if (!element) continue;

        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
        });

        const imgData = canvas.toDataURL('image/png');

        if (exportedCount > 0 && exportedCount % itemsPerPage === 0) {
          pdf.addPage('legal', 'portrait');
        }

        const indexOnPage = exportedCount % itemsPerPage;
        const col = indexOnPage % cols;
        const row = Math.floor(indexOnPage / cols);

        const x = marginX + col * (ticketW + gapX);
        const y = marginY + row * (ticketH + gapY);

        pdf.addImage(imgData, 'PNG', x, y, ticketW, ticketH);
        exportedCount++;
      }

      pdf.save(`tickets-added-${new Date().toISOString().slice(0, 10)}.pdf`);
      setPendingExportIds(new Set()); // clear after successful export
    } catch (error) {
      console.error('Failed to export added PDF:', error);
      alert('Failed to generate added PDF. Check console for details.');
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  return (
    <div className="app-shell">
      <div className="backdrop backdrop-left" />
      <div className="backdrop backdrop-right" />

      <header className="hero-shell">
        <div className="hero-copy">
          <div className="badge-row">
            <span className="badge">Graduating Council</span>
            <span className="badge badge-muted">Serial-first QR Ticket Studio</span>
          </div>
          <h1>Nocturne</h1>
          <p>
            Generate serial numbers from a modal, export them to Excel, and convert each serial into a QR code for scanning.
          </p>
          <div className="hero-actions">
            <button className={activeMode === 'generate' ? 'active' : ''} onClick={() => setActiveMode('generate')}>
              Generate serials
            </button>
            <button className={activeMode === 'scan' ? 'active' : ''} onClick={() => setActiveMode('scan')}>
              Scan QR codes
            </button>
            <button className="secondary-button" onClick={() => supabase.auth.signOut()} style={{ marginLeft: 'auto', background: 'rgba(239, 112, 112, 0.1)', borderColor: 'rgba(239, 112, 112, 0.3)', color: '#ef7070', padding: '0 16px' }}>
              Sign Out
            </button>
          </div>
        </div>

        <div className="hero-stats">
          <article>
            <span>Current batch</span>
            <strong>{generatedCountLabel}</strong>
          </article>
          <article>
            <span>Selected serial</span>
            <strong>{selectedSerial.serialNumber}</strong>
          </article>
          <article>
            <span>Workflow</span>
            <strong>{activeMode === 'generate' ? 'Generate' : 'Scan'}</strong>
          </article>
          <article style={{ borderColor: activeEvent ? 'rgba(255, 214, 117, 0.5)' : 'rgba(255,255,255,0.08)' }}>
            <span>Active Event</span>
            <strong style={{ color: activeEvent ? '#ffd675' : 'rgba(255,255,255,0.35)', fontSize: '0.85rem' }}>
              {activeEvent ? activeEvent.name : 'None set'}
            </strong>
          </article>
        </div>
      </header>

      <main className="workspace">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <section className="panel controls">
            <div className="section-header">
              <div>
                <p className="section-eyebrow">Database Connection</p>
                <h2>Supabase Setup</h2>
              </div>
            </div>
            <p className="section-description">Test your connection to the real-time Supabase Postgres database.</p>
            <div style={{ marginTop: '16px' }}>
              <button className="secondary-button" onClick={syncAdminFromSupabase}>
                Test Connection & Sync
              </button>
            </div>
          </section>

          {/* Events Management Panel */}
          <section className="panel controls">
            <div className="section-header">
              <div>
                <p className="section-eyebrow">Event Management</p>
                <h2>Active Event</h2>
              </div>
              {activeEvent && <div className="section-chip success">{activeEvent.name}</div>}
            </div>
            <p className="section-description">Create an event and set it as active. All generated tickets will be linked to it. Staff scanners will only validate tickets for the active event.</p>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <input
                type="text"
                value={newEventName}
                onChange={e => setNewEventName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createEvent()}
                placeholder="Event name (e.g. Nocturne Ball 2026)"
                style={{ flex: 1, padding: '12px 16px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255, 214, 117, 0.2)', color: '#fff', fontSize: '1rem' }}
              />
              <button className="primary-button" onClick={createEvent} style={{ whiteSpace: 'nowrap' }}>Create Event</button>
            </div>

            {eventsLoading && <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: '12px' }}>Loading events...</p>}

            {events.length > 0 && (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                {events.map(event => (
                  <div key={event.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '12px', background: event.is_active ? 'rgba(255, 214, 117, 0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${event.is_active ? 'rgba(255,214,117,0.4)' : 'rgba(255,255,255,0.08)'}` }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: event.is_active ? '#ffd675' : '#fff' }}>{event.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{new Date(event.created_at).toLocaleDateString()}</div>
                    </div>
                    {event.is_active
                      ? <span style={{ padding: '4px 10px', borderRadius: '20px', background: 'rgba(255,214,117,0.15)', color: '#ffd675', fontSize: '0.8rem', fontWeight: 600 }}>● ACTIVE</span>
                      : <button className="secondary-button" style={{ padding: '4px 12px', fontSize: '0.8rem', minHeight: 'unset' }} onClick={() => setActiveEvent(event)}>Set Active</button>
                    }
                    <button onClick={() => deleteEvent(event.id)} style={{ background: 'none', border: 'none', color: 'rgba(239,112,112,0.6)', cursor: 'pointer', fontSize: '1.1rem', padding: '4px' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel controls">
            <div className="section-header">
              <div>
                <p className="section-eyebrow">Batch management</p>
                <h2>Serial list</h2>
              </div>
              <div className="section-chip">{generatedCountLabel}</div>
            </div>
            <p className="section-description">Import a spreadsheet, generate a new batch, or switch between saved serials to update the preview.</p>
            <div className="action-stack" style={{ flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {serials.length === 0 && (
                  <button className="primary-button" onClick={() => openGenerateModal('overwrite')}>Generate serials</button>
                )}
                {serials.length > 0 && (
                  <button className="primary-button" onClick={() => openGenerateModal('append')}>Add serials</button>
                )}
              </div>

              {serials.length > 0 && (
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {isSelectMode && (
                    <button className="secondary-button" onClick={handleSelectAll}>
                      {selectedSerialIds.size === serials.length ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                  {isSelectMode && selectedSerialIds.size > 0 && (
                    <button className="primary-button" style={{ backgroundColor: '#8a2828', borderColor: '#a63434' }} onClick={handleDeleteSelected}>
                      Delete Selected ({selectedSerialIds.size})
                    </button>
                  )}
                  <button className="secondary-button" onClick={handleToggleSelectMode}>
                    {isSelectMode ? 'Cancel Selection' : 'Select Mode'}
                  </button>
                </div>
              )}
            </div>
            <div className="serial-list">
              {serials.map((entry, index) => {
                const isChecked = selectedSerialIds.has(entry.serialNumber);
                const cardClass = isSelectMode
                  ? `serial-card select-mode ${isChecked ? 'checked' : ''}`
                  : `serial-card ${index === selectedIndex ? 'selected' : ''}`;

                return (
                  <button
                    key={entry.serialNumber}
                    className={cardClass}
                    onClick={() => isSelectMode ? handleToggleSelectSerial(entry.serialNumber) : setSelectedIndex(index)}
                  >
                    {isSelectMode && (
                      <div className={`checkbox-circle ${isChecked ? 'checked' : ''}`} />
                    )}
                    <div className="serial-card-text">
                      <strong>{entry.serialNumber}</strong>
                      <span>{entry.label}</span>
                      <span style={{
                        marginTop: '2px',
                        fontSize: '0.72rem',
                        padding: '1px 7px',
                        borderRadius: '20px',
                        alignSelf: 'flex-start',
                        background: entry.status === 'Scanned' ? 'rgba(118,198,132,0.15)' : 'rgba(255,255,255,0.07)',
                        color: entry.status === 'Scanned' ? '#76c684' : 'rgba(255,255,255,0.4)',
                        fontWeight: 600,
                      }}>{entry.status}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <section className="panel preview" style={isFullScreen ? { backdropFilter: 'none', background: 'none', border: 'none', boxShadow: 'none' } : undefined}>
          {activeMode === 'generate' ? (
            <>
              <div className="section-header">
                <div>
                  <p className="section-eyebrow">Live preview</p>
                  <h2>Selected serial</h2>
                </div>
                <div className="section-chip muted">Ready to export</div>
              </div>

              <div className="ticket-preview-scroll-container">
                <article className="ticket-card" id="ticket-preview-card">
                  {/* Far-left vertical strip */}
                  <div className="ticket-vertical-strip">
                    <span className="ticket-vertical-text">{selectedSerial.label || 'MASQUERADER'}</span>
                  </div>

                  {/* Left part - Body */}
                  <div className="ticket-body">
                    {/* Top logo details */}
                    <div className="ticket-header-logos">
                      <div className="ticket-logos-container">
                        <img src={ctuLogo} className="ticket-logo-img" alt="CTU Logo" />
                        <img src={councilLogo} className="ticket-logo-img" alt="GC Logo" />
                      </div>
                      <div className="ticket-logo-text">
                        <span className="ticket-logo-inst">CTU Naga Extension Campus</span>
                        <span className="ticket-logo-council">Graduating Council</span>
                      </div>
                    </div>

                    {/* Middle details */}
                    <div className="ticket-center-content">
                      <h3 className="ticket-event-title">Nocturne</h3>
                      <p className="ticket-event-subtitle">A Masquerade of Legacy</p>
                      <br />
                      <h2 className="ticket-main-label">{selectedSerial.mainLabel || 'BUFFET COUPON'}</h2>
                    </div>

                    {/* Bottom details */}
                    <div className="ticket-bottom-content">
                      <div className="ticket-event-date-pill">June 11, 2026</div>
                      <div className="ticket-event-venue">SM Seaside Skyhall</div>
                    </div>
                  </div>

                  {/* Perforated separator */}
                  <div className="ticket-separator"></div>

                  {/* Right part - Stub */}
                  <div className="ticket-stub">
                    <span className="ticket-stub-type">{selectedSerial.qrLabel || selectedSerial.label || 'MASQUERADER'}</span>

                    <div className="ticket-stub-qr-container">
                      <div className="qr-bracket qr-bracket-top-left"></div>
                      <div className="qr-bracket qr-bracket-top-right"></div>
                      <div className="qr-bracket qr-bracket-bottom-left"></div>
                      <div className="qr-bracket qr-bracket-bottom-right"></div>
                      <div className="qr-code-canvas-wrapper">
                        <QRCodeCanvas value={selectedSerial.qrValue} size={160} level="H" />
                      </div>
                    </div>

                    <span className="ticket-stub-serial">{selectedSerial.serialNumber}</span>
                  </div>
                </article>
              </div>

              <div className="action-stack" style={{ display: 'flex', flexDirection: 'row', gap: '10px', marginTop: '12px' }}>
                <button
                  className="secondary-button"
                  onClick={exportAllPdfs}
                  disabled={exporting}
                  style={{ flex: 1 }}
                >
                  {exporting && exportProgress > 0
                    ? `Exporting (${exportProgress}%)...`
                    : `Export All (${serials.length}) PDFs`}
                </button>
                {pendingExportIds.size > 0 && (
                  <button
                    className="secondary-button"
                    onClick={exportPendingPdfs}
                    disabled={exporting}
                    style={{ flex: 1, borderColor: 'rgba(255, 214, 117, 0.5)', color: '#ffd675' }}
                  >
                    {exporting && exportProgress > 0
                      ? `Exporting (${exportProgress}%)...`
                      : `Export Added (${pendingExportIds.size}) PDFs`}
                  </button>
                )}
              </div>

              <div className="status-line" style={{ marginTop: '14px' }}>
                The list is generated first, then you can export the Excel file when you want to download or print it.
              </div>
            </>
          ) : (
            <>
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
              <p className="section-description">Use the camera to scan a serial QR and match it against the generated or imported serial list.</p>

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
                        {scanResult.entry && <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontFamily: 'monospace' }}>{scanResult.entry.serialNumber}</div>}
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
                      {scanResult.entry ? <div>{scanResult.entry.serialNumber} - {scanResult.entry.label}</div> : null}
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {isGenerateModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeGenerateModal}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="generate-serials-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="modal-eyebrow">Generate batch</p>
                <h2 id="generate-serials-title">Create serial numbers</h2>
              </div>
              <button className="modal-close" onClick={closeGenerateModal} aria-label="Close generate serials dialog">
                ×
              </button>
            </div>

            <div className="modal-grid">
              <label>
                How many serials?
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={serialForm.count}
                  onChange={(event) => setSerialForm((current) => ({ ...current, count: event.target.value }))}
                />
              </label>
              <label>
                Prefix
                <input
                  type="text"
                  value={serialForm.prefix}
                  onChange={(event) => setSerialForm((current) => ({ ...current, prefix: event.target.value }))}
                />
              </label>
              <label>
                Start number
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={serialForm.startNumber}
                  onChange={(event) => setSerialForm((current) => ({ ...current, startNumber: event.target.value }))}
                />
              </label>
              <label>
                Vertical Text
                <select
                  value={serialForm.label}
                  onChange={(event) => setSerialForm((current) => ({ ...current, label: event.target.value }))}
                  style={{
                    minHeight: '46px',
                    padding: '0 14px',
                    borderRadius: '14px',
                    border: '1px solid rgba(255, 214, 143, 0.18)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: '#fff4d0'
                  }}
                >
                  <option value="MASQUERADER">Masquerader</option>
                  <option value="CHAPERONE">Chaperone</option>
                  <option value="Custom">Custom Text...</option>
                </select>
              </label>
              {serialForm.label === 'Custom' && (
                <label>
                  Custom Vertical Text
                  <input
                    type="text"
                    placeholder="Enter custom vertical text"
                    value={serialForm.customLabel}
                    onChange={(event) => setSerialForm((current) => ({ ...current, customLabel: event.target.value }))}
                  />
                </label>
              )}
              <label>
                QR Top Text
                <select
                  value={serialForm.qrLabel}
                  onChange={(event) => setSerialForm((current) => ({ ...current, qrLabel: event.target.value }))}
                  style={{
                    minHeight: '46px',
                    padding: '0 14px',
                    borderRadius: '14px',
                    border: '1px solid rgba(255, 214, 143, 0.18)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: '#fff4d0'
                  }}
                >
                  <option value="GATEPASS">Gatepass</option>
                  <option value="BUFFET COUPON">Buffet Coupon</option>
                  <option value="Custom">Custom Text...</option>
                </select>
              </label>
              {serialForm.qrLabel === 'Custom' && (
                <label>
                  Custom QR Top Text
                  <input
                    type="text"
                    placeholder="Enter custom QR top text"
                    value={serialForm.customQrLabel}
                    onChange={(event) => setSerialForm((current) => ({ ...current, customQrLabel: event.target.value }))}
                  />
                </label>
              )}
              <label>
                Center Label
                <select
                  value={serialForm.mainLabel}
                  onChange={(event) => setSerialForm((current) => ({ ...current, mainLabel: event.target.value }))}
                  style={{
                    minHeight: '46px',
                    padding: '0 14px',
                    borderRadius: '14px',
                    border: '1px solid rgba(255, 214, 143, 0.18)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: '#fff4d0'
                  }}
                >
                  <option value="GATEPASS">Gatepass</option>
                  <option value="BUFFET COUPON">Buffet Coupon</option>
                  <option value="Custom">Custom Text...</option>
                </select>
              </label>
              {serialForm.mainLabel === 'Custom' && (
                <label>
                  Custom Center Label
                  <input
                    type="text"
                    placeholder="Enter custom center label"
                    value={serialForm.customMainLabel}
                    onChange={(event) => setSerialForm((current) => ({ ...current, customMainLabel: event.target.value }))}
                  />
                </label>
              )}
            </div>

            <div className="modal-actions" style={{ flexDirection: 'column', gap: '10px' }}>
              {modalError && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background: 'rgba(239,112,112,0.12)',
                  border: '1px solid rgba(239,112,112,0.35)',
                  color: '#f08080',
                  fontSize: '0.88rem',
                  width: '100%',
                }}>
                  ⚠ {modalError}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button className="secondary-button" onClick={closeGenerateModal} disabled={isGenerating}>
                  Cancel
                </button>
                <button className="primary-button" onClick={handleGenerateSerials} disabled={isGenerating}>
                  {isGenerating ? 'Generating...' : (generateMode === 'append' ? 'Add to Batch' : 'Generate')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirmation Modal */}
      {confirmationModal && (
        <ConfirmationModal
          isOpen={confirmationModal.isOpen}
          title={confirmationModal.title}
          message={confirmationModal.message}
          description={confirmationModal.description}
          confirmButtonLabel={confirmationModal.confirmButtonLabel}
          isDangerous={confirmationModal.isDangerous}
          onConfirm={confirmationModal.onConfirm}
          onCancel={() => setConfirmationModal(null)}
        />
      )}

      {/* Hidden container for batch PDF generation */}
      <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', overflow: 'hidden', height: 0, width: 0 }}>
        {serials.map((entry, index) => (
          <article key={`hidden-card-${entry.serialNumber}`} className="ticket-card" id={`hidden-ticket-card-${index}`}>
            <div className="ticket-vertical-strip">
              <span className="ticket-vertical-text">{entry.label || 'MASQUERADER'}</span>
            </div>
            <div className="ticket-body">
              <div className="ticket-header-logos">
                <div className="ticket-logos-container">
                  <img src={ctuLogo} className="ticket-logo-img" alt="CTU Logo" />
                  <img src={councilLogo} className="ticket-logo-img" alt="GC Logo" />
                </div>
                <div className="ticket-logo-text">
                  <span className="ticket-logo-inst">CTU Naga Extension Campus</span>
                  <span className="ticket-logo-council">Graduating Council</span>
                </div>
              </div>
              <div className="ticket-center-content">
                <h3 className="ticket-event-title">Nocturne</h3>
                <p className="ticket-event-subtitle">A Masquerade of Legacy</p>
                <h2 className="ticket-main-label">{entry.mainLabel || 'BUFFET COUPON'}</h2>
              </div>
              <div className="ticket-bottom-content">
                <div className="ticket-event-date-pill">June 11, 2026</div>
                <div className="ticket-event-venue">SM Seaside Skyhall</div>
              </div>
            </div>
            <div className="ticket-separator"></div>
            <div className="ticket-stub">
              <span className="ticket-stub-type">{entry.qrLabel || entry.label || 'MASQUERADER'}</span>
              <div className="ticket-stub-qr-container">
                <div className="qr-bracket qr-bracket-top-left"></div>
                <div className="qr-bracket qr-bracket-top-right"></div>
                <div className="qr-bracket qr-bracket-bottom-left"></div>
                <div className="qr-bracket qr-bracket-bottom-right"></div>
                <div className="qr-code-canvas-wrapper">
                  <QRCodeCanvas value={entry.qrValue} size={160} level="H" />
                </div>
              </div>
              <span className="ticket-stub-serial">{entry.serialNumber}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
