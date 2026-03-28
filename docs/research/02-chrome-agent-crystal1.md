# Підпис документів у Chrome через локальний агент і апаратний токен Crystal 1: цільова модель інтеграції, протоколи, безпека та план впровадження

## Резюме

Модель: **локальний агент підпису (IIT), доступний з веб-сторінки через JSON-RPC по HTTP(S) на localhost**.

### Ключові факти:
- Агент слухає порти **8081 (HTTP)** і **8083 (HTTPS)** — налаштовуються
- Allow-list "Довірені web-сайти" — контроль доступу на боці агента
- Chrome 138+ LNA (Local Network Access) — потрібен явний дозвіл користувача
- Для Windows Server / AVD — агент НЕ працює, потрібне web-розширення + NMH
- Crystal 1 — криптооперації всередині пристрою, приватні ключі не залишають токен

## Архітектура

```
Chrome (web UI) --[JSON-RPC HTTPS]--> Localhost Agent (8083) --> CryptoLib/PKCS#11 --> Crystal 1 Token
     |                                                                                      |
     |<-------- signature + cert chain ---------------------------------------------------|
     |
     |--[HTTPS]--> Backend (verify chain + OCSP/CRL + timestamp, store)
```

## Послідовність підпису

1. User натискає "Підписати" в web UI
2. Web UI запитує backend: що підписувати (payload/hash + політика)
3. Web UI → Agent (JSON-RPC): ініціалізація + запит сертифікатів
4. Agent повертає список сертифікатів з токена
5. User обирає сертифікат
6. Web UI → Agent: Sign(payload, certId, options)
7. Agent показує native UI: введіть PIN
8. User вводить PIN
9. Agent → Token: криптооперація "sign"
10. Token → Agent → Web UI: signature + metadata
11. Web UI → Backend: signature + cert chain
12. Backend: verify (chain + OCSP/CRL + timestamp)
13. Backend → Web UI: OK/помилка

## JSON-RPC протокол (шаблон)

Транспорт: HTTPS на localhost:8083
Формат: JSON-RPC 2.0

Мінімальні RPC-операції:
- Ping/GetVersion — перевірка агента
- GetCertificates — список сертифікатів з токена
- Sign / SignHash — підпис байтів або хеша
- GetLastError — діагностика

**ВАЖЛИВО:** Точний перелік методів — в developer-документації IIT (EUSignWebPManual), не в operator manual.

## Компоненти (BOM)

| Шар | Компонент | Примітки |
|---|---|---|
| Браузер | Chrome desktop | LNA permission для 138+ |
| Web | Ваш web-додаток + JS інтеграція | JSON-RPC клієнт або офіційна JS-обгортка |
| Localhost | IIT Agent підпису | Порти 8081/8083, allow-list сайтів, SSL cert |
| Localhost | Криптобібліотека | PKCS#11, CSP, OCSP/TSP/LDAP |
| Пристрій | Crystal 1 | CCID, криптооперації в пристрої |
| Server | Backend | Валідація, аудит, зберігання |

## Криптоалгоритми (стек IIT)

- ЕЦП: ДСТУ 4145-2002, RSA (PKCS#1), ECDSA
- Хеш: ГОСТ 34.311-95, SHA-1/224/256/384/512
- Сертифікати: X.509 (RFC 5280)
- Підпис: CAdES (ETSI EN 319 122), CMS/PKCS#7 (RFC 5652)
- Статуси: OCSP (RFC 2560), CRL
- Timestamp: TSP (RFC 3161)

## Безпека

### Allow-list сайтів в агенті
- Ваш домен має бути в "Довірені web-сайти"
- Не використовувати wildcard

### HTTPS до localhost
- Агент генерує SSL-сертифікат при першому запуску
- Імпортує в сховище сертифікатів ОС/браузера

### PIN
- НЕ вводити в DOM веб-сторінки (ризик XSS)
- PIN вводиться в native UI агента
- Два режими: "запитувати у оператора" або "фіксовані параметри"

### Серверна валідація
- Завжди перевіряти підпис/ланцюжок/статуси на сервері
- Не довіряти лише відповіді агента

## Обмеження

- Агент НЕ працює в багатокористувацькому режимі Windows Server
- Azure Virtual Desktop (AVD) може блокувати порти 8081/8083
- Fallback: web-розширення + Native Messaging Host

## Інсталяція (Windows desktop)

1. Встановити EUSignWebInstall.exe (web-бібліотеки + агент)
2. SSL-сертифікат агента — автогенерація + імпорт
3. Налаштувати порти 8081/8083 в Windows Firewall
4. Додати домен в "Довірені web-сайти"
5. Встановити драйвери Crystal 1

## Відкриті питання

1. Точний список JSON-RPC методів (потрібна developer-документація IIT)
2. Формат підпису для ДПС: CAdES-B? CAdES-T? CAdES-LT?
3. Chrome LNA політики в цільовому середовищі
4. Сценарії Windows Server/VDI — потрібен fallback

## Ключові джерела

- IIT EUSignWebOManual.pdf: https://iit.com.ua/download/productfiles/EUSignWebOManual.pdf
- Chrome Native Messaging: https://chromium.googlesource.com/chromium/src.git/+/62.0.3178.1/chrome/common/extensions/docs/templates/articles/nativeMessaging.html
- Chrome Local Network Access: https://developer.chrome.com/blog/local-network-access
- IIT комплекс/алгоритми: https://eu.iit.com.ua/
- RFC 5652 (CMS): https://datatracker.ietf.org/doc/html/rfc5652
