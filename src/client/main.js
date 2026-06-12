import { DigitalSignature, Models, EUSignCP } from '@it-enterprise/digital-signature';

const { DigitalSignatureKeyType, DigitalSignatureSettings, DefaultCertificatesProvider } = Models;
const { EndUserConstants, EndUserSignContainerInfo, EndUser } = EUSignCP;

const SIGNING_METHOD = {
  IIT_TOKEN: 'iit-token',
  PRIVATBANK_JKS: 'privatbank-jks',
};

const els = {
  detectAgentBtn: document.getElementById('detectAgentBtn'),
  refreshMediaBtn: document.getElementById('refreshMediaBtn'),
  uploadDocumentBtn: document.getElementById('uploadDocumentBtn'),
  readKeyBtn: document.getElementById('readKeyBtn'),
  readJksKeyBtn: document.getElementById('readJksKeyBtn'),
  signBtn: document.getElementById('signBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  documentInput: document.getElementById('documentInput'),
  caSelect: document.getElementById('caSelect'),
  keyMediaSelect: document.getElementById('keyMediaSelect'),
  pinInput: document.getElementById('pinInput'),
  jksFileInput: document.getElementById('jksFileInput'),
  jksKeySelect: document.getElementById('jksKeySelect'),
  jksPasswordInput: document.getElementById('jksPasswordInput'),
  agentStatus: document.getElementById('agentStatus'),
  fileModeStatus: document.getElementById('fileModeStatus'),
  documentStatus: document.getElementById('documentStatus'),
  jksStatus: document.getElementById('jksStatus'),
  keyStatus: document.getElementById('keyStatus'),
  resultStatus: document.getElementById('resultStatus'),
  sessionInfo: document.getElementById('sessionInfo'),
  log: document.getElementById('log'),
  methodCards: Array.from(document.querySelectorAll('.method-card')),
  signingMethodInputs: Array.from(document.querySelectorAll('input[name="signingMethod"]')),
  tokenPanel: document.getElementById('tokenPanel'),
  jksPanel: document.getElementById('jksPanel'),
  tokenKeyPanel: document.getElementById('tokenPanelKey'),
  jksKeyPanel: document.getElementById('jksPanelKey'),
};

const state = {
  signer: null,
  signingMethod: SIGNING_METHOD.IIT_TOKEN,
  libraryInfo: null,
  cas: [],
  keyMedias: [],
  document: null,
  uploadedFile: null,
  readedKey: null,
  readedKeyMeta: null,
  jksPrivateKeys: [],
  lastSignature: null,
  packageUrl: null,
  bootstrap: null
};

function normalizeSigningMethod(method) {
  const value = String(method || '').trim();
  if (value === SIGNING_METHOD.PRIVATBANK_JKS) return SIGNING_METHOD.PRIVATBANK_JKS;
  return SIGNING_METHOD.IIT_TOKEN;
}

function log(message) {
  const line = `[${new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ${message}`;
  els.log.textContent = `${line}\n${els.log.textContent}`.trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function prettyBytes(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function humanSigningMethod(method) {
  switch (method) {
    case SIGNING_METHOD.PRIVATBANK_JKS:
      return 'PrivatBank JKS';
    case SIGNING_METHOD.IIT_TOKEN:
    default:
      return 'IIT токен';
  }
}

function mediaLabel(media) {
  return media?.visibleName || `${media?.device || 'device'} (${media?.type || 'token'})`;
}

function firstCertificateInfo(certificates = []) {
  return certificates.find((certificate) => certificate?.infoEx)?.infoEx || {};
}

function jksKeyLabel(entry) {
  const cert = firstCertificateInfo(entry?.certificates || []);
  const subject = cert?.subjCN || cert?.issuerCN || 'Ключ без CN';
  const alias = entry?.alias ? `alias: ${entry.alias}` : 'alias невідомий';
  return `${subject} · ${alias}`;
}

function loadedKeyLabel() {
  if (!state.readedKey) return '—';
  if (state.signingMethod === SIGNING_METHOD.PRIVATBANK_JKS) {
    const fileName = state.readedKeyMeta?.fileName || 'container.jks';
    const alias = state.readedKeyMeta?.alias || 'ключ';
    return `${fileName} · ${alias}`;
  }
  return mediaLabel(state.readedKey.keyMedia);
}

function redactKeyMediaForUpload(keyMedia) {
  if (!keyMedia || typeof keyMedia !== 'object') return null;
  const { password, pass, pin, secret, ...rest } = keyMedia;
  return rest;
}

function currentClientInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform || null,
    language: navigator.language || null
  };
}

function summarizeLoadedSigner() {
  const ownerInfo = state.readedKey?.ownerInfo || {};
  const cert = firstCertificateInfo(state.readedKey?.certificates || []);
  return {
    subjCN: ownerInfo.subjCN || cert.subjCN || null,
    issuerCN: ownerInfo.issuerCN || cert.issuerCN || null,
    EDRPOUCode: ownerInfo.EDRPOUCode || ownerInfo.DRFOCode || null,
    serial: cert.serial || ownerInfo.serial || null
  };
}

function currentMethodState() {
  const selectedCA = els.caSelect.value || null;
  if (state.signingMethod === SIGNING_METHOD.PRIVATBANK_JKS) {
    const selectedIndex = Number(els.jksKeySelect.value);
    const selectedKey = Number.isInteger(selectedIndex) && selectedIndex >= 0 ? state.jksPrivateKeys[selectedIndex] : null;
    return {
      fileName: els.jksFileInput.files?.[0]?.name || state.readedKeyMeta?.fileName || null,
      alias: state.readedKeyMeta?.alias || selectedKey?.alias || null,
      certificateCount: selectedKey?.certificates?.length || state.readedKey?.certificates?.length || 0,
      ca: selectedCA
    };
  }

 : null,
      } : null
    };
  }

  return {
    keyMedia: state.readedKey ? redactKeyMediaForUpload(state.readedKey.keyMedia) : null,
    ca: selectedCA,
    library: state.libraryInfo ? {
      version: state.libraryInfo.version || null,
      supported: Boolean(state.libraryInfo.supported),
      loaded: Boolean(state.libraryInfo.loaded)
    } : null
  };
}

