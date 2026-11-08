/**
 * K-pop Radar — single-file build.
 *
 * This one file contains the whole app: the web UI, the sweep engine, the
 * scraper/translator layer, the roster and the JSON datastore. It exists so the
 * app can be deployed by uploading a handful of files (GitHub's web editor,
 * an iPhone, no terminal). The readable, commented source lives in the
 * kpop-radar project and is what you should edit long-term.
 *
 * env: PORT  KPR_DATA_DIR (where state.json is written)
 */
global.__KPR_ASSETS__ = {"/app.js":{"type":"application/javascript; charset=utf-8","b64":false,"body":"/* =====================================================================\n   K-pop Radar \u2014 iPhone-first PWA\n   ===================================================================== */\nconst $ = (s, r = document) => r.querySelector(s);\nconst $$ = (s, r = document) => [...r.querySelectorAll(s)];\nconst esc = (s = '') => String(s).replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n\nconst state = {\n  boot: null,\n  view: 'feed',\n  filter: { windowDays: 3, kind: 'all', artist: '', topic: '', onlyNew: false },\n  items: [],\n  newCount: 0,\n  searching: false,\n  digest: null\n};\n\nconst LS = {\n  get: (k, d) => { try { const v = localStorage.getItem('kpr:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },\n  set: (k, v) => { try { localStorage.setItem('kpr:' + k, JSON.stringify(v)); } catch (e) {} }\n};\n\n/* ------------------------------ api ------------------------------ */\nasync function api(path, opts = {}) {\n  const res = await fetch(path, {\n    headers: { 'content-type': 'application/json' },\n    ...opts,\n    body: opts.body ? JSON.stringify(opts.body) : undefined\n  });\n  const data = await res.json().catch(() => ({}));\n  if (!res.ok) throw new Error(data.error || res.statusText);\n  return data;\n}\n\n/* ------------------------------ toast ------------------------------ */\nlet toastTimer;\nfunction toast(msg, ms = 2600) {\n  const t = $('#toast');\n  t.textContent = msg;\n  t.classList.add('on');\n  clearTimeout(toastTimer);\n  toastTimer = setTimeout(() => t.classList.remove('on'), ms);\n}\n\n/* ------------------------------ time ------------------------------ */\nfunction timeAgo(iso) {\n  if (!iso) return 'undated';\n  const d = (Date.now() - Date.parse(iso)) / 1000;\n  if (isNaN(d)) return 'undated';\n  if (d < 0) return 'just now';\n  if (d < 90) return 'just now';\n  if (d < 3600) return Math.round(d / 60) + 'm ago';\n  if (d < 86400) return Math.round(d / 3600) + 'h ago';\n  if (d < 172800) return 'yesterday';\n  if (d < 2592000) return Math.round(d / 86400) + 'd ago';\n  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });\n}\nconst stampDate = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '\u2014';\n\n/* ------------------------------ boot ------------------------------ */\nasync function boot() {\n  renderSkeletons();\n  try {\n    const b = await api('/api/bootstrap');\n    state.boot = b;\n    const saved = LS.get('windowDays', b.settings.windowDays || 3);\n    state.filter.windowDays = saved;\n    state.filter.onlyNew = LS.get('onlyNew', false);\n    renderWindowChips();\n    renderFilters();\n    renderHero();\n    await loadFeed();\n    renderArtists();\n    renderSettings();\n    renderSaved();\n    updateHeaderLine();\n    if (b.progress && b.progress.phase && b.progress.phase !== 'idle') pollProgress(true);\n  } catch (e) {\n    $('#feed').innerHTML = `<div class=\"empty\"><div class=\"big\">\u26a0\ufe0f</div><h3>Can't reach the radar</h3><p>${esc(e.message)}</p></div>`;\n  }\n}\n\nfunction renderSkeletons() {\n  $('#feed').innerHTML = '<div class=\"sk\"></div><div class=\"sk\"></div><div class=\"sk\"></div>';\n  $('#hero').innerHTML = '';\n}\n\nfunction updateHeaderLine() {\n  const b = state.boot;\n  if (!b) return;\n  const el = $('#lastSweepLine');\n  el.textContent = b.lastSearchAt ? `last scan ${timeAgo(b.lastSearchAt)}` : 'never scanned \u00b7 tap search';\n}\n\n/* ------------------------------ window chips ------------------------------ */\nconst WINDOWS = [\n  { days: 1, label: 'Today' },\n  { days: 3, label: '3 days' },\n  { days: 7, label: '7 days' },\n  { days: 14, label: '14 days' },\n  { days: 30, label: '30 days' }\n];\nfunction renderWindowChips() {\n  $('#windowChips').innerHTML = WINDOWS.map((w) =>\n    `<button class=\"chip ${Number(state.filter.windowDays) === w.days ? 'on' : ''}\" data-days=\"${w.days}\">${w.label}</button>`\n  ).join('');\n  $$('#windowChips .chip').forEach((c) => c.onclick = async () => {\n    state.filter.windowDays = Number(c.dataset.days);\n    LS.set('windowDays', state.filter.windowDays);\n    renderWindowChips();\n    await api('/api/settings', { method: 'POST', body: { windowDays: state.filter.windowDays } }).catch(() => {});\n    loadFeed();\n  });\n}\n\n/* ------------------------------ filters ------------------------------ */\nfunction renderFilters() {\n  const b = state.boot;\n  const groups = b.artists.map((a) => ({ id: a.id, name: a.name }));\n  const kinds = [\n    { id: 'all', label: 'Everything' },\n    { id: 'news', label: 'News' },\n    { id: 'official', label: 'Official' },\n    { id: 'label', label: 'Labels' },\n    { id: 'merch', label: 'Merch' }\n  ];\n  $('#filterRow').innerHTML =\n    `<button class=\"f-chip ${state.filter.onlyNew ? 'on' : ''}\" id=\"fNew\">New only ${state.newCount ? `<span class=\"n\">${state.newCount}</span>` : ''}</button>` +\n    kinds.map((k) => `<button class=\"f-chip ${state.filter.kind === k.id ? 'on' : ''}\" data-kind=\"${k.id}\">${k.label}</button>`).join('') +\n    `<select class=\"f-select\" id=\"fArtist\">\n       <option value=\"\">All artists</option>\n       ${groups.map((g) => `<option value=\"${g.id}\" ${state.filter.artist === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}\n       ${b.artists.map((a) => `<optgroup label=\"${esc(a.name)} members\">${a.members.map((m) => `<option value=\"${m.id}\" ${state.filter.artist === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</optgroup>`).join('')}\n     </select>` +\n    `<select class=\"f-select\" id=\"fTopic\">\n       <option value=\"\">All topics</option>\n       ${b.topics.map((t) => `<option value=\"${t.id}\" ${state.filter.topic === t.id ? 'selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}\n     </select>`;\n\n  $('#fNew').onclick = () => {\n    state.filter.onlyNew = !state.filter.onlyNew;\n    LS.set('onlyNew', state.filter.onlyNew);\n    renderFilters(); loadFeed();\n  };\n  $$('#filterRow [data-kind]').forEach((el) => el.onclick = () => {\n    state.filter.kind = el.dataset.kind; renderFilters(); loadFeed();\n  });\n  $('#fArtist').onchange = (e) => { state.filter.artist = e.target.value; loadFeed(); };\n  $('#fTopic').onchange = (e) => { state.filter.topic = e.target.value; loadFeed(); };\n}\n\n/* ------------------------------ feed ------------------------------ */\nasync function loadFeed() {\n  const f = state.filter;\n  const qs = new URLSearchParams({\n    windowDays: f.windowDays || 30,\n    kind: f.kind,\n    artist: f.artist || '',\n    topic: f.topic || '',\n    new: f.onlyNew ? '1' : '',\n    limit: 300\n  });\n  const data = await api('/api/items?' + qs.toString());\n  state.items = data.items;\n  state.newCount = typeof data.newCount === 'number' ? data.newCount : data.items.filter((i) => i.isNew).length;\n  renderFeed();\n  renderHero();\n  renderFilters();\n  updateHeaderLine();\n}\n\nfunction renderHero() {\n  const items = state.items;\n  const n = (k) => items.filter((i) => i.kind === k).length;\n  const pinned = state.boot?.counts?.pinned || 0;\n  $('#hero').innerHTML = `\n    <div class=\"stat pink\"><b>${n('news') + n('label')}</b><span>news</span></div>\n    <div class=\"stat violet\"><b>${n('official')}</b><span>official</span></div>\n    <div class=\"stat green\"><b>${n('merch')}</b><span>merch</span></div>\n    <div class=\"stat blue\"><b>${pinned}</b><span>saved</span></div>`;\n}\n\nconst KIND_PILL = { news: ['news', 'News'], official: ['official', 'Official'], merch: ['merch', 'Drop'], label: ['label', 'Label'] };\n\nfunction cardHTML(it) {\n  const [pillClass, pillText] = KIND_PILL[it.kind] || ['news', 'News'];\n  const artists = (it.artistLabels || []).slice(0, 2).map((a) => a.split(' (')[0]);\n  const topicName = (state.boot.topics.find((t) => t.id === it.primaryTopic) || {}).name;\n  const srcCount = (it.sources || []).length;\n  const isGeneric = !it.summarySource || it.summarySource === 'fallback';\n  return `\n  <article class=\"card ${it.pinned ? 'pinned' : ''} ${it.isNew ? 'new' : ''}\" data-id=\"${it.id}\">\n    <div class=\"card-head\">\n      <span class=\"pill ${pillClass}\">${pillText}</span>\n      ${it.savedSubjectId ? '<span class=\"pill update\">update</span>' : ''}\n      <span class=\"src\">${esc(it.sourceName || 'Unknown')}</span>\n      <span class=\"meta\"><span class=\"sep\">\u00b7</span>${timeAgo(it.publishedAt || it.firstSeenAt)}</span>\n    </div>\n    ${it.image ? `<img class=\"thumb\" src=\"${esc(it.image)}\" alt=\"\" loading=\"lazy\" onerror=\"this.remove()\">` : ''}\n    <h3>${esc(it.title)}</h3>\n    ${it.detail ? `<p style=\"color:#8a8899;font-size:12px;margin-bottom:4px\">latest: ${esc(it.detail)}</p>` : ''}\n    ${it.summary ? `<p>${esc(it.summary)}${it.summarySource === 'ai' ? '<span class=\"ai\">AI</span>' : ''}</p>` : ''}\n    ${it.price ? `<div class=\"priceRow\"><span class=\"price\">$${it.price.amount.toFixed(2)}</span><span class=\"meta\">${esc(it.sourceName || '')}</span></div>` : ''}\n    <div class=\"card-foot\">\n      ${artists.map((a) => `<span class=\"tag\">${esc(a)}</span>`).join('')}\n      ${topicName ? `<span class=\"tag topic\">${esc(topicName)}</span>` : ''}\n      ${srcCount > 1 ? `<span class=\"tag more\">+${srcCount - 1} src</span>` : ''}\n      <div class=\"card-actions\">\n        ${isGeneric ? `<button class=\"act act-sum\" title=\"Summarize\">\ud83d\udcdd</button>` : ''}\n        <button class=\"act act-open\" title=\"Open\">\n          <svg width=\"17\" height=\"17\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M14 4h6v6M20 4l-8 8\"/><path d=\"M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\"/></svg>\n        </button>\n        <button class=\"act star ${it.pinned ? 'on' : ''}\" title=\"Save\">\n          <svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"${it.pinned ? 'currentColor' : 'none'}\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linejoin=\"round\"><path d=\"M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z\"/></svg>\n        </button>\n        <button class=\"act del\" title=\"Delete\">\n          <svg width=\"17\" height=\"17\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\"><path d=\"M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13\"/></svg>\n        </button>\n      </div>\n    </div>\n  </article>`;\n}\n\nfunction renderFeed() {\n  const feed = $('#feed');\n  if (!state.items.length) {\n    feed.innerHTML = `<div class=\"empty\">\n      <div class=\"big\">\ud83d\udce1</div>\n      <h3>No signals yet</h3>\n      <p>Tap <b>Search now</b> and the radar will sweep news in every language, official channels, label press rooms and K-pop stores \u2014 then keep what matches your ${esc(String(state.filter.windowDays))}-day window.</p>\n      <button class=\"btn-primary\" onclick=\"document.getElementById('btnSearch').click()\">Run first search</button>\n    </div>`;\n    return;\n  }\n  const digest = state.digest;\n  feed.innerHTML = (digest ? `<div class=\"card\" style=\"border-color:rgba(138,92,255,.4);background:rgba(138,92,255,.08)\">\n      <div class=\"card-head\"><span class=\"pill update\">digest</span><span class=\"meta\">${esc(digest)}</span></div>\n    </div>` : '') + state.items.map(cardHTML).join('');\n\n  $$('#feed .card[data-id]').forEach((el) => bindCard(el));\n  const tn = $('#tabNewCount');\n  tn.textContent = state.newCount || '';\n  tn.classList.toggle('hide', !state.newCount);\n}\n\nfunction bindCard(el) {\n  const id = el.dataset.id;\n  const item = () => state.items.find((i) => i.id === id);\n  const star = $('.star', el); if (star) star.onclick = async (e) => {\n    e.stopPropagation();\n    const it = item(); if (!it) return;\n    const pinned = !it.pinned;\n    star.classList.toggle('on', pinned);\n    star.querySelector('svg').setAttribute('fill', pinned ? 'currentColor' : 'none');\n    el.classList.toggle('pinned', pinned);\n    try {\n      const r = await api('/api/pin', { method: 'POST', body: { id, pinned } });\n      it.pinned = pinned;\n      state.boot.counts.pinned = Math.max(0, (state.boot.counts.pinned || 0) + (pinned ? 1 : -1));\n      toast(pinned ? '\u2605 Saved forever \u00b7 now tracking this subject' : 'Unsaved');\n      if (pinned) { await refreshSubjects(); }\n      renderHero(); renderSaved();\n    } catch (err) { toast('Could not save: ' + err.message); }\n  };\n  const del = $('.del', el); if (del) del.onclick = async (e) => {\n    e.stopPropagation();\n    el.style.transition = 'opacity .2s, transform .2s';\n    el.style.opacity = 0; el.style.transform = 'translateX(-24px)';\n    try { await api('/api/delete', { method: 'POST', body: { id } }); } catch (err) { toast(err.message); }\n    setTimeout(() => { state.items = state.items.filter((i) => i.id !== id); el.remove(); renderHero(); }, 190);\n  };\n  const open = $('.act-open', el); if (open) open.onclick = (e) => {\n    e.stopPropagation();\n    const it = item(); if (!it) return;\n    window.open(it.url, '_blank', 'noopener');\n    if (it.isNew) { it.isNew = false; el.classList.remove('new'); }\n  };\n  const sum = $('.act-sum', el); if (sum) sum.onclick = async (e) => {\n    e.stopPropagation();\n    sum.textContent = '\u2026';\n    try {\n      const r = await api('/api/enrich', { method: 'POST', body: { id } });\n      if (r.ok) { const it = item(); it.summary = r.item.summary; it.summarySource = r.item.summarySource; toast('Summary added'); refreshVisible(); }\n      else { toast('No extra detail available'); sum.textContent = '\ud83d\udcdd'; }\n    } catch (err) { toast(err.message); sum.textContent = '\ud83d\udcdd'; }\n  };\n  el.onclick = () => { if (open) open.click(); };\n}\n\nfunction refreshVisible() { renderFeed(); if (state.view === 'saved') renderSaved(); }\n\n/* ------------------------------ search ------------------------------ */\n$('#btnSearch').onclick = async function () {\n  if (state.searching) return;\n  state.searching = true;\n  this.disabled = true;\n  $('#btnSearchLabel').textContent = 'Scanning\u2026';\n  $('#progress').classList.add('on');\n  $('#progressPhase').textContent = 'Reaching every source\u2026';\n  try {\n    await api('/api/search', { method: 'POST', body: {} });\n    pollProgress();\n  } catch (e) {\n    toast(e.message);\n    endSearch();\n  }\n};\n\nfunction endSearch() {\n  state.searching = false;\n  $('#btnSearch').disabled = false;\n  $('#btnSearchLabel').textContent = 'Search now';\n  $('#progress').classList.remove('on');\n}\n\nasync function pollProgress(resuming) {\n  let guard = 0;\n  const tick = async () => {\n    guard++;\n    try {\n      const p = await api('/api/progress');\n      const pr = p.progress || {};\n      if (pr.phase && pr.phase !== 'idle') {\n        $('#progressPhase').textContent = pr.message || 'Working\u2026';\n        $('#progressCount').textContent = pr.total ? `${Math.min(pr.done, pr.total)}/${pr.total}` : '';\n      }\n      if (p.running) { setTimeout(tick, 1000); return; }\n      // finished\n      const b = await api('/api/bootstrap');\n      state.boot = b;\n      const st = b.lastSearchStats;\n      if (st) {\n        state.digest = st.digest || LS.get('digest:' + st.at, null);\n        if (st.digest) LS.set('digest:' + st.at, st.digest);\n        toast(`Sweep done \u00b7 ${st.added} new, ${st.updated} updated \u00b7 ${st.queries} sources checked`, 4200);\n      }\n      endSearch();\n      await loadFeed();\n      renderFilters(); renderSaved(); updateHeaderLine();\n      if (resuming) toast('A sweep was already running \u2014 refreshed.', 2200);\n    } catch (e) {\n      if (guard < 5) { setTimeout(tick, 1500); } else { endSearch(); toast('Lost contact with the radar'); }\n    }\n  };\n  tick();\n}\n\n$('#btnNewOnly').onclick = () => {\n  state.filter.onlyNew = !state.filter.onlyNew;\n  LS.set('onlyNew', state.filter.onlyNew);\n  renderFilters(); loadFeed();\n};\n\n/* ------------------------------ saved view ------------------------------ */\nasync function refreshSubjects() {\n  try {\n    const r = await api('/api/subjects');\n    state.boot.subjects = r.subjects;\n  } catch (e) {}\n}\n\nasync function renderSaved() {\n  const [savedData, subj] = await Promise.all([\n    api('/api/items?saved=1&limit=300&windowDays=all').catch(() => ({ items: [] })),\n    api('/api/subjects').catch(() => ({ subjects: state.boot.subjects || [] }))\n  ]);\n  const saved = savedData.items;\n  const subjects = subj.subjects || [];\n  $('#savedCount').textContent = `${saved.length} saved`;\n  const st = $('#tabSavedCount');\n  st.textContent = saved.length || '';\n  st.classList.toggle('hide', !saved.length);\n\n  $('#subjects').innerHTML = subjects.length ? subjects.map((s) => `\n    <div class=\"card subj\">\n      <div class=\"card-head\"><span class=\"pill update\">tracking</span><span class=\"meta\">${s.followUpCount || 0} follow-up${(s.followUpCount || 0) === 1 ? '' : 's'} in feed${s.lastSearchAt ? ' \u00b7 checked ' + timeAgo(s.lastSearchAt) : ''}</span></div>\n      <div class=\"sname\">${esc(s.label)}</div>\n      <div class=\"smeta\">${esc(s.seedTitle || '')}</div>\n      <div class=\"card-foot\">\n        <span class=\"tag topic\">${esc((state.boot.topics.find((t) => t.id === s.topicId) || {}).name || 'general')}</span>\n        <span class=\"meta\">since ${stampDate(s.createdAt)}</span>\n        <div class=\"card-actions\">\n          <button class=\"act del\" data-unsubj=\"${s.id}\" title=\"Stop tracking\">\n            <svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M5 12h14\"/></svg>\n          </button>\n        </div>\n      </div>\n    </div>`).join('') : `<div class=\"empty\" style=\"padding:22px\"><p>No standing subjects yet. Star a headline and the radar starts hunting for follow-ups.</p></div>`;\n\n  $$('#subjects [data-unsubj]').forEach((b) => b.onclick = async () => {\n    await api('/api/subjects/' + b.dataset.unsubj, { method: 'POST', body: { remove: true } });\n    toast('Stopped tracking'); renderSaved();\n  });\n\n  $('#savedFeed').innerHTML = saved.length\n    ? saved.map(cardHTML).join('')\n    : `<div class=\"empty\" style=\"padding:22px\"><p>Nothing starred yet.</p></div>`;\n  $$('#savedFeed .card[data-id]').forEach((el) => {\n    el.dataset.backup = idOf(el);\n    bindCardIn(el, saved);\n  });\n}\nfunction idOf(el) { return el.dataset.id; }\nfunction bindCardIn(el, list) {\n  const id = el.dataset.id;\n  const holder = state.items;\n  state.items = list;\n  bindCard(el);\n  state.items = holder;\n}\n\n/* ------------------------------ artists view ------------------------------ */\nfunction renderArtists() {\n  const b = state.boot;\n  $('#artistList').innerHTML = b.artists.map((a) => {\n    const on = (a.members || []).filter((m) => m.enabled !== false).length;\n    return `<div class=\"group\">\n      <div class=\"group-head\">\n        <span class=\"dot-color\" style=\"background:${a.color}\"></span>\n        <div>\n          <div class=\"gname\">${esc(a.name)}</div>\n          <div class=\"gaka\">${esc(a.aka || '')}${a.source === 'user' ? ' \u00b7 added by you' : ''}</div>\n        </div>\n        <span class=\"gcount\">${on}/${(a.members || []).length} members</span>\n        <div class=\"switch ${a.enabled !== false ? 'on' : ''}\" data-group-toggle=\"${a.id}\"></div>\n      </div>\n      <div class=\"members\">\n        ${(a.members || []).map((m) => `\n          <div class=\"mrow\">\n            <div>\n              <div class=\"mname\">${esc(m.name)}</div>\n              <div class=\"maka\">${esc(m.aka || '')}</div>\n            </div>\n            <div class=\"spacer\"></div>\n            <div class=\"switch ${m.enabled !== false ? 'on' : ''}\" data-member-toggle=\"${a.id}:${m.id}\"></div>\n          </div>`).join('')}\n        <div class=\"mrow\">\n          <button class=\"btn-sm\" data-addmember=\"${a.id}\">+ Add member</button>\n          <div class=\"spacer\"></div>\n          <button class=\"btn-sm danger\" data-delartist=\"${a.id}\">Remove</button>\n        </div>\n      </div>\n    </div>`;\n  }).join('');\n\n  $$('[data-group-toggle]').forEach((el) => el.onclick = async () => {\n    const a = state.boot.artists.find((x) => x.id === el.dataset.groupToggle);\n    a.enabled = a.enabled === false;\n    el.classList.toggle('on', a.enabled !== false);\n    await api('/api/artists', { method: 'POST', body: { action: 'update', id: a.id, enabled: a.enabled } });\n  });\n  $$('[data-member-toggle]').forEach((el) => el.onclick = async () => {\n    const [aid, mid] = el.dataset.memberToggle.split(':');\n    const a = state.boot.artists.find((x) => x.id === aid);\n    const m = a.members.find((x) => x.id === mid);\n    m.enabled = m.enabled === false;\n    el.classList.toggle('on', m.enabled !== false);\n    await api('/api/artists', { method: 'POST', body: { action: 'toggle-member', artistId: aid, memberId: mid, enabled: m.enabled } });\n  });\n  $$('[data-addmember]').forEach((el) => el.onclick = () => openMemberSheet(el.dataset.addmember));\n  $$('[data-delartist]').forEach((el) => el.onclick = async () => {\n    if (!confirm('Remove this artist and its stored items?')) return;\n    await api('/api/artists', { method: 'POST', body: { action: 'delete', id: el.dataset.delartist } });\n    const b2 = await api('/api/bootstrap'); state.boot = b2;\n    renderArtists(); renderFilters(); renderOfficial(); loadFeed();\n    toast('Artist removed');\n  });\n\n  renderOfficial();\n}\n\nfunction renderOfficial() {\n  const b = state.boot;\n  $('#officialList').innerHTML = b.artists.map((a) => {\n    const off = (b.official || {})[a.id] || { youtube: [], sites: [], instagram: [] };\n    return `<div class=\"group\">\n      <div class=\"group-head\">\n        <span class=\"dot-color\" style=\"background:${a.color}\"></span>\n        <div><div class=\"gname\">${esc(a.name)}</div><div class=\"gaka\">${(off.youtube || []).length} channel(s) \u00b7 ${(off.sites || []).length} site(s)</div></div>\n        <div class=\"spacer\"></div>\n        <button class=\"btn-sm\" data-edit-off=\"${a.id}\">Edit</button>\n      </div>\n      <div class=\"members\">\n        ${(off.youtube || []).map((y) => `<div class=\"mrow\"><div><div class=\"mname\">\u25b6 ${esc(y.name)}</div><div class=\"maka\">${esc(y.id)}</div></div></div>`).join('')}\n        ${(off.sites || []).map((s) => `<div class=\"mrow\"><div><div class=\"mname\">\ud83c\udf10 ${esc(s.name)}</div><div class=\"maka\">${esc(s.url)}</div></div></div>`).join('')}\n        ${!(off.youtube || []).length && !(off.sites || []).length ? '<div class=\"mrow\"><div class=\"maka\">No channels yet \u2014 tap Edit to add the official YouTube channel or website.</div></div>' : ''}\n      </div>\n    </div>`;\n  }).join('');\n  $$('[data-edit-off]').forEach((el) => el.onclick = () => openOfficialSheet(el.dataset.editOff));\n}\n\n$('#btnAddArtist').onclick = () => openArtistSheet();\n\n/* ------------------------------ sheets ------------------------------ */\nfunction openSheet(html) {\n  $('#sheetPanel').innerHTML = html;\n  $('#sheet').classList.add('on');\n  $$('#sheet [data-close]').forEach((el) => el.onclick = closeSheet);\n}\nfunction closeSheet() { $('#sheet').classList.remove('on'); }\n\nfunction openArtistSheet() {\n  openSheet(`\n    <h2>Add an artist</h2>\n    <div class=\"sheet-sub\">Groups and soloists both work. Add Korean/Chinese/Japanese names so the foreign-language search hits.</div>\n    <div class=\"field\"><label>Name</label><input class=\"inp\" id=\"naName\" placeholder=\"e.g. aespa\"></div>\n    <div class=\"field\"><label>Also known as (comma separated)</label><input class=\"inp\" id=\"naAlias\" placeholder=\"\uc5d0\uc2a4\ud30c, \u30a8\u30b9\u30d1\"></div>\n    <div class=\"field\"><label>Search terms (comma separated)</label><input class=\"inp\" id=\"naTerms\" placeholder=\"aespa, \uc5d0\uc2a4\ud30c\"></div>\n    <div class=\"field\"><label>Official YouTube channel ID (optional)</label><input class=\"inp\" id=\"naYt\" placeholder=\"UCxxxxxxxxxxxxxxxxxxxxxx\"></div>\n    <div class=\"grid2\" style=\"margin-top:14px\">\n      <button class=\"btn-sm\" data-close>Cancel</button>\n      <button class=\"btn-sm primary\" id=\"naSave\">Add to roster</button>\n    </div>`);\n  $('#naSave').onclick = async () => {\n    const name = $('#naName').value.trim();\n    if (!name) return toast('Name required');\n    const split = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);\n    try {\n      await api('/api/artists', {\n        method: 'POST',\n        body: {\n          action: 'add', name,\n          aliases: [name.toLowerCase(), ...split($('#naAlias').value).map((s) => s.toLowerCase())],\n          terms: [$('#naTerms').value ? null : name, ...split($('#naTerms').value)].filter(Boolean),\n          youtube: $('#naYt').value.trim() || null\n        }\n      });\n      state.boot = await api('/api/bootstrap');\n      closeSheet(); renderArtists(); renderFilters(); toast(name + ' added \u2014 run a search');\n    } catch (e) { toast(e.message); }\n  };\n}\n\nfunction openMemberSheet(artistId) {\n  const a = state.boot.artists.find((x) => x.id === artistId);\n  openSheet(`\n    <h2>Add a member to ${esc(a.name)}</h2>\n    <div class=\"sheet-sub\">Members are searched individually \u2014 great for solo news.</div>\n    <div class=\"field\"><label>Name</label><input class=\"inp\" id=\"nmName\" placeholder=\"e.g. Winter\"></div>\n    <div class=\"field\"><label>Native name / nicknames</label><input class=\"inp\" id=\"nmAlias\" placeholder=\"\uc708\ud130, \u51ac\"></div>\n    <div class=\"grid2\" style=\"margin-top:14px\">\n      <button class=\"btn-sm\" data-close>Cancel</button>\n      <button class=\"btn-sm primary\" id=\"nmSave\">Add member</button>\n    </div>`);\n  $('#nmSave').onclick = async () => {\n    const name = $('#nmName').value.trim();\n    if (!name) return toast('Name required');\n    const aliases = $('#nmAlias').value.split(',').map((s) => s.trim()).filter(Boolean);\n    await api('/api/artists', { method: 'POST', body: { action: 'add-member', artistId, name, aliases: [name.toLowerCase(), ...aliases] } });\n    state.boot = await api('/api/bootstrap');\n    closeSheet(); renderArtists(); toast(name + ' added');\n  };\n}\n\nfunction openOfficialSheet(artistId) {\n  const a = state.boot.artists.find((x) => x.id === artistId);\n  const off = state.boot.official[artistId] || { youtube: [], sites: [] };\n  openSheet(`\n    <h2>${esc(a.name)} \u2014 official sources</h2>\n    <div class=\"sheet-sub\">YouTube uploads and announcement pages are scanned on every sweep.</div>\n    <div class=\"field\"><label>Add YouTube channel</label>\n      <input class=\"inp\" id=\"ofYt\" placeholder=\"@handle or UC\u2026 channel ID\">\n      <div class=\"note\" style=\"margin-top:6px\">Paste the channel ID (UC\u2026) for best results.</div>\n    </div>\n    <div class=\"field\"><label>Add website / Weverse page</label><input class=\"inp\" id=\"ofSite\" placeholder=\"https://weverse.io/aespa/feed\"></div>\n    <div class=\"grid2\"><button class=\"btn-sm\" id=\"ofAddYt\">Add channel</button><button class=\"btn-sm\" id=\"ofAddSite\">Add site</button></div>\n    <div style=\"margin-top:16px\">\n      ${(off.youtube || []).map((y) => `<div class=\"row\"><div><div class=\"lab\">\u25b6 ${esc(y.name)}</div><div class=\"descr\">${esc(y.id)}</div></div><div class=\"spacer\"></div><button class=\"btn-sm danger\" data-rm-yt=\"${esc(y.id)}\">\u2715</button></div>`).join('')}\n      ${(off.sites || []).map((s) => `<div class=\"row\"><div><div class=\"lab\">\ud83c\udf10 ${esc(s.name)}</div><div class=\"descr\">${esc(s.url)}</div></div><div class=\"spacer\"></div><button class=\"btn-sm danger\" data-rm-site=\"${esc(s.url)}\">\u2715</button></div>`).join('')}\n    </div>\n    <button class=\"btn-sm primary\" style=\"width:100%;margin-top:16px\" data-close>Done</button>`);\n\n  $('#ofAddYt').onclick = async () => {\n    const input = $('#ofYt').value.trim();\n    if (!input) return;\n    await api('/api/official', { method: 'POST', body: { artistId, youtubeAdd: { input } } });\n    state.boot = await api('/api/bootstrap'); openOfficialSheet(artistId); renderOfficial(); toast('Channel added');\n  };\n  $('#ofAddSite').onclick = async () => {\n    const url = $('#ofSite').value.trim();\n    if (!url) return;\n    await api('/api/official', { method: 'POST', body: { artistId, siteAdd: { url } } });\n    state.boot = await api('/api/bootstrap'); openOfficialSheet(artistId); renderOfficial(); toast('Site added');\n  };\n  $$('#sheet [data-rm-yt]').forEach((b) => b.onclick = async () => {\n    await api('/api/official', { method: 'POST', body: { artistId, youtubeRemove: b.dataset.rmYt } });\n    state.boot = await api('/api/bootstrap'); openOfficialSheet(artistId); renderOfficial();\n  });\n  $$('#sheet [data-rm-site]').forEach((b) => b.onclick = async () => {\n    await api('/api/official', { method: 'POST', body: { artistId, siteRemove: b.dataset.rmSite } });\n    state.boot = await api('/api/bootstrap'); openOfficialSheet(artistId); renderOfficial();\n  });\n}\n\n/* ------------------------------ settings view ------------------------------ */\nfunction renderSettings() {\n  const b = state.boot;\n  const s = b.settings;\n  const onLocales = new Set(s.locales || []);\n  const onStores = new Set(b.stores.filter((x) => (s.watchStores || []).includes(x.id)).map((x) => x.id));\n  const onTopics = new Set(s.enabledTopics || []);\n\n  $('#settings').innerHTML = `\n  <div class=\"group\">\n    <div class=\"group-head\"><div class=\"gname\">Search window & retention</div></div>\n    <div class=\"row\"><div><div class=\"lab\">Default window</div><div class=\"descr\">How far back a sweep reaches. Change it any time from the chips at the top.</div></div>\n      <div class=\"spacer\"></div>\n      <select class=\"f-select\" id=\"setWindow\">${WINDOWS.map((w) => `<option value=\"${w.days}\" ${Number(s.windowDays) === w.days ? 'selected' : ''}>${w.label}</option>`).join('')}</select>\n    </div>\n    <div class=\"row\"><div><div class=\"lab\">Keep headlines for</div><div class=\"descr\">Unstarred items auto-delete after this. Starred ones are permanent.</div></div>\n      <div class=\"spacer\"></div>\n      <select class=\"f-select\" id=\"setRetention\">${[1, 7, 14, 30, 60, 90].map((d) => `<option value=\"${d}\" ${Number(s.retentionDays) === d ? 'selected' : ''}>${d} days</option>`).join('')}</select>\n    </div>\n  </div>\n\n  <div class=\"group\">\n    <div class=\"group-head\"><div class=\"gname\">Languages scanned</div><div class=\"spacer\"></div><span class=\"gcount\">${onLocales.size} on</span></div>\n    <div class=\"topicgrid\" id=\"setLocales\">\n      ${b.locales.map((l) => `<button class=\"f-chip ${onLocales.has(l.id) ? 'on' : ''}\" data-loc=\"${l.id}\">${esc(l.label)}</button>`).join('')}\n    </div>\n    <div class=\"row\"><div><div class=\"lab\">Show headlines in</div><div class=\"descr\">Foreign-language hits are translated to English.</div></div>\n      <div class=\"spacer\"></div>\n      <select class=\"f-select\" id=\"setLangMode\">\n        <option value=\"translate\" ${s.languageMode === 'translate' ? 'selected' : ''}>English</option>\n        <option value=\"original\" ${s.languageMode === 'original' ? 'selected' : ''}>Original</option>\n      </select>\n    </div>\n  </div>\n\n  <div class=\"group\">\n    <div class=\"group-head\"><div class=\"gname\">Summaries</div></div>\n    <div class=\"row\"><div><div class=\"lab\">Mode</div><div class=\"descr\">Automatic uses each article's own description. AI adds a written brief when a key is present.</div></div>\n      <div class=\"spacer\"></div>\n      <select class=\"f-select\" id=\"setSummaryMode\">\n        <option value=\"automatic\" ${s.summaryMode === 'automatic' ? 'selected' : ''}>Automatic</option>\n        <option value=\"ai\" ${s.summaryMode === 'ai' ? 'selected' : ''}>AI only</option>\n        <option value=\"both\" ${s.summaryMode === 'both' ? 'selected' : ''}>Auto + AI</option>\n      </select>\n    </div>\n    <div class=\"pad\">\n      <div class=\"field\"><label>AI API key (optional)</label>\n        <input class=\"inp\" id=\"setAiKey\" type=\"password\" placeholder=\"sk-\u2026 / sk-ant-\u2026\" value=\"${esc(s.aiKey || '')}\"></div>\n      <div class=\"grid2\">\n        <select class=\"f-select\" id=\"setAiProvider\">\n          <option value=\"auto\" ${s.aiProvider === 'auto' ? 'selected' : ''}>Auto-detect</option>\n          <option value=\"openai\" ${s.aiProvider === 'openai' ? 'selected' : ''}>OpenAI</option>\n          <option value=\"anthropic\" ${s.aiProvider === 'anthropic' ? 'selected' : ''}>Anthropic</option>\n        </select>\n        <input class=\"inp\" id=\"setAiModel\" placeholder=\"model (optional)\" value=\"${esc(s.aiModel || '')}\">\n      </div>\n      <div class=\"note\" style=\"margin-top:8px\">Stored on your server only. Without a key the radar still writes summaries from publisher deks.</div>\n    </div>\n  </div>\n\n  <div class=\"group\">\n    <div class=\"group-head\"><div class=\"gname\">Stores watched</div><div class=\"spacer\"></div><span class=\"gcount\">merch & albums</span></div>\n    <div class=\"topicgrid\" id=\"setStores\">\n      ${b.stores.map((st) => `<button class=\"f-chip ${onStores.has(st.id) ? 'on' : ''}\" data-store=\"${st.id}\">${esc(st.name)}</button>`).join('')}\n    </div>\n  </div>\n\n  <div class=\"group\">\n    <div class=\"group-head\"><div class=\"gname\">Labels & companies</div><div class=\"spacer\"></div><span class=\"gcount\">new groups \u00b7 tours \u00b7 merch</span></div>\n    <div class=\"topicgrid\" id=\"setCompanies\">\n      ${b.companies.map((c) => `<button class=\"f-chip ${(s.companies || b.companies.map(x=>x.id)).includes(c.id) ? 'on' : ''}\" data-co=\"${c.id}\">${esc(c.name)}</button>`).join('')}\n    </div>\n  </div>\n\n  <div class=\"group\">\n    <div class=\"group-head\"><div class=\"gname\">Topics to hunt</div></div>\n    <div class=\"topicgrid\" id=\"setTopics\">\n      ${b.topics.map((t) => `<button class=\"f-chip ${onTopics.has(t.id) ? 'on' : ''}\" data-topic=\"${t.id}\">${t.icon} ${esc(t.name)}</button>`).join('')}\n    </div>\n  </div>\n\n  <div class=\"group\">\n    <div class=\"group-head\"><div class=\"gname\">Data</div></div>\n    <div class=\"row\"><div><div class=\"lab\">Install on iPhone</div><div class=\"descr\">Safari \u2192 Share \u2192 \u201cAdd to Home Screen\u201d. Runs full-screen like an app.</div></div></div>\n    <div class=\"row\"><div><div class=\"lab\">Export everything</div><div class=\"descr\">JSON of stored headlines + standing subjects.</div></div><div class=\"spacer\"></div><button class=\"btn-sm\" id=\"btnExport\">Export</button></div>\n    <div class=\"row\"><div><div class=\"lab\">Run retention sweep</div><div class=\"descr\">Delete unstarred items past their window now.</div></div><div class=\"spacer\"></div><button class=\"btn-sm\" id=\"btnSweep\">Sweep</button></div>\n    <div class=\"row\"><div><div class=\"lab\">Reset feed</div><div class=\"descr\">Clears headlines & deleted-memory. Roster and settings stay.</div></div><div class=\"spacer\"></div><button class=\"btn-sm danger\" id=\"btnReset\">Reset</button></div>\n    <div class=\"pad note\">Version ${esc(b.app.version)} \u00b7 ${b.counts.total} items stored \u00b7 ${b.artists.length} artists tracked</div>\n  </div>`;\n\n  const save = async (patch, msg) => {\n    await api('/api/settings', { method: 'POST', body: patch });\n    state.boot.settings = { ...state.boot.settings, ...patch };\n    if (msg) toast(msg);\n  };\n\n  $('#setWindow').onchange = async (e) => {\n    state.filter.windowDays = Number(e.target.value);\n    LS.set('windowDays', state.filter.windowDays);\n    renderWindowChips(); await save({ windowDays: state.filter.windowDays }); loadFeed();\n  };\n  $('#setRetention').onchange = (e) => save({ retentionDays: Number(e.target.value) }, 'Retention updated');\n  $('#setLangMode').onchange = (e) => save({ languageMode: e.target.value }, 'Language mode saved');\n  $('#setSummaryMode').onchange = (e) => save({ summaryMode: e.target.value }, 'Summary mode saved');\n  $('#setAiKey').onchange = (e) => save({ aiKey: e.target.value.trim() }, e.target.value.trim() ? 'AI key saved' : 'AI key cleared');\n  $('#setAiProvider').onchange = (e) => save({ aiProvider: e.target.value });\n  $('#setAiModel').onchange = (e) => save({ aiModel: e.target.value.trim() });\n\n  $$('#setLocales [data-loc]').forEach((el) => el.onclick = async () => {\n    el.classList.toggle('on');\n    const ids = $$('#setLocales [data-loc].on').map((x) => x.dataset.loc);\n    await save({ locales: ids });\n  });\n  $$('#setStores [data-store]').forEach((el) => el.onclick = async () => {\n    el.classList.toggle('on');\n    const ids = $$('#setStores [data-store].on').map((x) => x.dataset.store);\n    await save({ watchStores: ids });\n  });\n  $$('#setCompanies [data-co]').forEach((el) => el.onclick = async () => {\n    el.classList.toggle('on');\n    const ids = $$('#setCompanies [data-co].on').map((x) => x.dataset.co);\n    await api('/api/watch', { method: 'POST', body: { companies: ids } });\n    state.boot.settings.companies = ids;\n  });\n  $$('#setTopics [data-topic]').forEach((el) => el.onclick = async () => {\n    el.classList.toggle('on');\n    const ids = $$('#setTopics [data-topic].on').map((x) => x.dataset.topic);\n    await save({ enabledTopics: ids });\n  });\n\n  $('#btnExport').onclick = async () => {\n    const data = await api('/api/export');\n    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });\n    const a = document.createElement('a');\n    a.href = URL.createObjectURL(blob);\n    a.download = `kpop-radar-${new Date().toISOString().slice(0, 10)}.json`;\n    a.click();\n    toast('Export ready');\n  };\n  $('#btnSweep').onclick = async () => {\n    const r = await api('/api/sweep', { method: 'POST' });\n    toast(`${r.removed} expired items removed`);\n    loadFeed();\n  };\n  $('#btnReset').onclick = async () => {\n    if (!confirm('Delete all stored headlines and standing subjects?')) return;\n    await api('/api/reset', { method: 'POST', body: { confirm: 'RESET' } });\n    state.digest = null; state.boot.subjects = [];\n    toast('Feed reset'); loadFeed(); renderSaved();\n  };\n}\n\n/* ------------------------------ tabs ------------------------------ */\nfunction showView(v) {\n  state.view = v;\n  $$('.view').forEach((el) => el.classList.toggle('hide', el.dataset.view !== v));\n  $$('.tab').forEach((el) => el.classList.toggle('on', el.dataset.tab === v));\n  document.body.classList.toggle('compact', v !== 'feed');\n  window.scrollTo({ top: 0, behavior: 'instant' });\n  if (v === 'saved') renderSaved();\n  if (v === 'artists') { renderArtists(); }\n  if (v === 'settings') renderSettings();\n}\n$$('.tab').forEach((t) => t.onclick = () => showView(t.dataset.tab));\n$('#btnSavedQuick').onclick = () => showView('saved');\n$('#btnSettingsQuick').onclick = () => showView('settings');\n\n/* mark \"new\" as seen when the user opens a card is handled per-card. */\ndocument.addEventListener('visibilitychange', () => {\n  if (!document.hidden) updateHeaderLine();\n});\n\nboot();\n"},"/icon-180.png":{"type":"image/png","b64":true,"body":"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"},"/icon-192.png":{"type":"image/png","b64":true,"body":"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"},"/icon-512.png":{"type":"image/png","b64":true,"body":"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"},"/icon.svg":{"type":"image/svg+xml","b64":false,"body":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\">\n  <defs>\n    <linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\n      <stop offset=\"0\" stop-color=\"#ff2d8f\"/><stop offset=\"1\" stop-color=\"#8a5cff\"/>\n    </linearGradient>\n    <radialGradient id=\"glow\" cx=\"0.3\" cy=\"0.1\" r=\"0.9\">\n      <stop offset=\"0\" stop-color=\"#ffffff\" stop-opacity=\"0.28\"/><stop offset=\"1\" stop-color=\"#ffffff\" stop-opacity=\"0\"/>\n    </radialGradient>\n  </defs>\n  <rect width=\"512\" height=\"512\" rx=\"112\" fill=\"#07070d\"/>\n  <rect width=\"512\" height=\"512\" rx=\"112\" fill=\"url(#glow)\"/>\n  <circle cx=\"256\" cy=\"256\" r=\"150\" fill=\"none\" stroke=\"url(#g)\" stroke-width=\"16\" opacity=\"0.35\"/>\n  <circle cx=\"256\" cy=\"256\" r=\"96\" fill=\"none\" stroke=\"url(#g)\" stroke-width=\"16\" opacity=\"0.6\"/>\n  <circle cx=\"256\" cy=\"256\" r=\"30\" fill=\"url(#g)\"/>\n  <path d=\"M256 62 L294 218 L256 256 L218 218 Z\" fill=\"url(#g)\" opacity=\"0.95\"/>\n  <path d=\"M150 330 A 150 150 0 0 1 92 256\" fill=\"none\" stroke=\"#38b6ff\" stroke-width=\"14\" stroke-linecap=\"round\" opacity=\"0.9\"/>\n  <circle cx=\"360\" cy=\"330\" r=\"16\" fill=\"#ff2d8f\"/>\n  <circle cx=\"150\" cy=\"350\" r=\"10\" fill=\"#38b6ff\"/>\n</svg>\n"},"/index.html":{"type":"text/html; charset=utf-8","b64":false,"body":"<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1\">\n<meta name=\"theme-color\" content=\"#07070d\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">\n<meta name=\"apple-mobile-web-app-title\" content=\"K-pop Radar\">\n<meta name=\"description\" content=\"K-pop news, official updates and merch drops for the groups you follow \u2014 in any language, in English.\">\n<link rel=\"manifest\" href=\"/manifest.webmanifest\">\n<link rel=\"apple-touch-icon\" href=\"/icon-180.png\">\n<link rel=\"icon\" href=\"/icon.svg\" type=\"image/svg+xml\">\n<link rel=\"stylesheet\" href=\"/styles.css\">\n<title>K-pop Radar</title>\n</head>\n<body>\n\n<header class=\"top\">\n  <div class=\"brand\">\n    <div class=\"logo\">\n      <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n        <path d=\"M3 12a9 9 0 1 0 3-6.7\"/><path d=\"M3 4v4.5h4.5\"/><circle cx=\"12\" cy=\"12\" r=\"2.4\" fill=\"#fff\" stroke=\"none\"/>\n      </svg>\n    </div>\n    <div>\n      <h1>K-POP <span>RADAR</span></h1>\n      <div class=\"sub\" id=\"lastSweepLine\">never scanned \u00b7 tap search</div>\n    </div>\n    <div class=\"top-actions\">\n      <button class=\"icon-btn\" id=\"btnSavedQuick\" title=\"Saved\">\n        <svg width=\"19\" height=\"19\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\"><path d=\"M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z\"/></svg>\n      </button>\n      <button class=\"icon-btn\" id=\"btnSettingsQuick\" title=\"Settings\">\n        <svg width=\"19\" height=\"19\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2.6 14H2a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6V4a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 5.7l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z\"/></svg>\n      </button>\n    </div>\n  </div>\n\n  <!-- time window -->\n  <div class=\"chips\" id=\"windowChips\"></div>\n\n  <div class=\"searchrow\">\n    <button class=\"btn-primary\" id=\"btnSearch\">\n      <svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M20 20l-3.6-3.6\"/></svg>\n      <span id=\"btnSearchLabel\">Search now</span>\n    </button>\n    <button class=\"btn-ghost\" id=\"btnNewOnly\" title=\"New only\">New</button>\n  </div>\n\n  <div class=\"progress\" id=\"progress\">\n    <div class=\"progress-bar\"><i></i></div>\n    <div class=\"progress-txt\"><span id=\"progressPhase\">Scanning the internet\u2026</span><span id=\"progressCount\"></span></div>\n  </div>\n</header>\n\n<div class=\"filters\" id=\"filterRow\"></div>\n\n<main>\n  <section data-view=\"feed\" class=\"view\">\n    <div class=\"hero\" id=\"hero\"></div>\n    <div id=\"feed\"></div>\n  </section>\n\n  <section data-view=\"saved\" class=\"view hide\">\n    <div class=\"section-head\"><h2>Saved forever</h2><span class=\"count\" id=\"savedCount\"></span></div>\n    <div class=\"note\" style=\"margin-bottom:12px\">Starred headlines never expire and each one registers a <b>standing subject</b> \u2014 the radar keeps looking for follow-ups to it on every search.</div>\n    <div class=\"section-head\" style=\"margin-top:16px\"><h2>Standing subjects</h2></div>\n    <div id=\"subjects\"></div>\n    <div class=\"section-head\" style=\"margin-top:16px\"><h2>Starred headlines</h2></div>\n    <div id=\"savedFeed\"></div>\n  </section>\n\n  <section data-view=\"artists\" class=\"view hide\">\n    <div class=\"section-head\"><h2>Your roster</h2><button class=\"link-btn spacer\" id=\"btnAddArtist\">+ Add artist</button></div>\n    <div id=\"artistList\"></div>\n    <div class=\"section-head\" style=\"margin-top:18px\"><h2>Official channels</h2></div>\n    <div class=\"note\" style=\"margin-bottom:10px\">Uploads and announcement pages are scanned on every search. Tap a group to edit its channels.</div>\n    <div id=\"officialList\"></div>\n  </section>\n\n  <section data-view=\"settings\" class=\"view hide\">\n    <div class=\"section-head\"><h2>Radar settings</h2></div>\n    <div id=\"settings\"></div>\n  </section>\n</main>\n\n<nav class=\"tabbar\">\n  <button class=\"tab on\" data-tab=\"feed\">\n    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 6h16M4 12h16M4 18h10\"/></svg>\n    <span>Feed</span><i class=\"tn hide\" id=\"tabNewCount\"></i>\n  </button>\n  <button class=\"tab\" data-tab=\"saved\">\n    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\"><path d=\"M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z\"/></svg>\n    <span>Saved</span><i class=\"tn hide\" id=\"tabSavedCount\"></i>\n  </button>\n  <button class=\"tab\" data-tab=\"artists\">\n    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"9\" cy=\"8\" r=\"3.2\"/><path d=\"M3.5 20c0-3.3 2.5-5.6 5.5-5.6s5.5 2.3 5.5 5.6\"/><path d=\"M16.5 5.4a3.2 3.2 0 0 1 0 6.2M17.5 14.6c2 .6 3.5 2.6 3.5 5.4\"/></svg>\n    <span>Artists</span>\n  </button>\n  <button class=\"tab\" data-tab=\"settings\">\n    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><path d=\"M4 7h10M18 7h2M4 17h4M12 17h8\"/><circle cx=\"16\" cy=\"7\" r=\"2.2\"/><circle cx=\"10\" cy=\"17\" r=\"2.2\"/></svg>\n    <span>Settings</span>\n  </button>\n</nav>\n\n<div class=\"sheet\" id=\"sheet\">\n  <div class=\"scrim\" data-close></div>\n  <div class=\"panel\" id=\"sheetPanel\"></div>\n</div>\n\n<div id=\"toast\"></div>\n\n<script src=\"/app.js\"></script>\n<script>\n  if ('serviceWorker' in navigator) {\n    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}));\n  }\n</script>\n</body>\n</html>\n"},"/manifest.webmanifest":{"type":"application/manifest+json","b64":false,"body":"{\n  \"name\": \"K-pop Radar\",\n  \"short_name\": \"K-pop Radar\",\n  \"description\": \"K-pop news, official updates and merch drops for the groups you follow \u2014 every language, in English.\",\n  \"start_url\": \"/\",\n  \"scope\": \"/\",\n  \"display\": \"standalone\",\n  \"orientation\": \"portrait\",\n  \"background_color\": \"#07070d\",\n  \"theme_color\": \"#07070d\",\n  \"categories\": [\"news\", \"entertainment\"],\n  \"icons\": [\n    { \"src\": \"/icon-192.png\", \"sizes\": \"192x192\", \"type\": \"image/png\", \"purpose\": \"any\" },\n    { \"src\": \"/icon-512.png\", \"sizes\": \"512x512\", \"type\": \"image/png\", \"purpose\": \"any\" },\n    { \"src\": \"/icon-180.png\", \"sizes\": \"180x180\", \"type\": \"image/png\" }\n  ]\n}\n"},"/styles.css":{"type":"text/css; charset=utf-8","b64":false,"body":":root{\n  --bg:#07070d;\n  --bg2:#0d0d18;\n  --card:rgba(255,255,255,.045);\n  --card2:rgba(255,255,255,.075);\n  --line:rgba(255,255,255,.09);\n  --line2:rgba(255,255,255,.16);\n  --txt:#f3f2f8;\n  --muted:#9d9bb0;\n  --dim:#6f6d82;\n  --pink:#ff2d8f;\n  --violet:#8a5cff;\n  --blue:#38b6ff;\n  --green:#2fe08a;\n  --amber:#ffc247;\n  --red:#ff5470;\n  --grad:linear-gradient(135deg,#ff2d8f 0%,#8a5cff 100%);\n  --grad2:linear-gradient(135deg,#38b6ff 0%,#8a5cff 100%);\n  --radius:18px;\n  --tab-h:62px;\n  --safe-b:env(safe-area-inset-bottom,0px);\n  --safe-t:env(safe-area-inset-top,0px);\n}\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\nhtml,body{margin:0;padding:0}\nbody{\n  background:\n    radial-gradient(1100px 620px at 15% -8%,rgba(255,45,143,.20),transparent 62%),\n    radial-gradient(900px 560px at 92% 4%,rgba(138,92,255,.20),transparent 60%),\n    radial-gradient(700px 500px at 50% 110%,rgba(56,182,255,.10),transparent 65%),\n    var(--bg);\n  color:var(--txt);\n  font:16px/1.45 -apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif;\n  min-height:100vh;\n  overscroll-behavior-y:none;\n  -webkit-font-smoothing:antialiased;\n  padding-bottom:calc(var(--tab-h) + var(--safe-b) + 14px);\n}\nbutton,input,select,textarea{font:inherit;color:inherit}\nbutton{border:0;background:none;cursor:pointer}\na{color:inherit;text-decoration:none}\n.hide{display:none!important}\nbody.compact .chips,body.compact .searchrow,body.compact .progress,body.compact .filters{display:none}\nbody.compact .top{padding-bottom:10px}\n\n/* ---------------- header ---------------- */\n.top{\n  position:sticky;top:0;z-index:40;\n  padding:calc(var(--safe-t) + 12px) 16px 10px;\n  background:linear-gradient(180deg,rgba(7,7,13,.96) 55%,rgba(7,7,13,.72) 100%);\n  backdrop-filter:blur(22px) saturate(1.4);\n  -webkit-backdrop-filter:blur(22px) saturate(1.4);\n  border-bottom:1px solid var(--line);\n}\n.brand{display:flex;align-items:center;gap:10px}\n.logo{width:34px;height:34px;flex:0 0 34px;border-radius:11px;background:var(--grad);\n  display:grid;place-items:center;box-shadow:0 6px 22px rgba(255,45,143,.36);position:relative;overflow:hidden}\n.logo svg{width:20px;height:20px}\n.brand h1{font-size:18px;font-weight:800;letter-spacing:.24em;margin:0;text-transform:uppercase}\n.brand h1 span{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}\n.brand .sub{font-size:11px;color:var(--dim);letter-spacing:.14em;text-transform:uppercase;margin-top:1px}\n.top-actions{margin-left:auto;display:flex;gap:8px;align-items:center}\n.icon-btn{width:38px;height:38px;border-radius:12px;background:var(--card);border:1px solid var(--line);\n  display:grid;place-items:center;color:var(--txt);transition:.16s}\n.icon-btn:active{transform:scale(.94);background:var(--card2)}\n.icon-btn.badge{position:relative}\n.icon-btn .dot{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--pink);\n  box-shadow:0 0 0 3px rgba(255,45,143,.18)}\n\n/* window chips */\n.chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin:12px -16px 0;padding:2px 16px 4px}\n.chips::-webkit-scrollbar{display:none}\n.chip{\n  flex:0 0 auto;padding:7px 13px;border-radius:999px;border:1px solid var(--line);\n  background:rgba(255,255,255,.03);color:var(--muted);font-size:13px;font-weight:600;white-space:nowrap;transition:.15s\n}\n.chip.on{background:var(--grad);border-color:transparent;color:#fff;box-shadow:0 5px 18px rgba(255,45,143,.32)}\n.chip:active{transform:scale(.96)}\n\n.searchrow{display:flex;gap:9px;margin-top:11px}\n.btn-primary{\n  flex:1;display:flex;align-items:center;justify-content:center;gap:9px;\n  padding:13px 16px;border-radius:15px;background:var(--grad);color:#fff;\n  font-weight:800;font-size:15px;letter-spacing:.02em;box-shadow:0 8px 26px rgba(255,45,143,.30);transition:.15s\n}\n.btn-primary:active{transform:scale(.98)}\n.btn-primary:disabled{opacity:.65;box-shadow:none}\n.btn-ghost{padding:13px 15px;border-radius:15px;border:1px solid var(--line);background:var(--card);font-weight:700;font-size:14px;color:var(--txt)}\n.btn-ghost:active{background:var(--card2)}\n\n.progress{margin-top:10px;display:none}\n.progress.on{display:block}\n.progress-bar{height:4px;border-radius:99px;background:rgba(255,255,255,.10);overflow:hidden}\n.progress-bar i{display:block;height:100%;width:22%;border-radius:99px;background:var(--grad);\n  animation:slide 1.15s ease-in-out infinite}\n@keyframes slide{0%{margin-left:-24%}100%{margin-left:100%}}\n.progress-txt{font-size:11.5px;color:var(--muted);margin-top:6px;display:flex;justify-content:space-between;gap:10px}\n.progress-txt b{color:var(--txt);font-weight:600}\n\n/* ---------------- filter row ---------------- */\n.filters{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding:10px 16px 2px;margin:0 -16px}\n.filters::-webkit-scrollbar{display:none}\n.f-chip{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:11px;\n  border:1px solid var(--line);background:rgba(255,255,255,.03);font-size:12.5px;font-weight:600;color:var(--muted)}\n.f-chip.on{background:rgba(138,92,255,.18);border-color:rgba(138,92,255,.5);color:#fff}\n.f-chip .n{font-size:10.5px;color:var(--dim);background:rgba(255,255,255,.07);padding:1px 6px;border-radius:99px}\nselect.f-select{flex:0 0 auto;padding:7px 11px;border-radius:11px;border:1px solid var(--line);\n  background:rgba(255,255,255,.03);font-size:12.5px;font-weight:600;color:var(--muted);-webkit-appearance:none;appearance:none;\n  background-image:linear-gradient(45deg,transparent 50%,var(--dim) 50%),linear-gradient(135deg,var(--dim) 50%,transparent 50%);\n  background-position:calc(100% - 14px) 13px,calc(100% - 9px) 13px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:26px}\n\n/* ---------------- main ---------------- */\nmain{padding:12px 14px 26px;max-width:720px;margin:0 auto}\n.section-head{display:flex;align-items:center;gap:10px;margin:6px 2px 12px}\n.section-head h2{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:700}\n.section-head .count{font-size:12px;color:var(--dim)}\n.section-head .spacer{margin-left:auto}\n.link-btn{font-size:12.5px;font-weight:700;color:var(--violet)}\n\n/* hero stats */\n.hero{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}\n.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 8px;text-align:center}\n.stat b{display:block;font-size:19px;font-weight:800;letter-spacing:-.02em}\n.stat span{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}\n.stat.pink b{color:var(--pink)} .stat.violet b{color:var(--violet)} .stat.blue b{color:var(--blue)} .stat.green b{color:var(--green)}\n\n/* cards */\n.card{\n  position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);\n  padding:13px 13px 10px;margin-bottom:10px;overflow:hidden;transition:.16s;\n  animation:rise .34s cubic-bezier(.2,.8,.3,1) both;\n}\n@keyframes rise{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}\n.card:active{background:var(--card2)}\n.card.pinned{border-color:rgba(255,194,71,.45);background:linear-gradient(180deg,rgba(255,194,71,.10),rgba(255,255,255,.035))}\n.card.new::after{content:\"\";position:absolute;top:0;left:0;width:3px;height:100%;background:var(--grad)}\n.card-head{display:flex;align-items:center;gap:7px;margin-bottom:7px;flex-wrap:wrap}\n.src{font-size:11px;font-weight:700;color:var(--txt);letter-spacing:.02em;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.meta{font-size:11px;color:var(--dim);display:flex;align-items:center;gap:5px}\n.meta .sep{opacity:.5}\n.pill{font-size:9.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;padding:2.5px 7px;border-radius:6px}\n.pill.news{background:rgba(56,182,255,.16);color:#7ad2ff}\n.pill.official{background:rgba(255,45,143,.16);color:#ff8bc0}\n.pill.merch{background:rgba(47,224,138,.16);color:#6ff0b4}\n.pill.label{background:rgba(255,194,71,.16);color:#ffd98a}\n.pill.update{background:rgba(138,92,255,.2);color:#c0a9ff}\n.card h3{font-size:15.5px;line-height:1.33;font-weight:700;margin:0 0 6px;letter-spacing:-.01em}\n.card p{margin:0;font-size:13.2px;line-height:1.45;color:#b8b6c8}\n.card p .ai{font-size:9.5px;font-weight:800;color:var(--violet);letter-spacing:.08em;vertical-align:1px;margin-left:4px}\n.card-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.055)}\n.tag{font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:7px;background:rgba(255,255,255,.06);color:#cfcddb;\n  max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.tag.topic{background:rgba(138,92,255,.14);color:#c3b0ff}\n.tag.more{background:transparent;color:var(--dim);padding-left:2px}\n.card-actions{margin-left:auto;display:flex;gap:4px}\n.act{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;color:var(--dim);transition:.14s}\n.act:active{transform:scale(.9);background:rgba(255,255,255,.08)}\n.act.star.on{color:var(--amber)}\n.act.del:active{color:var(--red)}\n.price{font-size:12px;font-weight:800;color:var(--green);margin-top:4px;display:inline-block}\n.thumb{width:46px;height:46px;border-radius:11px;object-fit:cover;background:rgba(255,255,255,.06);float:right;margin:0 0 6px 10px}\n.priceRow{display:flex;align-items:center;gap:8px;margin-top:6px}\n\n/* empty */\n.empty{text-align:center;padding:44px 20px;color:var(--dim)}\n.empty .big{font-size:34px;margin-bottom:12px}\n.empty h3{color:var(--txt);font-size:16px;margin:0 0 6px;font-weight:700}\n.empty p{font-size:13px;margin:0 auto;max-width:300px;line-height:1.5}\n.empty .btn-primary{max-width:240px;margin:18px auto 0}\n\n/* ---------------- tabs ---------------- */\n.tabbar{\n  position:fixed;left:0;right:0;bottom:0;z-index:50;\n  display:grid;grid-template-columns:repeat(4,1fr);\n  padding:8px 8px calc(8px + var(--safe-b));\n  background:rgba(10,10,18,.93);backdrop-filter:blur(24px) saturate(1.5);\n  -webkit-backdrop-filter:blur(24px) saturate(1.5);\n  border-top:1px solid var(--line);\n}\n.tab{display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px 0;color:var(--dim);font-size:10px;\n  font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:12px;position:relative}\n.tab svg{width:22px;height:22px}\n.tab.on{color:var(--txt)}\n.tab.on svg{color:var(--pink);filter:drop-shadow(0 0 8px rgba(255,45,143,.55))}\n.tab .tn{position:absolute;top:0;right:calc(50% - 22px);min-width:16px;height:16px;border-radius:99px;background:var(--pink);\n  color:#fff;font-size:10px;line-height:16px;padding:0 4px;letter-spacing:0}\n\n/* ---------------- lists: artists / settings ---------------- */\n.group{background:var(--card);border:1px solid var(--line);border-radius:16px;margin-bottom:10px;overflow:hidden}\n.group-head{display:flex;align-items:center;gap:10px;padding:13px 14px}\n.dot-color{width:11px;height:11px;border-radius:4px;flex:0 0 11px}\n.group-head .gname{font-weight:800;font-size:15.5px}\n.group-head .gaka{font-size:11px;color:var(--dim);margin-top:1px}\n.group-head .gcount{margin-left:auto;font-size:11px;color:var(--dim);white-space:nowrap}\n.members{padding:0 14px 6px}\n.mrow{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.05)}\n.mrow .mname{font-size:13.5px;font-weight:600}\n.mrow .maka{font-size:11px;color:var(--dim)}\n.mrow .spacer{margin-left:auto}\n.switch{width:44px;height:26px;border-radius:99px;background:rgba(255,255,255,.12);position:relative;transition:.18s;flex:0 0 44px}\n.switch::after{content:\"\";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.18s}\n.switch.on{background:linear-gradient(135deg,#ff2d8f,#8a5cff)}\n.switch.on::after{left:21px}\n.row{display:flex;align-items:center;gap:12px;padding:13px 14px;border-top:1px solid rgba(255,255,255,.05);font-size:14px}\n.row:first-child{border-top:0}\n.row .lab{font-weight:600}\n.row .descr{font-size:11.5px;color:var(--dim);margin-top:2px;line-height:1.4}\n.row .spacer{margin-left:auto}\n.chk{width:24px;height:24px;border-radius:8px;border:1.5px solid var(--line2);display:grid;place-items:center;flex:0 0 24px;color:transparent}\n.chk.on{background:var(--grad);border-color:transparent;color:#fff}\n.inp{width:100%;padding:12px 13px;border-radius:12px;border:1px solid var(--line);background:rgba(0,0,0,.28);\n  font-size:14px;outline:none;color:var(--txt)}\n.inp:focus{border-color:rgba(255,45,143,.6);box-shadow:0 0 0 3px rgba(255,45,143,.12)}\n.inp::placeholder{color:var(--dim)}\n.pad{padding:13px 14px}\n.grid2{display:grid;grid-template-columns:1fr 1fr;gap:9px}\n.btn-sm{padding:10px 14px;border-radius:11px;background:var(--card2);border:1px solid var(--line);font-weight:700;font-size:13px}\n.btn-sm.primary{background:var(--grad);border-color:transparent}\n.btn-sm.danger{color:var(--red);border-color:rgba(255,84,112,.35)}\n.note{font-size:11.5px;color:var(--dim);line-height:1.5;padding:0 2px}\n.topicgrid{display:flex;flex-wrap:wrap;gap:7px;padding:12px 14px}\n.topicgrid .f-chip{font-size:12px}\n\n/* editor sheet */\n.sheet{position:fixed;inset:0;z-index:70;display:none}\n.sheet.on{display:block}\n.sheet .scrim{position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(3px)}\n.sheet .panel{position:absolute;left:0;right:0;bottom:0;max-height:88vh;overflow-y:auto;\n  background:#12121d;border-top-left-radius:22px;border-top-right-radius:22px;border-top:1px solid var(--line2);\n  padding:16px 16px calc(24px + var(--safe-b));animation:up .26s ease both}\n@keyframes up{from{transform:translateY(100%)}to{transform:none}}\n.sheet h2{font-size:16px;margin:0 0 4px}\n.sheet .sheet-sub{font-size:12px;color:var(--dim);margin-bottom:14px}\n.field{margin-bottom:11px}\n.field label{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin-bottom:6px;font-weight:700}\n\n/* toast */\n#toast{position:fixed;left:50%;bottom:calc(var(--tab-h) + var(--safe-b) + 18px);transform:translateX(-50%) translateY(18px);\n  background:rgba(28,28,42,.98);border:1px solid var(--line2);color:#fff;padding:11px 16px;border-radius:13px;font-size:13px;\n  font-weight:600;opacity:0;pointer-events:none;transition:.24s;z-index:90;max-width:88vw;text-align:center;\n  box-shadow:0 12px 34px rgba(0,0,0,.5)}\n#toast.on{opacity:1;transform:translateX(-50%) translateY(0)}\n\n/* skeletons */\n.sk{height:96px;border-radius:var(--radius);margin-bottom:10px;background:linear-gradient(100deg,rgba(255,255,255,.05) 20%,rgba(255,255,255,.11) 40%,rgba(255,255,255,.05) 60%);\n  background-size:220% 100%;animation:sh 1.3s infinite}\n@keyframes sh{0%{background-position:120% 0}100%{background-position:-40% 0}}\n\n/* subject cards */\n.subj{border-left:2px solid var(--violet)}\n.subj .sname{font-weight:700;font-size:14px}\n.subj .smeta{font-size:11.5px;color:var(--dim);margin-top:2px}\n\n@media (min-width:640px){\n  main{padding:16px 20px 30px}\n  .hero{grid-template-columns:repeat(4,1fr)}\n  .tabbar{max-width:720px;left:50%;transform:translateX(-50%);border-radius:18px 18px 0 0;border:1px solid var(--line)}\n}\n"},"/sw.js":{"type":"application/javascript; charset=utf-8","b64":false,"body":"/* K-pop Radar service worker \u2014 shell cache only (data always live). */\nconst CACHE = 'kpop-radar-v1';\nconst SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon.svg'];\nself.addEventListener('install', (e) => {\n  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));\n});\nself.addEventListener('activate', (e) => {\n  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));\n});\nself.addEventListener('fetch', (e) => {\n  const url = new URL(e.request.url);\n  if (url.pathname.startsWith('/api/')) return;              // never cache API\n  if (e.request.method !== 'GET') return;\n  e.respondWith(\n    fetch(e.request).then((res) => {\n      const copy = res.clone();\n      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});\n      return res;\n    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))\n  );\n});\n"}};


