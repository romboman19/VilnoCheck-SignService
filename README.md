# VilnoCheck-SignService

Standalone multi-method signing service for **VilnoCheck / PRRO** workflows.

The service is designed to sign documents in a browser-first flow while keeping the backend as **crypto-blind** as possible for local-key scenarios.

## What this service is for

VilnoCheck-SignService provides one web UI and one lightweight backend for three classes of signing methods:

1. **Hardware token**
   - IIT local agent / browser integration
   - Crystal / Алмаз / similar token flows
2. **File key**
   - PrivatBank `.jks`
   - also intended path for `.p12` / `.pfx` style file keys
3. **Cloud signing**
   - PrivatBank **SmartID**
   - browser/KSP-driven confirmation flow

It can be used in two modes:
- **Manual signing UI** — user opens the page, uploads a document, signs it, downloads the package
- **Integration/session flow** — another system prepares the document and uses the service API/session model to receive the final detached signature package

---

## Current status

## Working now

### Hardware token
- IIT browser integration is wired
- token-based signing flow exists in the UI
- detached signature upload + ZIP packaging works

### File key (PrivatBank JKS)
- method switching works
- JKS container listing works
- JKS key reading works
- PKI proxy path for OCSP/TSP/CMP is implemented
- NBU OCSP host allow-list fix is included
- browser-side detached signing flow is implemented

### SmartID
- SmartID is added as the **third signing method**
- provider probe endpoint exists
- SmartID UI panels/states are present
- SmartID QR/deep-link state handling is scaffolded
- SmartID KSP binding through `@it-enterprise/digital-signature` is wired

## Still needs real-world confirmation

### SmartID production confirmation
The SmartID method is implemented as a **working prototype layer**, but still needs real-world verification with:
- a real SmartID-enabled Privat24 account
- real QR/deep-link confirmation in Privat24
- confirmation that the current `SMARTID_CLIENT_ID_PREFIX` is acceptable for production
- final workstation/browser validation on the target environment

### General hardening still pending
- backend signature verification before accept
- cleanup of deployment/process management
- stronger auth/session ownership controls
- better production docs around reverse proxy and deployment

---

## Architecture

## Local-key methods: crypto-blind backend

For these methods, the private key must never reach the backend:
- hardware token
- file key (JKS/P12/PFX)

Flow:
1. browser uploads document
2. backend stores document and returns payload
3. browser signs locally via SDK / local agent
4. browser uploads detached signature
5. backend stores signature and returns ZIP package

## Cloud method: coordinated browser/provider flow

For SmartID, the service is still browser-driven, but confirmation happens in the provider flow:
1. browser starts SmartID key-read/sign request
2. SDK obtains QR/deep-link / confirmation state
3. user confirms in Privat24
4. browser receives final signature
5. backend stores detached signature and packages result

---

## Repository structure

```text
VilnoCheck-SignService/
├── docs/
│   └── research/
│       ├── 01-kep-ukraine-fiscal.md
│       ├── 02-chrome-agent-crystal1.md
│       ├── 03-iit-agent-crystal1-dia.md
│       └── additional research docs from the repo
├── public/
│   ├── assets/
│   │   └── app.js
│   ├── data/
│   │   ├── CAs.json
│   │   └── CACertificates.p7b
│   ├── index.html
│   └── styles.css
├── scripts/
│   └── build-client.mjs
├── src/
│   ├── client/
│   │   └── main.js
│   └── server/
│       ├── server.js
│       └── providers/
│           └── privatbank-smartid.js
├── storage/
├── package.json
└── README.md
```

---

## Runtime API

## Health and bootstrap

### `GET /api/health`
Returns service health/version.

### `GET /api/bootstrap`
Returns enabled methods and runtime bootstrap metadata.

---

## Document/signature flow

### `POST /api/documents`
Upload a document for signing.

Returns:
- `documentId`
- file metadata
- `signingPayloadBase64`
- bootstrap/session metadata

### `PATCH /api/documents/:documentId/session`
Update session metadata for the current signing method.

Used by the browser to persist safe session state.

### `POST /api/documents/:documentId/signature`
Upload detached signature payload.

Stores:
- detached signature bytes
- signing method metadata
- signature info
- sanitized session/client metadata

### `GET /api/documents/:documentId/package`
Download ZIP package containing:
- original document
- detached signature
- `manifest.json`

---

## SmartID-specific endpoint

### `GET /api/providers/privatbank-smartid`
Returns provider configuration metadata.

