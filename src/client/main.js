import { DigitalSignature, Models, EUSignCP } from '@it-enterprise/digital-signature';

const { DigitalSignatureKeyType, DigitalSignatureSettings, DefaultCertificatesProvider } = Models;
const { EndUserConstants, EndUserSignContainerInfo, EndUser } = EUSignCP;

const els = {
  detectAgentBtn: document.getElementById('detectAgentBtn'),
  refreshMediaBtn: document.getElementById('refreshMediaBtn'),
  uploadDocumentBtn: document.getElementById('uploadDocumentBtn'),
  readKeyBtn: document.getElementById('readKeyBtn'),
  signBtn: document.getElementById('signBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  documentInput: document.getElementById('documentInput'),
  caSelect: document.getElementById('caSelect'),
  keyMediaSelect: document.getElementById('keyMediaSelect'),
  pinInput: document.getElementById('pinInput'),
  agentStatus: document.getElementById('agentStatus'),
  documentStatus: document.getElementById('documentStatus'),
  keyStatus: document.getElementById('keyStatus'),
  resultStatus: document.getElementById('resultStatus'),
  sessionInfo: document.getElementById('sessionInfo'),
  log: document.getElementById('log')
};

const state = {
  signer: null,
  libraryInfo: null,
  cas: [],
  keyMedias: [],
  document: null,
  uploadedFile: null,
  readedKey: null,
  lastSignature: null,
  packageUrl: null
};

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

function mediaLabel(media) {
  return media?.visibleName || `${media?.device || 'device'} (${media?.type || 'token'})`;
}

function describeCadesLevel(level) {
  switch (level) {
    case EndUserConstants.EndUserSignType.CAdES_BES:
      return 'CAdES_BES';
    case EndUserConstants.EndUserSignType.CAdES_T:
      return 'CAdES_T';
    case EndUserConstants.EndUserSignType.CAdES_C:
      return 'CAdES_C';
    case EndUserConstants.EndUserSignType.CAdES_X_Long:
      return 'CAdES_X_Long';
    default:
      return `unknown(${level ?? 'n/a'})`;
  }
}

function isFileBasedKey(readedKey) {
  return readedKey?.keyType === DigitalSignatureKeyType.File;
}

function isPrivatBankCertificate(readedKey) {
  const values = [
    readedKey?.ownerInfo?.issuerCN,
    readedKey?.ownerInfo?.subjCN,
    readedKey?.certificates?.[0]?.infoEx?.issuerCN,
    readedKey?.certificates?.[0]?.infoEx?.subjCN,
    readedKey?.certificates?.[0]?.infoEx?.issuerOrg,
    readedKey?.certificates?.[0]?.infoEx?.subjOrg
  ].filter(Boolean).join(' | ').toLowerCase();

  return values.includes('приват') || values.includes('privat');
}

function getPreferredCadesLevel(readedKey) {
  if (isFileBasedKey(readedKey) || isPrivatBankCertificate(readedKey)) {
    return EndUserConstants.EndUserSignType.CAdES_BES;
  }

  return EndUserConstants.EndUserSignType.CAdES_X_Long;
}

function isOcspError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('ocsp') || message.includes('статус сертиф') || message.includes('certificate status');
}

async function signDataWithFallback(signer, data, readedKey) {
  const preferredLevel = getPreferredCadesLevel(readedKey);
  const levels = preferredLevel === EndUserConstants.EndUserSignType.CAdES_BES
    ? [preferredLevel]
    : [preferredLevel, EndUserConstants.EndUserSignType.CAdES_BES];

  let lastError;

  for (let index = 0; index < levels.length; index += 1) {
    const signLevel = levels[index];
    const signType = new EndUserSignContainerInfo();
    signType.type = EndUserConstants.EndUserSignContainerType.CAdES;
    signType.subType = EndUserConstants.EndUserCAdESType.Detached;
    signType.signLevel = signLevel;

    try {
      const signature = await signer.signDataEx(data, signType);
      return {
        signature,
        signLevel,
        usedFallback: index > 0
      };
    } catch (error) {
      lastError = error;
      const canRetryWithBes = signLevel !== EndUserConstants.EndUserSignType.CAdES_BES && isOcspError(error);
      if (!canRetryWithBes) {
        throw error;
      }

      log(`OCSP перевірка зламала ${describeCadesLevel(signLevel)}. Повторюю підпис у сумісному режимі CAdES_BES.`);
    }
  }

  throw lastError;
}