/* ============================ module loader ============================ */
// Bundled app modules live in __KPR_MODULES__; everything else (http, fs,
// path, crypto, zlib, url, https) falls through to Node's real require.
const __KPR_MODULES__ = Object.create(null);
function __kprRequire(id) {
  const key = String(id).replace(/^\.\//, '').replace(/^lib\//, '').replace(/\.js$/, '') + '.js';
  const mod = __KPR_MODULES__[key];
  if (mod) {
    if (!mod.loaded) { mod.loaded = true; mod.fn(mod.exports, mod.require, mod); }
    return mod.exports;
  }
  return require(id);            // real Node core module
}

/* ======================== catalog ======================== */
__KPR_MODULES__["catalog.js"] = { exports: {}, loaded: false, require: __kprRequire, fn: function (exports, require, module) {
/**
 * catalog.js — the K-pop world the app watches.
 * Everything here is editable in-app (Artists tab), this is just the seed.
 */

/* ------------------------------------------------------------------ *
 * Artists
 *   terms: search strings. Group terms cover "group + topic" combos.
 *   brief: one-line context injected into AI prompts + keyword tagging.
 * ------------------------------------------------------------------ */
const ARTISTS = [
  {
    id: 'idle', name: '(G)I-DLE', aka: 'i-dle', type: 'group', color: '#c2185b',
    brief: 'i-dle (formerly (G)I-DLE), 5-member girl group under CUBE Entertainment (Soyeon, Miyeon, Minnie, Yuqi, Shuhua).',
    terms: ['(G)I-DLE', 'i-dle', '아이들', '女娃'],
    aliases: ['(g)i-dle', 'gidle', 'g-idle', 'idle', 'i-dle', '아이들', '여자아이들', '女娃'],
    members: [
      { id: 'soyeon', name: 'Soyeon', aka: '전소연', color: '#c2185b', terms: ['Soyeon (G)I-DLE', '전소연'], aliases: ['soyeon', 'so-yeon', '전소연', '田小娟'] },
      { id: 'miyeon', name: 'Miyeon', aka: '조미연', color: '#c2185b', terms: ['Miyeon (G)I-DLE', '조미연'], aliases: ['miyeon', '조미연', '赵美延'] },
      { id: 'minnie', name: 'Minnie', aka: 'มินนี่', color: '#c2185b', terms: ['Minnie (G)I-DLE', 'มินนี่'], aliases: ['minnie', 'มินนี่', '米妮'] },
      { id: 'yuqi', name: 'Yuqi', aka: '宋雨琦', color: '#c2185b', terms: ['Song Yuqi', '宋雨琦'], aliases: ['yuqi', 'song yuqi', '宋雨琦', '우기'] },
      { id: 'shuhua', name: 'Shuhua', aka: '葉舒華', color: '#c2185b', terms: ['Shuhua (G)I-DLE', '葉舒華'], aliases: ['shuhua', '舒華', '叶舒华', '슈화'] }
    ]
  },
  {
    id: 'itzy', name: 'ITZY', aka: '있지', type: 'group', color: '#e91e63',
    brief: 'ITZY, girl group under JYP Entertainment (Yeji, Lia, Ryujin, Chaeryeong, Yuna).',
    terms: ['ITZY', '있지'], aliases: ['itzy', '있지', '一击'],
    members: [
      { id: 'yeji', name: 'Yeji', aka: '황예지', color: '#e91e63', terms: ['Yeji ITZY', '황예지'], aliases: ['yeji', '예지', '黄礼志'] },
      { id: 'lia', name: 'Lia', aka: '최지수', color: '#e91e63', terms: ['Lia ITZY', '리아 있지'], aliases: ['lia', '리아', '崔智寿'] },
      { id: 'ryujin', name: 'Ryujin', aka: '신류진', color: '#e91e63', terms: ['Ryujin ITZY', '신류진'], aliases: ['ryujin', '류진', '申留真'] },
      { id: 'chaeryeong', name: 'Chaeryeong', aka: '이채령', color: '#e91e63', terms: ['Chaeryeong ITZY', '이채령'], aliases: ['chaeryeong', '채령', '李彩领'] },
      { id: 'yuna', name: 'Yuna', aka: '신유나', color: '#e91e63', terms: ['Yuna ITZY', '신유나'], aliases: ['yuna', '유나', '申有娜'] }
    ]
  },
  {
    id: 'lesserafim', name: 'LE SSERAFIM', aka: '르세라핌', type: 'group', color: '#0b7bc4',
    brief: 'LE SSERAFIM, girl group under SOURCE MUSIC / HYBE (Sakura, Chaewon, Yunjin, Kazuha, Eunchae).',
    terms: ['LE SSERAFIM', '르세라핌'], aliases: ['le sserafim', 'lesserafim', '르세라핌', 'lesserafim'],
    members: [
      { id: 'sakura', name: 'Sakura', aka: '宮脇咲良', color: '#0b7bc4', terms: ['Sakura LE SSERAFIM', '宮脇咲良'], aliases: ['sakura', '사쿠라', '宮脇咲良', '宫胁咲良'] },
      { id: 'chaewon', name: 'Kim Chaewon', aka: '김채원', color: '#0b7bc4', terms: ['Kim Chaewon LE SSERAFIM', '김채원'], aliases: ['chaewon', '채원', '金采源'] },
      { id: 'yunjin', name: 'Huh Yunjin', aka: '허윤진', color: '#0b7bc4', terms: ['Huh Yunjin', '허윤진'], aliases: ['yunjin', '윤진', '許允眞', '许允真'] },
      { id: 'kazuha', name: 'Kazuha', aka: '中村一葉', color: '#0b7bc4', terms: ['Kazuha LE SSERAFIM', '카즈하'], aliases: ['kazuha', '카즈하', '中村一叶'] },
      { id: 'eunchae', name: 'Hong Eunchae', aka: '홍은채', color: '#0b7bc4', terms: ['Hong Eunchae', '홍은채'], aliases: ['eunchae', '은채', '洪恩采'] }
    ]
  },
  {
    id: 'kep1er', name: 'Kep1er', aka: '케플러', type: 'group', color: '#7b1fa2',
    brief: 'Kep1er, project group from Girls Planet 999 under WAKEONE / KLAP; six members since March 2026 (Yujin, Xiaoting, Chaehyun, Dayeon, Hikaru, Bahiyyih).',
    terms: ['Kep1er', '케플러'], aliases: ['kep1er', 'kep1er', '케플러', '开普勒'],
    members: [
      { id: 'yujin', name: 'Choi Yujin', aka: '최유진', color: '#7b1fa2', terms: ['Choi Yujin Kep1er', '최유진'], aliases: ['yujin', '유진', '崔有眞'] },
      { id: 'xiaoting', name: 'Xiaoting', aka: '沈小婷', color: '#7b1fa2', terms: ['Shen Xiaoting Kep1er', '沈小婷'], aliases: ['xiaoting', '샤오팅', '沈小婷', '小婷'] },
      { id: 'chaehyun', name: 'Kim Chaehyun', aka: '김채현', color: '#7b1fa2', terms: ['Kim Chaehyun Kep1er', '김채현'], aliases: ['chaehyun', '채현'] },
      { id: 'dayeon', name: 'Kim Dayeon', aka: '김다연', color: '#7b1fa2', terms: ['Kim Dayeon Kep1er', '김다연'], aliases: ['dayeon', '다연'] },
      { id: 'hikaru', name: 'Hikaru', aka: '江崎ひかる', color: '#7b1fa2', terms: ['Ezaki Hikaru Kep1er', '江崎ひかる'], aliases: ['hikaru', '히카루', '江崎光'] },
      { id: 'bahiyyih', name: 'Huening Bahiyyih', aka: '휴닝바히에', color: '#7b1fa2', terms: ['Huening Bahiyyih', '휴닝바히에'], aliases: ['bahiyyih', '바히에', '休宁巴伊叶'] }
    ]
  },
  {
    id: 'artms', name: 'ARTMS', aka: '아르테미스', type: 'group', color: '#1a73e8',
    brief: 'ARTMS, five-member group under MODHAUS (HeeJin, HaSeul, Kim Lip, JinSoul, Choerry) formed from LOOΠΔ members.',
    terms: ['ARTMS', '아르테미스'], aliases: ['artms', '아르테미스', '阿耳忒弥斯'],
    members: [
      { id: 'heejin', name: 'HeeJin', aka: '희진', color: '#1a73e8', terms: ['HeeJin ARTMS', '희진'], aliases: ['heejin', '희진', '姬振'] },
      { id: 'haseul', name: 'HaSeul', aka: '하슬', color: '#1a73e8', terms: ['HaSeul ARTMS', '하슬'], aliases: ['haseul', '하슬'] },
      { id: 'kimlip', name: 'Kim Lip', aka: '김립', color: '#1a73e8', terms: ['Kim Lip ARTMS', '김립'], aliases: ['kim lip', 'kimlip', '김립'] },
      { id: 'jinsoul', name: 'JinSoul', aka: '진솔', color: '#1a73e8', terms: ['JinSoul ARTMS', '진솔'], aliases: ['jinsoul', '진솔'] },
      { id: 'choerry', name: 'Choerry', aka: '최리', color: '#1a73e8', terms: ['Choerry ARTMS', '최리'], aliases: ['choerry', '최리'] }
    ]
  }
];

/* ------------------------------------------------------------------ *
 * Transliteration fix-ups.
 * Machine translation mangles group names (르세라핌 → "Le Seraphim",
 * 케플러 → "Kepler"), so canonical spellings get restored before display
 * and before artist tagging.
 * ------------------------------------------------------------------ */
const FIXUPS = [
  [/\b(?:le|re)[\s-]?seraphim\b/gi, 'LE SSERAFIM'],
  [/\ble\s+sserafim\b/gi, 'LE SSERAFIM'],
  [/\blesserafim\b/gi, 'LE SSERAFIM'],
  [/\bkepler\b/gi, 'Kep1er'],
  [/\bkep\s?1\s?er\b/gi, 'Kep1er'],
  [/\b케플러\b/g, 'Kep1er'],
  [/\b아이들\b/g, '(G)I-DLE'],
  [/\bg[\s-]?idle\b/gi, '(G)I-DLE'],
  [/\bi[\s-]?dle\b/gi, 'i-dle'],
  [/\bartemis\b/gi, 'ARTMS'],
  [/\ba\s?r\s?t\s?m\s?s\b/gi, 'ARTMS'],
  [/\bitzy\b/gi, 'ITZY'],
  [/\bit\s?zy\b/gi, 'ITZY'],
  [/\bhuh\s+yunjin\b/gi, 'Huh Yunjin'],
  [/\bkim\s+chae\s?won\b/gi, 'Kim Chaewon'],
  [/\bhong\s+eun\s?chae\b/gi, 'Hong Eunchae'],
  [/\bhuening\s+bahiyyih\b/gi, 'Huening Bahiyyih'],
  [/\bhuening\s+bahiyih\b/gi, 'Huening Bahiyyih'],
  [/\bseo\s+young\s?eun\b/gi, 'Seo Youngeun'],
  [/\bshen\s+xiao\s?ting\b/gi, 'Shen Xiaoting'],
  [/\bkim\s+chae\s?hyun\b/gi, 'Kim Chaehyun'],
  [/\bkim\s+da\s?yeon\b/gi, 'Kim Dayeon'],
  [/\bezaki\s+hikaru\b/gi, 'Ezaki Hikaru'],
  [/\bchoi\s+yu\s?jin\b/gi, 'Choi Yujin'],
  [/\bjeon\s+so\s?yeon\b/gi, 'Jeon Soyeon'],
  [/\bsong\s+yu\s?qi\b/gi, 'Song Yuqi'],
  [/\bkim\s+min\s?nie\b/gi, 'Kim Minnie'],
  [/\bjeon\s+mi\s?yeon\b/gi, 'Jeon Miyeon'],
  [/\bshin\s+ryu\s?jin\b/gi, 'Shin Ryujin'],
  [/\blee\s+chae\s?ryeong\b/gi, 'Lee Chaeryeong'],
  [/\bshin\s+yu\s?na\b/gi, 'Shin Yuna']
];

/* ------------------------------------------------------------------ *
 * Companies — label press rooms & announcement pages
 * ------------------------------------------------------------------ */
const COMPANIES = [
  { id: 'hybe', name: 'HYBE', country: 'KR', group: 'hybe', news: 'https://hybecorp.com/eng/news', terms: ['HYBE'], aliases: ['hybe', '하이브'] },
  { id: 'sourcemusic', name: 'SOURCE MUSIC', country: 'KR', group: 'hybe', news: 'https://sourcemusic.com/notice', terms: ['SOURCE MUSIC'], aliases: ['source music'] },
  { id: 'jype', name: 'JYP Entertainment', country: 'KR', group: 'jyp', news: 'https://www.jype.com/News', terms: ['JYP Entertainment'], aliases: ['jyp', 'jype', 'jyp entertainment', 'jyp엔터테인먼트'] },
  { id: 'sment', name: 'SM Entertainment', country: 'KR', group: 'sm', news: 'https://www.smentertainment.com/PressCenter/Overview', terms: ['SM Entertainment'], aliases: ['sm entertainment', 'sment', 'sm엔터테인먼트'] },
  { id: 'ygent', name: 'YG Entertainment', country: 'KR', group: 'yg', news: 'https://www.ygfamily.com/notice', terms: ['YG Entertainment'], aliases: ['yg entertainment', 'yg엔터테인먼트'] },
  { id: 'cube', name: 'CUBE Entertainment', country: 'KR', group: 'cube', news: 'https://www.cubeent.co.kr/artist', terms: ['CUBE Entertainment'], aliases: ['cube entertainment', '큐브엔터테인먼트'] },
  { id: 'wakeone', name: 'WAKEONE', country: 'KR', group: 'cj', news: 'https://wake-one.com/notice', terms: ['WAKEONE'], aliases: ['wakeone', 'wake one', '웨이크원'] },
  { id: 'modhaus', name: 'MODHAUS', country: 'KR', group: 'modhaus', news: 'https://www.mod-haus.com/notice', terms: ['MODHAUS'], aliases: ['modhaus', '모드하우스'] },
  { id: 'klap', name: 'KLAP Entertainment', country: 'KR', group: 'klap', news: 'https://www.klap-ent.com', terms: ['KLAP Entertainment'], aliases: ['klap'] },
  { id: 'kakao', name: 'Kakao Entertainment', country: 'KR', group: 'kakao', news: 'https://www.kakaoent.com', terms: ['Kakao Entertainment'], aliases: ['kakao entertainment', '카카오엔터테인먼트'] },
  { id: 'starship', name: 'Starship Entertainment', country: 'KR', group: 'starship', news: 'https://www.starship-ent.com', terms: ['Starship Entertainment'], aliases: ['starship entertainment', '스타쉽'] },
  { id: 'pledis', name: 'PLEDIS Entertainment', country: 'KR', group: 'hybe', news: 'https://www.pledis.co.kr', terms: ['PLEDIS Entertainment'], aliases: ['pledis'] },
  { id: 'ador', name: 'ADOR', country: 'KR', group: 'hybe', news: 'https://www.ador.world', terms: ['ADOR'], aliases: ['ador'] },
  { id: 'jypjp', name: 'JYP Japan', country: 'JP', group: 'jyp', news: 'https://www.jypjapan.net', terms: ['JYP Japan'], aliases: ['jyp japan'] },
  { id: 'ldh', name: 'LDH JAPAN', country: 'JP', group: 'ldh', news: 'https://www.ldh.co.jp', terms: ['LDH JAPAN'], aliases: ['ldh'] },
  { id: 'avex', name: 'Avex', country: 'JP', group: 'avex', news: 'https://avex.jp', terms: ['Avex'], aliases: ['avex'] },
  { id: 'sonymusiccn', name: 'Sony Music China', country: 'CN', group: 'sony', news: 'https://www.sonymusic.com.cn', terms: ['Sony Music China'], aliases: ['sony music china'] },
  { id: 'yuehua', name: 'Yue Hua Entertainment', country: 'CN', group: 'yuehua', news: 'https://www.yhfamily.com', terms: ['Yue Hua Entertainment'], aliases: ['yuehua', '乐华娱乐', '위화'] },
  { id: 'kkbox', name: 'KKBOX (news)', country: 'TW', group: 'kkbox', news: 'https://www.kkbox.com/tw', terms: ['KKBOX'], aliases: ['kkbox'] }
];

/* ------------------------------------------------------------------ *
 * Stores / merch — Shopify stores expose a public suggest API (fast,
 * exact); every store also gets a "new arrival" RSS (Google News site:)
 * fallback and a plain search URL.
 * ------------------------------------------------------------------ */
const STORES = [
  { id: 'choicemusicla', name: 'Choice Music LA', flagship: true, kind: 'shopify', item: 'https://choicemusicla.com/products/', search: 'https://choicemusicla.com/search?q=', sug: 'https://choicemusicla.com/search/suggest.json?q=' },
  { id: 'musicplaza', name: 'Music Plaza', flagship: true, kind: 'shopify', item: 'https://musicplaza.com/products/', search: 'https://musicplaza.com/search?q=', sug: 'https://musicplaza.com/search/suggest.json?q=' },
  { id: 'kpopusaonline', name: 'Kpop USA Online', flagship: true, kind: 'shopify', item: 'https://kpopusaonline.com/products/', search: 'https://kpopusaonline.com/search?q=', sug: 'https://kpopusaonline.com/search/suggest.json?q=' },
  { id: 'ktown4u', name: 'Ktown4u', flagship: true, kind: 'link', search: 'https://www.ktown4u.com/search?keyword=', siteQ: 'ktown4u.com' },
  { id: 'weverse', name: 'Weverse Shop', flagship: true, kind: 'link', search: 'https://shop.weverse.io/en/search?keyword=', siteQ: 'weverse.io' },
  { id: 'makestar', name: 'Makestar', flagship: false, kind: 'link', search: 'https://www.makestar.com/search?keyword=' },
  { id: 'yes24', name: 'YES24', flagship: false, kind: 'link', search: 'https://www.yes24.com/product/search?domain=GOODS&query=' },
  { id: 'aladin', name: 'Aladin', flagship: false, kind: 'link', search: 'https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Music&SearchWord=' },
  { id: 'kpopmart', name: 'Kpopmart', flagship: false, kind: 'link', search: 'https://kpopmart.com/search?keyword=' },
  { id: 'smglobalshop', name: 'SM Global Shop', flagship: false, kind: 'link', search: 'https://shop.smtown.com/search?keyword=' },
  { id: 'jypstore', name: 'JYP Store', flagship: false, kind: 'link', search: 'https://www.jypstore.com/product/list.html?keyword=' },
  { id: 'yglobalshop', name: 'YG Select', flagship: false, kind: 'link', search: 'https://www.ygselect.com/goods/goods_search.php?keyword=' },
  { id: 'amazon', name: 'Amazon', flagship: false, kind: 'link', search: 'https://www.amazon.com/s?k=' },
  { id: 'towerrecords', name: 'Tower Records JP', flagship: false, kind: 'link', search: 'https://tower.jp/search/item/' },
  { id: 'hmv', name: 'HMV Japan', flagship: false, kind: 'link', search: 'https://www.hmv.co.jp/search/?q=' },
  { id: 'taobao', name: 'Taobao', flagship: false, kind: 'link', search: 'https://s.taobao.com/search?q=' }
];

/* ------------------------------------------------------------------ *
 * Official sites & channels per artist (editable in-app)
 * ------------------------------------------------------------------ */
const OFFICIAL = {
  idle: {
    sites: [{ name: 'i-dle Weverse', url: 'https://weverse.io/idle/feed' }],
    youtube: [{ name: 'i-dle (아이들)', id: 'UCritGVo7pLJLUS8wEu32vow' }],
    instagram: [{ name: '@official_i_dle', handle: 'official_i_dle' }]
  },
  itzy: {
    sites: [{ name: 'ITZY Official (JYP)', url: 'https://itzy.jype.com' }, { name: 'ITZY Weverse', url: 'https://weverse.io/itzy/feed' }],
    youtube: [{ name: 'ITZY', id: 'UCDhM2k2Cua-JdobAh5moMFg' }, { name: 'ITZY JAPAN', id: 'UCJsfO4nKS3_c24zLbF8rT0A' }],
    instagram: [{ name: '@itzy.all.in.us', handle: 'itzy.all.in.us' }]
  },
  lesserafim: {
    sites: [{ name: 'LE SSERAFIM Japan', url: 'https://le-sserafim.jp' }, { name: 'LE SSERAFIM Weverse', url: 'https://weverse.io/lesserafim/feed' }],
    youtube: [{ name: 'LE SSERAFIM', id: 'UCs-QBT4qkj_YiQw1ZntDO3g' }],
    instagram: [{ name: '@le_sserafim', handle: 'le_sserafim' }]
  },
  kep1er: {
    sites: [{ name: 'Kep1er Weverse', url: 'https://weverse.io/kep1er/feed' }, { name: 'WAKEONE', url: 'https://wake-one.com' }],
    youtube: [{ name: 'Kep1er', id: 'UC8whlOg70m2Yr3qSMjUhh0g' }],
    instagram: [{ name: '@official.kep1er', handle: 'official.kep1er' }]
  },
  artms: {
    sites: [{ name: 'MODHAUS', url: 'https://www.mod-haus.com' }, { name: 'ARTMS Weverse', url: 'https://weverse.io/artms/feed' }],
    youtube: [{ name: 'Official ARTMS', id: 'UChXC6ok0LaZIpf-50SIFf0Q' }],
    instagram: [{ name: '@official_artms', handle: 'official_artms' }]
  }
};

/* ------------------------------------------------------------------ *
 * Topic vocabulary — drives intent tagging, keyword search and
 * "saved subject" tracking.
 * ------------------------------------------------------------------ */
const TOPICS = [
  {
    id: 'music', name: 'Music & Releases', icon: '🎵',
    en: ['comeback', 'new album', 'mini album', 'single', 'title track', 'pre-release', 'music video', 'MV teaser', 'tracklist', 'album spoiler', 'digital single', 'EP', 'repackaged', 'remix', 'OST', 'collab', 'featuring', 'song', 'debut'],
    ko: ['컴백', '신곡', '미니앨범', '정규앨범', '타이틀곡', '뮤직비디오', '선공개', '트랙리스트', '싱글', 'OST', '발매', '리패키지'],
    zh: ['回归', '新歌', '迷你专辑', '正规专辑', '主打歌', 'MV', '单曲', '发行'],
    ja: ['カムバック', '新曲', 'ミニアルバム', 'タイトル曲', 'ミュージックビデオ', 'リリース']
  },
  {
    id: 'tour', name: 'Tours & Concerts', icon: '🎤',
    en: ['world tour', 'tour', 'concert', 'arena', 'stadium', 'tickets', 'ticketing', 'encore', 'live viewing', 'festival', 'lineup', 'fan meeting', 'fanmeeting', 'fancon', 'showcase', 'sold out', 'dates'],
    ko: ['월드투어', '투어', '콘서트', '티켓', '예매', '팬미팅', '팬콘', '쇼케이스', '공연', '단독 콘서트'],
    zh: ['巡演', '演唱会', '门票', '粉丝见面会', '开票'],
    ja: ['ツアー', 'コンサート', 'チケット', 'ファンミーティング', '公演']
  },
  {
    id: 'merch', name: 'Merch & Albums', icon: '🛍️',
    en: ['merch', 'merchandise', 'goods', 'album pre-order', 'pre-order', 'light stick', 'lightstick', 'photocard', 'photobook', 'season greeting', 'pop-up store', 'popup', 'official store', 'restock', 'limited edition', 'poca album', 'kit album', 'vinyl'],
    ko: ['굿즈', '예약판매', '응원봉', '포토카드', '포토북', '시즌그리팅', '팝업스토어', '공식몰', '재입고', '한정판', '앨범 예약'],
    zh: ['周边', '应援棒', '小卡', '写真集', '预售', '快闪店'],
    ja: ['グッズ', 'ペンライト', 'フォトカード', '予約販売', 'ポップアップストア']
  },
  {
    id: 'charts', name: 'Charts & Awards', icon: '🏆',
    en: ['Billboard', 'Billboard 200', 'Hot 100', 'Circle Chart', 'Oricon', 'Melon', 'music show', 'win', 'No.1', 'number one', 'award', 'daesang', 'Grammy', 'AMA', 'MTV', 'nomination', 'record', 'first K-pop'],
    ko: ['빌보드', '음악방송', '1위', '차트', '오리콘', '멜론', '시상식', '대상', '수상', '기록'],
    zh: ['榜单', '音乐节目', '一位', '颁奖礼', '获奖'],
    ja: ['ビルボード', 'オリコン', 'チャート', '受賞', '音楽番組']
  },
  {
    id: 'business', name: 'Label & Business', icon: '🏢',
    en: ['HYBE', 'JYP', 'SM Entertainment', 'YG', 'CUBE', 'WAKEONE', 'MODHAUS', 'earnings', 'revenue', 'quarterly', 'stock', 'contract', 'renewal', 'lawsuit', 'trademark', 'acquisition', 'shareholder', 'IPO'],
    ko: ['하이브', 'JYP', 'SM', 'YG', '큐브', '웨이크원', '모드하우스', '실적', '매출', '계약', '재계약', '소송', '상표', '주주'],
    zh: ['营收', '合约', '续约', '诉讼', '商标'],
    ja: ['決算', '契約', '訴訟', '商標']
  },
  {
    id: 'lineup', name: 'Lineup & Health', icon: '🩺',
    en: ['hiatus', 'injury', 'health', 'leave', 'departure', 'joins', 'new member', 'lineup change', 'contract ends', 'military', 'enlistment', 'disband', 'reunion', 'dating', 'marriage'],
    ko: ['활동 중단', '부상', '건강', '탈퇴', '합류', '새 멤버', '재정비', '군입대', '입대', '해체', '재결합', '열애', '결혼'],
    zh: ['暂退', '受伤', '退出', '新成员', '入伍', '解散', '恋爱', '结婚'],
    ja: ['活動休止', 'けが', '脱退', '加入', '入隊', '解散', '交際', '結婚']
  },
  {
    id: 'debut', name: 'New Groups & Rookies', icon: '🌱',
    en: ['new group', 'rookie', 'debut lineup', 'survival show', 'audition', 'trainee', 'subunit', 'project group', 'solo debut', 'pre-debut'],
    ko: ['신인', '데뷔', '서바이벌', '오디션', '연습생', '유닛', '프로젝트 그룹', '솔로 데뷔'],
    zh: ['新人', '出道', '选秀', '小分队'],
    ja: ['新人', 'デビュー', 'オーディション', 'ユニット']
  },
  {
    id: 'media', name: 'Variety & Media', icon: '📺',
    en: ['variety show', 'interview', 'magazine cover', 'photoshoot', 'ad campaign', 'ambassador', 'brand', 'endorsement', 'YouTube', 'vlog', 'documentary', 'TV appearance', 'collab stage'],
    ko: ['예능', '인터뷰', '화보', '광고', '홍보대사', '브랜드', '유튜브', '다큐'],
    zh: ['综艺', '采访', '画报', '代言', '品牌'],
    ja: ['バラエティ', 'インタビュー', '雑誌', 'CM', 'ブランド']
  },
  {
    id: 'fandom', name: 'Fandom & Events', icon: '💬',
    en: ['fandom', 'fan club', 'Weverse', 'Bubble', 'anniversary', 'birthday', 'donation', 'charity', 'event', 'lottery', 'fansign', 'video call event'],
    ko: ['팬덤', '팬클럽', '위버스', '버블', '기념일', '생일', '기부', '팬사인회', '영통'],
    zh: ['粉丝', '生日', '公益活动', '签售'],
    ja: ['ファンダム', 'ファンクラブ', '誕生日', 'イベント']
  }
];

/* ------------------------------------------------------------------ *
 * News locales — Google News editions (language + region).
 * "all languages, translated to English" = every one of these is on.
 * ------------------------------------------------------------------ */
const LOCALES = [
  { id: 'en-US', label: 'English (US)', lang: 'en', hl: 'en-US', gl: 'US', ceid: 'US:en', on: true },
  { id: 'en-GB', label: 'English (UK)', lang: 'en', hl: 'en-GB', gl: 'GB', ceid: 'GB:en', on: true },
  { id: 'en-IN', label: 'English (India)', lang: 'en', hl: 'en-IN', gl: 'IN', ceid: 'IN:en', on: true },
  { id: 'ko', label: 'Korean', lang: 'ko', hl: 'ko', gl: 'KR', ceid: 'KR:ko', on: true },
  { id: 'zh-TW', label: 'Chinese (Traditional)', lang: 'zh', hl: 'zh-TW', gl: 'TW', ceid: 'TW:zh-Hant', on: true },
  { id: 'zh-CN', label: 'Chinese (Simplified)', lang: 'zh', hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans', on: true },
  { id: 'ja', label: 'Japanese', lang: 'ja', hl: 'ja', gl: 'JP', ceid: 'JP:ja', on: true },
  { id: 'th', label: 'Thai', lang: 'th', hl: 'th', gl: 'TH', ceid: 'TH:th', on: true },
  { id: 'vi', label: 'Vietnamese', lang: 'vi', hl: 'vi', gl: 'VN', ceid: 'VN:vi', on: true },
  { id: 'id', label: 'Indonesian', lang: 'id', hl: 'id', gl: 'ID', ceid: 'ID:id', on: true },
  { id: 'es', label: 'Spanish', lang: 'es', hl: 'es-419', gl: 'US', ceid: 'US:es-419', on: true },
  { id: 'pt', label: 'Portuguese', lang: 'pt', hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419', on: true },
  { id: 'fr', label: 'French', lang: 'fr', hl: 'fr', gl: 'FR', ceid: 'FR:fr', on: true },
  { id: 'ar', label: 'Arabic', lang: 'ar', hl: 'ar', gl: 'AE', ceid: 'AE:ar', on: true }
];

/* Bing markets give us real URLs + real dek summaries (Google News hides both). */
const BING_MARKETS = [
  { id: 'en-US', lang: 'en', mkt: 'en-US', on: true },
  { id: 'en-GB', lang: 'en', mkt: 'en-GB', on: true },
  { id: 'ko-KR', lang: 'ko', mkt: 'ko-KR', on: true },
  { id: 'zh-TW', lang: 'zh', mkt: 'zh-TW', on: true },
  { id: 'ja-JP', lang: 'ja', mkt: 'ja-JP', on: true },
  { id: 'th-TH', lang: 'th', mkt: 'th-TH', on: false },
  { id: 'es-ES', lang: 'es', mkt: 'es-ES', on: false }
];

/* Specialists that are always worth checking for K-pop (English + Asian press). */
const SPECIALTY_FEEDS = [
  { id: 'soompi', name: 'Soompi', url: 'https://www.soompi.com/feed', lang: 'en', on: true },
  { id: 'koreaboo', name: 'Koreaboo', url: 'https://www.koreaboo.com/feed/', lang: 'en', on: true },
  { id: 'koreaherald-kpop', name: 'Korea Herald · K-pop', url: 'https://www.koreaherald.com/rss/020000000000.xml', lang: 'en', on: true }
];

/* Search suffixes that turn a news query into a merch/release query. */
const MERCH_MODIFIERS = {
  en: ['merch', 'album pre-order', 'pop-up store', 'goods'],
  ko: ['굿즈', '앨범 예약판매', '팝업스토어'],
  ja: ['グッズ', 'アルバム 予約'],
  zh: ['周边', '专辑 预售']
};

const DEFAULTS = {
  windowDays: 3,
  retentionDays: 30,
  languageMode: 'translate', // translate | original
  summaryMode: 'both',       // automatic | ai | both
  autoRefreshMinutes: 0,     // 0 = manual only
  aiProvider: 'auto',
  aiKey: '',
  aiModel: '',
  translateEngine: 'auto',
  weights: { news: 0.45, official: 0.2, merch: 0.2, label: 0.15 },
  locales: LOCALES.filter(l => l.on).map(l => l.id),
  bingMarkets: BING_MARKETS.filter(m => m.on).map(m => m.id),
  specialty: SPECIALTY_FEEDS.filter(f => f.on).map(f => f.id),
  enabledTopics: TOPICS.map(t => t.id),
  watchStores: STORES.filter(s => s.flagship).map(s => s.id)
};

module.exports = {
  ARTISTS, FIXUPS, COMPANIES, STORES, OFFICIAL, TOPICS, LOCALES, BING_MARKETS,
  SPECIALTY_FEEDS, MERCH_MODIFIERS, DEFAULTS
};
}};

/* ======================== net ======================== */
__KPR_MODULES__["net.js"] = { exports: {}, loaded: false, require: __kprRequire, fn: function (exports, require, module) {
/**
 * net.js — tiny zero-dependency HTTP + feed + translation helpers.
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** fetch text with timeout + retry, transparent gzip/deflate/br */
function get(url, { timeout = 12000, ua = UA_DESKTOP, headers = {}, retries = 1, raw = false } = {}) {
  const attempt = (n) => new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8,zh;q=0.7,ja;q=0.6',
        'Accept-Encoding': 'gzip, deflate, br',
        ...headers
      }
    }, (res) => {
      // follow redirects (max 5)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && n < 5) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(get(next, { timeout, ua, headers, retries: 0 }));
      }
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (raw) return resolve({ status: res.statusCode, headers: res.headers, buffer: buf, url });
        resolve({ status: res.statusCode, headers: res.headers, body: decodeBody(buf, res.headers), url });
      });
      stream.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout ' + url)));
    req.on('error', (e) => {
      if (n < retries) return resolve(get(url, { timeout, ua, headers, retries: n + 1 }));
      reject(e);
    });
    req.end();
  });
  return attempt(0);
}

