# Інструкція з деплою VilnoCheck SignService

## Передумови

- Node.js 18+
- pm2 (для production)
- Nginx (для production)
- Git

## Кроки деплою

### 1. Клонування репозиторію

```bash
git clone https://github.com/romboman19/VilnoCheck-SignService.git
cd VilnoCheck-SignService
git checkout v2
```

### 2. Встановлення залежностей

```bash
npm install
```

### 3. Збірка клієнтського коду

```bash
npm run build
```

### 4. Налаштування змінних оточення

Створіть файл `.env`:

```env
PORT=3017
HOST=0.0.0.0
SIGN_STORAGE_DIR=/var/lib/vilnocheck/storage
CLOUD_SIGN_ENABLED=1
CLIENT_API_KEY=your-secret-api-key-here
NODE_ENV=production
```

### 5. Запуск через pm2

```bash
# Встановлення pm2 (якщо ще не встановлено)
npm install -g pm2

# Запуск
pm2 start src/server/server.js --name vilnocheck-sign

# Збереження конфігурації
pm2 save
pm2 startup
```

### 6. Перевірка

```bash
# Health check
curl -s http://localhost:3017/api/health

# Bootstrap з cloud enabled
CLOUD_SIGN_ENABLED=1 curl -s http://localhost:3017/api/bootstrap | python3 -m json.tool
```

## Nginx конфігурація

Створіть файл `/etc/nginx/sites-available/vilnocheck`:

```nginx
server {
 listen 80;
 server_name sign.example.com;

 # Редірект на HTTPS
 return 301 https://$server_name$request_uri;
}

server {
 listen 443 ssl http2;
 server_name sign.example.com;

 # SSL сертифікати
 ssl_certificate /etc/letsencrypt/live/sign.example.com/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/sign.example.com/privkey.pem;

 # Проксі до Node.js
 location / {
 proxy_pass http://localhost:3017;
 proxy_http_version 1.1;
 proxy_set_header Upgrade $http_upgrade;
 proxy_set_header Connection 'upgrade';
 proxy_set_header Host $host;
 proxy_set_header X-Real-IP $remote_addr;
 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 proxy_set_header X-Forwarded-Proto $scheme;
 proxy_cache_bypass $http_upgrade;
 }

 # Велика таймаут для upload
 client_max_body_size 50M;
 proxy_read_timeout 300s;
 proxy_connect_timeout 300s;
 proxy_send_timeout 300s;
}
```

Активуйте:

```bash
sudo ln -s /etc/nginx/sites-available/vilnocheck /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Шляхи для проксіювання

| Шлях | Призначення |
|------|-------------|
| `/` | Основний UI |
| `/api/*` | REST API |
| `/pki/ProxyHandler` | IIT PKI проксі |
| `/vendor/*` | Статичні ресурси (worker.js) |
| `/config.js` | Runtime конфігурація |

## Оновлення

```bash
# Pull нових змін
git pull origin v2

# Перевстановлення залежностей (якщо package.json змінився)
npm install

# Перезбірка
npm run build

# Перезапуск
pm2 restart vilnocheck-sign
```

## Моніторинг

```bash
# Статус
pm2 status

# Логи
pm2 logs vilnocheck-sign

# Метрики
pm2 monit
```

## Вимоги до сервера

| Ресурс | Мінімум | Рекомендовано |
|--------|---------|---------------|
| CPU | 1 core | 2+ cores |
| RAM | 512 MB | 1 GB |
| Disk | 1 GB | 5 GB |
| OS | Ubuntu 20.04+ | Ubuntu 22.04 LTS |

## Порти

| Порт | Сервіс | Опис |
|------|--------|------|
| 3017 | Node.js | Основний сервер |
| 80 | Nginx | HTTP (редірект) |
| 443 | Nginx | HTTPS |

## Безпека

- API ключ (`CLIENT_API_KEY`) повинен бути довгим і випадковим
- `.env` файл не повинен потрапляти в git (додано в `.gitignore`)
- HTTPS обов'язковий для production
- `NODE_ENV=production` відключає verbose логування

## Troubleshooting

### "Cannot find module"

```bash
rm -rf node_modules package-lock.json
npm install
```

### "Port already in use"

```bash
# Знайти процес
sudo lsof -i :3017
# Або змінити PORT в .env
```

### IIT Agent не відповідає

- Перевірте що Agent запущено
- Перевірте що порт 8080 доступний
- Для Docker: використовуйте `host` network mode

### Cloud KEP не з'являється в UI

- Перевірте `CLOUD_SIGN_ENABLED=1` в `.env`
- Перевірте `/api/bootstrap` — має бути 3 методи
