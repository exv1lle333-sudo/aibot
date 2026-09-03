# AI Bot — Telegram-бот + Mini App

Claude 5 Opus / Sonnet 5, Gemini 3.1 Pro / 3 Flash / 3.1 Flash Lite, GPT-5.6 Sol и генерация картинок (Nano Banana × 3) — через ForgetAPI.
Баланс и оплата через Platega, пакеты токенов раздельно по моделям, рефералка, промокоды, тикеты, админка.

**Один проект = бот + мини-приложение + одна база (PostgreSQL).** Бот и мини-апп видят один и тот же баланс, токены и историю диалогов.

Стек: Next.js (App Router) · grammY (Telegram) · PostgreSQL + Drizzle ORM · Tailwind.

---

## Что исправлено относительно старого Python-бота

| Баг в старой версии | Как сейчас |
|---|---|
| `banned` хранился в БД, но **нигде не проверялся** — бан не работал | Бан проверяется в middleware бота и в API мини-аппа; кнопка «Бан/разбан» в админке (бот и мини-апп) |
| Покупка пакета: проверка баланса и списание **не атомарны** → двойной тап уводил баланс в минус | `UPDATE … WHERE balance >= price` — атомарно, проверено 5 параллельными запросами |
| Реферальный бесплатный запрос **сгорал даже при ошибке API** | Списывается только после успешного ответа модели |
| При 1 оставшемся токене можно было получить ответ на 10 000 токенов | Для текстового запроса нужен минимум 1 000 токенов; списание не уходит в минус |
| Генерация картинки: токены списывались после запроса, при параллельных запросах — минус | Токены резервируются атомарно до запроса, при ошибке возвращаются |
| Обработчик `menu:referral` зарегистрирован дважды | Убрано |
| FSM в `MemoryStorage` — при рестарте все диалоги/состояния слетали | Состояния хранятся в таблице `user_states` |
| Реферер мог не существовать / self-referral через API | Проверяется существование реферера, self-ref игнорируется |
| Webhook Platega падал с 500 на невалидном JSON | Возвращает 400; зачисление идемпотентно через флаг `credited` в транзакции |
| Промокод: лимит активаций проверялся неатомарно | Атомарный `UPDATE … WHERE used_count < max_uses` |
| README описывал ProxyAPI и 3 модели, код — ForgetAPI и 9 | Документация актуальна |
| Мини-аппа не было (код на неё ссылался) | Полноценный Mini App: чат, модели, кабинет, поддержка, рефералы, админка |

Не переносилось из Python-версии: локальный faster-whisper (голосовые теперь распознаются через `/audio/transcriptions` ForgetAPI, модель `WHISPER_MODEL`), генерация .pptx/.zip из ответа (блоки `[FILE:имя]…[/FILE]` по-прежнему отправляются файлами).

---

## Запуск

```bash
npm install
cp .env.example .env      # заполни переменные
npx drizzle-kit push      # создать таблицы
npm run build && npm start
```

### Переменные `.env`

| Переменная | Описание |
|---|---|
| `DATABASE_URL` | строка подключения PostgreSQL |
| `BOT_TOKEN` | токен бота от @BotFather |
| `BOT_USERNAME` | username бота без @ (для реферальных ссылок) |
| `ADMIN_IDS` | Telegram ID админов через запятую |
| `TELEGRAM_WEBHOOK_SECRET` | любая случайная строка — защищает вебхук и служебные роуты |
| `PUBLIC_BASE_URL` | публичный **https** адрес этого приложения |
| `FORGETAPI_KEY` | ключ ForgetAPI (можно задать позже из админки — приоритет у ключа из базы) |
| `PLATEGA_MERCHANT_ID`, `PLATEGA_SECRET` | данные из кабинета Platega |
| `MIN_TOPUP_RUB`, `REFERRAL_*`, `SIGNUP_BONUS_TOKENS` | бизнес-правила |
| `CHANNEL_URL`, `SUPPORT_USERNAME`, `USER_AGREEMENT_URL`, `PRIVACY_POLICY_URL` | ссылки в меню |
| `MINIAPP_DEMO` | `1` — мини-апп открывается вне Telegram под демо-пользователем. **В проде поставь `0`!** |

### Подключение к Telegram (один раз)

1. Разверни приложение по https-адресу и укажи его в `PUBLIC_BASE_URL`.
2. Открой в браузере `https://<домен>/api/telegram/setup?key=<TELEGRAM_WEBHOOK_SECRET>` — это зарегистрирует вебхук, команды и кнопку «Приложение» в меню бота.
3. В @BotFather → `/newapp` или `/setmenubutton` можно дополнительно привязать Mini App к тому же адресу.

### Platega

В личном кабинете укажи webhook: `https://<домен>/api/platega/webhook`.
Подстраховка, если колбэк не дошёл: раз в 1–2 минуты дёргай по крону `GET /api/cron/reconcile?key=<TELEGRAM_WEBHOOK_SECRET>` — оно сверит зависшие платежи напрямую с Platega. Пользователь также может нажать «Проверить оплату» сам.

---

## Структура

```
src/db/schema.ts          — таблицы (users, wallets, transactions, purchases, dialogs, tickets, promo, settings, user_states)
src/lib/config.ts         — переменные окружения
src/lib/pricing.ts        — модели, наценка (MARKUP = 1.5), пакеты токенов
src/lib/forgetapi.ts      — чат / картинки / распознавание речи через ForgetAPI
src/lib/platega.ts        — создание платежа, проверка статуса, проверка колбэка
src/lib/repo.ts           — все запросы к БД (атомарные списания)
src/lib/services.ts       — бизнес-логика, общая для бота и мини-аппа
src/lib/miniapp-auth.ts   — проверка подписи Telegram initData
src/lib/bot/              — grammY-бот: index.ts (пользователь), admin.ts (админка), keyboards.ts, format.ts
src/app/api/telegram/     — webhook + setup
src/app/api/platega/      — webhook оплаты
src/app/api/app/*         — API мини-аппа
src/components/app/       — интерфейс мини-аппа (чат, модели, кабинет, ещё, админ-панель)
```

Цены: меняешь только `costRubPer1m` в `pricing.ts` — пакеты, карточки и кнопки пересчитаются сами.