function decodeBody(buf, headers) {
  let charset = ((headers['content-type'] || '').match(/charset=([^;\s]+)/i) || [])[1];
  const head = buf.slice(0, 2048).toString('latin1');
  if (!charset) {
    const m = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
    if (m) charset = m[1];
  }
  charset = (charset || 'utf-8').toLowerCase();
  if (/euc-?kr|ks_c_5601|cp949/.test(charset)) {
    try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { /* fall through */ }
  }
  try { return new TextDecoder('utf-8').decode(buf); } catch (e) { return buf.toString('utf8'); }
}

/* ------------------------------- XML ------------------------------- */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m));
}
function safeChar(cp) { try { return String.fromCodePoint(cp); } catch (e) { return ''; } }
const stripTags = (s = '') => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** tolerant RSS 2.0 / Atom parser → [{title, link, date, summary, source, guid}] */
function parseFeed(xml, { base = '' } = {}) {
  if (!xml || typeof xml !== 'string') return [];
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const grab = (re) => { const m = b.match(re); return m ? m[1] : ''; };
    let link = stripTags(grab(/<link[^>]*?href=["']([^"']+)["']/i)) || stripTags(grab(/<link[^>]*>([\s\S]*?)<\/link>/i));
    if (link && base) { try { link = new URL(link, base).toString(); } catch (e) {} }
    const title = stripTags(grab(/<title[^>]*>([\s\S]*?)<\/title>/i));
    const rawDesc = grab(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
                    grab(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i) ||
                    grab(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
                    grab(/<media:description[^>]*>([\s\S]*?)<\/media:description>/i);
    const date = stripTags(grab(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)) ||
                 stripTags(grab(/<published[^>]*>([\s\S]*?)<\/published>/i)) ||
                 stripTags(grab(/<updated[^>]*>([\s\S]*?)<\/updated>/i)) ||
                 stripTags(grab(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i));
    const srcName = stripTags(grab(/<source[^>]*>([\s\S]*?)<\/source>/i));
    const srcUrl = (b.match(/<source[^>]*url=["']([^"']+)["']/i) || [])[1] || '';
    const guid = stripTags(grab(/<guid[^>]*>([\s\S]*?)<\/guid>/i)) || stripTags(grab(/<id[^>]*>([\s\S]*?)<\/id>/i)) || link;
    if (!title && !rawDesc) continue;
    out.push({
      title,
      link,
      date: parseDate(date),
      summaryRaw: stripTags(rawDesc),
      source: srcName,
      sourceUrl: srcUrl,
      guid
    });
  }
  return out;
}

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString();
  return null;
}

