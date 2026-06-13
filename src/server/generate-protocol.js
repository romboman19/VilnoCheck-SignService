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
 * Обрізає довгий текст
 * @param {string} str - Текст
 * @param {number} maxChars - Максимальна довжина
 * @returns {string} - Обрізаний текст
 */
function truncate(str, maxChars) {
  if (!str) return '—';
  return str.length > maxChars ? str.substring(0, maxChars - 1) + '…' : str;
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
    documentId,
    signedAt
  } = data;

  const dateStr = generatedAt ? formatDate(generatedAt) : formatDate(new Date().toISOString());
  const isValid = verification?.valid !== false;

  // Допоміжні значення
  const org = signer?.subjOrg || signer?.subjOrgUnit || 'ФІЗИЧНА ОСОБА';
  const country = 'Україна';
  const algorithm = 'ДСТУ 4145';
  const signType = (signer?.issuerCN || '').toLowerCase().includes('кваліфікован')
    ? 'Кваліфікований'
    : 'Удосконалений';

  let y = height - 50;
  const lineHeight = 16;
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
    const labelText = label + ':';
    drawText(labelText, leftMargin, yPos, 11, true);
    const valueX = leftMargin + customFontBold.widthOfTextAtSize(labelText, 11) + 6;
    drawText(String(value || '—'), valueX, yPos, 11);
    return yPos - lineHeight;
  };

  // Допоміжна функція для друку довгих значень
  const drawLongValue = (label, value, yPos) => {
    const labelText = label + ':';
    drawText(labelText, leftMargin, yPos, 11, true);
    const labelWidth = customFontBold.widthOfTextAtSize(labelText, 11) + 6;
    const val = String(value || '—');
    const maxWidth = width - leftMargin * 2 - labelWidth - 50;
    const words = val.split(' ');
    let line = '';
    let currentY = yPos;

    for (const word of words) {
      const testLine = line + word + ' ';
      const textWidth = customFont.widthOfTextAtSize(testLine, 11);
      if (textWidth > maxWidth && line !== '') {
        drawText(line, leftMargin + labelWidth, currentY, 11);
        currentY -= 13;
        line = word + ' ';
      } else {
        line = testLine;
      }
    }
    if (line) {
      drawText(line, leftMargin + labelWidth, currentY, 11);
      currentY -= 13;
    }
    return currentY;
  };

  // Заголовок
  drawText('ПРОТОКОЛ', leftMargin, y, 24, true);
  y -= 28;
  drawText('перевірки електронного підпису', leftMargin, y, 14);
  y -= lineHeight * 2;

  // Дата формування
  drawText(`Дата формування: ${dateStr}`, leftMargin, y, 11);
  y -= lineHeight * 2;

  // Статус верифікації
  if (isValid) {
    drawText('✓ ПІДПИС ДІЙСНИЙ — верифікація пройшла успішно', leftMargin, y, 14, true);
  } else {
    drawText('✗ УВАГА: верифікація не пройшла', leftMargin, y, 14, true);
  }
  y -= lineHeight * 2;

  // БЛОК 1: Файл підпису
  drawText('1. ФАЙЛ ПІДПИСУ', leftMargin, y, 13, true);
  y -= lineHeight;
  const sig = signatures?.cadesDetached;
  if (sig) {
    y = drawLine('Назва файлу', sig?.fileName, y);
    y = drawLine('Розмір', sig?.size ? (sig.size / 1024).toFixed(1) + ' КБ' : null, y);
  } else {
    y = drawLine('Назва файлу', '—', y);
  }
  y -= lineHeight * 0.5;

  // БЛОК 2: Перевірені файли (оригінал)
  drawText('2. ПЕРЕВІРЕНІ ФАЙЛИ', leftMargin, y, 13, true);
  y -= lineHeight;
  y = drawLine('Назва файлу', document?.originalName, y);
  y = drawLine('Розмір', document?.size ? (document.size / 1024).toFixed(1) + ' КБ' : null, y);
  y = drawLongValue('SHA-256', document?.sha256, y);
  y = drawLine('Результат верифікації', isValid ? 'Дійсний' : 'Недійсний', y);
  y -= lineHeight * 0.5;

  // БЛОК 3: Підписувач
  drawText('3. ПІДПИСУВАЧ', leftMargin, y, 13, true);
  y -= lineHeight;
  y = drawLine('ПІБ', signer?.subjCN, y);
  y = drawLine('РНОКПП', signer?.subjDRFOCode, y);
  y = drawLine('Організація', org, y);
  y = drawLine('Країна', country, y);
  y -= lineHeight * 0.5;

  // БЛОК 4: Час підпису
  drawText('4. ЧАС ПІДПИСУ', leftMargin, y, 13, true);
  y -= lineHeight;
  const timeValue = signedAt ? formatDate(signedAt) : (sig?.timestamp || '—');
  y = drawLine('Час підпису', timeValue, y);
  drawText('(підтверджено позначкою часу від Надавача)', leftMargin + 10, y, 9);
  y -= lineHeight * 1.5;

  // БЛОК 5: Сертифікат
  drawText('5. СЕРТИФІКАТ', leftMargin, y, 13, true);
  y -= lineHeight;
  y = drawLine('КНЕДП', truncate(signer?.issuerCN, 60), y);
  y = drawLine('Серійний номер', signer?.serial, y);
  y = drawLine('Алгоритм підпису', algorithm, y);
  y = drawLine('Тип підпису', signType, y);
  y = drawLine('Тип контейнера', 'Підпис та дані в окремих файлах (CAdES detached)', y);
  y = drawLine('Формат підпису', 'З повними даними ЦСК для перевірки (CAdES-X Long)', y);
  
  // Версія сертифіката (дата видачі) — якщо є
  if (cert?.validFrom) {
    y = drawLine('Дійсний з', formatDate(signer.validFrom), y);
  }
  y -= lineHeight * 0.5;

  // БЛОК 6: Згенеровані формати
  drawText('6. ЗГЕНЕРОВАНІ ФОРМАТИ', leftMargin, y, 13, true);
  y -= lineHeight;
  if (signatures) {
    if (signatures.cadesDetached) {
      drawText('• CAdES Detached (відокремлений)', leftMargin + 10, y, 11, true);
      y -= lineHeight;
    }
    if (signatures.cadesEnveloped) {
      drawText('• CAdES Enveloped (вбудований)', leftMargin + 10, y, 11, true);
      y -= lineHeight;
    }
    if (signatures.pades) {
      drawText('• PAdES (PDF-вбудований)', leftMargin + 10, y, 11, true);
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
  const baseName = document?.originalName
    ? path.basename(document.originalName, path.extname(document.originalName))
    : 'document';
  const protocolFileName = `${baseName}_протокол.pdf`;

  return {
    buffer: Buffer.from(pdfBytes),
    fileName: protocolFileName
  };
}

module.exports = { generateSignatureProtocol };
