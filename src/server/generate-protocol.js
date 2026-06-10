const PDFDocument = require('pdfkit');
const path = require('path');

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

    // Використовуємо шрифт з підтримкою кирилиці
    const fontPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    const fontBoldPath = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
    
    let fontRegular, fontBold;
    try {
      fontRegular = doc.registerFont('DejaVuSans', fontPath);
      fontBold = doc.registerFont('DejaVuSans-Bold', fontBoldPath);
    } catch (e) {
      // Fallback на стандартний шрифт
      fontRegular = 'Helvetica';
      fontBold = 'Helvetica-Bold';
    }

    const {
      generatedAt,
      document,
      signer,
      signatures,
      signingMethod,
      verification
    } = data;

    // Заголовок - чорний текст
    doc.font(fontBold).fontSize(24).text('PROTOL', 50, 50, { align: 'center' });
    doc.font(fontRegular).fontSize(16).text('perevirky elektronnogo pidpysu', 50, 80, { align: 'center' });
    
    // Дата та статус
    const dateStr = generatedAt ? new Date(generatedAt).toLocaleString('uk-UA') : new Date().toLocaleString('uk-UA');
    doc.font(fontRegular).fontSize(12).text(`Data formuvannia: ${dateStr}`, 50, 120);
    
    doc.moveDown(2);

    // Статус підпису - тільки чорний
    const isValid = verification?.result?.valid !== false;
    const statusText = isValid ? 'Pidpis validnyi' : 'Pidpis ne validnyi';
    doc.font(fontBold).fontSize(14).text(statusText, 50, 150);

    doc.moveDown(2);

    // Інформація про документ
    doc.font(fontBold).fontSize(14).text('1. INFORMACIJA PRO DOKUMENT', 50, doc.y);
    doc.moveDown(0.5);
    doc.font(fontRegular).fontSize(11);
    
    if (document) {
      doc.text(`Nazva fajlu: ${document.fileName || '-'}`);
      doc.text(`Typ: ${document.mimeType || '-'}`);
      doc.text(`Rozmir: ${document.size ? (document.size / 1024).toFixed(2) + ' KB' : '-'}`);
      doc.text(`SHA256: ${document.sha256 || '-'}`);
    } else {
      doc.text('Informacia pro dokument vidсutnia');
    }

    doc.moveDown(1);

    // Інформація про підписувача
    doc.font(fontBold).fontSize(14).text('2. INFORMACIJA PRO PIDPYSUVACHA', 50, doc.y);
    doc.moveDown(0.5);
    doc.font(fontRegular).fontSize(11);

    if (signer) {
      doc.text(`PIB: ${signer.subjCN || '-'}`);
      doc.text(`Organizacia: ${signer.subjOrg || '-'}`);
      doc.text(`EDRPOU: ${signer.EDRPOUCode || '-'}`);
      doc.text(`DRFO: ${signer.DRFOCode || '-'}`);
      doc.text(`Serijnyj nomer sertyfikata: ${signer.serial || '-'}`);
      doc.text(`Vydavnyk: ${signer.issuerCN || '-'}`);
    } else {
      doc.text('Informacia pro pidpysuvacha vidсutnia');
    }

    doc.moveDown(1);

    // Інформація про методу підписання
    doc.font(fontBold).fontSize(14).text('3. METOD PIDPYSANNIA', 50, doc.y);
    doc.moveDown(0.5);
    doc.font(fontRegular).fontSize(11);
    doc.text(`Metod: ${signingMethod || '-'}`);
    doc.text(`Servis: VilnoCheck Sign Service v${data.version || '0.2.0'}`);

    doc.moveDown(1);

    // Формати підписів
    doc.font(fontBold).fontSize(14).text('4. ZGENEROVANI FORMATY PIDPYSU', 50, doc.y);
    doc.moveDown(0.5);
    doc.font(fontRegular).fontSize(11);

    if (signatures) {
      if (signatures.cadesDetached) {
        doc.text('* CAdES Detached (vidokremlenyj)');
        doc.text(`  Fajl: ${signatures.cadesDetached.fileName || '-'}`);
        doc.text(`  SHA256: ${signatures.cadesDetached.sha256 || '-'}`);
        doc.moveDown(0.3);
      }
      if (signatures.cadesEnveloped) {
        doc.text('* CAdES Enveloped (vbudovanyj)');
        doc.text(`  Fajl: ${signatures.cadesEnveloped.fileName || '-'}`);
        doc.text(`  SHA256: ${signatures.cadesEnveloped.sha256 || '-'}`);
        doc.moveDown(0.3);
      }
      if (signatures.pades) {
        doc.text('* PAdES (PDF-vbudovanyj)');
        doc.text(`  Fajl: ${signatures.pades.fileName || '-'}`);
        doc.text(`  SHA256: ${signatures.pades.sha256 || '-'}`);
      }
    } else {
      doc.text('Informacia pro formaty pidpysu vidсutnia');
    }

    doc.moveDown(1);

    // Примітки
    doc.font(fontBold).fontSize(14).text('5. PRYMITKY', 50, doc.y);
    doc.moveDown(0.5);
    doc.font(fontRegular).fontSize(10);
    doc.text('Cej protocol mistyt informaciju pro elektronnyj pidpys, zgenerovanyj za dopomogoju servisu VilnoCheck Sign Service.');
    doc.text('Dani navedeni vidpovidno do metadanych pidpysu ta ne e jurydychno znachushchym dokumentom.');
    doc.text('Dlja jurydychno znachushchoi perevirky vykorystovujte akredytovanyj centr sertyfikacii.');

    // Футер
    const pageHeight = doc.page.height;
    doc.font(fontRegular).fontSize(8).text(
      `Zgenerovano VilnoCheck Sign Service • ${dateStr}`,
      50, pageHeight - 50, { align: 'center', width: doc.page.width - 100 }
    );

    doc.end();
  });
}

module.exports = { generateSignatureProtocol };
