const crypto = require('crypto');

/**
 * Генерує HTML-протокол перевірки електронного підпису
 * @param {Object} data - Дані для протоколу
 * @returns {string} - HTML рядок
 */
function generateSignatureProtocol(data) {
  const {
    generatedAt,
    document,
    signer,
    signatures,
    signingMethod,
    verification
  } = data;

  const dateStr = generatedAt 
    ? new Date(generatedAt).toLocaleString('uk-UA') 
    : new Date().toLocaleString('uk-UA');
  
  const isValid = verification?.result?.valid !== false;
  
  // Форматування підписів
  let signaturesHtml = '';
  if (signatures) {
    if (signatures.cadesDetached) {
      signaturesHtml += `
        <div class="signature-item">
          <strong>• CAdES Detached (відокремлений)</strong><br>
          Файл: ${escapeHtml(signatures.cadesDetached.fileName || '-')}</br>
          SHA256: <code>${escapeHtml(signatures.cadesDetached.sha256 || '-')}</code>
        </div>
      `;
    }
    if (signatures.cadesEnveloped) {
      signaturesHtml += `
        <div class="signature-item">
          <strong>• CAdES Enveloped (вбудований)</strong><br>
          Файл: ${escapeHtml(signatures.cadesEnveloped.fileName || '-')}</br>
          SHA256: <code>${escapeHtml(signatures.cadesEnveloped.sha256 || '-')}</code>
        </div>
      `;
    }
    if (signatures.pades) {
      signaturesHtml += `
        <div class="signature-item">
          <strong>• PAdES (PDF-вбудований)</strong><br>
          Файл: ${escapeHtml(signatures.pades.fileName || '-')}</br>
          SHA256: <code>${escapeHtml(signatures.pades.sha256 || '-')}</code>
        </div>
      `;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8">
  <title>Протокол перевірки підпису</title>
  <style>
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 14px;
      line-height: 1.6;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      color: #000;
    }
    h1 {
      text-align: center;
      font-size: 24px;
      margin-bottom: 0;
    }
    h2 {
      text-align: center;
      font-size: 16px;
      font-weight: normal;
      margin-top: 5px;
    }
    .status {
      font-size: 16px;
      font-weight: bold;
      margin: 20px 0;
      padding: 10px;
      border: 1px solid #000;
    }
    .status.valid {
      color: #000;
    }
    .status.invalid {
      color: #000;
    }
    h3 {
      font-size: 14px;
      font-weight: bold;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    .info-row {
      margin: 5px 0;
    }
    .label {
      display: inline-block;
      width: 200px;
    }
    .signature-item {
      margin: 10px 0;
      padding: 10px;
      border-left: 3px solid #000;
    }
    code {
      font-family: "Courier New", monospace;
      font-size: 11px;
      word-break: break-all;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ccc;
      font-size: 10px;
      text-align: center;
      color: #333;
    }
    @media print {
      body { margin: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h1>ПРОТОКОЛ</h1>
  <h2>перевірки електронного підпису</h2>
  
  <div class="date">Дата формування: ${escapeHtml(dateStr)}</div>
  
  <div class="status ${isValid ? 'valid' : 'invalid'}">
    ${isValid ? '✓ Підпис валідний' : '✗ Підпис не валідний'}
  </div>
  
  <h3>1. ІНФОРМАЦІЯ ПРО ДОКУМЕНТ</h3>
  <div class="info-row"><span class="label">Назва файлу:</span> ${escapeHtml(document?.fileName || '-')}</div>
  <div class="info-row"><span class="label">Тип:</span> ${escapeHtml(document?.mimeType || '-')}</div>
  <div class="info-row"><span class="label">Розмір:</span> ${document?.size ? (document.size / 1024).toFixed(2) + ' KB' : '-'}</div>
  <div class="info-row"><span class="label">SHA256:</span> <code>${escapeHtml(document?.sha256 || '-')}</code></div>
  
  <h3>2. ІНФОРМАЦІЯ ПРО ПІДПИСУВАЧА</h3>
  <div class="info-row"><span class="label">ПІБ:</span> ${escapeHtml(signer?.subjCN || '-')}</div>
  <div class="info-row"><span class="label">Організація:</span> ${escapeHtml(signer?.subjOrg || '-')}</div>
  <div class="info-row"><span class="label">ЄДРПОУ:</span> ${escapeHtml(signer?.EDRPOUCode || '-')}</div>
  <div class="info-row"><span class="label">ДРФО:</span> ${escapeHtml(signer?.DRFOCode || '-')}</div>
  <div class="info-row"><span class="label">Серійний номер сертифіката:</span> ${escapeHtml(signer?.serial || '-')}</div>
  <div class="info-row"><span class="label">Видавець:</span> ${escapeHtml(signer?.issuerCN || '-')}</div>
  
  <h3>3. МЕТОД ПІДПИСАННЯ</h3>
  <div class="info-row"><span class="label">Метод:</span> ${escapeHtml(signingMethod || '-')}</div>
  <div class="info-row"><span class="label">Сервіс:</span> VilnoCheck Sign Service v${escapeHtml(data?.version || '0.2.0')}</div>
  
  <h3>4. ЗГЕНЕРОВАНІ ФОРМАТИ ПІДПИСУ</h3>
  ${signaturesHtml || '<p>Інформація про формати підпису відсутня</p>'}
  
  <h3>5. ПРИМІТКИ</h3>
  <p>
    Цей протокол містить інформацію про електронний підпис, згенерований за допомогою сервісу VilnoCheck Sign Service.
    Дані наведені відповідно до метаданих підпису та не є юридично значущим документом.
    Для юридично значущої перевірки використовуйте акредитований центр сертифікації.
  </p>
  
  <div class="footer">
    Згенеровано VilnoCheck Sign Service • ${escapeHtml(dateStr)}
  </div>
</body>
</html>`;

  return html;
}

function escapeHtml(text) {
  if (!text) return '-';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = { generateSignatureProtocol };
