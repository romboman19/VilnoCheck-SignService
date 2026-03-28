# Механізм веб-підпису документів з локальним агентом ІІТ АСК 1.3 та токеном «Кристал-1» для КНЕДП «Дія»

## Резюме

Мета — веб-інтерфейс: завантажити документ, обрати токен, ввести пароль, зчитати сертифікат/ключ через локальний агент, сформувати підпис, завантажити результат.

USB-токен недоступний серверу → криптооперації локально через «Агент підпису» (JSON-RPC HTTP(S) localhost).

### Ключові факти:
- Агент: порти 8081 (HTTP) / 8083 (HTTPS), allow-list "Довірені web-сайти"
- Бекенд "криптографічно сліпий": приймає артефакт підпису, не пароль
- Формат за замовчанням: CAdES detached (.p7s + оригінал)

## Архітектура

```
Користувач → Браузер/Фронтенд
  |--HTTPS 443--> Бекенд сервіс підпису --> Сховище файлів/сесій
  |--JSON-RPC HTTPS 127.0.0.1:8083--> Локальний агент підпису
      |--USB/CCID--> Токен «Кристал-1»
      |--OCSP/TSP/CRL (опц.)--> Сервіси ЦСК/КНЕДП
```

## Варіанти інтеграції

| Варіант | Де підпис | Доступ до ключа | Коли обирати |
|---|---|---|---|
| Браузер → агент (JSON-RPC) | ПК | localhost 8083, allow-list | **Рекомендовано** |
| WebExtension + NMH | ПК | stdio через розширення | VDI/корп. політики блокують порти |
| Локальний бекенд → PKCS#11 | ПК | PKCS#11 модуль | Без агента, більше інжинірингу |
| Локальний бекенд → CSP | ПК | Microsoft CSP | Windows-інтеграція |

## REST API контракт бекенду

### Endpoints:
- `POST /api/files` — завантажити файл → {id, sha256}
- `GET /api/files/{id}` — скачати оригінал
- `POST /api/signing-sessions` — створити сесію → {id, status, uploadSignatureUrl}
- `GET /api/signing-sessions/{id}` — статус сесії
- `POST /api/signing-sessions/{id}/certificate` — передати сертифікат (опц.)
- `POST /api/signing-sessions/{id}/signature` — передати підпис
- `GET /api/signing-sessions/{id}/download` — завантажити підписаний результат

### Модель даних:
- FileObject: id, originalName, mimeType, sizeBytes, sha256, createdAt
- SigningSession: id, fileId, status (NEW|READY_FOR_SIGN|SIGNED|VERIFIED|FAILED|EXPIRED), signatureFormat, signature, error

## Кроки підпису (end-to-end)

1. Перевірка агента: ping HTTPS 127.0.0.1:8083 (fallback HTTP 8081)
2. HTTPS-довіра: агент генерує SSL-сертифікат, імпортує в сховище
3. Allow-list: домен має бути в "Довірені web-сайти"
4. Детекція токенів: Crystal-1 через CCID
5. Введення пароля: тільки локально, не на сервер
6. Зчитування сертифіката: з токена або каталогу сертифікатів
7. Формування підпису: CAdES detached (default)
8. Передача на бекенд + завантаження результату

## Формати підпису

| Формат | Для яких даних | Артефакт | Default? |
|---|---|---|---|
| CMS/PKCS#7 | Будь-які байти | .p7s detached | Максимальна сумісність |
| CAdES | Будь-які файли | .p7s detached | **Рекомендовано** |
| XAdES | XML/структуровані | XML з Signature | Е-сервіси |
| PAdES | PDF | Вбудовано в PDF | "Підпис в PDF" |

## Псевдокод клієнтського адаптера

```
interface LocalSigner {
  ping(): boolean
  listKeyMedia(): KeyMedia[]
  readKeyAndCert(mediaId, password): CertificateInfo
  signFile(mediaId, password, fileBytes, format, detached): SignatureResult
}

flow:
  assert signer.ping()
  medias = signer.listKeyMedia()
  chosen = UI.select(medias)
  password = UI.promptPassword()
  certInfo = signer.readKeyAndCert(chosen.id, password)
  sig = signer.signFile(chosen.id, password, fileBytes, "CAdES_BASELINE_B", true)
  backend.uploadSignature(sig)
  UI.download(backend.getPackage())
```

## Безпека

- Пароль: тільки локально, не на бекенд, не логувати
- Allow-list: тільки production-домен, без wildcard
- TLS: бекенд HTTPS обов'язково; агент HTTPS 8083 бажано
- CORS: allow-list origin'ів, без wildcard для чутливих endpoints
- CSRF: токени для всіх state-changing endpoints
- Серверна валідація: не довіряти лише агенту, перевіряти підпис/ланцюжок/статуси

## Типові помилки

| Симптом | Причина | Рішення |
|---|---|---|
| Агент недоступний | Не запущено / порти заблоковані | Запустити агент, перевірити 8081/8083 |
| HTTPS не працює | Не імпортовано SSL cert агента | Перевірити EU Sign Agent CA в сховищі |
| "Сертифікат не знайдено" | Немає сертифікатів ЦСК/ЦЗО | Перевірити каталог сертифікатів |
| Помилка доступу до носія | Невірний пароль / перевищено спроби | Лічильник спроб, попередження |
| Проблеми з драйвером | SecureBoot / потрібна CCID-версія | Оновлення прошивки/драйвера |
| Не працює через proxy | 127.0.0.1 не у винятках | Додати в виключення proxy |

## Вимоги до середовища (Windows)

- ОС: Windows 7+, інсталяція від адміністратора
- Дистрибутиви: EUInstall.exe, EUUpdate.exe, EKeyCrystal1Install.exe, CAs.json, CACertificates.p7b
- Порти: 8081/8083 відкриті в firewall
- Довірені сайти: ваші домени в allow-list агента
- Драйвери: Crystal-1 CCID

## Джерела

- IIT Web-бібліотеки: https://iit.com.ua/download/productfiles/EUSignWebOManual.pdf
- IIT FAQ/Support: порти 8081/8083, діагностика
- КНЕДП «Дія»: програмне забезпечення, інструкції
- Crystal-1: експлуатаційна настанова, CCID
- CMS: RFC 5652
- CAdES: ETSI EN 319 122-1
- XAdES: ETSI EN 319 132-1
- PAdES: ETSI EN 319 142-1