function updateSessionInfo() {
  const signer = summarizeLoadedSigner();
  const rows = [
    ['Метод', humanSigningMethod(state.signingMethod)],
    ['Документ', state.document ? `${state.document.fileName} · ${prettyBytes(state.document.size)}` : '—'],
    ['SHA-256', state.document?.sha256 || '—'],
    ['Носій / ключ', loadedKeyLabel()],
    ['Підписувач', signer.subjCN || signer.issuerCN || '—']
  ];

  els.sessionInfo.innerHTML = rows.map(([label, value]) => (
    `<div><span>${escapeHtml(label)}</span><span class="code">${escapeHtml(value)}</span></div>`
  )).join('');
}

function setAgentStatus(html) {
  els.agentStatus.innerHTML = html;
}

function setFileModeStatus(html) {
  els.fileModeStatus.innerHTML = html;
}

function setDocumentStatus(html) {
  els.documentStatus.innerHTML = html;
}

function setJksStatus(html) {
  els.jksStatus.innerHTML = html;
}

function setKeyStatus(html) {
  els.keyStatus.innerHTML = html;
}

function setResultStatus(html) {
  els.resultStatus.innerHTML = html;
}

function setBusy(button, busy, busyText) {
  if (!button) return;
  if (!button.dataset.label) {
    button.dataset.label = button.textContent;
  }
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.label;
}

