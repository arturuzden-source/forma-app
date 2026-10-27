# Форма

Telegram Mini App — персональный помощник по тренировкам, питанию и прогрессу. Личный пилот: доступ только у владельца.

## Стек

- **Сервер:** Node.js 22, TypeScript, Fastify, grammY (бот, long polling), SQLite (better-sqlite3, WAL).
- **Интерфейс:** React 18 + Vite, тёмная тема дизайн-системы «Форма».
- **ИИ:** OpenAI Responses API со структурированными ответами (JSON-схема), учёт расходов и лимиты.
- **Хостинг:** Railway, один сервис, Volume в `/data`.

## Разработка

```bash
npm install
npm run check        # типы + тесты
npm run build && npm start
```

Секреты в репозиторий не попадают: реальные значения только в переменных Railway, пример — `.env.example`.

## Структура

```
server/      API, бот, планировщик, база, резервные копии, ИИ
web/         интерфейс Mini App
tests/       тесты
docs/        эксплуатация, восстановление, миграции
```

Подробности эксплуатации — [docs/operations.md](docs/operations.md).