/* --------------------------- translation --------------------------- */

const LANG_OF = { ko: 'ko', zh: 'zh-CN', ja: 'ja', th: 'th', vi: 'vi', id: 'id', es: 'es', pt: 'pt', fr: 'fr', ar: 'ar', en: 'en' };
const HANGUL = /[\uac00-\ud7af]/;
const KANA = /[\u3040-\u30ff]/;
const HAN = /[\u4e00-\u9fff]/;

function detectLang(text = '') {
  if (HANGUL.test(text)) return 'ko';
  if (KANA.test(text)) return 'ja';
  if (HAN.test(text)) return 'zh';
  return 'en';
}

const translationCache = new Map();

/**
 * Translate text → English. Google's public endpoint first (fast, no key),
 * MyMemory as the fallback. Results cached for the process lifetime.
 */
async function translate(text, from) {
  const clean = (text || '').trim();
  if (!clean) return clean;
  const src = from || detectLang(clean);
  if (src === 'en') return clean;
  const key = src + '|' + clean;
  if (translationCache.has(key)) return translationCache.get(key);
  const q = encodeURIComponent(clean.slice(0, 1200));
  const sl = src === 'zh' ? 'zh-CN' : src;

  const engines = [
    async () => {
      const r = await get(`https://clients5.google.com/translate_a/single?client=dict-chrome-ex&sl=${sl}&tl=en&dt=t&q=${q}`,
        { timeout: 9000, ua: UA_DESKTOP, retries: 0 });
      const d = JSON.parse(r.body);
      const out = (d[0] || []).map((seg) => seg[0]).join('');
      return out || null;
    },
    async () => {
      const r = await get(`https://api.mymemory.translated.net/get?q=${q}&langpair=${sl}|en`,
        { timeout: 9000, ua: UA_DESKTOP, retries: 0 });
      const d = JSON.parse(r.body);
      const out = d && d.responseData && d.responseData.translatedText;
      return out && !/^MYMEMORY WARNING/.test(out) ? out : null;
    }
  ];

  for (const engine of engines) {
    try {
      const out = await engine();
      if (out) {
        const final = decodeEntities(out);
        if (translationCache.size > 4000) translationCache.clear();
        translationCache.set(key, final);
        return final;
      }
    } catch (e) { /* try next engine */ }
  }
  return clean; // give up: show the original
}

