const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

/**
 * Генерує PDF-протокол перевірки електронного підпису через pdf-lib
 * @param {Object} data - Дані для протоколу
 * @returns {Promise<Buffer>} - PDF файл як Buffer
 */
async function generateSignatureProtocol(data) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  // Завантажуємо шрифт Roboto з підтримкою кирилиці
  const fontPath = path.join(__dirname, 'fonts', 'Roboto-Regular.ttf');
  let font;
  try {
    const fontBytes = fs.readFileSync(fontPath);
    font = await pdfDoc.embedFont(fontBytes);
  } catch (e) {
    // Fallback на стандартний шрифт якщо Roboto не знайдено
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

  const {
    generatedAt,
    document,
    signer,
    signatures,
    signingMethod,
    verification,
    documentId
  } = data;

  const dateStr = generatedAt 
    ? new Date(generatedAt).toLocaleString('uk-UA') 
    : new Date().toLocaleString('uk-UA');

  let y = height - 50;
  const lineHeight = 18;
  const leftMargin = 50;
  const rightMargin = width - 50;

  // Допоміжна функція для друку тексту
  const drawText = (text, x, yPos, size = 11, options = {}) => {
    page.drawText(text || '-', {
      x,
      y: yPos,
      size,
      font,
      color: rgb(0, 0, 0),
      ...options
    });
  };

  // Допоміжна функція для друку лінії
  const drawLine = (label, value, yPos) => {
    drawText(label + ':', leftMargin, yPos, 11, { font });
    drawText(String(value || '-'), leftMargin + 200, yPos, 11, { font });
  };

  // Заголовок
  drawText('ПРОТОКОЛ', leftMargin, y, 24, { font });
  y -= 25;
  drawText('перевірки електронного підпису', leftMargin, y, 14, { font });
  y -= lineHeight * 2;

  // Дата
  drawText(`Дата формування: ${dateStr}`, leftMargin, y, 11, { font });
  y -= lineHeight * 2;

  // Статус
  const isValid = verification?.result?.valid !== false;
  drawText(isValid ? '✓ Підпис валідний' : '✗ Підпис не валідний', 
    leftMargin, y, 14, { font });
  y -= lineHeight * 2;

  // Розділ 1: Інформація про документ
  drawText('1. ІНФОРМАЦІЯ ПРО ДОКУМЕНТ', leftMargin, y, 13, { font });
  y -= lineHeight;
  
  drawLine('Назва файлу', document?.fileName, y);
  y -= lineHeight;
  drawLine('Тип MIME', document?.mimeType, y);
  y -= lineHeight;
  drawLine('Розмір', document?.size ? (document.size / 1024).toFixed(2) + ' KB' : '-', y);
  y -= lineHeight;
  drawLine('SHA256', document?.sha256, y);
  y -= lineHeight;
  drawLine('ID документу', documentId, y);
  y -= lineHeight * 1.5;

  // Розділ 2: Інформація про підписувача
  drawText('2. ІНФОРМАЦІЯ ПРО ПІДПИСУВАЧА', leftMargin, y, 13, { font });
  y -= lineHeight;
  
  drawLine('ПІБ', signer?.subjCN, y);
  y -= lineHeight;
  drawLine('Організація', signer?.subjOrg, y);
  y -= lineHeight;
  drawLine('ЄДРПОУ', signer?.EDRPOUCode, y);
  y -= lineHeight;
  drawLine('ДРФО', signer?.DRFOCode, y);
  y -= lineHeight;
  drawLine('Серійний номер сертифіката', signer?.serial, y);
  y -= lineHeight;
  drawLine('ЦСК (Видавець)', signer?.issuerCN, y);
  y -= lineHeight * 1.5;

  // Розділ 3: Метод підписання
  drawText('3. МЕТОД ПІДПИСАННЯ', leftMargin, y, 13, { font });
  y -= lineHeight;
  
  drawLine('Метод', signingMethod, y);
  y -= lineHeight;
  drawLine('Сервіс', `VilnoCheck Sign Service v${data?.version || '0.2.0'}`, y);
  y -= lineHeight * 1.5;

  // Розділ 4: Формати підпису
  drawText('4. ЗГЕНЕРОВАНІ ФОРМАТИ ПІДПИСУ', leftMargin, y, 13, { font });
  y -= lineHeight;

  if (signatures) {
    if (signatures.cadesDetached) {
      drawText('• CAdES Detached (відокремлений)', leftMargin + 10, y, 11, { font });
      y -= lineHeight;
      drawText(`  Файл: ${signatures.cadesDetached.fileName || '-'}`, leftMargin + 20, y, 10, { font });
      y -= lineHeight;
      drawText(`  SHA256: ${signatures.cadesDetached.sha256 || '-'}`, leftMargin + 20, y, 9, { font });
      y -= lineHeight;
    }
    if (signatures.cadesEnveloped) {
      drawText('• CAdES Enveloped (вбудований)', leftMargin + 10, y, 11, { font });
      y -= lineHeight;
      drawText(`  Файл: ${signatures.cadesEnveloped.fileName || '-'}`, leftMargin + 20, y, 10, { font });
      y -= lineHeight;
      drawText(`  SHA256: ${signatures.cadesEnveloped.sha256 || '-'}`, leftMargin + 20, y, 9, { font });
      y -= lineHeight;
    }
    if (signatures.pades) {
      drawText('• PAdES (PDF-вбудований)', leftMargin + 10, y, 11, { font });
      y -= lineHeight;
      drawText(`  Файл: ${signatures.pades.fileName || '-'}`, leftMargin + 20, y, 10, { font });
      y -= lineHeight;
      drawText(`  SHA256: ${signatures.pades.sha256 || '-'}`, leftMargin + 20, y, 9, { font });
      y -= lineHeight;
    }
  } else {
    drawText('Інформація про формати підпису відсутня', leftMargin + 10, y, 11, { font });
    y -= lineHeight;
  }

  y -= lineHeight;

  // Розділ 5: Примітки
  drawText('5. ПРИМІТКИ', leftMargin, y, 13, { font });
  y -= lineHeight;
  
  const noteText = 'Цей протокол містить інформацію про електронний підпис, згенерований за допомогою ' +
    'сервісу VilnoCheck Sign Service. Дані наведені відповідно до метаданих підпису та не є ' +
    'юридично значущим документом. Для юридично значущої перевірки використовуйте акредитований центр сертифікації.';
  
  // Розбиваємо текст на рядки
  const words = noteText.split(' ');
  let line = '';
  const maxWidth = width - leftMargin * 2;
  
  for (const word of words) {
    const testLine = line + word + ' ';
    const textWidth = font.widthOfTextAtSize(testLine, 10);
    if (textWidth > maxWidth && line !== '') {
      drawText(line, leftMargin, y, 10, { font });
      y -= 14;
      line = word + ' ';
    } else {
      line = testLine;
    }
  }
  if (line) {
    drawText(line, leftMargin, y, 10, { font });
    y -= 14;
  }

  y -= lineHeight;

  // Футер
  drawText(`Згенеровано VilnoCheck Sign Service • ${dateStr}`, 
    leftMargin, 30, 9, { font });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { generateSignatureProtocol };
