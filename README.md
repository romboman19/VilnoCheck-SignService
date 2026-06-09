# VilnoCheck-SignService

Окремий сервіс підпису для **VilnoCheck / ПРРО** з підтримкою кількох методів накладання КЕП.

Сервіс призначений для роботи в українському контексті:
- українські КЕП/УЕП
- українські КНЕДП
- підпис документів для бізнес-процесів
- підпис у сценаріях, пов'язаних із ПРРО / фіскалізацією

---

## Призначення сервісу

`VilnoCheck-SignService` дає один веб-інтерфейс і один легкий бекенд для трьох класів підпису:

1. **Апаратний токен**
   - IIT local agent / browser integration
   - Crystal / Алмаз / подібні сценарії
2. **Файловий ключ**
   - PrivatBank `.jks`
   - також цільовий шлях для `.p12` / `.pfx`
3. **Хмарний підпис**
   - PrivatBank **SmartID**
   - KSP/browser-driven flow

Сервіс можна використовувати у двох режимах:
- **ручний веб-режим** — користувач відкриває сторінку, завантажує документ, підписує, завантажує пакет
- **інтеграційний режим** — інша система формує документ/сесію, а сервіс приймає вже готовий підпис і формує артефакти

---

## Поточний стан

## Що вже працює

### Апаратний токен
- інтеграція з IIT browser stack підключена
- токеновий flow у веб-інтерфейсі реалізований
- завантаження документа, підпис і формування ZIP-пакета працюють

### Файловий ключ (PrivatBank JKS)
- перемикання на метод файлового підпису працює
- читання списку ключів з JKS працює
- зчитування ключа з контейнера працює
- реалізовано PKI-proxy для OCSP/TSP/CMP
- додано allow-list для потрібних OCSP-хостів
- браузерний detached-підпис для JKS реалізований

### SmartID
- SmartID доданий як **третій метод підпису**
- є provider probe endpoint
- є базовий SmartID UI/state flow
- є QR / deep-link логіка на рівні інтерфейсу
- є підключення через `@it-enterprise/digital-signature`

## Що вже зроблено

- PIN/password/secret вирізаються із session metadata перед збереженням
- file-key і token методи не виносять приватний ключ на сервер
- SmartID підтвердження відбувається на стороні провайдера/SDK
- Helmet security headers
- Rate limiting (100/15хв загальний, 10/1хв документи, 30/1хв PKI proxy)
- API Key авторизація (x-api-key header)
- 24-годинний TTL для storage/
- Логування через morgan (logs/access.log)
- ✅ Верифікація detached підпису на бекенді перед збереженням

## Що ще потрібно

- SmartID end-to-end тест на реальному акаунті Privat24
- SMARTID_CLIENT_ID_PREFIX від ПриватБанку

---

## Архітектура

## Локальні методи: бекенд не працює з приватним ключем

Для цих методів приватний ключ не має потрапляти на сервер:
- апаратний токен
- файловий ключ

Потік такий:
1. браузер завантажує документ на бекенд
2. бекенд зберігає документ і повертає payload
3. браузер підписує локально через SDK / local agent
4. браузер віддає detached signature назад
5. бекенд зберігає підпис і формує ZIP-пакет

## Хмарний метод: координований flow через провайдера

Для SmartID підтвердження відбувається у провайдера:
1. браузер запускає SmartID flow
2. SDK формує QR / deep link / confirmation state
3. користувач підтверджує у Privat24
4. браузер отримує готовий підпис
5. бекенд зберігає detached signature і формує пакет

---

## Структура репозиторію

```text
VilnoCheck-SignService/
├── docs/
│   └── research/
│       ├── 01-kep-ukraine-fiscal.md
│       ├── 02-chrome-agent-crystal1.md
│       ├── 03-iit-agent-crystal1-dia.md
│       └── інші дослідницькі файли з репозиторію
├── public/
│   ├── assets/
│   │   └── app.js
│   ├── data/
│   │   ├── CAs.json
│   │   └── CACertificates.p7b
│   ├── index.html
│   └── styles.css
├── scripts/
│   └── build-client.mjs
├── src/
│   ├── client/
│   │   └── main.js
│   └── server/
│       ├── server.js
│       └── providers/
│           └── privatbank-smartid.js
├── storage/
├── package.json
└── README.md
```

---

## API сервісу

## Службові endpoints

### `GET /api/health`
Повертає health/version сервісу.

### `GET /api/bootstrap`
Повертає bootstrap-дані для клієнта:
- доступні методи підпису
- увімкнені провайдери
- стартову конфігурацію для UI

---

## Потік документа і підпису

### `POST /api/documents`
Завантаження документа для підпису.

Повертає:
- `documentId`
- метадані файлу
- `signingPayloadBase64`
- bootstrap/session metadata

### `PATCH /api/documents/:documentId/session`
Оновлення session metadata для поточного методу підпису.

### `POST /api/documents/:documentId/signature`
Завантаження detached signature.

Зберігає:
- байти підпису
- метод підпису
- signature info
- очищені session/client metadata

### `GET /api/documents/:documentId/package`
Завантаження ZIP-пакета з:
- оригінальним документом
- detached signature
- `manifest.json`

---

## SmartID provider endpoint

### `GET /api/providers/privatbank-smartid`
Повертає metadata SmartID provider.