function makeLibraryInfoHtml(info) {
  if (!info) {
    return '<div class="status-line"><span class="dot warn"></span><span>Стан IIT agent ще не перевірявся.</span></div>';
  }

  const installLinks = [
    info.webExtensionInstallURL ? `<a href="${escapeHtml(info.webExtensionInstallURL)}" target="_blank" rel="noreferrer">Встановити browser extension</a>` : '',
    info.nativeLibraryInstallURL ? `<a href="${escapeHtml(info.nativeLibraryInstallURL)}" target="_blank" rel="noreferrer">Встановити IIT local agent</a>` : '',
    info.nativeLibraryUpdateURL ? `<a href="${escapeHtml(info.nativeLibraryUpdateURL)}" target="_blank" rel="noreferrer">Оновити IIT local agent</a>` : '',
    info.helpURL ? `<a href="${escapeHtml(info.helpURL)}" target="_blank" rel="noreferrer">Довідка IIT</a>` : ''
  ].filter(Boolean).join(' · ');

  const statusClass = info.supported && info.loaded ? 'ok' : (info.supported ? 'warn' : 'bad');
  const mainLine = info.supported
    ? (info.loaded ? `IIT agent доступний. Версія: ${escapeHtml(info.version || 'невідома')}` : 'IIT agent підтримується, але локальна бібліотека ще не завантажилась або потребує оновлення.')
    : 'IIT web integration не знайдено в поточному браузері.';

  return `
    <div class="status-line"><span class="dot ${statusClass}"></span><strong>${mainLine}</strong></div>
    <div class="small" style="margin-top: 10px;">
      Web extension: <span class="code">${info.isWebExtensionInstalled ? 'installed' : 'missing'}</span><br />
      Sign Agent support: <span class="code">${info.isSignAgentSupported ? 'yes' : 'no'}</span><br />
      Local library loaded: <span class="code">${info.loaded ? 'yes' : 'no'}</span>
    </div>
    ${installLinks ? `<div class="small" style="margin-top: 10px;">${installLinks}</div>` : ''}
  `;
}

function makeFileModeHtml() {
  return `
    <div class="status-line"><span class="dot ok"></span><strong>Файловий JKS режим готовий</strong></div>
    <div class="small" style="margin-top: 10px;">
      Ключ читається та використовується локально у браузері.<br />
      Пароль від контейнера <span class="code">не відправляється</span> на бекенд.<br />
      Оберіть <span class="code">.jks</span> файл нижче, зачекайте сканування контейнера та зчитайте ключ.
    </div>
  `;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('uk-UA');
}





function setMethodAvailability(method, enabled, reason = '') {
  const normalized = normalizeSigningMethod(method);
  const input = els.signingMethodInputs.find((entry) => normalizeSigningMethod(entry.value) === normalized);
  const card = els.methodCards.find((entry) => normalizeSigningMethod(entry.dataset.method) === normalized);
  if (input) input.disabled = !enabled;
  if (card) {
    card.classList.toggle('disabled', !enabled);
    if (reason) {
      card.title = reason;
    } else {
      card.removeAttribute('title');
    }
  }
}

function applyBootstrap(bootstrap) {
  if (!bootstrap || typeof bootstrap !== 'object') return;
  state.bootstrap = bootstrap;

  }

    : null;

  }

}

async function loadBootstrap() {
  const response = await fetch('/api/bootstrap');
  const payload = await response.json();
  if (!response.ok || !payload?.bootstrap) {
    throw new Error(payload?.error || 'bootstrap unavailable');
  }
  applyBootstrap(payload.bootstrap);
  return payload.bootstrap;
}

function populateCAs() {
  const options = ['<option value="">Автовизначення</option>'];
  for (const ca of state.cas) {
    const issuer = Array.isArray(ca.issuerCNs) && ca.issuerCNs.length ? ca.issuerCNs[0] : 'Невідомий ЦСК';
    options.push(`<option value="${escapeHtml(issuer)}">${escapeHtml(issuer)}</option>`);
  }
  els.caSelect.innerHTML = options.join('');
}

function populateKeyMedias() {
  const options = state.keyMedias.length
    ? state.keyMedias.map((media, index) => `<option value="${index}">${escapeHtml(mediaLabel(media))}</option>`)
    : ['<option value="">Носії не знайдено</option>'];
  els.keyMediaSelect.innerHTML = options.join('');
}

function populateJksPrivateKeys() {
  const options = state.jksPrivateKeys.length
    ? state.jksPrivateKeys.map((entry, index) => `<option value="${index}">${escapeHtml(jksKeyLabel(entry))}</option>`)
    : ['<option value="">Спочатку оберіть .jks контейнер</option>'];
  els.jksKeySelect.innerHTML = options.join('');
  els.jksKeySelect.disabled = !state.jksPrivateKeys.length;
}

