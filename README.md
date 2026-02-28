# IP Address Manager

A React app for managing your home network's static IP addresses.

## Requirements

- [Node.js](https://nodejs.org/) v16 or higher (includes npm)

## Setup & Run

```bash
# 1. Install dependencies (only needed once)
npm install

# 2. Start the app
npm run dev
```

Then open your browser to **http://localhost:5173**

## Build for Production

To create a standalone build you can host anywhere:

```bash
npm run build
```

Output will be in the `dist/` folder — just serve that with any web server.

## Features

- Search by IP, hostname, service, or location
- Edit any existing IP entry
- Claim free/available IPs with a form
- Release IPs back to the free pool
- Download as Excel (.xlsx) to save your changes
- Cards and Table views
- DHCP/Static/Fixed/Free IP classification
