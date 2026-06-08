import type { TicketRecord } from './types';
import * as XLSX from 'xlsx';

const normalize = (value: unknown) => String(value ?? '').trim();

const pick = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return '';
};

export const ticketPayload = (record: TicketRecord) =>
  JSON.stringify({
    id: record.id,
    name: record.name,
    email: record.email,
    ticketType: record.ticketType,
    seat: record.seat ?? '',
    company: record.company ?? '',
  });

export const parseTicketPayload = (value: string): Partial<TicketRecord> | null => {
  try {
    const parsed = JSON.parse(value) as Partial<TicketRecord>;
    if (!parsed.id && !parsed.email) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const loadTicketsFromExcel = async (file: File): Promise<TicketRecord[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], {
    defval: '',
  });

  return rows
    .map((row, index): TicketRecord | null => {
      const name = normalize(pick(row, ['name', 'Name', 'full name', 'Full Name', 'attendee', 'Attendee']));
      const email = normalize(pick(row, ['email', 'Email']));
      const id = normalize(pick(row, ['id', 'ID', 'ticket id', 'Ticket ID', 'qr', 'QRCode'])) || `TICKET-${String(index + 1).padStart(3, '0')}`;
      const ticketType = normalize(pick(row, ['ticketType', 'Ticket Type', 'type', 'Type'])) || 'General Admission';
      const seat = normalize(pick(row, ['seat', 'Seat', 'table', 'Table']));
      const company = normalize(pick(row, ['company', 'Company', 'organization', 'Organization']));
      const notes = normalize(pick(row, ['notes', 'Notes']));

      if (!name && !email && !id) {
        return null;
      }

      return {
        id,
        name: name || email || id,
        email,
        ticketType,
        seat: seat || undefined,
        company: company || undefined,
        notes: notes || undefined,
      };
    })
    .filter((record): record is TicketRecord => record !== null);
};

export const downloadCsv = (records: TicketRecord[]) => {
  const header = ['id', 'name', 'email', 'ticketType', 'seat', 'company', 'notes'];
  const rows = [
    header.join(','),
    ...records.map((record) =>
      [record.id, record.name, record.email, record.ticketType, record.seat ?? '', record.company ?? '', record.notes ?? '']
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    ),
  ];

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ticket-list.csv';
  anchor.click();
  URL.revokeObjectURL(url);
};