function getPkiProxyUrl() {
  return new URL('/pki/ProxyHandler', window.location.href).toString();
}

function createSigner() {
  return new DigitalSignature({
    language: 'uk',
    userId: 'openprro-sign-service',
    getGlSign() {
      return {
        AllowTestKeys: false,
        PreferHarware: true,
        DirectAccess: false,
        ApplyProxySettings: true,
        UseProxy: true,
        WebClientFileSize: 50,
      };
    },
    getSettings() {
      return new DigitalSignatureSettings(
        'uk',
        'openprro-sign-service',
        getPkiProxyUrl(),
        new DefaultCertificatesProvider('/data/CAs.json', '/data/CACertificates.p7b'),
        '/vendor/euscp.worker.js'
      );
    }
  });
}

async function getIitLibraryInfo() {
  const agent = new EndUser('/vendor/euscp.worker.js', EndUserConstants.EndUserLibraryType.SW, 50);
  return agent.GetLibraryInfo();
}

async function getSigner() {
  if (!state.signer) {
    state.signer = createSigner();
  }
  return state.signer;
}

async function ensureFileLibraryReady() {
  const signer = await getSigner();
  await signer.setLibraryType(DigitalSignatureKeyType.File);
  if (!state.cas.length) {
    state.cas = await signer.getCAs();
    populateCAs();
  }
  return signer;
}

async function syncSession(patch) {
  if (!state.document?.documentId) return null;
  const response = await fetch(`/api/documents/${state.document.documentId}/session`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...patch,
      client: patch?.client || currentClientInfo()
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Не вдалося оновити стан підписання.');
  }
  return payload;
}

async function syncSessionSafe(patch) {
  try {
    await syncSession(patch);
  } catch (error) {
    log(`УВАГА: не вдалося оновити стан сесії: ${error?.message || String(error)}`);
  }
}

function resetSignatureState(message = 'Підпис ще не створено.') {
  state.lastSignature = null;
  state.packageUrl = null;
  els.downloadBtn.disabled = true;
  setResultStatus(message);
}

async function clearLoadedKey(statusHtml) {
  state.readedKey = null;
  state.readedKeyMeta = null;
  resetSignatureState('Після зчитування ключа можна запускати підпис.');
  if (statusHtml) {
    setKeyStatus(statusHtml);
  }
  try {
    const signer = await getSigner();
    await signer.resetPrivateKey();
    if (typeof signer.resetKSPOperation === 'function') {
      await signer.resetKSPOperation();
    }
  } catch {
    // no-op, reset is best-effort
  }
  updateSessionInfo();
}

function defaultKeyStatusHtml() {
  if (state.signingMethod === SIGNING_METHOD.PRIVATBANK_JKS) {
    return '<div class="status-line"><span class="dot warn"></span><span>Ключ із .jks контейнера ще не зчитано.</span></div>';
  }
  return '<div class="status-line"><span class="dot warn"></span><span>Ключ із токена ще не зчитано.</span></div>';
}

async function setSigningMethod(method, { persist = true } = {}) {
  state.signingMethod = normalizeSigningMethod(method);

  const selectedInput = els.signingMethodInputs.find((input) => input.value === state.signingMethod);
  if (selectedInput?.disabled) {
    state.signingMethod = SIGNING_METHOD.IIT_TOKEN;
  }

  els.signingMethodInputs.forEach((input) => {
    input.checked = input.value === state.signingMethod;
  });
  els.methodCards.forEach((card) => {
    card.classList.toggle('active', card.dataset.method === state.signingMethod);
  });

  els.tokenPanel.classList.toggle('hidden', state.signingMethod !== SIGNING_METHOD.IIT_TOKEN);
  els.jksPanel.classList.toggle('hidden', state.signingMethod !== SIGNING_METHOD.PRIVATBANK_JKS);
  els.tokenKeyPanel.classList.toggle('hidden', state.signingMethod !== SIGNING_METHOD.IIT_TOKEN);
  els.jksKeyPanel.classList.toggle('hidden', state.signingMethod !== SIGNING_METHOD.PRIVATBANK_JKS);

  els.pinInput.value = '';
  els.jksPasswordInput.value = '';
  await clearLoadedKey(defaultKeyStatusHtml());

  if (state.signingMethod === SIGNING_METHOD.PRIVATBANK_JKS) {
    setFileModeStatus(makeFileModeHtml());
    if (!state.jksPrivateKeys.length) {
      setJksStatus('<div class="status-line"><span class="dot warn"></span><span>Оберіть PrivatBank .jks контейнер, щоб отримати список ключів усередині.</span></div>');
    }
  }

  updateSessionInfo();
  log(`Обрано метод підписання: ${humanSigningMethod(state.signingMethod)}.`);

  if (persist && state.document?.documentId) {
    await syncSessionSafe({
      signingMethod: state.signingMethod,
      status: 'method-selected',
      methodState: currentMethodState()
    });
  }
}

