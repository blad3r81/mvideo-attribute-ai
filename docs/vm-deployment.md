# Запуск на командной VM

Страница организаторов: https://hub.gigaschool.ru/events/tochka-sborki-2026/vm

На VM работает Docker; Node.js на хосте не установлен. Код размещается в `~/project`. Демо открывается по адресу, указанному на странице VM, только если приложение слушает `0.0.0.0:8000`.

```bash
cd ~/project
docker build -t mvideo-attribute-ai:vm .
docker run -d --name mvideo-attribute-ai --restart unless-stopped \
  --network host \
  -e OPENAI_BASE_URL -e OPENAI_API_KEY \
  -e LLM_MODEL=GigaChat/GigaChat-3-Pro \
  -e LLM_AUTO_REVIEW=1 \
  -e LLM_TIMEOUT_MS=30000 \
  -e DEMO_MODE=1 -e LLM_DAILY_LIMIT=60 \
  mvideo-attribute-ai:vm
```

Ключ и адрес LLM уже заданы организаторами в окружении VM. `src/llm.js` строит из `OPENAI_BASE_URL` endpoint `/chat/completions`; ключ не записывается в файлы проекта. Режим сети хоста нужен на этой VM: из стандартной сети Docker шлюз не отвечает, что проверено отдельным запросом. `LLM_AUTO_REVIEW=1` включает модель по умолчанию в обычном API и в форме демо, если она настроена. Запрос `use_llm: false` оставляет путь только с правилами. Модель вызывается лишь при обязательном пропуске или спорном поле; если таких полей нет, платный вызов пропускается. Проверка спорного поля возвращается в `llm.review_checks` с цитатой и источником; без справочника значение остаётся в статусе `review`.

`DEMO_MODE=1` нужен публичному интерфейсу VM: он открывает ограниченный `/api/preview`, но не `/api/extract`. Предпросмотр ограничен 100 КБ и 60 запросами в минуту на адрес клиента в одном процессе; LLM ограничена 60 вызовами за 24 часа в одном процессе. Для закрытой интеграции задайте `API_TOKEN` и передавайте токен в заголовке `Authorization: Bearer ...` даже при включённом демо. Не копируйте секреты в репозиторий. Пример параметров есть в `.env.example`. Dockerfile задаёт `HOST=0.0.0.0` и `PORT=8000`; локальный запуск без Docker по README использует `127.0.0.1:4174`.

Проверка:

```bash
curl -fsS http://127.0.0.1:8000/api/health
docker logs --tail 30 mvideo-attribute-ai
docker run --rm -v "$PWD":/app -w /app node:20-alpine node --test
docker run --rm -v "$PWD":/app -w /app -e DEMO_MODE=1 node:20-alpine node scripts/check_setup.js
```

После обновления кода контейнер нужно пересобрать и пересоздать. Сдача кода организаторам выполняется отдельно через Gitea; данные, ключи и большой пакетный JSONL не следует добавлять в Git. Полная выгрузка воспроизводится по основному README и хранится отдельно от исходников.
