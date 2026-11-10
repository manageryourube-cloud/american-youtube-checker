AMERICAN YOUTUBE — MONETIZATION CHECKER (FIXED)

ВАЖНО: ошибка браузера "Unexpected token '<' ... is not valid JSON"
означает, что вместо ответа API сайт получил HTML/XML-страницу хостинга.
Чаще всего frontend размещён как Static Site, а Node.js backend не запущен.

ПРАВИЛЬНОЕ РАЗВЁРТЫВАНИЕ НА RENDER
1. Распакуй архив.
2. Создай GitHub-репозиторий и загрузи СОДЕРЖИМОЕ этой папки в корень репозитория:
   index.html, server.js, package.json, render.yaml, README_RU.txt, .env.example.
   Не загружай только index.html.
3. В Render выбери New → Web Service (или Blueprint, если используешь render.yaml).
   НЕ выбирай Static Site.
4. Если файлы находятся в корне GitHub-репозитория:
   Build Command: npm install
   Start Command: npm start
   Runtime: Node
   Health Check Path: /health
   Если загрузил папку american_youtube_checker целиком и она осталась вложенной,
   укажи Root Directory: american_youtube_checker.
5. В Environment добавь YOUTUBE_API_KEY (необязательно для ограниченного режима,
   но рекомендуется для публичной статистики через YouTube Data API).
6. Запусти Deploy и дождись статуса Live.
7. Открой адрес Render/health. Должен появиться JSON:
   {"ok":true,"service":"american-youtube-monetization-checker",...}
8. Открой корневой адрес сервиса и попробуй ссылку канала.

ПОЛУЧЕНИЕ YOUTUBE API KEY
1. https://console.cloud.google.com/apis/library/youtube.googleapis.com
2. Выбери/создай проект Google Cloud и включи YouTube Data API v3.
3. APIs & Services → Credentials → Create credentials → API key.
4. Добавь ключ в Render → твой сервис → Environment → YOUTUBE_API_KEY.
5. Не помещай ключ в HTML, GitHub или публичный чат.

ЕСЛИ СНОВА ВЫЛЕТАЕТ ОШИБКА
- Если /health показывает HTML/XML или 404: открыт не тот сервис или Node backend не запущен.
- Если /health показывает JSON, но apiKeyConfigured:false: добавь YOUTUBE_API_KEY в Environment и перезапусти Deploy.
- Если /health работает, но проверка канала не проходит: проверь логи Render; YouTube может ограничивать запросы к публичной странице.
- Для API-ошибки смотри текст, который вернёт сайт.

ОГРАНИЧЕНИЕ
YouTube не предоставляет публичный API для подтверждения статуса YPP чужого канала,
точных часов просмотра за последние 12 месяцев или Shorts за 90 дней. Оценка сайта —
условный индекс публичных сигналов, не реальная вероятность и не подтверждение монетизации.
Точный статус виден владельцу в YouTube Studio → Доход.

Автор: https://t.me/americanyoutuber