/** Translate a list of strings in small parallel batches. */
async function translateAll(items, budget = 6) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(budget, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await translate(items[idx].text, items[idx].lang);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Run tasks with limited concurrency. */
async function pool(tasks, limit = 6) {
  const results = new Array(tasks.length);
  let i = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); } catch (e) { results[idx] = null; }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Pull og:description / meta description from an article page. */
async function fetchDek(url, { timeout = 8000 } = {}) {
  try {
    const r = await get(url, { timeout, ua: UA_MOBILE, retries: 0, headers: { Accept: 'text/html' } });
    if (r.status !== 200 || !r.body) return null;
    const html = r.body;
    const grab = (re) => { const m = html.match(re); return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : null; };
    const dek = grab(/<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']{20,400})["']/i) ||
                grab(/<meta[^>]+content=["']([^"']{20,400})["'][^>]+(?:property|name)=["']og:description["']/i) ||
                grab(/<meta[^>]+(?:name)=["'](?:description|twitter:description)["'][^>]+content=["']([^"']{20,400})["']/i) ||
                grab(/<meta[^>]+content=["']([^"']{20,400})["'][^>]+name=["']description["']/i);
    if (!dek) return null;
    return { dek, title: grab(/<title[^>]*>([^<]{4,200})<\/title>/i) };
  } catch (e) {
    return null;
  }
}

module.exports = {
  get, parseFeed, parseDate, decodeEntities, stripTags,
  translate, translateAll, detectLang, pool, fetchDek, LANG_OF,
  UA_MOBILE, UA_DESKTOP
};
}};

/* ======================== sources ======================== */
__KPR_MODULES__["sources.js"] = { exports: {}, loaded: false, require: __kprRequire, fn: function (exports, require, module) {
/**
 * sources.js — every place the radar looks.
 *   news      : Google News RSS (all languages) + Bing News (real URLs + real deks)
 *   official  : YouTube channel uploads + official site/Weverse announcements
 *   label     : record-company press rooms & announcement pages
 *   merch     : K-pop stores (Shopify suggest API + new arrivals + site: searches)
 */
const { get, parseFeed, translate, pool, decodeEntities, stripTags } = require('./net');
const { TOPICS, STORES, COMPANIES, OFFICIAL, LOCALES, BING_MARKETS, SPECIALTY_FEEDS, MERCH_MODIFIERS } = require('./catalog');

const GN = (q, loc) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${loc.hl}&gl=${loc.gl}&ceid=${loc.ceid}`;
const quote = (t) => (/\s|[^\w()'-]/.test(t) ? `"${t}"` : t);

/* ------------------------------------------------------------------ *
 * Query construction
 * ------------------------------------------------------------------ */
function artistClause(artists) {
  return artists.map((a) => a.terms.slice(0, 2).map(quote).join(' OR ')).map((s) => `(${s})`).join(' OR ');
}

function topicKeywords(topic, lang) {
  const bucket = lang === 'ko' ? topic.ko : lang === 'ja' ? topic.ja : (lang === 'zh' ? topic.zh : topic.en);
  return (bucket && bucket.length ? bucket : topic.en);
}

/** Google News queries for one locale: broad + intent + label-rookie sweeps. */
function googleNewsQueries(state, loc) {
  const artists = state.artists;
  const lang = loc.lang;
  const out = [];
  const A = artistClause(artists);
  if (!A) return out;

  // 1) straight artist news
  out.push({ type: 'news', locale: loc.id, lang, q: A });

  // 2) intent sweep: comeback / tour / merch / charts in this locale's language
  const intent = [];
  for (const t of TOPICS.filter((t) => state.enabledTopics.includes(t.id) && ['music', 'tour', 'merch', 'charts', 'lineup', 'debut'].includes(t.id))) {
    intent.push(...topicKeywords(t, lang).slice(0, 6).map(quote));
  }
  if (intent.length) out.push({ type: 'news-intent', locale: loc.id, lang, q: `${A} (${intent.join(' OR ')})` });

  return out;
}

/** label / new-group sweep, run in the four biggest markets only */
function labelQueries(state, loc) {
  const labels = COMPANIES.filter((c) => state.companies.includes(c.id));
  if (!labels.length) return [];
  const lang = loc.lang;
  const L = labels.slice(0, 12).map((c) => quote(c.terms[0])).join(' OR ');
  const rookie = topicKeywords(TOPICS.find((t) => t.id === 'debut'), lang).slice(0, 8).map(quote);
  const tour = topicKeywords(TOPICS.find((t) => t.id === 'tour'), lang).slice(0, 5).map(quote);
  const merch = topicKeywords(TOPICS.find((t) => t.id === 'merch'), lang).slice(0, 5).map(quote);
  return [{
    type: 'label', locale: loc.id, lang,
    q: `(${L}) (${[...rookie, ...tour, ...merch].join(' OR ')})`
  }];
}

/* ------------------------------------------------------------------ *
 * Fetchers — each returns normalized "raw item" objects.
 * ------------------------------------------------------------------ */
function blankItem(over) {
  return Object.assign({
    kind: 'news',
    title: '', titleOriginal: '', lang: 'en',
    summary: '', summaryOriginal: '',
    url: '', sourceName: '', sourceUrl: '',
    publishedAt: null, sourceType: 'news',
    topics: [], primaryTopic: null, artists: [],
    isNew: true
  }, over);
}

async function fetchGoogleNewsOne(qd) {
  const loc = LOCALES.find((l) => l.id === qd.locale) || LOCALES[0];
  const r = await get(GN(qd.q, loc), { timeout: 12000, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
  const entries = parseFeed(r.body || '', { base: 'https://news.google.com' });
  return entries.map((e) => {
    // Google News titles carry " - Publisher" suffix
    let title = e.title;
    let source = e.source;
    const m = title.match(/^(.*)\s+-\s+([^-]{2,40})$/);
    if (m && e.source && title.endsWith(e.source)) { title = m[1]; }
    if (!source && m) source = m[2];
    return blankItem({
      title, titleOriginal: title,
      summary: '', summaryOriginal: e.summaryRaw === title ? '' : '',
      url: e.link,
      sourceName: source || 'Google News',
      sourceUrl: e.sourceUrl,
      publishedAt: e.date,
      lang: qd.lang,
      sourceType: 'google-news',
      locale: qd.locale,
      needsDek: true,
      needsUrlResolve: /news\.google\.com/.test(e.link)
    });
  });
}

/** Bing News: real publisher URLs + real one-sentence deks. */
async function fetchBingNewsOne(qd) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(qd.q)}&format=RSS&mkt=${qd.mkt}`;
  const r = await get(url, { timeout: 12000, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
  const entries = parseFeed(r.body || '', { base: 'https://www.bing.com' });
  return entries.map((e) => {
    let real = e.link;
    const m = real.match(/[?&]url=([^&]+)/);
    if (/bing\.com\/news\/apiclick/.test(real)) {
      real = m ? decodeURIComponent(m[1]) : real;
      if (!/^https?:/.test(real)) real = m ? decodeURIComponent(decodeURIComponent(m[1])) : e.link;
    }
    const title = e.title.replace(/\s+-\s+[^-]{2,40}$/, '');
    return blankItem({
      title, titleOriginal: title,
      summary: e.summaryRaw || '', summaryOriginal: e.summaryRaw || '',
      url: real,
      sourceName: e.source || hostOf(real),
      sourceUrl: e.sourceUrl || ('https://' + hostOf(real)),
      publishedAt: e.date,
      lang: qd.lang,
      sourceType: 'bing',
      locale: qd.locale
    });
  });
}

const HANGUL_RE = /[\uac00-\ud7af]/;
const KANA_RE = /[\u3040-\u30ff]/;
const HAN_RE = /[\u4e00-\u9fff]/;

/** Pick the search term that matches the target language (falls back to the latin name). */
function localizedTerm(artist, lang) {
  const pool = [...(artist.terms || []), ...(artist.aliases || [])].filter(Boolean);
  const match = pool.find((t) => {
    if (lang === 'ko') return HANGUL_RE.test(t);
    if (lang === 'ja') return KANA_RE.test(t) || HANGUL_RE.test(t);
    if (lang === 'zh') return HAN_RE.test(t) && !KANA_RE.test(t);
    return !HANGUL_RE.test(t) && !KANA_RE.test(t) && !HAN_RE.test(t);
  });
  return match || artist.terms[0] || artist.name;
}

/** Native-language Bing queries: clean signal + real deks in every market. */
function bingQueriesFor(artist, market, enabledTopics) {
  const term = localizedTerm(artist, market.lang);
  const out = [{ type: 'bing-artist', mkt: market.mkt, lang: market.lang, artistId: artist.id, q: term }];
  const intents = [];
  for (const t of TOPICS.filter((t) => (!enabledTopics || enabledTopics.includes(t.id)) &&
    ['music', 'tour', 'merch', 'charts', 'lineup'].includes(t.id))) {
    intents.push(...topicKeywords(t, market.lang).slice(0, 4));
  }
  if (intents.length) {
    out.push({ type: 'bing-intent', mkt: market.mkt, lang: market.lang, artistId: artist.id, q: `${term} (${intents.slice(0, 12).map(quote).join(' OR ')})` });
  }
  return out;
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

/** YouTube uploads for an official channel (also catches "new group" teasers). */
async function fetchYouTubeChannel(ch) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
  const r = await get(url, { timeout: 10000 });
  const entries = parseFeed(r.body || '');
  return entries.map((e) => blankItem({
    kind: 'official',
    title: e.title, titleOriginal: e.title,
    summary: '',
    url: e.link,
    sourceName: ch.name + ' · YouTube',
    sourceUrl: 'https://www.youtube.com/channel/' + ch.id,
    publishedAt: e.date,
    lang: 'en', // channel titles are mixed; detect later
    sourceType: 'youtube',
    officialFor: ch.artistId,
    media: (e.link.match(/v=([\w-]+)/) || [])[1] || null
  }));
}

/** Shopify store: new arrivals (products.json) filtered for our artists later. */
async function fetchShopifyNew(store) {
  const base = store.item.replace(/\/products\/$/, '');
  const url = `${base}/products.json?limit=250&page=1`;
  const r = await get(url, { timeout: 15000, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
  if (r.status !== 200) return [];
  let data;
  try { data = JSON.parse(r.body); } catch (e) { return []; }
  const products = (data && data.products) || [];
  return products.map((p) => {
    const v = (p.variants || [])[0] || {};
    return blankItem({
      kind: 'merch',
      title: p.title, titleOriginal: p.title,
      summary: '',
      url: store.item + p.handle,
      sourceName: store.name,
      sourceUrl: base,
      publishedAt: p.published_at ? new Date(p.published_at).toISOString() : null,
      lang: 'en',
      sourceType: 'store',
      storeId: store.id,
      price: v.price ? { amount: Number(v.price), currency: 'USD' } : null,
      image: (p.images && p.images[0] && p.images[0].src) || null,
      productType: p.product_type || ''
    });
  });
}

/** Shopify store: targeted product search for one artist (exact + fast). */
async function fetchShopifySuggest(store, artist) {
  const base = store.item.replace(/\/products\/$/, '');
  const term = artist.terms[0];
  const url = `${base}/search/suggest.json?q=${encodeURIComponent(term)}&resources%5Btype%5D=product&resources%5Blimit%5D=8`;
  const r = await get(url, { timeout: 12000, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
  if (r.status !== 200) return [];
  let d;
  try { d = JSON.parse(r.body); } catch (e) { return []; }
  const products = ((d.resources && d.resources.results && d.resources.results.products) || [])
    .sort((a, b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0));
  return products.map((p) => blankItem({
    kind: 'merch',
    title: p.title, titleOriginal: p.title,
    summary: p.body ? stripTags(p.body).slice(0, 220) : '',
    url: base + p.url.split('?')[0],
    sourceName: store.name,
    sourceUrl: base,
    publishedAt: p.published_at ? new Date(p.published_at).toISOString() : null,
    lang: 'en',
    sourceType: 'store',
    storeId: store.id,
    price: p.price ? { amount: Number(p.price), currency: 'USD' } : null,
    image: p.featured_image ? (p.featured_image.url || p.featured_image) : null
  }));
}

/** Google News but scoped to a store domain → catches new releases/restocks we can't scrape. */
function storeNewsQuery(store, artist, loc) {
  const site = store.siteQ;
  if (!site) return null;
  return { type: 'merch', locale: loc.id, lang: loc.lang, storeId: store.id, q: `${artist.terms[0]} site:${site}` };
}

/** Specialty K-pop outlets (Soompi, Koreaboo, Korea Herald) — filtered by artist later. */
async function fetchSpecialty(feed) {
  const r = await get(feed.url, { timeout: 12000 });
  return parseFeed(r.body || '', { base: feed.url }).map((e) => blankItem({
    title: e.title, titleOriginal: e.title,
    summary: e.summaryRaw || '', summaryOriginal: e.summaryRaw || '',
    url: e.link,
    sourceName: feed.name,
    sourceUrl: feed.url,
    publishedAt: e.date,
    lang: feed.lang,
    sourceType: 'specialty'
  }));
}

/** Official website / Weverse announcement page — scrape headline-ish links. */
async function fetchOfficialSite(site) {
  const r = await get(site.url, { timeout: 10000, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
  const html = r.body || '';
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{4,180}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 40) {
    const text = stripTags(m[2]);
    if (text.length < 8 || /^(home|login|menu|more|view all|privacy|terms|cookie)/i.test(text)) continue;
    let url = m[1];
    try { url = new URL(url, site.url).toString(); } catch (e) { continue; }
    if (seen.has(url) || !/^https?:/.test(url)) continue;
    seen.add(url);
    out.push(blankItem({
      kind: 'official',
      title: text, titleOriginal: text, summary: '',
      url,
      sourceName: site.name,
      sourceUrl: site.url,
      publishedAt: null,
      lang: /[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]/.test(text) ? 'auto' : 'en',
      sourceType: 'official-site',
      officialFor: site.artistId
    }));
  }
  return out;
}

module.exports = {
  googleNewsQueries, labelQueries, storeNewsQuery, artistClause, topicKeywords, quote,
  fetchGoogleNewsOne, fetchBingNewsOne, fetchYouTubeChannel, fetchShopifyNew,
  fetchShopifySuggest, fetchSpecialty, fetchOfficialSite, blankItem, hostOf, localizedTerm, bingQueriesFor
};
}};

/* ======================== enrich ======================== */
__KPR_MODULES__["enrich.js"] = { exports: {}, loaded: false, require: __kprRequire, fn: function (exports, require, module) {
/**
 * enrich.js — turns raw headlines into readable English cards.
 *
 *  1. translate non-English headlines/deks → English
 *  2. fill missing one-line summaries (Bing deks → publisher og:description →
 *     smart extractive fallback)
 *  3. optional AI summaries (OpenAI-compatible or Anthropic) using each
 *     article's dek + the group context
 *  4. tag each item with artists + topics, score it for ranking
 */
const { translate, translateAll, detectLang, fetchDek, pool, stripTags } = require('./net');

const { TOPICS, ARTISTS, FIXUPS } = require('./catalog');

/* ------------------------- classification ------------------------- */

const CJK = /[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]/;

/**
 * Alias homographs: "ARTMS.IS" is a Turkish listed company, "idle" is a word,
 * "Rise" is a group we don't track. If the only signal is a weak alias and the
 * text smells like markets/legal/other-industry news, it isn't K-pop.
 */
const NOISE_PATTERNS = [
  /\b(anonim|sirketi|şirketi|ticker|stock|stocks|shares|nasdaq|nyse|borsa|dividend|earnings per share|quarterly results of|gynecology|nasa|spacecraft)\b/i,
  /\bARTMS\.[A-Z]{1,3}\b/,
  /\b(idle|idles)\b(?![^.]{0,40}(k-?pop|comeback|album|tour|idol))/i
];

/** Does this alias appear as a whole token (avoids "Rise" ~ "rises", "Lia" ~ "liar")? */
function hasToken(hay, needle) {
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  if (CJK.test(n)) return hay.includes(n);              // CJK has no word boundaries
  const i = hay.indexOf(n);
  if (i < 0) return false;
  const before = hay[i - 1] || ' ';
  const after = hay[i + n.length] || ' ';
  const wordish = /[a-z0-9]/;
  return !wordish.test(before) && !wordish.test(after);
}

/**
 * Group + member tagging.
 *   · group name/alias hit            → group (and any member named in the text)
 *   · long member alias hit           → member only (e.g. "Chaeryeong")
 *   · 2–3 letter latin alias hit      → needs the group named too ("Lia", "Yuna")
 */
function matchArtists(text, artists) {
  const hay = ' ' + text.toLowerCase() + ' ';
  const hits = new Set();
  for (const a of artists) {
    const groupAliases = [...new Set([a.name, a.aka, ...(a.aliases || []), ...(a.terms || [])]
      .filter(Boolean).map((x) => String(x).toLowerCase()))];
    const groupHit = groupAliases.some((t) => hasToken(hay, t));
    const memberHits = [];
    for (const m of a.members || []) {
      const aliases = [...new Set([m.name, ...(m.aliases || [])].filter(Boolean).map((x) => String(x).toLowerCase()))];
      const hit = aliases.find((t) => {
        const latinShort = !CJK.test(t) && t.replace(/[^a-z0-9]/g, '').length <= 3;
        if (latinShort) return groupHit && hasToken(hay, t);   // too ambiguous on its own
        return hasToken(hay, t);
      });
      if (hit) memberHits.push(m.id);
    }
    if (groupHit) hits.add(a.id);
    memberHits.forEach((id) => hits.add(id));
  }
  return [...hits];
}

function tagTopics(text) {
  const hay = ' ' + text.toLowerCase() + ' ';
  const hits = [];
  for (const t of TOPICS) {
    const words = [...t.en, ...t.ko, ...t.zh, ...t.ja];
    const score = words.reduce((n, w) => (w && hay.includes(w.toLowerCase()) ? n + 1 : n), 0);
    if (score > 0) hits.push({ id: t.id, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.map((h) => h.id);
}

/** Restore canonical spellings after machine translation. */
function applyFixups(text) {
  if (!text) return text;
  let out = text;
  for (const [re, to] of FIXUPS) out = out.replace(re, to);
  return out;
}

/** A title like "ITZY's Chaeryeong previews solo debut album" is about Chaeryeong. */
function primaryArtist(item) {
  const t = (item.title || '').toLowerCase();
  const artists = item.artists || [];
  for (const id of artists) {
    if (t.includes(id.toLowerCase())) return id;
  }
  return artists[0] || null;
}

/* --------------------------- summaries --------------------------- */

const CLICKBAIT = /(click|here'?s|watch|see |photos?|look|read more|via |\[photos?\]|\[video\])/i;

/** Trim a dek into 1–2 clean sentences. */
function tidySummary(text, maxLen = 220) {
  let s = (text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // press datelines & bylines
  s = s.replace(/^\s*\[?[A-Z]{2,10}\]?\s*[-–—:]\s*/, '');            // [SEOUL] - ... / SEOUL:
  if (/^\[[^\]]{0,90}\]/.test(s) && /(airport|=|news|reporter|기자|서울|seoul|yonhap|연합|dispatch|일보)/i.test(s.match(/^\[[^\]]{0,90}\]/)[0])) {
    s = s.replace(/^\[[^\]]{0,90}\]\s*/, '');                          // [Incheon Airport = Newsen Reporter X]
  }
  if (/^\([^)]{0,60}\)/.test(s) && /(=|news|reporter|기자|seoul|서울|yonhap|연합)/i.test(s.match(/^\([^)]{0,60}\)/)[0])) {
    s = s.replace(/^\([^)]{0,60}\)\s*/, '');                            // (Seoul = News 1) / (서울=뉴스1)
  }
  s = s.replace(/^(?:Reporter|By|기자)\s+[^=]{2,40}=\s*/i, '');         // Reporter Ko Seung-ah =
  s = s.replace(/^[^=]{0,30}기자\s*=\s*/, '');                          // 고승아 기자 =
  s = s.replace(/^(SEOUL|TOKYO|NEW YORK|LOS ANGELES|HONG KONG|BEIJING|TAIPEI)\s*[-–—,]\s*/i, '');
  s = s.replace(/\s*\[(?:PHOTO|VIDEO|CAPTION|FILE|GETTY)[^\]]*\]\s*/gi, ' ');
  s = s.replace(/\s*\(?:?[^)]{0,10}(?:GETTY|AFP|YONHAP|REUTERS)\)\s*/gi, ' ');
  s = s.replace(/\s*(Read more|Continue reading|Source:|Photo:).*$/i, '');
  if (s.length <= maxLen) return finishSentence(s);
  // cut at sentence boundary near the limit
  const cut = s.slice(0, maxLen);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > 80) return finishSentence(cut.slice(0, lastStop + 1));
  return finishSentence(cut.replace(/[,\s]+\S*$/, '') + '…');
}
function finishSentence(s) {
  s = s.trim();
  if (!s) return s;
  if (!/[.!?…]$/.test(s)) s += '.';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const LANG_LABEL = { ko: 'Korean', zh: 'Chinese', ja: 'Japanese', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', es: 'Spanish', pt: 'Portuguese', fr: 'French', ar: 'Arabic' };

/**
 * Honest brief when a publisher gives us no description: says what the card is,
 * which language it came from, and what it was tagged as — never invents facts.
 */
function fallbackSummary(item, artistNames) {
  const who = artistNames.length ? artistNames.join(', ') : 'K-pop';
  const topic = (TOPICS.find((t) => t.id === (item.topics || [])[0]) || {}).name;
  const from = item.lang && item.lang !== 'en' ? ` (${LANG_LABEL[item.lang] || item.lang} press, machine-translated)` : '';
  const src = item.sourceName ? ` by ${item.sourceName}` : '';
  if (item.kind === 'merch') {
    return `New listing from ${item.sourceName || 'a K-pop store'}${item.price ? ` at $${item.price.amount.toFixed(2)}` : ''}.`;
  }
  if (item.kind === 'official') {
    return `Official post${src}${from} for ${who}.`;
  }
  const tagged = topic ? ` Tagged as ${topic}.` : '';
  return `Headline only${src}${from} — ${who}.${tagged} Tap through for the full story.`;
}

/* ------------------------------ AI ------------------------------ */

function aiConfig(settings) {
  const key = (settings.aiKey || '').trim();
  if (!key) return null;
  const provider = settings.aiProvider && settings.aiProvider !== 'auto'
    ? settings.aiProvider
    : (/^sk-ant-/.test(key) ? 'anthropic' : 'openai');
  const model = settings.aiModel || (provider === 'anthropic' ? 'claude-3-5-haiku-latest' : 'gpt-4o-mini');
  return { key, provider, model };
}

async function callAI(cfg, system, user, maxTokens = 300) {
  const { get } = require('./net');
  const https = require('https');
  const body = JSON.stringify(cfg.provider === 'anthropic'
    ? { model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }
    : { model: cfg.model, max_tokens: maxTokens, temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
  const host = cfg.provider === 'anthropic' ? 'api.anthropic.com' : 'api.openai.com';
  const path = cfg.provider === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
  return new Promise((resolve) => {
    const req = https.request({
      hostname: host, path, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(cfg.provider === 'anthropic'
          ? { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' }
          : { authorization: `Bearer ${cfg.key}` })
      },
      timeout: 25000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const text = cfg.provider === 'anthropic'
            ? (d.content || []).map((c) => c.text).join('')
            : ((d.choices || [])[0] || {}).message.content;
          resolve(text || null);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

/** Summarize a batch of items in one AI call (cheap) → { id: text } */
async function aiSummaries(items, settings, artistNameFor) {
  const cfg = aiConfig(settings);
  if (!cfg || !items.length) return {};
  const numbered = items.map((it, i) => {
    const who = artistNameFor(it);
    const dek = tidySummary(it.summaryOriginal || it.summary || '', 300);
    return `${i + 1}. [${who}] ${it.title}${dek ? ` — ${dek}` : ''}`;
  }).join('\n');
  const system = 'You are a K-pop news editor writing concise, factual briefs for a fan dashboard. ' +
    'Never invent facts that are not present in the given headline or dek. If information is thin, restate the headline plainly.';
  const user = `For each numbered K-pop item below, write ONE sentence (max 28 words) in English explaining what happened and why a fan cares.\n` +
    `Reply ONLY as a JSON array of objects: [{"n":1,"summary":"..."}]. No prose, no markdown.\n\n${numbered}`;
  const raw = await callAI(cfg, system, user, 60 * Math.min(items.length, 20) + 80);
  if (!raw) return {};
  const out = {};
  try {
    const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
    const arr = JSON.parse(json);
    for (const row of arr) {
      const idx = Number(row.n) - 1;
      if (idx >= 0 && idx < items.length && row.summary) out[items[idx].id] = String(row.summary).trim();
    }
  } catch (e) { /* malformed → ignore, keep extractive */ }
  return out;
}

/** One AI call to summarize "what changed since last search" for saved subjects. */
async function aiDigest(items, settings, artistNameFor) {
  const cfg = aiConfig(settings);
  if (!cfg || items.length < 3) return null;
  const list = items.slice(0, 20).map((it) => `- [${artistNameFor(it)}] ${it.title}`).join('\n');
  const system = 'You write tight K-pop news digests for fans. Only use the headlines given; do not invent details.';
  const user = `Headlines from the last few days:\n${list}\n\nWrite a 3-sentence digest (max 70 words) of the most important developments, naming the artists. Plain text only.`;
  return await callAI(cfg, system, user, 220);
}

/* --------------------------- main pipeline --------------------------- */

async function enrichBatch(rawItems, { settings, artists, labelName = {}, budget = 8 }) {
  const items = rawItems.filter((i) => i && i.title);

  // 1. language detect + translate titles/deks (deks live in either field)
  const toTranslate = [];
  for (const it of items) {
    const dek = it.summaryRaw || it.summary || '';
    const detected = detectLang(`${it.title} ${dek}`);
    it.lang = detected !== 'en' ? detected : (it.lang && it.lang !== 'auto' ? it.lang : 'en');
    it.summaryRaw = dek;
    if (detected !== 'en') {
      toTranslate.push({ text: it.title, lang: detected, apply: (v) => { it.titleOriginal = it.title; it.title = v; } });
      if (dek) toTranslate.push({ text: dek, lang: detected, apply: (v) => { it.summaryOriginal = dek; it.summary = v; } });
    } else {
      it.titleOriginal = it.titleOriginal || it.title;
      it.summary = it.summary || dek;
    }
  }
  if (toTranslate.length) {
    const out = await translateAll(toTranslate.map((t) => ({ text: t.text, lang: t.lang })), budget);
    toTranslate.forEach((t, i) => { if (out[i]) t.apply(out[i]); });
  }

  // 2. deks for items that need them (og:description), most important first
  const needDek = items.filter((i) => !tidySummary(i.summary || '').length && i.url && !/news\.google\.com/.test(i.url));
  await pool(needDek.slice(0, 40).map((it) => async () => {
    const d = await fetchDek(it.url);
    if (d && d.dek) {
      const translated = it.lang && it.lang !== 'en' ? await translate(d.dek, it.lang) : d.dek;
      it.summary = tidySummary(translated);
      it.summaryOriginal = tidySummary(d.dek);
      if (translated && translated.length > 12) it.summarySource = 'publisher';
    }
  }), 6);

  // 2b. canonical spellings for machine-mangled names
  for (const it of items) {
    it.title = applyFixups(it.title);
    if (it.summary) it.summary = applyFixups(it.summary);
  }

  // 3. tagging + scoring
  for (const it of items) {
    const text = `${it.title} ${it.summary || ''} ${it.sourceName || ''}`;
    it.artists = it.artists && it.artists.length ? it.artists : matchArtists(text, artists);
    // a member mention also pulls in their group (for filters + labels)
    for (const a of artists) {
      for (const m of a.members || []) {
        if (it.artists.includes(m.id) && !it.artists.includes(a.id)) it.artists.push(a.id);
      }
    }
    it.topics = it.topics && it.topics.length ? it.topics : tagTopics(text);
    it.primaryTopic = it.topics[0] || null;
    it.noise = it.artists.length <= 1 && NOISE_PATTERNS.some((re) => re.test(it.title + ' ' + (it.summaryRaw || '')));
    it.summary = tidySummary(it.summary) || fallbackSummary(it, it.artists.map((a) => labelName[a] || a));
    if (!it.summarySource && tidySummary(it.summaryRaw || '').length > 30) it.summarySource = 'publisher';
    if (/^Headline only/.test(it.summary) || /^New listing/.test(it.summary) || /^Official post/.test(it.summary)) it.summarySource = 'fallback';
    it.score = scoreItem(it);
  }

  // drop obvious noise: nothing about our artists AND not an official/label/merch hit
  const kept = items.filter((it) => {
    if (it.noise) return false;
    if (it.kind === 'merch') return it.artists.length > 0 || it.sourceType === 'store';
    if (it.sourceType === 'youtube' || it.sourceType === 'official-site') return true;
    return it.artists.length > 0;
  });

  await translateSummaries(kept, budget);

  // 4. AI pass (optional) — summaries for top items + digest
  let digest = null;
  const mode = settings.summaryMode || 'both';
  const cfg = aiConfig(settings);
  if (cfg && mode !== 'automatic') {
    const top = kept.slice(0, 16);
    const aiOut = await aiSummaries(top, settings, (it) => (it.artists || []).map((a) => labelName[a] || a).join(' / ') || 'K-pop');
    for (const it of top) if (aiOut[it.id]) { it.summary = aiOut[it.id]; it.summarySource = 'ai'; }
  }
  return { items: kept, digest };
}

function scoreItem(it) {
  let s = 0;
  s += it.kind === 'news' ? 30 : it.kind === 'official' ? 24 : it.kind === 'merch' ? 20 : 18;
  s += Math.min(12, (it.artists || []).length * 4);
  if (it.kind === 'merch' && it.price) s += 2;
  if (/comeback|tour|album|debut|contract|lawsuit|hiatus/i.test(it.title)) s += 6;
  if (it.summarySource === 'ai') s += 3;
  if (it.summarySource === 'fallback') s -= 4;
  if (it.kind === 'official' && (it.media === null)) s -= 2;
  if (it.summary && it.summary.length > 60) s += 2;
  const age = Date.now() - Date.parse(it.publishedAt || 0);
  if (!isNaN(age)) s += Math.max(0, 8 - age / 86400000);
  return Math.round(s * 10) / 10;
}

const matchMemberOnly = (text, artists) => matchArtists(text, artists).filter((id) => !artists.some((a) => a.id === id));

/** Translate AI/mirror summaries that arrived in the original language. */
async function translateSummaries(items, budget = 6) {
  const todo = items.filter((i) => i.summary && detectLang(i.summary) !== 'en');
  if (!todo.length) return;
  const out = await translateAll(todo.map((i) => ({ text: i.summary, lang: detectLang(i.summary) })), budget);
  todo.forEach((it, n) => { if (out[n]) { it.summaryOriginal = it.summary; it.summary = tidySummary(out[n]); } });
}

module.exports = {
  translateSummaries, applyFixups,
  enrichBatch, matchArtists, tagTopics, primaryArtist,
  tidySummary, fallbackSummary, aiConfig, aiSummaries, aiDigest, scoreItem
};
}};

/* ======================== db ======================== */
__KPR_MODULES__["db.js"] = { exports: {}, loaded: false, require: __kprRequire, fn: function (exports, require, module) {
/**
 * db.js — dead-simple atomic JSON store (no native deps, survives restarts).
 * Keeps: settings, roster, official-channel overrides, stored items,
 * permanent saves, "saved subjects" and a small activity log.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ARTISTS, COMPANIES, STORES, OFFICIAL, DEFAULTS, TOPICS, LOCALES, BING_MARKETS, SPECIALTY_FEEDS } = require('./catalog');

const DATA_DIR = process.env.KPR_DATA_DIR || path.join(process.cwd(), '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'state.json');
const MAX_ITEMS = 4000;

let state = null;
let saveTimer = null;

const clone = (o) => JSON.parse(JSON.stringify(o));

function seed() {
  const artists = clone(ARTISTS).map((a) => ({
    ...a,
    enabled: true,
    source: 'seed',
    members: a.members.map((m) => ({ ...m, enabled: true }))
  }));
  const roster = {};
  for (const a of artists) {
    roster[a.id] = { group: true, members: a.members.map((m) => m.id) };
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    settings: { ...clone(DEFAULTS) },
    artists,
    roster,
    companies: COMPANIES.map((c) => c.id),
    stores: STORES.map((s) => s.id),
    official: clone(OFFICIAL),
    items: [],
    deleted: {},          // normalizedUrlHash -> deletedAt
    savedSubjects: [],
    logs: [],
    lastSearchAt: null,
    lastSearchStats: null
  };
}

function load() {
  if (state) return state;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      // heal schema additions
      const seedState = seed();
      state.settings = { ...seedState.settings, ...(state.settings || {}) };
      state.stores = state.stores && state.stores.length ? state.stores : seedState.stores;
      state.companies = state.companies && state.companies.length ? state.companies : seedState.companies;
      state.official = state.official || seedState.official;
      state.savedSubjects = state.savedSubjects || [];
      // refresh labels created by older builds
      for (const sub of state.savedSubjects) {
        const fixed = buildSubjectLabel({}, sub.artistIds || [], sub.topicId);
        if (fixed && fixed !== sub.label) sub.label = fixed;
      }
      state.deleted = state.deleted || {};
      state.logs = state.logs || [];
      state.items = state.items || [];
      // register channels for artists added later
      for (const a of state.artists) if (!state.official[a.id]) state.official[a.id] = clone(OFFICIAL[a.id] || { sites: [], youtube: [], instagram: [] });
    } else {
      state = seed();
      save(true);
    }
  } catch (e) {
    console.error('db load failed, reseeding:', e.message);
    state = seed();
    save(true);
  }
  return state;
}

function save(immediate) {
  if (saveTimer) clearTimeout(saveTimer);
  const doSave = () => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
      fs.renameSync(tmp, FILE);
    } catch (e) { console.error('db save failed:', e.message); }
  };
  if (immediate) return doSave();
  saveTimer = setTimeout(doSave, 800);
}

/* ------------------------------ helpers ------------------------------ */

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

function normUrl(u = '') {
  try {
    const url = new URL(u);
    const junk = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'oc', 'hl', 'gl', 'ceid', 'ref', 'ref_src', 'fbclid', 'gclid'];
    junk.forEach((k) => url.searchParams.delete(k));
    url.hash = '';
    return (url.hostname.replace(/^www\./, '') + url.pathname + (url.search || '')).replace(/\/$/, '');
  } catch (e) { return String(u); }
}

function normTitle(t = '') {
  return t.toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, '')
    .replace(/\[[^\]]{0,30}\]/g, ' ')
    .replace(/\([^)]{0,3}\)/g, ' ')
    .replace(/[^a-z0-9\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemKey(item) {
  return hash(normTitle(item.title).slice(0, 90) || normUrl(item.url));
}

/* ------------------------------ items ------------------------------ */

function isDeleted(item) {
  const keys = [hash(normUrl(item.url)), hash(normTitle(item.title).slice(0, 90))];
  return keys.some((k) => state.deleted[k]);
}

/** Insert/replace items; returns { added, updated, skipped } */
function upsertItems(incoming) {
  load();
  const index = new Map(state.items.map((it) => [it.id, it]));
  const out = { added: 0, updated: 0 };
  for (const raw of incoming) {
    if (!raw || !raw.title) continue;
    if (isDeleted(raw)) continue;
    const id = itemKey(raw);
    const existing = index.get(id);
    if (existing) {
      // enrich, never lose a summary or a real URL
      const merged = { ...existing };
      if (!existing.summary && raw.summary) merged.summary = raw.summary;
      if (!existing.summaryOriginal && raw.summaryOriginal) merged.summaryOriginal = raw.summaryOriginal;
      if (!existing.image && raw.image) merged.image = raw.image;
      if (!existing.price && raw.price) merged.price = raw.price;
      if (raw.sources && existing.sources) {
        const names = new Set(existing.sources.map((s) => s.name));
        merged.sources = existing.sources.concat(raw.sources.filter((s) => !names.has(s.name)));
      }
      if (raw.score > (existing.score || 0)) merged.score = raw.score;
      merged.artists = [...new Set([...(existing.artists || []), ...(raw.artists || [])])];
      merged.topics = [...new Set([...(existing.topics || []), ...(raw.topics || [])])];
      merged.pinned = existing.pinned;
      merged.savedSubjectId = existing.savedSubjectId || raw.savedSubjectId || null;
      if (!merged.firstSeenAt) merged.firstSeenAt = raw.firstSeenAt || new Date().toISOString();
      index.set(id, merged);
      out.updated++;
    } else {
      const item = {
        ...raw,
        id,
        isNew: true,
        pinned: false,
        firstSeenAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString()
      };
      index.set(id, item);
      out.added++;
    }
  }
  state.items = [...index.values()];
  // cap: keep pinned + newest
  if (state.items.length > MAX_ITEMS) {
    state.items.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
    state.items = state.items.slice(0, MAX_ITEMS);
  }
  return out;
}

function listItems({ windowDays, kind, artistId, topic, onlyNew, saved, deleted, limit = 400 } = {}) {
  load();
  const now = Date.now();
  let items = state.items.filter((it) => {
    if (deleted) return !!it.deletedAt;
    if (it.deletedAt) return false;
    return true;
  });
  if (saved) items = items.filter((i) => i.pinned);
  if (kind && kind !== 'all') {
    if (kind === 'news') items = items.filter((i) => i.kind === 'news' || i.kind === 'label');
    else items = items.filter((i) => i.kind === kind);
  }
  if (artistId) items = items.filter((i) => (i.artists || []).includes(artistId));
  if (topic) items = items.filter((i) => (i.topics || []).includes(topic));
  if (onlyNew) items = items.filter((i) => i.isNew);
  if (windowDays) {
    const cutoff = now - windowDays * 86400000;
    items = items.filter((i) => {
      const t = Date.parse(i.publishedAt || i.firstSeenAt || 0);
      return isNaN(t) ? true : t >= cutoff;
    });
  }
  // pinned first, then best-scored (news & official outrank merch), then newest
  items.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
    (b.score || 0) - (a.score || 0) ||
    new Date(b.publishedAt || b.firstSeenAt || 0) - new Date(a.publishedAt || a.firstSeenAt || 0));
  return items.slice(0, limit);
}

function setPinned(id, pinned) {
  load();
  const it = state.items.find((i) => i.id === id);
  if (!it) return null;
  it.pinned = !!pinned;
  it.isNew = false;
  if (pinned) {
    it.savedAt = new Date().toISOString();
    const subj = ensureSubjectFor(it);
    it.savedSubjectId = subj.id;
  } else {
    it.savedAt = null;
    it.savedSubjectId = null;
  }
  save(true);
  return it;
}

function deleteItem(id) {
  load();
  const i = state.items.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const it = state.items[i];
  it.deletedAt = new Date().toISOString();
  it.pinned = false;
  state.deleted[hash(normUrl(it.url))] = it.deletedAt;
  state.deleted[hash(normTitle(it.title).slice(0, 90))] = it.deletedAt;
  state.items.splice(i, 1);
  save(true);
  return true;
}

function undeleteAll() {
  load();
  state.deleted = {};
  save(true);
}

/* --------------------------- saved subjects --------------------------- */
/**
 * A starred headline becomes a standing "subject" — a thing the radar keeps
 * an eye on: "ITZY × Tour & Concerts: <headline>". Next full search adds a
 * query for it and tags matching hits as updates.
 */
function ensureSubjectFor(item) {
  load();
  const artists = item.artists || [];
  const topics = item.topics || [];
  const primary = item.primaryTopic || topics[0] || 'general';
  const key = `${artists.slice().sort().join(',')}::${primary}`;
  let subj = state.savedSubjects.find((s) => s.key === key);
  if (!subj) {
    subj = {
      id: hash(key + Date.now()),
      key,
      label: buildSubjectLabel(item, artists, primary),
      artistIds: artists,
      topicId: primary,
      keywords: subjectKeywords(item),
      seedTitle: item.title,
      createdAt: new Date().toISOString(),
      lastSearchAt: null,
      hits: 0,
      active: true,
      itemIds: []
    };
    state.savedSubjects.push(subj);
  }
  if (!subj.itemIds.includes(item.id)) subj.itemIds.push(item.id);
  save();
  return subj;
}

function buildSubjectLabel(item, artists, primary) {
  load();
  const topic = TOPICS.find((t) => t.id === primary);
  // if a group is present, name the group; otherwise name the members
  const groups = artists.filter((id) => state.artists.some((a) => a.id === id));
  const who = groups.length
    ? groups.map(prettyId).join(' + ')
    : (artists.map((id) => prettyId(id).replace(/\s*\([^)]*\)$/, '')).join(' + ') || 'K-pop');
  return `${who} · ${topic ? topic.name : 'News'}`;
}

function prettyId(id) {
  load();
  for (const a of state.artists) {
    if (a.id === id) return a.name;
    const m = (a.members || []).find((x) => x.id === id);
    if (m) return `${m.name} (${a.name})`;
  }
  return id;
}

function subjectKeywords(item) {
  const words = normTitle(item.title).split(' ').filter((w) => w.length > 3);
  return [...new Set(words)].slice(0, 6);
}

function listSubjects() { load(); return state.savedSubjects; }

/** Mark freshly-found items as follow-ups of a standing subject. */
function tagSubjectHits(subjectId, itemIds) {
  load();
  let n = 0;
  for (const it of state.items) {
    if (itemIds.includes(it.id) && it.savedSubjectId !== subjectId) {
      it.savedSubjectId = subjectId;
      n++;
    }
  }
  if (n) save();
  return n;
}

/** Items created since a timestamp that match a subject's artist + topic. */
function subjectFollowUps(subject, sinceIso) {
  load();
  const topic = subject.topicId;
  return state.items.filter((it) => {
    if (it.deletedAt || it.pinned) return false;
    if ((it.firstSeenAt || '') < sinceIso) return false;
    const artistMatch = (subject.artistIds || []).some((a) => (it.artists || []).includes(a));
    if (!artistMatch) return false;
    return !topic || (it.topics || []).includes(topic) || true; // topic is a hint, not a gate
  });
}

function updateSubject(id, patch) {
  load();
  const s = state.savedSubjects.find((x) => x.id === id);
  if (!s) return null;
  Object.assign(s, patch);
  save(true);
  return s;
}

function deleteSubject(id) {
  load();
  state.savedSubjects = state.savedSubjects.filter((s) => s.id !== id);
  save(true);
}

/* ------------------------------ retention ------------------------------ */
function sweep() {
  load();
  const days = Number(state.settings.retentionDays || 30);
  const cutoff = Date.now() - days * 86400000;
  const before = state.items.length;
  state.items = state.items.filter((it) => {
    if (it.pinned) return true;
    const t = Date.parse(it.fetchedAt || it.firstSeenAt || 0);
    return isNaN(t) ? true : t >= cutoff;
  });
  const removed = before - state.items.length;
  if (removed) save();
  return removed;
}

function pruneDeleted(days = 90) {
  load();
  const cutoff = Date.now() - days * 86400000;
  let changed = false;
  for (const [k, v] of Object.entries(state.deleted)) {
    if (Date.parse(v) < cutoff) { delete state.deleted[k]; changed = true; }
  }
  if (changed) save();
}

function markAllSeen() {
  load();
  for (const it of state.items) it.isNew = false;
  save(true);
}

function logSearch(entry) {
  load();
  state.lastSearchAt = entry.at || new Date().toISOString();
  state.lastSearchStats = entry;
  state.logs.unshift(entry);
  state.logs = state.logs.slice(0, 40);
  save();
}

module.exports = {
  load, save, hash, normUrl, normTitle, upsertItems, listItems, setPinned,
  deleteItem, undeleteAll, ensureSubjectFor, listSubjects, updateSubject,
  deleteSubject, sweep, pruneDeleted, markAllSeen, logSearch, prettyId, tagSubjectHits, subjectFollowUps
};
}};

/* ======================== search ======================== */
__KPR_MODULES__["search.js"] = { exports: {}, loaded: false, require: __kprRequire, fn: function (exports, require, module) {
/**
 * search.js — orchestrates a full radar sweep.
 *
 * Plan of attack for one "Search now":
 *   A. news      : Google News in every enabled language (artists + intent)
 *                  → dedupe → translate to English
 *   B. news      : Bing News in the biggest markets (real URLs + real deks)
 *   C. official  : YouTube uploads for every artist channel + official sites/Weverse
 *   D. label     : record company press rooms (new groups, tours, merch)
 *   E. merch     : flagship stores (Shopify search + new arrivals) + site: sweeps
 *   F. subjects  : standing queries created by your starred headlines
 *   G. filter by window → tag/score → store → sweep retention
 */
const crypto = require('crypto');
const net = require('./lib/net');
const db = require('./lib/db');
const S = require('./lib/sources');
const E = require('./lib/enrich');
const { LOCALES, BING_MARKETS, SPECIALTY_FEEDS, STORES, COMPANIES, TOPICS, MERCH_MODIFIERS } = require('./lib/catalog');

const BIG_MARKETS = ['en-US', 'ko', 'zh-TW', 'ja'];

let running = false;
let progress = { phase: 'idle', done: 0, total: 0, message: '' };

function setProgress(phase, done, total, message) {
  progress = { phase, done, total, message, at: Date.now() };
}

/** Active roster → artist objects (groups always on; members only if enabled). */
function activeArtists(state) {
  return state.artists
    .filter((a) => a.enabled !== false)
    .map((a) => ({
      ...a,
      members: (a.members || []).filter((m) => m.enabled !== false)
    }));
}

function labelNames(state) {
  const map = {};
  for (const a of state.artists) {
    map[a.id] = a.name;
    for (const m of a.members || []) map[m.id] = m.name;
  }
  return map;
}

/** Everything the sweep needs, built once. */
function buildPlan(state) {
  const artists = activeArtists(state);
  const locales = LOCALES.filter((l) => state.settings.locales.includes(l.id));
  const plan = { gn: [], bing: [], yt: [], sites: [], stores: [], specialty: [], subjects: [] };

  // A. Google News: all artists as one OR-query per locale (cheap + broad),
  //    plus a member-only precision pass for English + primary language.
  for (const loc of locales) {
    plan.gn.push(...S.googleNewsQueries({ artists, enabledTopics: state.settings.enabledTopics }, loc));
  }
  // per-artist precision queries in the top markets
  for (const loc of locales.filter((l) => BIG_MARKETS.includes(l.id))) {
    for (const a of artists) {
      plan.gn.push({ type: 'news-artist', locale: loc.id, lang: loc.lang, artistId: a.id, q: a.terms.slice(0, 2).map(S.quote).join(' OR ') });
    }
  }

  // B. Bing News (real URLs/deks)
  const markets = BING_MARKETS.filter((m) => (state.settings.bingMarkets || []).includes(m.id));
  for (const m of markets) {
    for (const a of artists) plan.bing.push(...S.bingQueriesFor(a, m, state.settings.enabledTopics));
  }

  // C. Official channels & sites
  for (const a of state.artists.concat([])) {
    if (a.enabled === false) continue;
    const off = state.official[a.id] || {};
    for (const ch of off.youtube || []) plan.yt.push({ ...ch, artistId: a.id });
    for (const site of off.sites || []) plan.sites.push({ ...site, artistId: a.id });
  }

  // D. Label press rooms → news queries scoped to new groups/tours/merch
  for (const loc of locales.filter((l) => BIG_MARKETS.includes(l.id))) {
    plan.gn.push(...S.labelQueries({ companies: state.companies }, loc));
  }

  // E. Merch
  const stores = STORES.filter((s) => (state.stores || []).includes(s.id));
  for (const st of stores) {
    if (st.kind === 'shopify') plan.stores.push({ store: st, mode: 'new' });
    for (const a of artists) {
      if (st.kind === 'shopify') plan.stores.push({ store: st, mode: 'search', artist: a });
      const q = S.storeNewsQuery(st, a, LOCALES[0]);
      if (q) plan.gn.push(q);
    }
  }
  // generic merch-intent sweep in the two main languages
  const en = LOCALES.find((l) => l.id === 'en-US');
  const ko = LOCALES.find((l) => l.id === 'ko');
  for (const loc of [en, ko].filter(Boolean)) {
    const mods = MERCH_MODIFIERS[loc.lang === 'ko' ? 'ko' : 'en'].slice(0, 3).map(S.quote);
    plan.gn.push({ type: 'merch-intent', locale: loc.id, lang: loc.lang, q: `${S.artistClause(artists)} (${mods.join(' OR ')})` });
  }

  // F. Specialty outlets
  plan.specialty = SPECIALTY_FEEDS.filter((f) => (state.settings.specialty || []).includes(f.id) && f.on !== false);

  // G. Standing subjects from starred headlines
  plan.subjects = (state.savedSubjects || []).filter((s) => s.active !== false);
  return plan;
}

async function runSearch({ reason = 'manual' } = {}) {
  if (running) return { ok: false, error: 'busy' };
  running = true;
  const started = Date.now();
  const state = db.load();
  const settings = state.settings;
  const names = labelNames(state);
  const artists = activeArtists(state);

  try {
    db.sweep();
    const plan = buildPlan(state);
    const total = plan.gn.length + plan.bing.length + plan.yt.length + plan.sites.length +
      plan.stores.length + plan.specialty.length + plan.subjects.length;
    let done = 0;
    const tick = (label) => { done++; setProgress('fetch', done, total, label); };
    setProgress('fetch', 0, total, 'Starting sweep…');

    const raw = [];
    const errors = [];

    // ---------- A + D + F(subjects) via Google News ----------
    const gnTasks = plan.gn.map((q) => async () => {
      try {
        const got = await S.fetchGoogleNewsOne(q);
        if (q.type === 'label') got.forEach((g) => { g.kind = 'label'; g.labelWatch = true; });
        raw.push(...got);
      } catch (e) { errors.push('gn:' + e.message); }
      tick('Google News · ' + (q.locale || ''));
    });
    // subject queries
    for (const subj of plan.subjects) {
      const loc = LOCALES.find((l) => l.id === 'en-US');
      const terms = subj.artistIds && subj.artistIds.length
        ? subj.artistIds.map((id) => names[id]).filter(Boolean).slice(0, 2).map(S.quote).join(' OR ')
        : '';
      const topic = TOPICS.find((t) => t.id === subj.topicId);
      const kw = topic ? topic.en.slice(0, 4).map(S.quote).join(' OR ') : '';
      if (terms) {
        gnTasks.push(async () => {
          try {
            const got = await S.fetchGoogleNewsOne({ locale: loc.id, lang: 'en', q: `${terms} (${kw})` });
            got.forEach((g) => { g.savedSubjectId = subj.id; g.subjectLabel = subj.label; });
            raw.push(...got);
          } catch (e) { errors.push('subj:' + e.message); }
          tick('Saved subject · ' + subj.label);
        });
      }
    }
    const bingTasks = plan.bing.map((q) => async () => {
      try { raw.push(...(await S.fetchBingNewsOne(q))); } catch (e) { errors.push('bing:' + e.message); }
      tick('Bing News · ' + q.mkt);
    });
    const ytTasks = plan.yt.map((ch) => async () => {
      try { raw.push(...(await S.fetchYouTubeChannel(ch))); } catch (e) { errors.push('yt:' + ch.name); }
      tick('YouTube · ' + ch.name);
    });
    const siteTasks = plan.sites.map((site) => async () => {
      try { raw.push(...(await S.fetchOfficialSite(site))); } catch (e) { errors.push('site:' + site.name); }
      tick('Official site · ' + site.name);
    });
    const specialtyTasks = plan.specialty.map((f) => async () => {
      try { raw.push(...(await S.fetchSpecialty(f))); } catch (e) { errors.push('feed:' + f.name); }
      tick('Feed · ' + f.name);
    });
    const storeTasks = plan.stores.map((st) => async () => {
      try {
        if (st.mode === 'new') {
          const prods = await S.fetchShopifyNew(st.store);
          const ours = prods.filter((p) => E.matchArtists(p.title, artists).length);
          raw.push(...ours);
        } else {
          raw.push(...(await S.fetchShopifySuggest(st.store, st.artist)));
        }
      } catch (e) { errors.push('store:' + st.store.id); }
      tick('Store · ' + st.store.name);
    });

    // run in waves so we stay polite and fast
    await net.pool([...gnTasks], 10);
    await net.pool([...bingTasks], 6);
    await net.pool([...ytTasks, ...siteTasks, ...specialtyTasks], 8);
    await net.pool([...storeTasks], 6);

    setProgress('process', done, total, 'Translating & summarizing…');

    // ---------- window filter before we enrich (saves translate calls) ----------
    const windowDays = Number(settings.windowDays || 3);
    const cutoff = Date.now() - windowDays * 86400000;
    // store inventories: keep only products tied to a roster artist that actually
    // look like a release or goods (drops magazines, gift cards, other groups' stock)
    const RELEASE = /(album|미니|정규|single|싱글|ep\b|ver\.?|version|photobook|포토북|light ?stick|응원봉|photocard|포토카드|season'?s? ?greeting|시즌그리팅|merch|goods|굿즈|poster|키트|kit\b|blu-?ray|vinyl|lp\b|dvd|poca|platform|플랫폼|digipack|디지팩|jewel|한정|limited|pre-?order|예약|set\b|세트)/i;
    const MERCH_FRESH_DAYS = 150;   // older catalogue stock isn't a "drop"
    const freshCut = Date.now() - MERCH_FRESH_DAYS * 86400000;
    const ours = raw.filter((it) => {
      if (it.kind !== 'merch') return true;
      if (it.sourceType === 'store') {
        if (it.publishedAt && Date.parse(it.publishedAt) < freshCut) return false;
        const t = it.title || '';
        const isOurs = E.matchArtists(t, artists).length > 0;
        const looksLikeRelease = RELEASE.test(t) || RELEASE.test(it.productType || '');
        return isOurs && looksLikeRelease;
      }
      return true;
    });
    const merged = dedupeRaw(ours).filter((it) => {
      if (it.kind === 'merch') return true;                 // store listings are timeless inventory
      if (!it.publishedAt) return windowDays >= 30;         // undated pages only for "last month" sweeps
      return Date.parse(it.publishedAt) >= cutoff;
    });

    // ---------- enrich (translate, summarize, tag, score) ----------
    const { items } = await E.enrichBatch(merged.slice(0, 700), { settings, artists, labelName: names });

    // ---------- second pass: find the real publisher URL + dek ----------
    // Google News hides both, so for headline-only cards we ask Bing — in the
    // article's own language, using its translated keywords (news translates
    // better than it matches exact titles).
    const blankOnes = items.filter((it) => /news\.google\.com/.test(it.url) && it.kind !== 'merch' &&
      (it.summarySource === 'fallback' || !it.summarySource)).slice(0, 20);
    if (blankOnes.length) {
      setProgress('process', done, total, 'Matching publishers…');
      await net.pool(blankOnes.map((it) => async () => {
        const marketFor = { ko: 'ko-KR', ja: 'ja-JP', zh: 'zh-TW', th: 'th-TH', vi: 'vi-VN', id: 'id-ID' }[it.lang] || 'en-US';
        const artistName = (it.artists || []).map((a) => names[a]).filter(Boolean)[0] || '';
        const stop = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'his', 'her', 'its', 'has', 'have', 'will', 'was', 'are']);
        const stem = it.title.replace(/[\[\]"'“”‘’…、。,]/g, ' ').split(/\s+/)
          .filter((w) => w.length > 2 && !stop.has(w.toLowerCase())).slice(0, 5).join(' ');
        const attempts = [
          `${artistName} ${stem}`.trim(),
          stem
        ];
        let best = null;
        for (const q of attempts) {
          if (!q) continue;
          try {
            const got = await S.fetchBingNewsOne({ q, mkt: marketFor, lang: it.lang || 'en' });
            const m = bestMatch(it.title, got);
            if (m && (!best || (m.summary || '').length > (best.summary || '').length)) best = m;
            if (best && best.summary && best.summary.length > 60) break;
          } catch (e) { /* try the next phrasing */ }
        }
        if (best) {
          if (best.summary && best.summary.length > 40) { it.summary = best.summary; it.summarySource = 'publisher'; }
          if (best.url && !/bing\.com/.test(best.url)) it.url = best.url;
          if (best.sourceName) { it.sourceName = best.sourceName; it.sourceUrl = best.sourceUrl; }
          it.mirrored = true;
          it.sources = [...(it.sources || []), { name: best.sourceName, url: best.url }];
        }
      }), 6);
      // titles/deks that came back in another language get translated
      await E.translateSummaries(items.filter((i) => i.mirrored && i.summary && i.lang !== 'en'), 6);
    }

    // ---------- collapse merch variants into one "drop" card ----------
    const collapsed = mergeSimilar(collapseMerch(items, names));

    // ---------- store ----------
    setProgress('store', done, total, 'Saving…');
    const res = db.upsertItems(collapsed);

    // ---------- standing-subject bookkeeping ----------
    // Anything that surfaced for a starred subject's artist+topic since this
    // sweep started is recorded as a follow-up and badged in the UI.
    const windowStart = new Date(started).toISOString();
    for (const subj of plan.subjects) {
      const ups = db.subjectFollowUps(subj, windowStart).filter((it) => !(subj.itemIds || []).includes(it.id));
      if (ups.length) {
        db.tagSubjectHits(subj.id, ups.map((i) => i.id));
        subj.hits = (subj.hits || 0) + ups.length;
        subj.lastSearchAt = windowStart;
        subj.lastHitTitle = ups[0].title;
      }
    }

    const removed = db.sweep();

    // digest of what's new since the previous sweep
    let digest = null;
    const newItems = db.listItems({ windowDays, limit: 60 }).filter((i) => i.isNew);
    if (newItems.length >= 3) {
      digest = await E.aiDigest(newItems, settings, (it) => (it.artists || []).map((a) => names[a] || a).join(' / ') || 'K-pop');
    }

    const stats = {
      at: new Date().toISOString(),
      reason,
      ms: Date.now() - started,
      queries: total,
      fetched: raw.length,
      deduped: merged.length,
      added: res.added,
      updated: res.updated,
      pruned: removed,
      digest,
      errors: errors.slice(0, 20)
    };
    db.logSearch(stats);
    db.save(true);
    setProgress('idle', total, total, 'Done');
    return { ok: true, stats };
  } catch (e) {
    setProgress('error', 0, 0, e.message);
    return { ok: false, error: e.message };
  } finally {
    running = false;
  }
}

/**
 * collapse near-duplicates across outlets & languages.
 * Merch listings additionally get a canonical key so the 12 variants of one
 * album (photobook / digipack / platform / random cover…) show up as one drop.
 */
function dedupeRaw(items) {
  const byKey = new Map();
  const merchKey = (it) => {
    let t = (it.titleOriginal || it.title || '').toLowerCase();
    t = t.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');
    t = t.replace(/\b(pre[- ]?order|in stock|restock|new|sold out|ready to ship|random\s*ver\.?|ver\.?\s*[a-z0-9]+|version[^,]*)\b/g, ' ');
    t = t.replace(/[^a-z0-9\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim();
    // keep the release identity: artist + album-ish words (first 7 tokens)
    return 'merch:' + t.split(' ').slice(0, 7).join(' ');
  };
  for (const it of items) {
    const key = it.kind === 'merch' ? merchKey(it) : normalizeTitle(it.titleOriginal || it.title);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...it, sources: [{ name: it.sourceName, url: it.url }] });
      continue;
    }
    const names = new Set(existing.sources.map((s) => s.name));
    if (!names.has(it.sourceName)) existing.sources.push({ name: it.sourceName, url: it.url });
    // prefer a copy with a real URL, a real summary, or a lower price
    if ((!existing.summary && it.summary) ||
        (/news\.google\.com/.test(existing.url) && !/news\.google\.com/.test(it.url))) {
      existing.summary = existing.summary || it.summary;
      existing.url = /news\.google\.com/.test(it.url) ? existing.url : it.url;
      existing.sourceName = it.sourceName || existing.sourceName;
      existing.publishedAt = existing.publishedAt || it.publishedAt;
    }
    if (it.kind === 'merch') {
      if (!existing.price && it.price) { existing.price = it.price; existing.url = it.url; existing.sourceName = it.sourceName; }
      else if (it.price && existing.price && it.price.amount < existing.price.amount) {
        existing.price = it.price; existing.url = it.url; existing.sourceName = it.sourceName;
      }
      if (!existing.image && it.image) existing.image = it.image;
    }
    existing.artists = [...new Set([...(existing.artists || []), ...(it.artists || [])])];
    existing.kind = existing.kind || it.kind;
  }
  return [...byKey.values()];
}

/**
 * Same story, many outlets: cluster titles that share most of their meaningful
 * words for the same artist. The best copy wins; every other outlet is kept in
 * "sources" and shown as "+N src" on the card.
 */
function mergeSimilar(items) {
  const STOP = new Set(['the','and','for','with','from','that','this','will','has','have','was','were','are','its','his','her','their','after','before','over','into','about','says','said','new','more','than','out','up','on','in','of','to','a','an','is','as','at','by','be','it','or','vs','per']);
  const toks = (t) => new Set((t || '').toLowerCase().replace(/[^a-z0-9\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff ]+/g, ' ')
    .split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const sim = (a, b) => {
    const A = toks(a), B = toks(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach((w) => { if (B.has(w)) inter++; });
    return inter / Math.min(A.size, B.size);
  };
  const clusters = [];
  for (const it of items) {
    if (it.kind === 'merch') { clusters.push({ item: it, group: [it] }); continue; }
    const hit = clusters.find((c) => c.item.kind !== 'merch' &&
      (c.item.artists || []).some((a) => (it.artists || []).includes(a)) &&
      sim(c.item.title, it.title) >= 0.55);
    if (hit) {
      hit.group.push(it);
      const better = (it.score || 0) > (hit.item.score || 0) +
        (it.summarySource === 'publisher' && hit.item.summarySource !== 'publisher' ? 10 : 0);
      if (better) hit.item = it;
    } else {
      clusters.push({ item: it, group: [it] });
    }
  }
  const out = [];
  for (const c of clusters) {
    const it = { ...c.item };
    const sources = [];
    for (const g of c.group) {
      for (const s of (g.sources || [{ name: g.sourceName, url: g.url }])) {
        if (!sources.some((x) => x.name === s.name)) sources.push(s);
      }
    }
    it.sources = sources;
    if (c.group.length > 1) it.clusterSize = c.group.length;
    out.push(it);
  }
  return out;
}

/** Product families so "photobook ver / digipack / platform / random cover" fold into one drop. */
// Only well-defined release families collapse into one card. Loose categories
// (photocards, apparel, posters) stay as individual listings so titles stay useful.
const MERCH_FAMILIES = [
  [/season'?s? ?greeting|시즌 ?그리팅/i, "Season's Greetings"],
  [/light ?stick|응원봉/i, 'Light stick'],
  [/platform|poca ?album|plve|플랫폼/i, 'Platform album'],
  [/(mini|full|정규|미니) ?album|[0-9](st|nd|rd|th) (mini|album)|\balbum\b|\bep\b/i, 'Album'],
  [/blu-?ray|dvd/i, 'Blu-ray / DVD'],
  [/vinyl|\blp\b/i, 'Vinyl']
];
function merchFamily(title) {
  for (const [re, label] of MERCH_FAMILIES) if (re.test(title)) return label;
  return null;
}

/**
 * Merge merch listings that are really the same release from several stores or
 * in several versions. Representative = cheapest, with every store + link kept.
 */
function collapseMerch(items, names) {
  const groups = new Map();
  const out = [];
  for (const it of items) {
    if (it.kind !== 'merch') { out.push(it); continue; }
    const fam = merchFamily(it.title);
    const artistKey = (it.artists || []).filter((a) => names[a] && /^(idle|itzy|lesserafim|kep1er|artms)$/i.test(a)).sort().join(',') ||
      (it.artists || []).sort()[0] || 'kpop';
    if (!fam) { out.push(it); continue; }
    const key = `${artistKey}::${fam}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...it,
        family: fam,
        variants: 1,
        sources: [...(it.sources || [{ name: it.sourceName, url: it.url }])]
      });
      continue;
    }
    existing.variants++;
    const seenStores = new Set(existing.sources.map((x) => x.name));
    if (!seenStores.has(it.sourceName)) existing.sources.push({ name: it.sourceName, url: it.url });
    if (it.price && (!existing.price || it.price.amount < existing.price.amount)) {
      existing.price = it.price;
      existing.url = it.url;
      existing.sourceName = it.sourceName;
      if (it.image) existing.image = it.image;
    }
    // remember the newest concrete listing so the card still says what it is
    if (!existing.latestTitle || Date.parse(it.publishedAt || 0) > Date.parse(existing.publishedAt || 0)) {
      existing.latestTitle = it.title;
    }
  }
  for (const g of groups.values()) {
    const artistLabel = (g.artists || []).map((a) => names[a]).filter(Boolean)[0] || 'K-pop';
    const stores = [...new Set(g.sources.map((x) => x.name))];
    if (g.variants > 1) {
      g.title = `${artistLabel} — ${g.family} (${g.variants} listings)`;
      g.detail = g.latestTitle || g.title;
      g.summary = `${g.family} in stock across ${stores.join(', ')}` +
        (g.price ? ` · from $${g.price.amount.toFixed(2)}` : '') + '.';
      g.summarySource = 'publisher';
      g.isMerchGroup = true;
    } else {
      g.summary = `New at ${stores[0] || g.sourceName}` + (g.price ? ` · $${g.price.amount.toFixed(2)}` : '') + '.';
      g.summarySource = 'publisher';
    }
    out.push(g);
  }
  return out;
}

const tidyOf = (t) => (t || '').replace(/\s+/g, ' ').trim();

/** token-overlap match: the same story often appears with a shortened title */
function bestMatch(title, candidates) {
  const words = (x) => new Set(normalizeTitle(x).split(' ').filter((w) => w.length > 2));
  const a = words(title);
  if (!a.size) return null;
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const b = words(c.title);
    if (!b.size) continue;
    let inter = 0;
    a.forEach((w) => { if (b.has(w)) inter++; });
    const score = inter / Math.min(a.size, b.size);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.6 ? best : null;
}

function normalizeTitle(t = '') {
  return t.toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, '')
    .replace(/\[[^\]]{0,40}\]/g, ' ')
    .replace(/\([^)]{0,3}\)/g, ' ')
    .replace(/[^a-z0-9\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().slice(0, 110);
}

module.exports = { runSearch, buildPlan, progress: () => progress, isRunning: () => running };
}};

/* ======================== index ======================== */
__KPR_MODULES__["index.js"] = { exports: {}, loaded: false, require: __kprRequire, fn: function (exports, require, module) {
/**
 * KPOP RADAR — server
 * Zero-dependency Node HTTP server: static PWA + JSON API.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');

const db = require('./lib/db');
const search = require('./search');
const E = require('./lib/enrich');
const { fetchDek, translate } = require('./lib/net');
const {
  ARTISTS, COMPANIES, STORES, TOPICS, LOCALES, BING_MARKETS,
  SPECIALTY_FEEDS, DEFAULTS, OFFICIAL
} = require('./lib/catalog');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(process.cwd(), '..', 'public');

/* ------------------------------ utilities ------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    ...headers
  });
  res.end(buf);
}
const json = (res, obj, status = 200) => send(res, status, JSON.stringify(obj, null, 0));
const bad = (res, msg, status = 400) => json(res, { ok: false, error: msg }, status);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2e6) { req.destroy(); resolve({}); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

const EMBEDDED = global.__KPR_ASSETS__ || null;   // set by the single-file build

function serveFromMemory(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const a = EMBEDDED[rel] || EMBEDDED[rel.replace(/^\//, '')];
  if (!a) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  const body = a.b64 ? Buffer.from(a.body, 'base64') : Buffer.from(a.body, 'utf8');
  const headers = {
    'Content-Type': a.type || 'application/octet-stream',
    'Cache-Control': /\.(png|jpg|jpeg|svg|webmanifest)$/.test(rel) ? 'public, max-age=86400' : 'no-cache',
    'Service-Worker-Allowed': '/'
  };
  if (String(req.headers['accept-encoding'] || '').includes('gzip') && body.length > 1024) {
    headers['Content-Encoding'] = 'gzip';
    return send(res, 200, zlib.gzipSync(body), headers);
  }
  return send(res, 200, body, headers);
}

function serveStatic(req, res, pathname) {
  if (EMBEDDED) return serveFromMemory(req, res, pathname);
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  }
  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': /\.(png|jpg|jpeg|svg|webmanifest)$/.test(ext) ? 'public, max-age=86400' : 'no-cache',
    'Service-Worker-Allowed': '/'
  };
  if (String(req.headers['accept-encoding'] || '').includes('gzip') && body.length > 1024) {
    headers['Content-Encoding'] = 'gzip';
    return send(res, 200, zlib.gzipSync(body), headers);
  }
  send(res, 200, body, headers);
}

/* ------------------------------ bootstrap ------------------------------ */
function bootstrap() {
  const state = db.load();
  const names = {};
  for (const a of state.artists) {
    names[a.id] = a.name;
    for (const m of a.members || []) names[m.id] = m.name;
  }
  const counts = { total: 0, news: 0, official: 0, merch: 0, label: 0, pinned: 0 };
  for (const it of state.items) {
    if (it.deletedAt) continue;
    counts.total++;
    if (it.pinned) counts.pinned++;
    const k = it.kind === 'label' ? 'label' : it.kind;
    counts[k] = (counts[k] || 0) + 1;
  }
  return {
    ok: true,
    app: { name: 'K-pop Radar', version: '1.0.0' },
    artists: state.artists,
    companies: COMPANIES,
    stores: STORES,
    topics: TOPICS.map((t) => ({ id: t.id, name: t.name, icon: t.icon })),
    locales: LOCALES,
    bingMarkets: BING_MARKETS,
    specialty: SPECIALTY_FEEDS,
    settings: state.settings,
    defaults: DEFAULTS,
    counts,
    subjects: state.savedSubjects,
    lastSearchAt: state.lastSearchAt,
    lastSearchStats: state.lastSearchStats,
    official: state.official,
    progress: search.progress()
  };
}

/* ------------------------------ routes ------------------------------ */
async function api(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/api';
  const q = url.searchParams;
  const method = req.method;

  if (method === 'OPTIONS') return send(res, 204, '');

  /* ---- bootstrap / settings ---- */
  if (p === '/api/bootstrap') return json(res, bootstrap());

  if (p === '/api/settings' && method === 'POST') {
    const body = await readBody(req);
    const state = db.load();
    const allowed = ['windowDays', 'retentionDays', 'languageMode', 'summaryMode', 'autoRefreshMinutes',
      'aiProvider', 'aiKey', 'aiModel', 'translateEngine', 'locales', 'bingMarkets', 'specialty',
      'enabledTopics', 'watchStores', 'weights'];
    for (const k of allowed) if (body[k] !== undefined) state.settings[k] = body[k];
    db.save(true);
    return json(res, { ok: true, settings: state.settings });
  }

  /* ---- search ---- */
  if (p === '/api/search' && method === 'POST') {
    const state = db.load();
    if (search.isRunning()) return json(res, { ok: false, error: 'busy', progress: search.progress() });
    // fire and forget; client polls /api/progress
    search.runSearch({ reason: 'manual' }).catch((e) => console.error('search failed', e));
    return json(res, { ok: true, started: true });
  }
  if (p === '/api/progress') return json(res, { ok: true, progress: search.progress(), running: search.isRunning() });

  /* ---- items ---- */
  if (p === '/api/items') {
    const state = db.load();
    const names = {};
    for (const a of state.artists) { names[a.id] = a.name; for (const m of a.members || []) names[m.id] = m.name; }
    const filters = {
      windowDays: q.get('windowDays') === 'all' ? 0 : Number(q.get('windowDays') || 0),
      kind: q.get('kind') || 'all',
      artistId: q.get('artist') || null,
      topic: q.get('topic') || null,
      onlyNew: q.get('new') === '1',
      saved: q.get('saved') === '1',
      deleted: q.get('deleted') === '1',
      limit: Number(q.get('limit') || 400)
    };
    const apiItems = (f) => db.listItems(f);
    const items = apiItems(filters).map((it) => ({
      ...it,
      artistLabels: (it.artists || []).map((id) => names[id] || id)
    }));
    const newCount = apiItems({ ...filters, onlyNew: true }).length;
    return json(res, { ok: true, items, count: items.length, newCount, lastSearchAt: state.lastSearchAt });
  }

  if (p === '/api/pin' && method === 'POST') {
    const body = await readBody(req);
    const it = db.setPinned(body.id, !!body.pinned);
    if (!it) return bad(res, 'not found', 404);
    return json(res, { ok: true, item: it, subjects: db.listSubjects() });
  }

  if (p === '/api/delete' && method === 'POST') {
    const body = await readBody(req);
    const ok = db.deleteItem(body.id);
    return json(res, { ok });
  }

  if (p === '/api/mark-seen' && method === 'POST') {
    db.markAllSeen();
    return json(res, { ok: true });
  }

  if (p === '/api/enrich' && method === 'POST') {
    const body = await readBody(req);
    const state = db.load();
    const it = state.items.find((x) => x.id === body.id);
    if (!it) return bad(res, 'not found', 404);
    let summary = null;
    if (it.url && !/news\.google\.com/.test(it.url)) {
      const d = await fetchDek(it.url);
      if (d && d.dek) {
        const en = it.lang && it.lang !== 'en' ? await translate(d.dek, it.lang) : d.dek;
        summary = E.tidySummary(en);
        it.summaryOriginal = E.tidySummary(d.dek);
      }
    }
    if (!summary && state.settings.aiKey) {
      const out = await E.aiSummaries([it], state.settings, (x) => (x.artists || []).join('/') || 'K-pop');
      if (out[it.id]) { summary = out[it.id]; it.summarySource = 'ai'; }
    }
    if (summary) { it.summary = summary; it.summarySource = it.summarySource || 'publisher'; db.save(true); }
    return json(res, { ok: !!summary, item: it });
  }

  /* ---- artists ---- */
  if (p === '/api/artists' && method === 'POST') {
    const body = await readBody(req);
    const state = db.load();
    if (body.action === 'add') {
      const name = String(body.name || '').trim();
      if (!name) return bad(res, 'name required');
      const id = (body.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artist') + '-' + Math.random().toString(36).slice(2, 5);
      const artist = {
        id, name, aka: body.aka || '', type: body.type || 'group',
        color: body.color || '#7c4dff',
        brief: body.brief || `${name}, K-pop artist.`,
        terms: body.terms && body.terms.length ? body.terms : [name],
        aliases: body.aliases && body.aliases.length ? body.aliases : [name.toLowerCase()],
        members: [],
        enabled: true, source: 'user'
      };
      state.artists.push(artist);
      state.roster[id] = { group: true, members: [] };
      state.official[id] = { sites: [], youtube: body.youtube ? [{ name, id: body.youtube }] : [], instagram: [] };
      db.save(true);
      return json(res, { ok: true, artist });
    }
    if (body.action === 'update') {
      const a = state.artists.find((x) => x.id === body.id);
      if (!a) return bad(res, 'not found', 404);
      for (const k of ['name', 'aka', 'brief', 'terms', 'aliases', 'color', 'enabled']) {
        if (body[k] !== undefined) a[k] = body[k];
      }
      db.save(true);
      return json(res, { ok: true, artist: a });
    }
    if (body.action === 'delete') {
      state.artists = state.artists.filter((x) => x.id !== body.id);
      state.items = state.items.filter((it) => !(it.artists || []).includes(body.id));
      delete state.official[body.id];
      db.save(true);
      return json(res, { ok: true });
    }
    if (body.action === 'toggle-member') {
      const a = state.artists.find((x) => x.id === body.artistId);
      if (!a) return bad(res, 'artist not found', 404);
      const m = (a.members || []).find((x) => x.id === body.memberId);
      if (!m) return bad(res, 'member not found', 404);
      m.enabled = body.enabled !== false;
      db.save(true);
      return json(res, { ok: true, member: m });
    }
    if (body.action === 'add-member') {
      const a = state.artists.find((x) => x.id === body.artistId);
      if (!a) return bad(res, 'artist not found', 404);
      const name = String(body.name || '').trim();
      if (!name) return bad(res, 'name required');
      const id = (body.memberId || name.toLowerCase().replace(/[^a-z0-9]+/g, '')) + '-' + Math.random().toString(36).slice(2, 4);
      const member = {
        id, name, aka: body.aka || '', color: a.color,
        terms: body.terms && body.terms.length ? body.terms : [`${name} ${a.name}`],
        aliases: body.aliases && body.aliases.length ? body.aliases : [name.toLowerCase()],
        enabled: true
      };
      a.members = a.members || [];
      a.members.push(member);
      db.save(true);
      return json(res, { ok: true, member });
    }
    if (body.action === 'remove-member') {
      const a = state.artists.find((x) => x.id === body.artistId);
      if (!a) return bad(res, 'artist not found', 404);
      a.members = (a.members || []).filter((m) => m.id !== body.memberId);
      db.save(true);
      return json(res, { ok: true });
    }
    return bad(res, 'unknown action');
  }

  /* ---- official channels ---- */
  if (p === '/api/official' && method === 'POST') {
    const body = await readBody(req);
    const state = db.load();
    const off = state.official[body.artistId] || (state.official[body.artistId] = { sites: [], youtube: [], instagram: [] });
    if (body.youtubeAdd) {
      off.youtube = off.youtube || [];
      const id = body.youtubeAdd.id || extractChannelId(body.youtubeAdd.input || '');
      if (id) off.youtube.push({ name: body.youtubeAdd.name || id, id });
    }
    if (body.youtubeRemove) off.youtube = (off.youtube || []).filter((c) => c.id !== body.youtubeRemove);
    if (body.siteAdd) {
      off.sites = off.sites || [];
      if (body.siteAdd.url) off.sites.push({ name: body.siteAdd.name || hostOf(body.siteAdd.url), url: body.siteAdd.url });
    }
    if (body.siteRemove) off.sites = (off.sites || []).filter((s) => s.url !== body.siteRemove);
    if (body.instagramAdd) {
      off.instagram = off.instagram || [];
      off.instagram.push({ name: '@' + String(body.instagramAdd).replace(/^@/, ''), handle: String(body.instagramAdd).replace(/^@/, '') });
    }
    db.save(true);
    return json(res, { ok: true, official: off });
  }

  /* ---- stores / companies toggles ---- */
  if (p === '/api/watch' && method === 'POST') {
    const body = await readBody(req);
    const state = db.load();
    if (Array.isArray(body.stores)) state.stores = body.stores;
    if (Array.isArray(body.companies)) state.companies = body.companies;
    db.save(true);
    return json(res, { ok: true, stores: state.stores, companies: state.companies });
  }

  /* ---- saved subjects ---- */
  if (p === '/api/subjects') {
    if (method === 'GET') {
      const state = db.load();
      const subjects = db.listSubjects().map((s) => ({
        ...s,
        followUpCount: state.items.filter((i) => i.savedSubjectId === s.id).length
      }));
      return json(res, { ok: true, subjects });
    }
  }
  if (p.startsWith('/api/subjects/') && method === 'POST') {
    const id = p.split('/').pop();
    const body = await readBody(req);
    if (body.remove) { db.deleteSubject(id); return json(res, { ok: true }); }
    const s = db.updateSubject(id, body);
    return s ? json(res, { ok: true, subject: s }) : bad(res, 'not found', 404);
  }

  /* ---- housekeeping ---- */
  if (p === '/api/sweep' && method === 'POST') {
    const removed = db.sweep();
    db.pruneDeleted();
    return json(res, { ok: true, removed });
  }
  if (p === '/api/export') {
    const state = db.load();
    return json(res, { ok: true, exportedAt: new Date().toISOString(), items: state.items, subjects: state.savedSubjects });
  }
  if (p === '/api/reset' && method === 'POST') {
    const body = await readBody(req);
    if (body.confirm !== 'RESET') return bad(res, 'confirmation required');
    const state = db.load();
    state.items = []; state.deleted = {}; state.savedSubjects = [];
    db.save(true);
    return json(res, { ok: true });
  }

  return bad(res, 'unknown endpoint ' + p, 404);
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'site'; } }
function extractChannelId(input) {
  const s = String(input || '').trim();
  const m = s.match(/UC[\w-]{22}/);
  return m ? m[0] : null;
}

/* ------------------------------ server ------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error('request failed', url.pathname, e);
    return json(res, { ok: false, error: e.message }, 500);
  }
});

// opportunistic auto-refresh (optional, off by default)
let lastAuto = 0;
setInterval(() => {
  try {
    const st = db.load();
    const mins = Number(st.settings.autoRefreshMinutes || 0);
    if (!mins || search.isRunning()) return;
    const age = st.lastSearchAt ? (Date.now() - Date.parse(st.lastSearchAt)) / 60000 : Infinity;
    if (age < mins || Date.now() - lastAuto < 60000) return;
    lastAuto = Date.now();
    search.runSearch({ reason: 'auto' }).catch(() => {});
  } catch (e) {}
}, 5 * 60 * 1000);

// housekeeping every 30 min: retention sweep + cleanup
if (process.env.NO_INTERVAL !== "1") setInterval(() => {
  try { db.sweep(); db.pruneDeleted(); } catch (e) { console.error(e.message); }
}, 30 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`K-pop Radar running on http://${HOST}:${PORT}`);
  const state = db.load();
  console.log(`  artists: ${state.artists.length} · items stored: ${state.items.length} · retention ${state.settings.retentionDays}d`);
});
}};

/* ============================== boot ============================== */
__kprRequire('index.js');
