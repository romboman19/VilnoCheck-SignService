'use strict';

require('dotenv').config();

const SMARTID_DEFAULTS = Object.freeze({
  id: 'pb-smartid',
  name: 'Приватбанк - хмарний підпис "SmartID"',
  mobileAppName: 'Приват24',
  address: 'https://acsk.privatbank.ua/cloud/api/back/',
  confirmationURL: 'https://www.privat24.ua/rd/kep',
  clientIdPrefix: 'IEIS_',
  needQRCode: true,
  directAccess: true,
  codeEDRPOU: '14360570'
});

const CLIENT_ID_PREFIX = process.env.SMARTID_CLIENT_ID_PREFIX || SMARTID_DEFAULTS.clientIdPrefix;
const ENABLED = process.env.SMARTID_ENABLED === '1';
const SMARTID_ADDRESS = process.env.SMARTID_ADDRESS || SMARTID_DEFAULTS.address;

// Кеш EndUser інстансу
let _eu = null;
let _euInitError = null;

async function getEU() {
  if (_eu) return _eu;
  if (_euInitError) return null;

  try {
    const { EndUser } = require('@it-enterprise/digital-signature');
    const path = require('path');
    const fs = require('fs');

    const caJSON = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public/data/CAs.json'), 'utf8'));
    const caCerts = fs.readFileSync(path.join(__dirname, '../../../public/data/CACertificates.p7b'));

    const eu = new EndUser();
    await eu.Initialize({
      language: 'uk',
      encoding: 'utf-8',
      CAs: caJSON,
      CACertificates: caCerts,
      allowedSignTypes: ['attached', 'detached'],
    });

    _eu = eu;
    return eu;
  } catch (err) {
    console.warn('[SmartID] EndUser init failed:', err.message);
    _euInitError = err;
    return null;
  }
}

// sessionStore — тимчасове зберігання (в production → Redis)
const sessionStore = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 хвилин

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessionStore) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessionStore.delete(id);
      console.log(`[SmartID] Expired session removed: ${id}`);
    }
  }
}

// Запускаємо cleanup кожні 2 хвилини
setInterval(cleanupExpiredSessions, 2 * 60 * 1000);

async function probe() {
  if (!ENABLED) {
    return { 
      available: false, 
      enabled: false,
      reason: 'SMARTID_ENABLED is not set to 1'
    };
  }
  
  if (!CLIENT_ID_PREFIX || CLIENT_ID_PREFIX === SMARTID_DEFAULTS.clientIdPrefix) {
    return { 
      available: false, 
      enabled: true,
      reason: 'SMARTID_CLIENT_ID_PREFIX not configured (use your PrivatBank client prefix)'
    };
  }

  const eu = await getEU();
  if (!eu) {
    return {
      available: false,
      enabled: true,
      reason: 'EndUser initialization failed (check @it-enterprise/digital-signature installation)'
    };
  }

  // Спробуємо отримати список сертифікатів
  try {
    // Назва методу може відрізнятись — адаптувати після тесту
    // const certs = await eu.SmartIDGetCertificates(CLIENT_ID_PREFIX);
    // return { available: true, certificatesCount: certs.length };
    
    // Заглушка поки немає реального CLIENT_ID_PREFIX
    return {
      available: false,
      enabled: true,
      reason: 'CLIENT_ID_PREFIX configured but SmartIDGetCertificates not yet implemented (needs real prefix)',
      hint: 'To activate: set SMARTID_CLIENT_ID_PREFIX in .env and restart server'
    };
  } catch (err) {
    return {
      available: false,
      enabled: true,
      reason: `SmartID API probe failed: ${err.message}`,
      hint: 'Verify SMARTID_CLIENT_ID_PREFIX with PrivatBank'
    };
  }
}

