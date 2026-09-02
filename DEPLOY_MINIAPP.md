# Как поднять Mini App на exvl.space

Мини-апп — это просто ещё несколько путей (`/app/*`, `/api/*`) на том же aiohttp-сервере,
который уже принимает вебхук Platega (`webhook.py`). Отдельный сервер поднимать не нужно.

## 1. Заполни .env

```
MINIAPP_URL=https://exvl.space/app/
MINIAPP_STATIC_DIR=./webapp_static
```

`MINIAPP_STATIC_DIR` можно не трогать — папка `webapp_static/` уже лежит рядом с `bot.py`.

## 2. Проверь, что бот слушает наружу

По умолчанию `WEBHOOK_PORT=8080` и `WEBHOOK_HOST=0.0.0.0` — бот сам слушает на 8080,
наружу его пускает nginx (см. ниже). Меняешь порт — не забудь поменять и в nginx-конфиге.

## 3. Nginx на сервере с доменом exvl.space

```nginx
server {
    listen 80;
    server_name exvl.space www.exvl.space;
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name exvl.space www.exvl.space;

    ssl_certificate     /etc/letsencrypt/live/exvl.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/exvl.space/privkey.pem;

    location /app/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /platega-webhook {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Выпусти сертификат (если ещё не выпущен):

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d exvl.space -d www.exvl.space
```

Проверь конфиг и перезапусти nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 4. Пропиши Mini App в @BotFather

1. Открой [@BotFather](https://t.me/BotFather) → `/mybots` → выбери своего бота.
2. `Bot Settings` → `Menu Button` → `Configure Menu Button`.
3. Пришли URL: `https://exvl.space/app/`
4. Название кнопки, например: `Мини-апп`.

Без этого шага синяя кнопка меню у поля ввода не появится (но кнопка "🖥 Мини-апп" в
нижней клавиатуре бота появится сама — она берётся из `MINIAPP_URL` в `.env`).

## 5. Перезапусти бота

```bash
python3 bot.py
```

В логах не должно быть предупреждения `MINIAPP_STATIC_DIR (...) не найдена`.
Открой бота в Telegram (не в браузере — Mini App работает только внутри Telegram-клиента)
и нажми «🖥 Мини-апп» или синюю кнопку меню.

## Частые проблемы

- **Кнопка мини-аппа не появляется** — проверь, что `MINIAPP_URL` начинается с `https://`
  (Telegram полностью игнорирует `http://`).
- **Белый экран / ошибка в мини-аппе** — открой мини-апп на телефоне, потряси телефон
  (или long-tap) — Telegram покажет "Report a Bug", там есть консоль с ошибкой; либо
  временно открой `https://exvl.space/app/` прямо в браузере — если и там белый экран,
  проблема на уровне nginx/статики, а не Telegram.
- **401 на все действия в мини-аппе** — значит `BOT_TOKEN` на сервере не совпадает с тем,
  которым подписывает initData сам Telegram (проверь, что .env не перепутан между
  тестовым и боевым ботом).
- **Мини-апп открывается, но кнопки ничего не делают** — проверь в браузерной консоли на
  сервере, что `/api/models` отвечает 200 (`curl https://exvl.space/api/models`).
