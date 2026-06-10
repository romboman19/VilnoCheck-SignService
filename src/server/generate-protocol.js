const PdfPrinter = require('pdfmake');
const fs = require('fs');
const path = require('path');

// Завантажуємо шрифти
const fonts = {
  Roboto: {
    normal: path.join(__dirname, 'fonts', 'Roboto-Regular.ttf'),
    bold: path.join(__dirname, 'fonts', 'Roboto-Bold.ttf'),
    italics: path.join(__dirname, 'fonts', 'Roboto-Regular.ttf'),
    bolditalics: path.join(__dirname, 'fonts', 'Roboto-Bold.ttf')
  }
};

/**
 * Генерує PDF-протокол перевірки електронного підпису
 * @param {Object} data - Дані для протоколу
 * @returns {Promise<Buffer>} - PDF файл як Buffer
 */
async function generateSignatureProtocol(data) {
  const printer = new PdfPrinter(fonts);
  
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

  const isValid = verification?.result?.valid !== false;

  // Формуємо контент підписів
  const signaturesContent = [];
  if (signatures) {
    if (signatures.cadesDetached) {
      signaturesContent.push(
        { text: '• CAdES Detached (відокремлений)', style: 'signatureItem' },
        { text: `Файл: ${signatures.cadesDetached.fileName || '-'}`, style: 'signatureDetail' },
        { text: `SHA256: ${signatures.cadesDetached.sha256 || '-'}`, style: 'signatureHash' }
      );
    }
    if (signatures.cadesEnveloped) {
      signaturesContent.push(
        { text: '• CAdES Enveloped (вбудований)', style: 'signatureItem' },
        { text: `Файл: ${signatures.cadesEnveloped.fileName || '-'}`, style: 'signatureDetail' },
        { text: `SHA256: ${signatures.cadesEnveloped.sha256 || '-'}`, style: 'signatureHash' }
      );
    }
    if (signatures.pades) {
      signaturesContent.push(
        { text: '• PAdES (PDF-вбудований)', style: 'signatureItem' },
        { text: `Файл: ${signatures.pades.fileName || '-'}`, style: 'signatureDetail' },
        { text: `SHA256: ${signatures.pades.sha256 || '-'}`, style: 'signatureHash' }
      );
    }
  }

  const docDefinition = {
    content: [
      { text: 'ПРОТОКОЛ', style: 'header' },
      { text: 'перевірки електронного підпису', style: 'subheader' },
      { text: `Дата формування: ${dateStr}`, style: 'date' },
      { text: '' },
      {
        text: isValid ? '✓ Підпис валідний' : '✗ Підпис не валідний',
        style: isValid ? 'statusValid' : 'statusInvalid'
      },
      { text: '', margin: [0, 10] },
      
      { text: '1. ІНФОРМАЦІЯ ПРО ДОКУМЕНТ', style: 'sectionHeader' },
      {
        columns: [
          { width: 200, text: 'Назва файлу:', style: 'label' },
          { text: document?.fileName || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'Тип MIME:', style: 'label' },
          { text: document?.mimeType || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'Розмір:', style: 'label' },
          { text: document?.size ? (document.size / 1024).toFixed(2) + ' KB' : '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'SHA256:', style: 'label' },
          { text: document?.sha256 || '-', style: 'valueCode' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'ID документу:', style: 'label' },
          { text: documentId || '-', style: 'valueCode' }
        ]
      },
      { text: '', margin: [0, 10] },
      
      { text: '2. ІНФОРМАЦІЯ ПРО ПІДПИСУВАЧА', style: 'sectionHeader' },
      {
        columns: [
          { width: 200, text: 'ПІБ:', style: 'label' },
          { text: signer?.subjCN || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'Організація:', style: 'label' },
          { text: signer?.subjOrg || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'ЄДРПОУ:', style: 'label' },
          { text: signer?.EDRPOUCode || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'ДРФО:', style: 'label' },
          { text: signer?.DRFOCode || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'Серійний номер сертифіката:', style: 'label' },
          { text: signer?.serial || '-', style: 'valueCode' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'ЦСК (Видавець):', style: 'label' },
          { text: signer?.issuerCN || '-', style: 'value' }
        ]
      },
      { text: '', margin: [0, 10] },
      
      { text: '3. МЕТОД ПІДПИСАННЯ', style: 'sectionHeader' },
      {
        columns: [
          { width: 200, text: 'Метод:', style: 'label' },
          { text: signingMethod || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'Сервіс:', style: 'label' },
          { text: `VilnoCheck Sign Service v${data?.version || '0.2.0'}`, style: 'value' }
        ]
      },
      { text: '', margin: [0, 10] },
      
      { text: '4. ЗГЕНЕРОВАНІ ФОРМАТИ ПІДПИСУ', style: 'sectionHeader' },
      ...signaturesContent,
      { text: '', margin: [0, 10] },
      
      { text: '5. ПРИМІТКИ', style: 'sectionHeader' },
      {
        text: 'Цей протокол містить інформацію про електронний підпис, згенерований за допомогою сервісу VilnoCheck Sign Service. Дані наведені відповідно до метаданих підпису та не є юридично значущим документом. Для юридично значущої перевірки використовуйте акредитований центр сертифікації.',
        style: 'note'
      }
    ],
    
    styles: {
      header: {
        font: 'Roboto',
        fontSize: 24,
        bold: true,
        alignment: 'center',
        margin: [0, 0, 0, 5]
      },
      subheader: {
        font: 'Roboto',
        fontSize: 14,
        alignment: 'center',
        margin: [0, 0, 0, 20]
      },
      date: {
        font: 'Roboto',
        fontSize: 11,
        margin: [0, 0, 0, 10]
      },
      statusValid: {
        font: 'Roboto',
        fontSize: 14,
        bold: true,
        color: 'green',
        margin: [0, 10]
      },
      statusInvalid: {
        font: 'Roboto',
        fontSize: 14,
        bold: true,
        color: 'red',
        margin: [0, 10]
      },
      sectionHeader: {
        font: 'Roboto',
        fontSize: 13,
        bold: true,
        margin: [0, 10, 0, 5]
      },
      label: {
        font: 'Roboto',
        fontSize: 11,
        bold: true
      },
      value: {
        font: 'Roboto',
        fontSize: 11
      },
      valueCode: {
        font: 'Roboto',
        fontSize: 9,
        color: '#333'
      },
      signatureItem: {
        font: 'Roboto',
        fontSize: 11,
        bold: true,
        margin: [10, 5, 0, 0]
      },
      signatureDetail: {
        font: 'Roboto',
        fontSize: 10,
        margin: [20, 2, 0, 0]
      },
      signatureHash: {
        font: 'Roboto',
        fontSize: 8,
        color: '#666',
        margin: [20, 2, 0, 5]
      },
      note: {
        font: 'Roboto',
        fontSize: 10,
        italics: true,
        color: '#555'
      }
    },
    
    defaultStyle: {
      font: 'Roboto'
    },
    
    footer: function(currentPage, pageCount) {
      return {
        text: `Згенеровано VilnoCheck Sign Service • ${dateStr}`,
        alignment: 'center',
        fontSize: 9,
        font: 'Roboto',
        color: '#666',
        margin: [0, 10]
      };
    }
  };

  return new Promise((resolve, reject) => {
    try {
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      
      pdfDoc.on('data', (chunk) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      
      pdfDoc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateSignatureProtocol };
