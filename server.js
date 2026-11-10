'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 10000);
const API_KEY = process.env.YOUTUBE_API_KEY || '';
const html = fs.readFileSync(path.join(__dirname, 'index.html'));
const json = (res, status, obj) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(obj));
};

function parseYouTubeUrl(input) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
  catch { throw new Error('Некорректная ссылка. Вставь ссылку на YouTube-канал.'); }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    throw new Error('Это не ссылка YouTube. Подойдут youtube.com/@handle и youtube.com/channel/ID.');
  }
  if (host === 'youtu.be') {
    const videoId = u.pathname.split('/').filter(Boolean)[0];
    if (videoId) return { kind: 'video', value: videoId };
  }
  const p = u.pathname;
  const channel = p.match(/^\/channel\/(UC[\w-]{20,})/i);
  if (channel) return { kind: 'channel', value: channel[1] };
  const handle = p.match(/^\/@([^/]+)/);
  if (handle) return { kind: 'handle', value: `@${handle[1]}` };
  const custom = p.match(/^\/(c|user)\/([^/]+)/i);
  if (custom) return { kind: custom[1].toLowerCase(), value: custom[2] };
  const video = p.match(/^\/(?:watch|shorts|live|embed)\/?/i);
  if (video) {
    const videoId = u.searchParams.get('v') || p.split('/').filter(Boolean)[1];
    if (videoId) return { kind: 'video', value: videoId };
  }
  throw new Error('Не удалось распознать ссылку. Вставь адрес главной страницы канала, например youtube.com/@handle.');
}

async function fetchText(url, timeout = 15000) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8'
    },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`YouTube вернул HTTP ${response.status}. Попробуй позже.`);
  return response.text();
}

function channelIdFromHtml(body) {
  const patterns = [
    /"externalId"\s*:\s*"(UC[\w-]{20,})"/,
    /"channelId"\s*:\s*"(UC[\w-]{20,})"/,
    /itemprop="channelId"\s+content="(UC[\w-]{20,})"/,
    /\/channel\/(UC[\w-]{20,})/
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (m) return m[1];
  }
  return null;
}

async function resolveChannel(input) {
  const parsed = parseYouTubeUrl(input.trim());
  if (parsed.kind === 'channel') return { id: parsed.value };
  let pageUrl;
  if (parsed.kind === 'video') pageUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(parsed.value)}`;
  else if (parsed.kind === 'handle') pageUrl = `https://www.youtube.com/${parsed.value}`;
  else pageUrl = `https://www.youtube.com/${parsed.kind}/${encodeURIComponent(parsed.value)}`;
  const body = await fetchText(`${pageUrl}?hl=en`);
  const id = channelIdFromHtml(body);
  if (!id) throw new Error('Не получилось определить ID канала. Попробуй ссылку вида youtube.com/channel/UC... или повтори попытку позже.');
  return { id };
}

async function apiChannel(id) {
  const u = new URL('https://www.googleapis.com/youtube/v3/channels');
  u.search = new URLSearchParams({ part: 'snippet,statistics,contentDetails', id, key: API_KEY });
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = d.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded') throw new Error('Исчерпана дневная квота YouTube API. Попробуй завтра.');
    throw new Error(d.error?.message || 'Ошибка YouTube Data API. Проверь API-ключ и включение YouTube Data API v3.');
  }
  if (!d.items?.length) throw new Error('Канал не найден или его данные недоступны.');
  const x = d.items[0];
  return {
    id,
    title: x.snippet?.title || 'YouTube-канал',
    description: x.snippet?.description || '',
    avatar: x.snippet?.thumbnails?.high?.url || x.snippet?.thumbnails?.default?.url || '',
    url: `https://www.youtube.com/channel/${id}`,
    subscribers: x.statistics?.hiddenSubscriberCount ? null : (x.statistics?.subscriberCount == null ? null : Number(x.statistics.subscriberCount)),
    views: x.statistics?.viewCount == null ? null : Number(x.statistics.viewCount),
    videoCount: x.statistics?.videoCount == null ? null : Number(x.statistics.videoCount),
    uploads: x.contentDetails?.relatedPlaylists?.uploads || null
  };
}