async function detectAgent() {
  const signer = await getSigner();
  state.libraryInfo = await getIitLibraryInfo();
  setAgentStatus(makeLibraryInfoHtml(state.libraryInfo));
  log('Перевірено стан IIT agent / extension.');
  if (!state.libraryInfo.supported) {
    throw new Error('IIT web integration не підтримується або не встановлена.');
  }

  await signer.setLibraryType(DigitalSignatureKeyType.Token);
  state.cas = await signer.getCAs();
  state.keyMedias = await signer.getKeyMedias();
  populateCAs();
  populateKeyMedias();

  if (!state.keyMedias.length) {
    setKeyStatus('<div class="status-line"><span class="dot warn"></span><span>Токени не знайдено. Перевірте, що Crystal-1 підключений і драйвер встановлений.</span></div>');
  } else {
    setKeyStatus(`<div class="status-line"><span class="dot ok"></span><span>Знайдено носіїв: <strong>${state.keyMedias.length}</strong>. Оберіть токен та зчитайте ключ.</span></div>`);
  }

  updateSessionInfo();
}

async function uploadDocument() {
  const file = els.documentInput.files?.[0];
  if (!file) {
    throw new Error('Оберіть файл для підпису.');
  }

  const formData = new FormData();
  formData.append('document', file);
  const response = await fetch('/api/documents', { method: 'POST', body: formData });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Не вдалося завантажити документ.');
  }

  state.uploadedFile = file;
  state.document = payload;
  if (payload.bootstrap) {
    applyBootstrap(payload.bootstrap);
  }
  resetSignatureState('Після зчитування ключа можна запускати підпис.');

  setDocumentStatus(`
    <div class="status-line"><span class="dot ok"></span><strong>Документ завантажено</strong></div>
    <div class="small" style="margin-top: 10px;">
      Файл: <span class="code">${escapeHtml(payload.fileName)}</span><br />
      Розмір: <span class="code">${escapeHtml(prettyBytes(payload.size))}</span><br />
      SHA-256: <span class="code">${escapeHtml(payload.sha256)}</span>
    </div>
  `);
  updateSessionInfo();
  log(`Документ ${payload.fileName} завантажено для підпису.`);

  await syncSessionSafe({
    signingMethod: state.signingMethod,
    status: 'document-uploaded',
    methodState: currentMethodState()
  });
}

async function loadJksContainer() {
  const file = els.jksFileInput.files?.[0];
  if (!file) {
    state.jksPrivateKeys = [];
    populateJksPrivateKeys();
    setJksStatus('<div class="status-line"><span class="dot warn"></span><span>Оберіть PrivatBank .jks контейнер.</span></div>');
    return;
  }

  const signer = await ensureFileLibraryReady();
  if (!signer.isJKSContainer(file)) {
    throw new Error('Потрібен файл контейнера з розширенням .jks.');
  }

  await clearLoadedKey(defaultKeyStatusHtml());
  setJksStatus('<div class="status-line"><span class="dot warn"></span><span>Зчитую список ключів із JKS контейнера…</span></div>');

  state.jksPrivateKeys = await signer.getJKSPrivateKeys(file);
  populateJksPrivateKeys();

  if (!state.jksPrivateKeys.length) {
    setJksStatus('<div class="status-line"><span class="dot warn"></span><span>У контейнері не знайдено приватних ключів.</span></div>');
    log(`JKS контейнер ${file.name} відкрито, але ключів не знайдено.`);
    return;
  }

  setJksStatus(`
    <div class="status-line"><span class="dot ok"></span><strong>Контейнер розпізнано</strong></div>
    <div class="small" style="margin-top: 10px;">
      Файл: <span class="code">${escapeHtml(file.name)}</span><br />
      Ключів усередині: <span class="code">${escapeHtml(state.jksPrivateKeys.length)}</span>
    </div>
  `);
  setKeyStatus('<div class="status-line"><span class="dot warn"></span><span>Оберіть ключ у контейнері, введіть пароль і зчитайте його.</span></div>');
  log(`Зчитано список ключів із JKS контейнера ${file.name}.`);

  await syncSessionSafe({
    signingMethod: state.signingMethod,
    status: 'container-loaded',
    methodState: currentMethodState()
  });
}

