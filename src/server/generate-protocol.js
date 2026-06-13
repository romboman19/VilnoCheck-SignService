const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

/**
 * Форматує дату українською з часовою зоною Києва
 * @param {string} isoStr - ISO datetime string
 * @returns {string} - Форматована дата
 */
function formatDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Kiev'
  }) + ', ' + d.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Kiev'
  }) + ' (Київ)';
}

/**
 * Повертає людську назву методу підпису
 * @param {string} m - ID методу
 * @returns {string} - Людська назва
 */
function humanMethod(m) {
  const names = {
    'iit-token': 'IIT апаратний токен (е.ключ)',
    'privatbank-jks': 'Файловий ключ JKS',
    'cloud-kep': 'Хмарний КЕП'
  };
  return names[m] || m;
}

/**
 * Генерує PDF-протокол перевірки електронного підпису через pdf-lib
 * з підтримкою кирилиці через вбудований шрифт
 * @param {Object} data - Дані для протоколу
 * @returns {Promise<{buffer: Buffer, fileName: string}>} - PDF файл як Buffer та ім'я файлу
 */
async function generateSignatureProtocol(data) {
  const pdfDoc = await PDFDocument.create();

  // Реєструємо fontkit для підтримки кастомних шрифтів
  pdfDoc.registerFontkit(fontkit);

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  // Завантажуємо системний шрифт DejaVu з підтримкою кирилиці
  const fontPath = path.join(__dirname, 'fonts', 'DejaVuSans.ttf');
  const fontBoldPath = path.join(__dirname, 'fonts', 'DejaVuSans-Bold.ttf');

  // Вбудовуємо шрифт в PDF з підтримкою Unicode
  const fontBytes = fs.readFileSync(fontPath);
  const fontBoldBytes = fs.readFileSync(fontBoldPath);

  const customFont = await pdfDoc.embedFont(fontBytes, { subset: true });
  const customFontBold = await pdfDoc.embedFont(fontBoldBytes, { subset: true });

  const {
    generatedAt,
    document,
    signer,
    signatures,
    signingMethod,
    verification,
    documentId
  } = data;

  const dateStr = generatedAt ? formatDate(generatedAt) : formatDate(new Date().toISOString());
  const isValid = verification?.valid !== false;

  let y = height - 50;
  const lineHeight = 18;
  const leftMargin = 50;

  // Допоміжна функція для друку тексту
  const drawText = (text, x, yPos, size = 11, isBold = false) => {
    const font = isBold ? customFontBold : customFont;
    page.drawText(text || '—', {
      x,
      y: yPos,
      size,
      font,
      color: rgb(0, 0, 0)
    });
  };

  // Допоміжна функція для друку лінії — повертає нову y
  const drawLine = (label, value, yPos) => {
    drawText(label + ':', leftMargin, yPos, 11, true);
    drawText(String(value || '—'), leftMargin + 220, yPos, 11);
    return yPos - lineHeight;
  };

  // Допоміжна функція для друку довгих значень
  const drawLongValue = (label, value, yPos, options = {}) => {
    const labelWidth = options.labelWidth || 220;
    drawText(label + ':', leftMargin, yPos, 11, true);

    const val = String(value || '—');
    const maxWidth = width - leftMargin * 2 - labelWidth;
    const words = val.split(' ');
    let line = '';
    let currentY = yPos;

    for (const word of words) {
      const testLine = line + word + ' ';
      const textWidth = customFont.widthOfTextAtSize(testLine, 11);
      if (textWidth > maxWidth && line !== '') {
        drawText(line, leftMargin + labelWidth, currentY, 11);
        currentY -= 14;
        line = word + ' ';
      } else {
        line = testLine;
      }
    }
    if (line) {
      drawText(line, leftMargin + labelWidth, currentY, 11);
      currentY -= 14;
    }
    return currentY;
  };

  // Заголовок
  drawText('ПРОТОКОЛ', leftMargin, y, 24, true);
  y -= 28;
  drawText('перевірки електронного підпису', leftMargin, y, 14);
  y -= lineHeight * 2;

  // Дата
  drawText(`Дата формування: ${dateStr}`, leftMargin, y, 11);
  y -= lineHeight * 2;

  // Статус верифікації
  if (isValid) {
    drawText('✓ ПІДПИС ДІЙСНИЙ — верифікація пройшла успішно', leftMargin, y, 14, true);
  } else {
    drawText('✗ УВАГА: верифікація не пройшла', leftMargin, y, 14, true);
  }
  y -= lineHeight * 2;

  // Розділ 1: Підписаний документ
  drawText('1. ПІДПИСАНИЙ ДОКУМЕНТ', leftMargin, y, 13, true);
  y -= lineHeight;
  y = drawLine('Назва файлу', document?.fileName, y);
  y = drawLine('Розмір', document?.size ? (document.size / 1024).toFixed(1) + ' КБ' : null, y);
  y = drawLongValue('SHA-256', document?.sha256, y);
  y -= lineHeight * 1.5;

  // Розділ 2: Підписувач
  drawText('2. ПІДПИСУВАЧ', leftMargin, y, 13, true);
  y -= lineHeight;
  y = drawLine('ПІБ', signer?.subjCN, y);
  y = drawLine('РНОКПП', signer?.subjDRFOCode, y);

  // ЄДРПОУ тільки якщо є
  if (signer?.subjEDRPOUCode) {
    y = drawLine('ЄДРПОУ', signer.subjEDRPOUCode, y);
  }

  y = drawLine('Email', signer?.subjEMail, y);
  y = drawLine('Телефон', signer?.subjPhone, y);

  // Місто: locality + state
  const city = [signer?.subjLocality, signer?.subjState].filter(Boolean).join(', ');
  y = drawLine('Місто', city || null, y);
  y -= lineHeight * 0.5;

  // Розділ 3: Сертифікат
  drawText('3. СЕРТИФІКАТ', leftMargin, y, 13, true);
  y -= lineHeight;
  y = drawLine('КНЕДП', signer?.issuerCN, y);
  y = drawLine('Серійний номер', signer?.serial, y);
  y = drawLine('Метод підпису', humanMethod(signingMethod), y);
  y -= lineHeight * 0.5;

  // Розділ 4: Підпис
  drawText('4. ПІДПИС', leftMargin, y, 13, true);
  y -= lineHeight;

  const sig = signatures?.cadesDetached;
  if (sig) {
    // Використовуємо signedAt з даних, або timestamp з signatures
    const timeValue = data.signedAt || sig?.timestamp || signatures?.generatedAt;
    y = drawLine('Час підпису (UTC)', timeValue, y);
    y = drawLine('Файл підпису', sig?.fileName, y);
    y = drawLongValue('SHA-256 підпису', sig?.sha256, y);
    y -= lineHeight;
    y = drawLine('Формат', 'CAdES-X Long (відокремлений)', y);
  } else {
    drawText('• Інформація про підпис недоступна', leftMargin + 10, y, 11);
    y -= lineHeight;
  }
  y -= lineHeight;

  // Розділ 5: Формати підпису
  drawText('5. ЗГЕНЕРОВАНІ ФОРМАТИ', leftMargin, y, 13, true);
  y -= lineHeight;

  if (signatures) {
    if (signatures.cadesDetached) {
      drawText('• CAdES Detached (відокремлений)', leftMargin + 10, y, 11, true);
      y -= lineHeight;
      drawText(`Файл: ${signatures.cadesDetached.fileName || '—'}`, leftMargin + 20, y, 10);
      y -= lineHeight;
    }
    if (signatures.cadesEnveloped) {
      drawText('• CAdES Enveloped (вбудований)', leftMargin + 10, y, 11, true);
      y -= lineHeight;
      drawText(`Файл: ${signatures.cadesEnveloped.fileName || '—'}`, leftMargin + 20, y, 10);
      y -= lineHeight;
    }
    if (signatures.pades) {
      drawText('• PAdES (PDF-вбудований)', leftMargin + 10, y, 11, true);
      y -= lineHeight;
      drawText(`Файл: ${signatures.pades.fileName || '—'}`, leftMargin + 20, y, 10);
      y -= lineHeight;
    }
  }

  y -= lineHeight;

  // Футер
  drawText('Для перевірки підпису: https://czo.gov.ua або https://eu.iit.com.ua', leftMargin, 50, 9);
  drawText(`Ідентифікатор документа: ${documentId || '—'}`, leftMargin, 35, 9);
  drawText(`Згенеровано VilnoCheck Sign Service • ${dateStr}`, leftMargin, 20, 9);

  const pdfBytes = await pdfDoc.save();

  // Формуємо назву файлу протоколу
  const baseName = document?.fileName
    ? path.basename(document.fileName, path.extname(document.fileName))
    : 'document';
  const protocolFileName = `${baseName}_протокол.pdf`;

  return {
    buffer: Buffer.from(pdfBytes),
    fileName: protocolFileName
  };
}

module.exports = { generateSignatureProtocol };
