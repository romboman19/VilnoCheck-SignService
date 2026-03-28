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
  probeSmartIdProvider
};