async function publicChannel(id) {
  const body = await fetchText(`https://www.youtube.com/channel/${id}?hl=en`);
  const decode = s => s ? s.replace(/\\u0026/g, '&').replace(/\\"/g, '"').replace(/&quot;/g, '"') : null;
  const pick = re => { const m = body.match(re); return m ? decode(m[1]) : null; };
  const title = pick(/<meta property="og:title" content="([^"]+)/) || pick(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"channelUrl"/) || 'YouTube-канал';
  const avatar = pick(/<meta property="og:image" content="([^"]+)/) || '';
  return { id, title, avatar, url: `https://www.youtube.com/channel/${id}`, subscribers: null, views: null, videoCount: null };
}

async function rssSignals(id) {
  try {
    const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, 10000);
    const dates = [...xml.matchAll(/<published>([^<]+)<\/published>/g)]
      .map(m => new Date(m[1])).filter(d => !Number.isNaN(d.getTime())).sort((a, b) => b - a);
    return { recentVideos: dates.length, latest: dates[0]?.toISOString() || null };
  } catch { return null; }
}

function analyze(channel, rss) {
  let score = 10;
  const signals = [];
  const add = (type, text, points = 0) => { signals.push({ type, text }); score += points; };
  if (channel.subscribers != null) {
    if (channel.subscribers >= 1000) add('good', `Публичный порог в 1 000 подписчиков достигнут (${channel.subscribers.toLocaleString('ru-RU')}).`, 20);
    else add('bad', `Меньше 1 000 подписчиков: ${channel.subscribers.toLocaleString('ru-RU')}.`, -5);
  } else add('', 'Количество подписчиков скрыто или недоступно через публичные данные.');
  if (channel.videoCount != null) {
    if (channel.videoCount >= 10) add('good', `На канале опубликовано ${channel.videoCount.toLocaleString('ru-RU')} видео.`, 8);
    else add('', `Небольшой объём библиотеки: ${channel.videoCount.toLocaleString('ru-RU')} видео.`);
  }
  if (channel.views != null) {
    if (channel.views >= 100000) add('good', `Более 100 000 суммарных просмотров (${channel.views.toLocaleString('ru-RU')}).`, 12);
    else add('', `Публичные просмотры канала: ${channel.views.toLocaleString('ru-RU')}.`);
  }
  if (rss?.recentVideos >= 3) add('good', `В RSS найдены недавние публикации: ${rss.recentVideos}.`, 8);
  else if (rss) add('', `В RSS найдено публикаций: ${rss.recentVideos}.`);
  else add('', 'Не удалось получить ленту последних публикаций.');
  add('', 'Часы просмотра за последние 12 месяцев и просмотры Shorts за 90 дней нельзя надёжно получить из публичной страницы канала.');
  add('bad', 'Наличие рекламы в роликах не доказывает, что доход получает владелец канала.');
  score = Math.max(5, Math.min(95, score));
  const label = score >= 70 ? 'Много положительных публичных сигналов' : score >= 40 ? 'Недостаточно подтверждений' : 'Мало публичных сигналов';
  return {
    score, label, signals,
    note: 'Это условный индекс публичных сигналов, а не реальная вероятность и не подтверждение подключения YPP. Точный статус виден владельцу канала в YouTube Studio → Доход.'
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, {
      ok: true,
      service: 'american-youtube-monetization-checker',
      apiKeyConfigured: Boolean(API_KEY),
      node: process.version
    });
    if (url.pathname === '/api/check' && req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { error: 'Используй POST-запрос к /api/check. Если ты просто открыл сайт в браузере, это нормально.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/check') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 10000) return json(res, 413, { error: 'Слишком большой запрос.' });
      }
      let payload;
      try { payload = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'Некорректный формат запроса.' }); }
      if (typeof payload.url !== 'string' || !payload.url.trim()) return json(res, 400, { error: 'Вставь ссылку на YouTube-канал.' });
      const found = await resolveChannel(payload.url);
      const channel = API_KEY ? await apiChannel(found.id) : await publicChannel(found.id);
      const rss = await rssSignals(found.id);
      const result = analyze(channel, rss);
      return json(res, 200, { channel, ...result, mode: API_KEY ? 'youtube-data-api' : 'public-page-limited' });
    }
    return json(res, 404, { error: 'Страница не найдена.' });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'YouTube долго не отвечает. Попробуй ещё раз.' : (error.message || 'Внутренняя ошибка сервера.');
    return json(res, 502, { error: message });
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`YouTube checker listening on 0.0.0.0:${PORT}`));