async function readHardwareKey() {
  if (!state.keyMedias.length) {
    throw new Error('Спочатку виконайте перевірку IIT agent та оновіть список носіїв.');
  }

  const signer = await getSigner();
  const selectedIndex = Number(els.keyMediaSelect.value);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || !state.keyMedias[selectedIndex]) {
    throw new Error('Оберіть токен / рідер.');
  }
  if (!els.pinInput.value) {
    throw new Error('Введіть PIN токена.');
  }

  const selectedCA = els.caSelect.value || null;
  await signer.setCA(selectedCA);

  const keyMedia = { ...state.keyMedias[selectedIndex], password: els.pinInput.value };
  state.readedKey = await signer.readHardwareKey(keyMedia);
  state.readedKeyMeta = {
    method: SIGNING_METHOD.IIT_TOKEN,
    label: mediaLabel(state.readedKey.keyMedia)
  };
  els.pinInput.value = '';

  const ownerInfo = state.readedKey.ownerInfo || {};
  const cert = firstCertificateInfo(state.readedKey.certificates || []);
  setKeyStatus(`
    <div class="status-line"><span class="dot ok"></span><strong>Ключ зчитано успішно</strong></div>
    <div class="small" style="margin-top: 10px;">
      Носій: <span class="code">${escapeHtml(mediaLabel(state.readedKey.keyMedia))}</span><br />
      Підписувач: <span class="code">${escapeHtml(ownerInfo.subjCN || '—')}</span><br />
      ЄДРПОУ/РНОКПП: <span class="code">${escapeHtml(ownerInfo.EDRPOUCode || ownerInfo.DRFOCode || '—')}</span><br />
      Серійний номер сертифіката: <span class="code">${escapeHtml(cert.serial || ownerInfo.serial || '—')}</span>
    </div>
  `);
  updateSessionInfo();
  log(`Зчитано ключ з носія ${mediaLabel(state.readedKey.keyMedia)}.`);
}

async function readJksKey() {
  if (!els.jksFileInput.files?.[0]) {
    throw new Error('Оберіть .jks контейнер.');
  }
  if (!state.jksPrivateKeys.length) {
    await loadJksContainer();
  }

  const signer = await ensureFileLibraryReady();
  const selectedIndex = Number(els.jksKeySelect.value);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || !state.jksPrivateKeys[selectedIndex]) {
    throw new Error('Оберіть ключ із JKS контейнера.');
  }
  if (!els.jksPasswordInput.value) {
    throw new Error('Введіть пароль від JKS контейнера.');
  }

  const selectedCA = els.caSelect.value || null;
  await signer.setCA(selectedCA);

  const selectedKey = state.jksPrivateKeys[selectedIndex];
  const certificates = Array.isArray(selectedKey.certificates)
    ? selectedKey.certificates.map((certificate) => certificate?.data).filter(Boolean)
    : null;

  state.readedKey = await signer.readFileKey(selectedKey.privateKey, els.jksPasswordInput.value, certificates);
  state.readedKeyMeta = {
    method: SIGNING_METHOD.PRIVATBANK_JKS,
    fileName: els.jksFileInput.files[0].name,
    alias: selectedKey.alias || null,
    certificateCount: selectedKey.certificates?.length || 0
  };
  els.jksPasswordInput.value = '';

  const ownerInfo = state.readedKey.ownerInfo || {};
  const cert = firstCertificateInfo(state.readedKey.certificates || []);
  setKeyStatus(`
    <div class="status-line"><span class="dot ok"></span><strong>JKS ключ зчитано успішно</strong></div>
    <div class="small" style="margin-top: 10px;">
      Контейнер: <span class="code">${escapeHtml(state.readedKeyMeta.fileName)}</span><br />
      Alias: <span class="code">${escapeHtml(state.readedKeyMeta.alias || '—')}</span><br />
      Підписувач: <span class="code">${escapeHtml(ownerInfo.subjCN || cert.subjCN || '—')}</span><br />
      Серійний номер сертифіката: <span class="code">${escapeHtml(cert.serial || ownerInfo.serial || '—')}</span>
    </div>
  `);
  updateSessionInfo();
  log(`Зчитано файловий ключ з JKS контейнера ${state.readedKeyMeta.fileName}${state.readedKeyMeta.alias ? ` (${state.readedKeyMeta.alias})` : ''}.`);
}

