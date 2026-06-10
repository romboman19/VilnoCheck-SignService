const PDFDocument = require('pdfkit');
const crypto = require('crypto');

/**
 * Генерує PDF-протокол перевірки електронного підпису
 * @param {Object} data - Дані для протоколу
 * @returns {Buffer} - PDF файл як Buffer
 */
function generateSignatureProtocol(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const {
      generatedAt,
      document,
      signer,
      signatures,
      signingMethod,
      verification
    } = data;

    // Заголовок
    doc.fontSize(24).text('ПРОТОКОЛ', 50, 50, { align: 'center' });
    doc.fontSize(16).text('перевірки електронного підпису', 50, 80, { align: 'center' });
    
    // Дата та статус
    const dateStr = generatedAt ? new Date(generatedAt).toLocaleString('uk-UA') : new Date().toLocaleString('uk-UA');
    doc.fontSize(12).text(`Дата формування: ${dateStr}`, 50, 120);
    
    doc.moveDown(2);

    // Статус підпису
    const isValid = verification?.result?.valid !== false;
    doc.fontSize(14).fillColor(isValid ? 'green' : 'red').text(
      isValid ? '✓ Підпис валідний' : '✗ Підпис не валідний',
      50, 150
    );
    doc.fillColor('black');

    doc.moveDown(2);

    // Інформація про документ
    doc.fontSize(14).text('1. ІНФОРМАЦІЯ ПРО ДОКУМЕНТ', 50, doc.y);
    doc.moveDown(0.5);
    doc.fontSize(11);
    
    if (document) {
      doc.text(`Назва файлу: ${document.fileName || '—'}`);
      doc.text(`Тип: ${document.mimeType || '—'}`);
      doc.text(`Розмір: ${document.size ? (document.size / 1024).toFixed(2) + ' KB' : '—'}`);
      doc.text(`SHA256: ${document.sha256 || '—'}`);
    } else {
      doc.text('Інформація про документ відсутня');
    }

    doc.moveDown(1);

    // Інформація про підписувача
    doc.fontSize(14).text('2. ІНФОРМАЦІЯ ПРО ПІДПИСУВАЧА', 50, doc.y);
    doc.moveDown(0.5);
    doc.fontSize(11);

    if (signer) {
      doc.text(`ПІБ: ${signer.subjCN || '—'}`);
      doc.text(`Організація: ${signer.subjOrg || '—'}`);
      doc.text(`ЄДРПОУ: ${signer.EDRPOUCode || '—'}`);
      doc.text(`ДРФО: ${signer.DRFOCode || '—'}`);
      doc.text(`Серійний номер сертифіката: ${signer.serial || '—'}`);
      doc.text(`Видавець: ${signer.issuerCN || '—'}`);
    } else {
      doc.text('Інформація про підписувача відсутня');
    }

    doc.moveDown(1);

    // Інформація про методу підписання
    doc.fontSize(14).text('3. МЕТОД ПІДПИСАННЯ', 50, doc.y);
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Метод: ${signingMethod || '—'}`);
    doc.text(`Сервіс: VilnoCheck Sign Service v${data.version || '0.2.0'}`);

    doc.moveDown(1);

    // Формати підписів
    doc.fontSize(14).text('4. ЗГЕНЕРОВАНІ ФОРМАТИ ПІДПИСУ', 50, doc.y);
    doc.moveDown(0.5);
    doc.fontSize(11);

    if (signatures) {
      if (signatures.cadesDetached) {
        doc.text('• CAdES Detached (відокремлений)');
        doc.text(`  Файл: ${signatures.cadesDetached.fileName || '—'}`);
        doc.text(`  SHA256: ${signatures.cadesDetached.sha256 || '—'}`);
        doc.moveDown(0.3);
      }
      if (signatures.cadesEnveloped) {
        doc.text('• CAdES Enveloped (вбудований)');
        doc.text(`  Файл: ${signatures.cadesEnveloped.fileName || '—'}`);
        doc.text(`  SHA256: ${signatures.cadesEnveloped.sha256 || '—'}`);
        doc.moveDown(0.3);
      }
      if (signatures.pades) {
        doc.text('• PAdES (PDF-вбудований)');
        doc.text(`  Файл: ${signatures.pades.fileName || '—'}`);
        doc.text(`  SHA256: ${signatures.pades.sha256 || '—'}`);
      }
    } else {
      doc.text('Інформація про формати підпису відсутня');
    }

    doc.moveDown(1);

    // Примітки
    doc.fontSize(14).text('5. ПРИМІТКИ', 50, doc.y);
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text('Цей протокол містить інформацію про електронний підпис, згенерований за допомогою сервісу VilnoCheck Sign Service.');
    doc.text('Дані наведені відповідно до метаданих підпису та не є юридично значущим документом.');
    doc.text('Для юридично значущої перевірки використовуйте акредитований центр сертифікації.');

    // Футер
    const pageHeight = doc.page.height;
    doc.fontSize(8).text(
      `Згенеровано VilnoCheck Sign Service • ${dateStr}`,
      50, pageHeight - 50, { align: 'center', width: doc.page.width - 100 }
    );

    doc.end();
  });
}

module.exports = { generateSignatureProtocol };