### `GET /api/providers/privatbank-smartid?probe=1`
Performs a live provider reachability probe.

Expected use:
- check SmartID provider availability before starting the flow
- confirm that SmartID certificates endpoint is reachable

---

## Environment variables

## General
- `PORT` — service port
- `HOST` — bind host
- `SIGN_STORAGE_DIR` — storage path override

## SmartID
- `SMARTID_ENABLED=1|0`
- `SMARTID_CLIENT_ID_PREFIX=...`
- `SMARTID_ADDRESS=https://acsk.privatbank.ua/cloud/api/back/`
- `SMARTID_CONFIRMATION_URL=https://www.privat24.ua/rd/kep`
- `SMARTID_DIRECT_ACCESS=true|false`

---

## Local development

## Requirements
- Node.js 22+
- npm
- for token/file-key/cloud browser flows: workstation browser environment

## Install

```bash
npm install
npm run build
```

## Run

```bash
npm start
```

Default local URL:

```text
http://127.0.0.1:3017
```

---

## Build

Client bundle is built with `esbuild` via:

```bash
npm run build:client
```

Full build:

```bash
npm run build
```

---

## Deployment notes

## Reverse proxy
If deployed behind nginx / openresty / NPM, make sure the following routes are passed through correctly:
- `/api/health`
- `/api/bootstrap`
- `/api/documents/*`
- `/api/providers/*`
- `/pki/ProxyHandler`
- static assets under `/assets/*`

A common failure mode is serving the UI but not forwarding `/api/bootstrap`, which causes the browser app to render partially and fail during initialization.

## PKI proxy
The service includes a **same-origin PKI proxy** for browser-side OCSP/TSP/CMP access used in file-key flows.
It is allow-listed and should not be turned into an open relay.

---

## Security notes

### Good current properties
- passwords/PINs/secrets are redacted from persisted session metadata
- file-key and token methods keep private key usage client-side
- SmartID confirmation happens provider-side / SDK-side, not on the backend

### Important limitations right now
- backend does **not yet fully verify uploaded signatures** before storing them
- session ownership/auth is still lightweight
- current deployment is manually started, not yet formalized via service manager
- SmartID should still be treated as **prototype / experimental** until confirmed end-to-end with a real account

---

## Known issues / caveats

### SmartID
- current implementation is promising, but still needs a real production-style browser + Privat24 confirmation test
- the current `SMARTID_CLIENT_ID_PREFIX` may need confirmation/replacement for production
- browser/reverse proxy routing must correctly expose `/api/bootstrap`

### File-key flow
- browser PKI behavior depends on workstation network conditions, CA endpoints, and proxy/revocation routing
- OCSP/TSP/CMP routing is handled through same-origin PKI proxy, but target host allow-list must stay current

### Deployment
- current live deployment is manual
- one repo/service may be reachable by direct port while domain proxy still points elsewhere if reverse proxy is not updated

---

## Suggested operator test checklist

## Hardware token
1. Open the service
2. Upload a document
3. Choose hardware token method
4. Detect IIT agent
5. Read token key/certificate
6. Sign document
7. Download ZIP

## File key
1. Open the service
2. Upload a document
3. Choose PrivatBank JKS method
4. Select `.jks`
5. Read key/certificate
6. Sign document
7. Download ZIP

## SmartID
1. Open the service
2. Upload a document
3. Choose SmartID method
4. Read key/certificate via SmartID
5. Confirm in Privat24 via QR/deep-link
6. Sign document
7. Download ZIP

---

## Roadmap

## Near-term
- verify SmartID end-to-end with a real account
- add backend signature verification before accept
- clean deployment/process management
- improve reverse proxy/deployment documentation

## Mid-term
- stabilize SmartID UX
- improve session security model
- formalize API contracts and operator docs
- better packaging and verification metadata

## Later
- tighter PRRO integration
- batch signing scenarios where provider allows it
- stronger observability and audit logging

---

## Research basis

This repo includes research docs covering:
- Ukrainian KEP and fiscal receipt signing
- IIT local agent + hardware token flows
- KНЕДП Дія / IIT agent integration
- PrivatBank file-key (JKS) signing
- PrivatBank SmartID / cloud signing

See:
- `docs/research/`

---

## Honest status summary

If you need the shortest truthful statement:

- **Hardware token:** implemented
- **File key:** implemented
- **SmartID:** implemented as a live prototype, still requires real-account end-to-end confirmation

