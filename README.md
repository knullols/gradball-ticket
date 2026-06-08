# Ticket QR Scanning

A static React app for generating masquerade-style serial batches from Excel or a modal, converting each serial into a QR code, and scanning them on site.

## Features

- Import serial lists from `.xlsx`, `.xls`, or `.csv`
- Open a modal to generate any number of serial numbers in a batch
- Convert each serial into a QR code for scanning
- Scan QR codes with the camera and match them against the generated or imported serial list
- Export a serial workbook for printing or distribution
- Static hosting friendly for GitHub Pages because the app uses a relative Vite base path

## Expected Excel columns

The importer accepts these common column names:

- `serialNumber`, `serial`, `ticketId`, `TicketID`, or `id`
- `label`, `Label`, `name`, or `Name`
- `status`, `Status`

If a serial number is missing, the app generates one automatically.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The output in `dist/` can be deployed to GitHub Pages or any static host.