async function initSession(documentBytes, fileName) {
  if (!ENABLED) {
    throw new Error('SmartID is disabled. Set SMARTID_ENABLED=1 in .env');
  }

  if (!CLIENT_ID_PREFIX || CLIENT_ID_PREFIX === SMARTID_DEFAULTS.clientIdPrefix) {
    throw new Error(
      'SmartID not configured: SMARTID_CLIENT_ID_PREFIX must be set to your PrivatBank client prefix. ' +
      'Contact PrivatBank at acsk@privatbank.ua to obtain your clientIdPrefix.'
    );
  }

  const eu = await getEU();
  if (!eu) {
    throw new Error('EndUser initialization failed. Check server logs.');
  }

  // TODO: Implement real SmartID flow after obtaining CLIENT_ID_PREFIX
  // 1. const certs = await eu.SmartIDGetCertificates(CLIENT_ID_PREFIX);
  // 2. const cert = certs[0];
  // 3. const { operationId, confirmationUrl } = await eu.SmartIDSign(documentBytes, cert, CLIENT_ID_PREFIX);
  // 4. Store session and return QR/DeepLink

  // Заглушка — повертаємо помилку з інструкцією
  throw new Error(
    'SmartID is configured but not yet activated. ' +
    'To complete setup: obtain CLIENT_ID_PREFIX from PrivatBank, then uncomment real implementation in privatbank-smartid.js'
  );
}

async function getStatus(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session) {
    return { status: 'expired', reason: 'Session not found or expired' };
  }

  // TODO: Implement real status check
  // const result = await eu.SmartIDGetSignStatus(sessionId, CLIENT_ID_PREFIX);
  
  return { status: session.status }; // pending | confirmed | rejected
}

function parseBoolean(value, fallback) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function buildSmartIdProviderConfig() {
  const clientIdPrefix = String(process.env.SMARTID_CLIENT_ID_PREFIX || SMARTID_DEFAULTS.clientIdPrefix || '').trim();
  const enabled = parseBoolean(process.env.SMARTID_ENABLED, true);
  const directAccess = parseBoolean(process.env.SMARTID_DIRECT_ACCESS, SMARTID_DEFAULTS.directAccess);
  const warnings = [];

  if (!clientIdPrefix) {
    warnings.push('Не задано SMARTID_CLIENT_ID_PREFIX. Без коректного clientIdPrefix інтеграція SmartID може не пройти бою з реальним провайдером.');
  } else if (clientIdPrefix === SMARTID_DEFAULTS.clientIdPrefix) {
    warnings.push('Використовується дефолтний clientIdPrefix з бібліотеки (IEIS_). Для production може знадобитися окремо підтверджений префікс від провайдера.');
  }

  warnings.push('Поточна реалізація використовує браузерну бібліотеку @it-enterprise/digital-signature для прямого QR / polling потоку. Перед rollout варто підтвердити prefix, CORS/мережу та реальний SmartID акаунт.');

  return {
    id: SMARTID_DEFAULTS.id,
    name: SMARTID_DEFAULTS.name,
    mobileAppName: SMARTID_DEFAULTS.mobileAppName,
    address: process.env.SMARTID_ADDRESS || SMARTID_DEFAULTS.address,
    confirmationURL: process.env.SMARTID_CONFIRMATION_URL || SMARTID_DEFAULTS.confirmationURL,
    clientIdPrefix,
    needQRCode: true,
    directAccess,
    enabled,
    codeEDRPOU: SMARTID_DEFAULTS.codeEDRPOU,
    mode: enabled ? 'experimental-browser-direct' : 'disabled',
    warnings
  };
}

async function probeSmartIdProvider(config = buildSmartIdProviderConfig()) {
  const certificatesUrl = new URL('get-certificates', config.address).toString();
  const startedAt = Date.now();

  try {
    const response = await fetch(certificatesUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'VilnoCheck-SignService/0.3 SmartID-probe'
      }
    });

    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      certificatesCount: Array.isArray(payload?.certificates) ? payload.certificates.length : null,
      sampleIssuerHint: Array.isArray(payload?.certificates) && payload.certificates[0]
        ? String(payload.certificates[0]).slice(0, 48)
        : null,
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      certificatesCount: null,
      sampleIssuerHint: null,
      error: error?.message || String(error)
    };
  }
}

module.exports = {
  SMARTID_DEFAULTS,
  buildSmartIdProviderConfig,
  probeSmartIdProvider,
  probe,
  initSession,
  getStatus,
  ENABLED
};
