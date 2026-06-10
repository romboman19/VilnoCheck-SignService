'use strict';

const path = require('path');
const fs = require('fs');

// Шлях до CA файлів
const CA_JSON_PATH = path.join(__dirname, '../../public/data/CAs.json');
const CA_CERTS_PATH = path.join(__dirname, '../../public/data/CACertificates.p7b');

let endUserInstance = null;
let endUserInitFailed = false;

// ENV прапор для дозволу пропуску верифікації (тільки для dev/test)
const ALLOW_SKIP_VERIFY = process.env.ALLOW_SKIP_VERIFY === 'true';

async function getEndUser() {
  if (endUserInitFailed) return null;
  if (endUserInstance) return endUserInstance;

  try {
    const { EndUser } = require('@it-enterprise/digital-signature');
    const caJSON = JSON.parse(fs.readFileSync(CA_JSON_PATH, 'utf8'));
    const caCerts = fs.readFileSync(CA_CERTS_PATH);

    const eu = new EndUser();

    await eu.Initialize({
      language: 'uk',
      encoding: 'utf-8',
      CAs: caJSON,
      CACertificates: caCerts,
      allowedSignTypes: ['attached', 'detached'],
    });

    endUserInstance = eu;
    return eu;
  } catch (err) {
    console.error('[verify] EndUser init failed:', err.message);
    endUserInitFailed = true;
    return null;
  }
}

/**
 * Класифікує підпис за результатом верифікації.
 * ПРИМІТКА: Потребує тестування з реальними підписами для перевірки полів SDK
 * @param {Object} result - результат від VerifyDataInternal
 * @returns {string} signatureClass: QES | AdES_QC | AdES | unknown
 */
function classifySignature(result) {
  if (!result || !result.Certificate) return 'unknown';
  
  const cert = result.Certificate;
  
  // TODO: Тестувати з реальними підписами для перевірки реальних полей
  // console.log('[DEBUG] Certificate fields:', JSON.stringify(cert, null, 2));
  
  // Перевірка на кваліфікований сертифікат (QC)
  // Поля які можуть бути в результаті SDK (потребують перевірки):
  const isQualified = cert.qualified === true || 
                      cert.QCStatements?.includes('qcCompliance') ||
                      cert.QCStatements?.includes('QcCompliance') ||
                      (cert.policy && cert.policy.some(p => 
                        p.includes('1.2.804.2.1.1.1.1.2.1') || // Український кваліфікований
                        p.includes('0.4.0.1456.1.2') ||        // ЄС кваліфікований
                        p.includes('1.2.840.113549.1.9.16.11.58')
                      ));

  // Перевірка на QSCD (ключ у засобі КЕП)
  const isQSCD = result.QSCD === true || 
                 (result.SigningDeviceInfo && result.SigningDeviceInfo.qscd === true) ||
                 cert.QCStatements?.includes('qcSSCD') ||
                 cert.QCStatements?.includes('QcSSCD');

  // Класифікація згідно eIDAS/Zakon:
  if (isQualified && isQSCD) {
    return 'QES'; // КЕП
  } else if (isQualified) {
    return 'AdES_QC'; // УЕП на кваліфікованому сертифікаті
  } else if (cert.subject || cert.serial || cert.commonName) {
    return 'AdES'; // Простий електронний підпис
  }

  return 'unknown';
}

/**
 * Витягує validation report з результату верифікації.
 * @param {Object} result - результат від VerifyDataInternal
 * @returns {Object} звіт про валідацію
 */
function extractValidationReport(result) {
  const cert = result.Certificate || {};
  
  return {
    signer: {
      commonName: result.SignerInfo?.CommonName || cert.subject?.CN || cert.commonName || 'unknown',
      organization: cert.subject?.O || null,
      country: cert.subject?.C || null,
      serialNumber: cert.serial || null,
    },
    certificate: {
      issuer: cert.issuer?.CN || cert.issuer?.commonName || null,
      issuerOrganization: cert.issuer?.O || null,
      validFrom: cert.validFrom || null,
      validTo: cert.validTo || null,
      isQualified: cert.qualified === true || false,
      keyUsage: cert.keyUsage || [],
      policyOids: cert.policy || [],
      qcStatements: cert.QCStatements || [],
    },
    timestamp: {
      present: !!result.SigningTime,
      time: result.SigningTime || null,
    },
    verificationTime: new Date().toISOString(),
    trustMaterialVersion: process.env.TRUST_MATERIAL_VERSION || 'unknown',
  };
}

/**
 * Верифікує detached підпис відносно оригінального документа.
 * FAIL-CLOSED: якщо EndUser не ініціалізувався → valid: false 
 * (дозволити пропуск лише з ALLOW_SKIP_VERIFY=true)
 * 
 * @param {Buffer} documentBytes - оригінальний документ
 * @param {Buffer} signatureBytes - detached підпис (.p7s / CMS)
 * @returns {{ valid: boolean, signerCN?: string, signingTime?: string, error?: string, skipped?: boolean, signatureClass?: string, validationReport?: object }}
 */
async function verifyDetachedSignature(documentBytes, signatureBytes) {
  try {
    const eu = await getEndUser();

    if (!eu) {
      // FAIL-CLOSED: EndUser не ініціалізувався
      if (!ALLOW_SKIP_VERIFY) {
        console.error('[verify] FAIL-CLOSED: EndUser not initialized, verification failed');
        return {
          valid: false,
          error: 'Signature verification service unavailable. EndUser initialization failed.',
          skipped: false,
        };
      }

      // Дев-режим: дозволяємо пропуск з великим попередженням
      console.warn('[verify] DEV MODE: EndUser initialization failed, verification skipped (ALLOW_SKIP_VERIFY=true)');
      return {
        valid: true,
        skipped: true,
        error: 'DEV MODE: EndUser initialization failed, verification skipped',
        signatureClass: 'unknown',
        validationReport: null,
      };
    }

    // VerifyDataInternal — верифікація detached підпису
    const result = await eu.VerifyDataInternal(documentBytes, signatureBytes);

    // Класифікація підпису (КЕП/УЕП/AdES)
    const signatureClass = classifySignature(result);
    
    // Validation report
    const validationReport = extractValidationReport(result);

    return {
      valid: true,
      signerCN: result.SignerInfo?.CommonName || result.Certificate?.subject?.CN || result.Certificate?.commonName || 'unknown',
      signingTime: result.SigningTime || null,
      certSerial: result.Certificate?.serial || null,
      issuer: result.Certificate?.issuer?.CN || result.Certificate?.issuer?.commonName || null,
      verificationSkipped: false,
      signatureClass, // "QES" | "AdES_QC" | "AdES" | "unknown"
      validationReport,
    };
  } catch (err) {
    // EndUser кидає помилку якщо підпис невалідний
    console.error('[verify] Signature verification failed:', err.message);
    return {
      valid: false,
      error: err.message || 'Signature verification failed',
      signatureClass: 'unknown',
    };
  }
}

module.exports = { 
  verifyDetachedSignature,
  classifySignature,
  extractValidationReport,
};
