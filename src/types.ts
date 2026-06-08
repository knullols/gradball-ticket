export type TicketRecord = {
  id: string;
  name: string;
  email: string;
  ticketType: string;
  seat?: string;
  company?: string;
  notes?: string;
};

export type ScanStatus = 'pending' | 'valid' | 'invalid';

export type ScanResult = {
  status: ScanStatus;
  message: string;
  record?: TicketRecord;
};
