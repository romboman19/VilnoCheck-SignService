const pdfMake = require('pdfmake/build/pdfmake');
const fs = require('fs');
const path = require('path');

let fontsInitialized = false;

function initFonts() {
  if (fontsInitialized) return;
  
  const robotoRegular = fs.readFileSync(path.join(__dirname, 'fonts', 'Roboto-Regular.ttf'));
  const robotoBold = fs.readFileSync(path.join(__dirname, 'fonts', 'Roboto-Bold.ttf'));
  
  // Для pdfmake потрібно встановити vfs правильно
  pdfMake.vfs = pdfMake.vfs || {};
  pdfMake.vfs['Roboto-Regular.ttf'] = robotoRegular.toString('base64');
  pdfMake.vfs['Roboto-Bold.ttf'] = robotoBold.toString('base64');
  
  pdfMake.fonts = {
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Bold.ttf',
      italics: 'Roboto-Regular.ttf',
      bolditalics: 'Roboto-Bold.ttf'
    }
  };
  
  fontsInitialized = true;
}

/**
 * Генерує PDF-протокол перевірки електронного підпису через pdfmake
 * @param {Object} data - Дані для протоколу
 * @returns {Promise<Buffer>} - PDF файл як Buffer
 */
async function generateSignatureProtocol(data) {
  // Ініціалізуємо шрифти перед генерацією
  initFonts();
  
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
        { text: '• CAdES Detached (vidokremlenyj)', style: 'signatureItem' },
        { text: `Fajl: ${signatures.cadesDetached.fileName || '-'}`, style: 'signatureDetail' },
        { text: `SHA256: ${signatures.cadesDetached.sha256 || '-'}`, style: 'signatureHash' }
      );
    }
    if (signatures.cadesEnveloped) {
      signaturesContent.push(
        { text: '• CAdES Enveloped (vbydovanyj)', style: 'signatureItem' },
        { text: `Fajl: ${signatures.cadesEnveloped.fileName || '-'}`, style: 'signatureDetail' },
        { text: `SHA256: ${signatures.cadesEnveloped.sha256 || '-'}`, style: 'signatureHash' }
      );
    }
    if (signatures.pades) {
      signaturesContent.push(
        { text: '• PAdES (PDF-vbydovanyj)', style: 'signatureItem' },
        { text: `Fajl: ${signatures.pades.fileName || '-'}`, style: 'signatureDetail' },
        { text: `SHA256: ${signatures.pades.sha256 || '-'}`, style: 'signatureHash' }
      );
    }
  }

  const docDefinition = {
    content: [
      { text: 'PROTOKOL', style: 'header' },
      { text: 'perevirky elektronnogo pidpysu', style: 'subheader' },
      { text: `Data formuvannia: ${dateStr}`, style: 'date' },
      { text: '' },
      {
        text: isValid ? 'Pidpis VALIDNYJ' : 'Pidpis NE validnyj',
        style: isValid ? 'statusValid' : 'statusInvalid'
      },
      { text: '', margin: [0, 10] },
      
      { text: '1. INFORMACIJA PRO DOKUMENT', style: 'sectionHeader' },
      {
        columns: [
          { width: 200, text: 'Nazva fajlu:', style: 'label' },
          { text: document?.fileName || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'Typ MIME:', style: 'label' },
          { text: document?.mimeType || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'Rozmir:', style: 'label' },
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
          { width: 200, text: 'ID dokumentu:', style: 'label' },
          { text: documentId || '-', style: 'valueCode' }
        ]
      },
      { text: '', margin: [0, 10] },
      
      { text: '2. INFORMACIJA PRO PIDPYSUVACHA', style: 'sectionHeader' },
      {
        columns: [
          { width: 200, text: 'PIB:', style: 'label' },
          { text: signer?.subjCN || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'Organizacija:', style: 'label' },
          { text: signer?.subjOrg || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'EDRPOU:', style: 'label' },
          { text: signer?.EDRPOUCode || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'DRFO:', style: 'label' },
          { text: signer?.DRFOCode || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'Serijnyj nomer sertyfikata:', style: 'label' },
          { text: signer?.serial || '-', style: 'valueCode' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'CCK (Vydavnyk):', style: 'label' },
          { text: signer?.issuerCN || '-', style: 'value' }
        ]
      },
      { text: '', margin: [0, 10] },
      
      { text: '3. METOD PIDPYSANNJA', style: 'sectionHeader' },
      {
        columns: [
          { width: 200, text: 'Metod:', style: 'label' },
          { text: signingMethod || '-', style: 'value' }
        ]
      },
      {
        columns: [
          { width: 200, text: 'Servis:', style: 'label' },
          { text: `VilnoCheck Sign Service v${data?.version || '0.2.0'}`, style: 'value' }
        ]
      },
      { text: '', margin: [0, 10] },
      
      { text: '4. ZGENEROVANI FORMATY PIDPYSU', style: 'sectionHeader' },
      ...signaturesContent,
      { text: '', margin: [0, 10] },
      
      { text: '5. PRYMITKY', style: 'sectionHeader' },
      {
        text: 'Ceij protocol mistyt informaciju pro elektronnyj pidpys, zgenerovanyj za dopomohoju servisu VilnoCheck Sign Service. Dani navedeni vidpovidno do metadanych pidpysu ta ne e jurydychno znachushchym dokumentom. Dlja jurydychno znachushchoi perevirky vykorystovujte akredytovanyj centr sertyfikacii.',
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
        text: `Zgenerovano VilnoCheck Sign Service • ${dateStr}`,
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
      const pdfDocGenerator = pdfMake.createPdf(docDefinition);
      pdfDocGenerator.getBuffer((buffer) => {
        if (buffer) {
          resolve(Buffer.from(buffer));
        } else {
          reject(new Error('PDF generation failed: no buffer'));
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateSignatureProtocol };
