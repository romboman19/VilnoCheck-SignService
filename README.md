# VilnoCheck-SignService

Standalone multi-method signing service for VilnoCheck / PRRO integrations.

## Goals
- Hardware token signing (IIT local agent / Crystal / Алмаз)
- File-key signing (JKS / P12 / PFX)
- Cloud signing (SmartID / KSP-style providers)
- Manual web signing flow
- API/session flow for PRRO integrations

## Status

### Working now
- Hardware token signing via IIT local agent / browser integration
- PrivatBank `.jks` browser-side signing flow
- First SmartID / cloud-signing scaffold in UI + backend config route
- SmartID provider probe via `GET /api/providers/privatbank-smartid?probe=1`
- SmartID client flow wired through `@it-enterprise/digital-signature` KSP support:
  - read cloud key / certificates with QR confirmation in Privat24
  - sign document with a second QR / Privat24 confirmation
  - upload detached signature and download ZIP package via existing backend flow

### Still needs real-world confirmation
- Exact production `SMARTID_CLIENT_ID_PREFIX` accepted for this project/tenant
- Browser/network/CORS behavior against real PrivatBank SmartID from the target workstation
- Full end-to-end confirmation on a real SmartID-enabled account

### SmartID env knobs
- `SMARTID_ENABLED=1|0`
- `SMARTID_CLIENT_ID_PREFIX=...`
- `SMARTID_ADDRESS=https://acsk.privatbank.ua/cloud/api/back/`
- `SMARTID_CONFIRMATION_URL=https://www.privat24.ua/rd/kep`
- `SMARTID_DIRECT_ACCESS=true|false`
