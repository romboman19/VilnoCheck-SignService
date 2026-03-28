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
- SmartID added as the canonical third signing method in service bootstrap + session metadata (`smartid`)
- Legacy `privatbank-smartid` values are normalized server-side to `smartid` for backward compatibility
- SmartID UI panels/states are present in the browser app, including QR / deep-link confirmation state boxes
- SmartID provider config + probe endpoint exists: `GET /api/providers/privatbank-smartid?probe=1`
- SmartID browser binding is wired through `@it-enterprise/digital-signature` KSP support so the app can attempt:
  - certificate/key read via `readPrivateKeyKSP(...)`
  - signing via `signDataEx(...)`
  - detached signature upload + ZIP packaging through the existing backend flow

### Still needs real-world confirmation
- Exact production `SMARTID_CLIENT_ID_PREFIX` accepted for this project/tenant
- Browser/network/CORS behavior against real PrivatBank SmartID from the target workstation
- Whether PrivatBank SmartID fully accepts this exact browser-direct KSP flow in production for both key-read and signing
- Full end-to-end confirmation on a real SmartID-enabled account

### SmartID env knobs
- `SMARTID_ENABLED=1|0`
- `SMARTID_CLIENT_ID_PREFIX=...`
- `SMARTID_ADDRESS=https://acsk.privatbank.ua/cloud/api/back/`
- `SMARTID_CONFIRMATION_URL=https://www.privat24.ua/rd/kep`
- `SMARTID_DIRECT_ACCESS=true|false`
