# Telegram ChatGPT-Style Bot (OpenRouter + Telegraf + Prisma)

Production-ready Telegram chatbot with:
- Multi-turn memory per chat/user context
- OpenRouter model routing and fallback
- Streaming responses with progressive Telegram edits
- Tool calling (`calculator`, `date_time`, `unit_convert`, text utilities)
- Basic safety moderation + prompt-injection hardening
- PostgreSQL persistence via Prisma
- Railway-ready webhook mode + `/health` endpoint

## Project Structure

```text
src/
  index.ts
  bot.ts
  openrouter/
    client.ts
    models.ts
    router.ts
    prompts.ts
  memory/
    store.ts
    summarizer.ts
  tools/
    tools.ts
    calculator.ts
    datetime.ts
    convert.ts
  db/
    prisma.ts
  utils/
    logger.ts
    markdown.ts
    rateLimit.ts
    locks.ts
    chunking.ts
    errors.ts
prisma/
  schema.prisma
  migrations/
```

## Setup (Local)

1. Install backend dependencies:
```bash
cd backend
npm install
```

2. Create env file:
```bash
cp .env.example .env
```

3. Set required env vars:
- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `DATABASE_URL`

4. Run Prisma migrate and generate:
```bash
npm run prisma:migrate
npm run prisma:generate
```

5. Start in dev (long polling if `APP_URL` is empty):
```bash
npm run dev
```

## Railway Deployment

1. Set Railway variables:
- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `DATABASE_URL` (Railway Postgres)
- `APP_URL` (your Railway public URL, e.g. `https://your-app.up.railway.app`)
- Optional tuning vars from `.env.example`

2. Deploy.

3. Runtime uses:
- `npm --prefix backend run start:railway`
- This runs `prisma migrate deploy` and then starts bot server.

4. Verify health:
- `GET https://<your-app>/health`
- Expected: `{ "ok": true }`

5. Open Telegram and send `/start`.

## Commands

- `/start` onboarding and quick actions
- `/help` command list and examples
- `/reset` clear chat memory/history for this chat context
- `/model` show current model and switch models
- `/settings` show/update temperature, verbosity, style
- `/export` export conversation as `txt` + `json`
- `/stop` abort active streaming response

Inline actions:
- `Reset chat`
- `Switch model`
- `Toggle concise/detailed`

## Environment Variables

- `TELEGRAM_BOT_TOKEN`: Telegram bot token
- `OPENROUTER_API_KEY`: OpenRouter API key
- `OPENROUTER_BASE_URL`: default `https://openrouter.ai/api/v1`
- `APP_URL`: public URL for webhook mode
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: optional (current implementation uses DB rate limit + DB locks)
- `ADMIN_TELEGRAM_IDS`: optional CSV for admin-only behavior
- `DEFAULT_MODEL`: default model key/id
- `FALLBACK_MODEL`: model fallback ID
- `MAX_INPUT_CHARS`: max message input length
- `MAX_OUTPUT_TOKENS`: max generated tokens
- `STREAM_EDIT_INTERVAL_MS`: Telegram edit throttle

## Model Routing

If current model is `auto`, heuristic routing selects:
- `coding/debugging` -> `code` model
- `math` -> `math` model
- `general` -> `fast` model
- `current events` -> response includes no-live-browsing disclaimer

Special Python disambiguation:
- If message includes `python` + coding words (`learn`, `code`, `function`, `error`, `install`, `pip`, `syntax`) -> programming intent.
- Otherwise bot asks quick clarification (programming vs Monty Python).

## Memory Strategy

- Persists messages in DB (`Chat`, `Message`, `Memory`)
- Keeps recent turns verbatim (last `N`)
- Maintains running summary (`summaryText`) via summarizer model call
- Supports pinned memory on messages like:
  - `remember this: my preferred format is bullet points`

## Safety + Reliability

- Input moderation blocks obvious harmful categories
- System prompt blocks prompt injection and secret leakage
- Per-chat DB lock prevents concurrency races
- Per-user rate limit: 20 messages / 10 min
- Robust errors for users, full server logging with `pino`

## Troubleshooting

### 429 / provider overload
- Bot retries with exponential backoff on `429` and `5xx`.
- If persistent, reduce request rate or switch to a cheaper/faster model.

### Telegram markdown parse errors
- Markdown is escaped before send/edit.
- If parsing still fails, bot falls back to plain text automatically.

### Webhook issues on Railway
- Ensure `APP_URL` is set to exact public URL.
- Confirm `/health` is reachable.
- Check Railway logs for `Webhook mode enabled`.

### DB errors
- Verify `DATABASE_URL` is valid.
- Run `npm run prisma:deploy` after schema updates.