### `GET /api/providers/privatbank-smartid?probe=1`
Пробує зв'язок із провайдером у live-режимі.

Використання:
- перевірити доступність SmartID перед стартом flow
- підтвердити, що endpoint сертифікатів відповідає

---

## Змінні середовища

## Загальні
- `PORT` — порт сервісу
- `HOST` — bind host
- `SIGN_STORAGE_DIR` — каталог для зберігання документів/підписів

## SmartID
- `SMARTID_ENABLED=1|0`
- `SMARTID_CLIENT_ID_PREFIX=...`
- `SMARTID_ADDRESS=https://acsk.privatbank.ua/cloud/api/back/`
- `SMARTID_CONFIRMATION_URL=https://www.privat24.ua/rd/kep`
- `SMARTID_DIRECT_ACCESS=true|false`

---

## Локальний запуск

## Вимоги
- Node.js 22+
- npm
- браузерне середовище для тестування token/file-key/cloud flows

## Встановлення

```bash
npm install
npm run build
```

## Запуск

```bash
npm start
```

Типовий локальний URL:

```text
http://127.0.0.1:3017
```

---

## Збірка

Клієнтський bundle збирається через `esbuild`:

```bash
npm run build:client
```

Повна збірка:

```bash
npm run build
```

---

## Примітки по деплою

## Reverse proxy
Якщо сервіс працює за nginx / openresty / NPM, треба правильно прокидати:
- `/api/health`
- `/api/bootstrap`
- `/api/documents/*`
- `/api/providers/*`
- `/pki/ProxyHandler`
- `/assets/*`

Типовий збій: UI відкривається, але `/api/bootstrap` не прокидається — тоді фронтенд рендериться частково й падає під час ініціалізації.

## PKI proxy
Сервіс містить **same-origin PKI proxy** для browser-side доступу до OCSP/TSP/CMP у file-key flow.
Це дозволений проксі з allow-list, а не open relay.

---

## Нотатки по безпеці

## Що вже добре
- PIN/password/secret вирізаються із session metadata перед збереженням
- file-key і token методи не виносять приватний ключ на сервер
- SmartID підтвердження відбувається на стороні провайдера/SDK

## Що ще потрібно доробити
- повна верифікація підпису перед прийняттям на бекенді
- жорсткіша модель session ownership/auth
- нормалізований продовий запуск
- підтвердження production-поведінки SmartID

---

## Відомі обмеження / caveats

### SmartID
- ✅ Серверний API готовий (`/init`, `/status/:sessionId`)
- ⚠️ Необхідно отримати `SMARTID_CLIENT_ID_PREFIX` від ПриватБанку
- ⚠️ Необхідний реальний SmartID-enabled акаунт Privat24 для тестування
- Реалізовано два шляхи підпису:
  1. Браузерний (через IIT SDK) — основний
  2. Серверний polling fallback — резервний

### Що потрібно від ПриватБанку для активації SmartID

1. Написати на `acsk@privatbank.ua` або через форму `https://acsk.privatbank.ua`
2. Запросити `clientIdPrefix` для вашої організації
3. Після отримання додати в `.env`:
   ```env
   SMARTID_ENABLED=1
   SMARTID_CLIENT_ID_PREFIX=your_prefix_here
   ```
4. Розкоментувати реалізацію в `src/server/providers/privatbank-smartid.js`
5. Перезапустити сервер

### File-key flow
- browser-side PKI залежить від мережі, CA endpoints і проксі-маршруту
- allow-list для OCSP/TSP/CMP має лишатися актуальним

### Деплой
- поточний live деплой запускається вручну
- можливий сценарій, коли прямий порт уже віддає нову версію, а домен ще дивиться в старий upstream

---

## Рекомендований чекліст тестування

## Апаратний токен
1. Відкрити сервіс
2. Завантажити документ
3. Обрати метод апаратного токена
4. Перевірити IIT agent
5. Зчитати ключ/сертифікат
6. Підписати документ
7. Завантажити ZIP

## Файловий ключ
1. Відкрити сервіс
2. Завантажити документ
3. Обрати PrivatBank JKS
4. Вибрати `.jks`
5. Зчитати ключ/сертифікат
6. Підписати документ
7. Завантажити ZIP

## SmartID
1. Відкрити сервіс
2. Завантажити документ
3. Обрати SmartID
4. Зчитати ключ/сертифікат через SmartID
5. Підтвердити в Privat24 через QR / deep link
6. Підписати документ
7. Завантажити ZIP

---

## Дорожня карта

## Найближчі кроки
- підтвердити SmartID end-to-end на реальному акаунті
- додати верифікацію підпису перед прийняттям на бекенді
- навести лад із деплоєм і process management
- дописати документацію по reverse proxy

## Далі
- стабілізація SmartID UX
- покращення session security model
- нормалізація API-контракту
- глибша інтеграція з ПРРО

---

## База досліджень

У repo вже є дослідницькі матеріали по:
- українських КЕП та фіскалізації
- IIT local agent + токенах
- КНЕДП Дія / IIT agent integration
- PrivatBank file-key (JKS)
- PrivatBank SmartID / cloud signing

Дивись:
- `docs/research/`

---

## Чесне резюме стану

Якщо зовсім коротко:

- **Апаратний токен:** реалізовано
- **Файловий ключ:** реалізовано
- **SmartID:** реалізовано як живий прототип, який ще треба підтвердити на реальному акаунті end-to-end