function updateSessionInfo() {
  const signer = state.lastSignature?.signatureInfo?.OwnerInfo || null;
  const rows = [
    ['Документ', state.document ? `${state.document.fileName} · ${prettyBytes(state.document.size)}` : '—'],
    ['SHA-256', state.document?.sha256 || '—'],
    ['Носій', state.readedKey ? mediaLabel(state.readedKey.keyMedia) : '—'],
    ['Підписувач', signer?.subjCN || signer?.issuerCN || '—']
  ];

  els.sessionInfo.innerHTML = rows.map(([label, value]) => (
    `<div><span>${escapeHtml(label)}</span><span class="code">${escapeHtml(value)}</span></div>`
  )).join('');
}

function setAgentStatus(html) {
  els.agentStatus.innerHTML = html;
}

function setDocumentStatus(html) {
  els.documentStatus.innerHTML = html;
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

function createSigner() {
  return new DigitalSignature({
    language: 'uk',
    userId: 'openprro-sign-service',
    getGlSign() {
      return {
        AllowTestKeys: false,
        PreferHarware: true,
        DirectAccess: true,
        ApplyProxySettings: false,
        UseProxy: false,
        WebClientFileSize: 50,
        KSPs: []
      };
    },
    getSettings() {
      return new DigitalSignatureSettings(
        'uk',
        'openprro-sign-service',
        '',
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

async function detectAgent() {
  const signer = await getSigner();
  state.libraryInfo = await getIitLibraryInfo();
  setAgentStatus(makeLibraryInfoHtml(state.libraryInfo));
  log('Перевірено стан IIT agent / extension.');
  if (!state.libraryInfo.supported) {
    throw new Error('IIT web integration не підтримується або не встановлена.');
  }

  await signer.setLibraryType(DigitalSignatureKeyType.Token);
  await signer.initialise();
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
  state.lastSignature = null;
  state.packageUrl = null;
  els.downloadBtn.disabled = true;

  setDocumentStatus(`
    <div class="status-line"><span class="dot ok"></span><strong>Документ завантажено</strong></div>
    <div class="small" style="margin-top: 10px;">
      Файл: <span class="code">${escapeHtml(payload.fileName)}</span><br />
      Розмір: <span class="code">${escapeHtml(prettyBytes(payload.size))}</span><br />
      SHA-256: <span class="code">${escapeHtml(payload.sha256)}</span>
    </div>
  `);
  setResultStatus('Після зчитування ключа можна запускати підпис.');
  updateSessionInfo();
  log(`Документ ${payload.fileName} завантажено для підпису.`);
}

async function readKey() {
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

  const ownerInfo = state.readedKey.ownerInfo || {};
  const cert = state.readedKey.certificates?.[0]?.infoEx || {};
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

async function signDocument() {
  if (!state.document?.signingPayloadBase64) {
    throw new Error('Спочатку завантажте документ.');
  }
  if (!state.readedKey) {
    throw new Error('Спочатку зчитайте ключ із токена.');
  }

  const signer = await getSigner();
  const data = base64ToUint8Array(state.document.signingPayloadBase64);
  const { signature, signLevel, usedFallback } = await signDataWithFallback(signer, data, state.readedKey);
  state.lastSignature = signature;

  const uploadResponse = await fetch(`/api/documents/${state.document.documentId}/signature`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signatureBase64: signature.Sign,
      signatureFileName: `${state.document.fileName}.p7s`,
      signatureInfo: {
        ...(signature.SignatureInfo || {}),
        SignLevel: describeCadesLevel(signLevel),
        CompatibilityMode: usedFallback || signLevel === EndUserConstants.EndUserSignType.CAdES_BES
      },
      keyMedia: state.readedKey.keyMedia,
      client: {
        userAgent: navigator.userAgent,
        platform: navigator.platform || null,
        language: navigator.language || null
      }
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
      Підписувач: <span class="code">${escapeHtml(signature.SignatureInfo?.Signer || '—')}</span><br />
      Час підпису: <span class="code">${escapeHtml(signature.SignatureInfo?.DateTimeStr || '—')}</span><br />
      Режим підпису: <span class="code">${escapeHtml(describeCadesLevel(signLevel))}</span>${usedFallback ? ' <span class="code">(fallback після OCSP)</span>' : ''}<br />
      Підпис збережено на сервері, можна завантажити ZIP-пакет.
    </div>
  `);
  log(`Підпис створено у режимі ${describeCadesLevel(signLevel)}${usedFallback ? ' (fallback після OCSP)' : ''} та завантажено на сервер для документа ${state.document.fileName}.`);
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

setAgentStatus(makeLibraryInfoHtml(null));
setDocumentStatus('Документ ще не завантажено.');
setKeyStatus('Ключ ще не зчитано.');
setResultStatus('Підпис ще не створено.');
updateSessionInfo();