async function readKey() {
  if (state.signingMethod === SIGNING_METHOD.PRIVATBANK_JKS) {
    await readJksKey();
  } else else {
    await readHardwareKey();
  }

  await syncSessionSafe({
    signingMethod: state.signingMethod,
    status: 'key-ready',
    methodState: currentMethodState(),
    signer: summarizeLoadedSigner()
  });
}

async function signDocument() {
  if (!state.document?.signingPayloadBase64) {
    throw new Error('Спочатку завантажте документ.');
  }
  if (!state.readedKey) {
    throw new Error('Спочатку зчитайте ключ обраним методом.');
  }

    : await getSigner();
  const signType = new EndUserSignContainerInfo();
  signType.type = EndUserConstants.EndUserSignContainerType.CAdES;
  signType.subType = EndUserConstants.EndUserCAdESType.Detached;
  signType.signLevel = EndUserConstants.EndUserSignType.CAdES_X_Long;

  const data = base64ToUint8Array(state.document.signingPayloadBase64);

  let signature;
  try {
    signature = await signer.signDataEx(data, signType);
  } finally {
  }
  state.lastSignature = signature;

  const methodState = currentMethodState();
  const signerSummary = summarizeLoadedSigner();
  const uploadResponse = await fetch(`/api/documents/${state.document.documentId}/signature`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signatureBase64: signature.Sign,
      signatureFileName: `${state.document.fileName}.p7s`,
      signatureInfo: signature.SignatureInfo,
      signingMethod: state.signingMethod,
      methodState,
      keyMedia: state.signingMethod === SIGNING_METHOD.IIT_TOKEN ? redactKeyMediaForUpload(state.readedKey.keyMedia) : null,
      session: {
        signingMethod: state.signingMethod,
        status: 'signed',
        methodState,
        signer: signerSummary,
        client: currentClientInfo()
      },
      client: currentClientInfo()
    })
  });

  const uploadPayload = await uploadResponse.json();
  if (!uploadResponse.ok) {
    throw new Error(uploadPayload.error || 'Не вдалося передати підпис на сервер.');
  }

  state.packageUrl = uploadPayload.downloadUrl;
  els.downloadBtn.disabled = false;
  updateSessionInfo();
  setResultStatus(`
    <div class="status-line"><span class="dot ok"></span><strong>Документ підписано</strong></div>
    <div class="small" style="margin-top: 10px;">
      Метод: <span class="code">${escapeHtml(humanSigningMethod(state.signingMethod))}</span><br />
      Підписувач: <span class="code">${escapeHtml(signature.SignatureInfo?.Signer || signerSummary.subjCN || '—')}</span><br />
      Час підпису: <span class="code">${escapeHtml(signature.SignatureInfo?.DateTimeStr || '—')}</span><br />
      Підпис збережено на сервері, можна завантажити ZIP-пакет.
    </div>
  `);
  log(`Підпис створено та завантажено на сервер для документа ${state.document.fileName}.`);
}

async function downloadPackage() {
  if (!state.packageUrl) {
    throw new Error('ZIP-пакет ще не готовий.');
  }
  window.location.href = state.packageUrl;
}

