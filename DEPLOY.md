# Деплой — один домен, PM2 autodeploy

Фронтенд (сборка Vite) раздаётся как статические файлы из `/var/www/xbox/dist`.  
Бэкенд (Node/Express) работает под PM2 на `127.0.0.1:4000`.  
Nginx завершает TLS на одном домене и разделяет трафик:

- `https://DOMAIN/api/*` → Node (PM2)
- `https://DOMAIN/*` → `/var/www/xbox/dist/index.html` (SPA)

Так как и фронтенд, и бэкенд находятся на одном origin, в production CORS не нужен.

---

## 1. Первичная настройка сервера (Ubuntu)

```bash
# Системные зависимости
sudo apt update
sudo apt install -y curl git nginx postgresql

# Node 20 LTS + PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2

# Postgres — создать базу и пользователя
sudo -u postgres psql <<'SQL'
CREATE USER xbox WITH PASSWORD 'STRONG_DB_PASSWORD';
CREATE DATABASE xbox_store OWNER xbox;
GRANT ALL PRIVILEGES ON DATABASE xbox_store TO xbox;
SQL

# Папка проекта
sudo mkdir -p /var/www/xbox
sudo chown -R $USER:$USER /var/www/xbox
```

### SSL

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN.com -d www.YOUR_DOMAIN.com
```

### Nginx

```bash
sudo cp /var/www/xbox/nginx/xbox.conf /etc/nginx/sites-available/xbox.conf
# Отредактируй файл: замени YOUR_DOMAIN.com на свой реальный домен
sudo ln -s /etc/nginx/sites-available/xbox.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Автозапуск PM2 после перезагрузки

```bash
pm2 startup systemd
# выполни команду, которую он выведет
pm2 save
```

---

## 2. Секреты на сервере

Скопируй примеры env-файлов и заполни их на сервере  
(эти файлы добавлены в `.gitignore`):

```bash
cp /var/www/xbox/server/.env.production.example /var/www/xbox/server/.env
nano /var/www/xbox/server/.env
```

Сгенерируй надёжный JWT secret:

```bash
openssl rand -base64 32
```

Клиенту `.env` в production не нужен — `api.js` по умолчанию использует относительный путь `/api`, который nginx проксирует на Node-процесс.

---

## 3. В каких местах нужно заменить домен

Замени `YOUR_DOMAIN.com` **во всех этих местах** на реальный домен:

| Файл / место | Что заменить |
|---|---|
| `nginx/xbox.conf` | `server_name`, пути к SSL-сертификатам |
| `server/.env` | `CLIENT_ORIGIN`, `API_PUBLIC_ORIGIN` |
| `server/.env` | `GOOGLE_REDIRECT_URI`, `VK_REDIRECT_URI` |
| Google Cloud Console | OAuth authorised redirect URI → `https://YOUR_DOMAIN.com/api/auth/oauth/google/callback` |
| Настройки приложения VK | Authorized redirect URI → `https://YOUR_DOMAIN.com/api/auth/oauth/vk/callback` |
| Telegram BotFather | `/setdomain` → `YOUR_DOMAIN.com` |

Клиенту отдельная настройка домена не нужна — он обращается к `/api` на том же origin, с которого загружен.

---

## 4. Первый деплой

На **локальной машине** отредактируй `ecosystem.config.js`:

- `host` → IP сервера
- `repo` → URL твоего git-репозитория (SSH)

Запушь код в GitHub/GitLab, затем локально выполни:

```bash
# Добавляет сервер как цель для деплоя через PM2 и клонирует репозиторий в /var/www/xbox
pm2 deploy ecosystem.config.js production setup

# Выполняет git pull + deploy.sh (установка, сборка, перезапуск)
pm2 deploy ecosystem.config.js production
```

Что делает `deploy.sh` на сервере:

1. Выполняет `npm ci` внутри `server/` (без dev-зависимостей)
2. Выполняет `npm ci && npm run build` внутри `client/`
3. Копирует `client/dist` → `/var/www/xbox/dist` (туда, откуда nginx раздаёт файлы)
4. Выполняет `pm2 startOrReload ecosystem.config.js --env production`
5. Выполняет `pm2 save`

---

## 5. Последующие деплои (autodeploy flow)

На локальной машине после `git push` в `main`:

```bash
pm2 deploy ecosystem.config.js production
```

Это полный цикл: PM2 подключается по SSH, делает `git pull`, запускает `deploy.sh`, и PM2 перезагружает приложение без простоя.

### Необязательно: деплой сразу после `git push`

Если хочешь полностью автоматический деплой после пуша, добавь workflow в GitHub Actions с шагом, который по SSH подключается к серверу и выполняет:

```bash
cd /var/www/xbox/current && bash deploy.sh
```

Либо можно поместить эту же команду в серверный git hook `post-receive`, если ты пушишь напрямую в bare-репозиторий на сервере.

---

## 6. Полезные команды

```bash
pm2 status                # список процессов
pm2 logs xbox-api         # просмотр логов API
pm2 restart xbox-api      # ручной перезапуск
pm2 monit                 # мониторинг в реальном времени

sudo nginx -t             # проверить конфиг nginx
sudo systemctl reload nginx

sudo journalctl -u nginx -f
```

---

## 7. Фаервол

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

**Не открывай порт 4000 наружу** — единственная публичная точка входа должна быть через nginx.