async function runAction(button, busyText, action) {
  setBusy(button, true, busyText);
  try {
    await action();
  } catch (error) {
    const message = error?.message || String(error);
    log(`ПОМИЛКА: ${message}`);
    throw error;
  } finally {
    setBusy(button, false);
  }
}

function showError(targetSetter, error) {
  const message = escapeHtml(error?.message || String(error));
  targetSetter(`<div class="status-line"><span class="dot bad"></span><strong>${message}</strong></div>`);
}

els.signingMethodInputs.forEach((input) => {
  input.addEventListener('change', async () => {
    if (!input.checked) return;
    try {
      await setSigningMethod(input.value);
    } catch (error) {
      showError(setKeyStatus, error);
      log(`ПОМИЛКА: ${error?.message || String(error)}`);
    }
  });
});

els.detectAgentBtn.addEventListener('click', async () => {
  await runAction(els.detectAgentBtn, 'Перевіряю…', async () => {
    try {
      await detectAgent();
    } catch (error) {
      showError(setAgentStatus, error);
      throw error;
    }
  });
});

els.refreshMediaBtn.addEventListener('click', async () => {
  await runAction(els.refreshMediaBtn, 'Оновлюю…', async () => {
    try {
      await detectAgent();
    } catch (error) {
      showError(setKeyStatus, error);
      throw error;
    }
  });
});

els.uploadDocumentBtn.addEventListener('click', async () => {
  await runAction(els.uploadDocumentBtn, 'Завантажую…', async () => {
    try {
      await uploadDocument();
    } catch (error) {
      showError(setDocumentStatus, error);
      throw error;
    }
  });
});

els.readKeyBtn.addEventListener('click', async () => {
  await runAction(els.readKeyBtn, 'Зчитую…', async () => {
    try {
      await readKey();
    } catch (error) {
      showError(setKeyStatus, error);
      throw error;
    }
  });
});

els.readJksKeyBtn.addEventListener('click', async () => {
  await runAction(els.readJksKeyBtn, 'Зчитую…', async () => {
    try {
      await readKey();
    } catch (error) {
      showError(setKeyStatus, error);
      throw error;
    }
  });
});

els.signBtn.addEventListener('click', async () => {
  await runAction(els.signBtn, 'Підписую…', async () => {
    try {
      await signDocument();
    } catch (error) {
      showError(setResultStatus, error);
      throw error;
    }
  });
});

els.downloadBtn.addEventListener('click', async () => {
  await runAction(els.downloadBtn, 'Готую…', async () => {
    await downloadPackage();
  });
});

els.jksFileInput.addEventListener('change', async () => {
  try {
    await loadJksContainer();
  } catch (error) {
    showError(setJksStatus, error);
    log(`ПОМИЛКА: ${error?.message || String(error)}`);
  }
});

setAgentStatus(makeLibraryInfoHtml(null));
setFileModeStatus(makeFileModeHtml());
setDocumentStatus('Документ ще не завантажено.');
setJksStatus('<div class="status-line"><span class="dot warn"></span><span>Оберіть PrivatBank .jks контейнер, щоб отримати список ключів усередині.</span></div>');
setKeyStatus(defaultKeyStatusHtml());
resetSignatureState('Підпис ще не створено.');
populateCAs();
populateKeyMedias();
populateJksPrivateKeys();
updateSessionInfo();

async function initialize() {
  try {
    await loadBootstrap();
  } catch (error) {
    log(`УВАГА: bootstrap init failed: ${error?.message || String(error)}`);
  }

    });
  }

  await setSigningMethod(normalizeSigningMethod(state.bootstrap?.defaults?.signingMethod || state.signingMethod), { persist: false });

  // Check for API key in URL params (for embedded usage)
  const urlParams = new URLSearchParams(window.location.search);
  const apiKey = urlParams.get('apiKey');
  if (apiKey) {
    window.__API_KEY__ = apiKey;
    log('API key loaded from URL');
  }
}

void initialize().catch((error) => {
  showError(setKeyStatus, error);
  log(`ПОМИЛКА: ${error?.message || String(error)}`);
});
