import { COMPONENTS, computeAll, componentWear, replaceComponent, rideFactor, activeRides, wearColor, wearSeries, addMeasurement, measuredPct, wornPartners, allCosts } from './wear.js';
import { CHECKS, checkStatus, PRE_RIDE, CRASH_POINTS, TORQUES, PRESSURES, BATTERY_RULES } from './care.js';
import { canRemember, saveDir, loadDir, forgetDir, dirAccess } from './autoimport.js';
import { fetchRideWeather } from './weather.js';
import * as strava from './strava.js';
import { avinoxRide, isAvinoxFile, missingKm, AVINOX_DIR } from './avinox.js';
import { createBikeView } from './bike3d.js';

const KEY = 'velo-verschleiss-v1';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 0) => v.toLocaleString('de-CH', { maximumFractionDigits: d, minimumFractionDigits: d });

const SILVER = '#b7babf'; // Satin Silver des PL Carbon
function defaults() {
  return {
    // Kaufdatum und Preis trägt man unter «Mehr» selbst ein
    settings: { baselineKm: 0, gearId: '', frameColor: SILVER, homeLat: null, homeLon: null, frameSize: 'M', purchaseDate: '', price: 0, lastBackup: null },
    strava: {}, bikes: [], rides: [], components: {}, expenses: [], incidents: [], checks: {}, checkLog: [], avinoxSeen: [],
  };
}
// Ältere Stände um neue Felder ergänzen
function migrate(j) {
  const d = defaults();
  return { ...d, ...j, settings: { ...d.settings, ...(j.settings || {}) } };
}
function load() {
  try { return migrate(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return defaults(); }
}
let state = load();
if (state.settings.frameColor === '#23262b') state.settings.frameColor = SILVER; // alter Standardwert
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

const view = createBikeView($('#viewport'), { onSelect: openPart });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 4500);
}

const unitFmt = (c, v) => (c.unit === 'h' ? `${num(v, v < 20 ? 1 : 0)} h` : c.unit === 'cyc' ? `${num(v, v < 20 ? 1 : 0)} Zyklen` : c.unit === 'd' ? `${num(v)} Tage` : `${num(v)} km`);
const chf = (v) => `CHF ${num(v, 2)}`;
const day = (x) => new Date(x).toLocaleDateString('de-CH');

function remainingText(c, w) {
  if (w.pct >= 100) return 'fällig';
  if (c.unit === 'd') return `noch ca. ${num(w.remaining)} Tage`;
  if (w.byTime) return `noch ca. ${num(w.daysLeft)} Tage bis zum Jahresservice`;
  return c.unit === 'km' ? `noch ca. ${unitFmt(c, w.remaining)}` : `noch ca. ${unitFmt(c, w.remaining)} (~${num(w.remainingKm)} km)`;
}
const totalKm = () => activeRides(state).reduce((a, r) => a + r.km, 0) + (state.settings.baselineKm || 0);

// ---------- Rendering ----------
function render() {
  const wear = computeAll(state);
  const byId = Object.fromEntries(wear.map((w) => [w.id, w]));
  const rides = activeRides(state);
  $('#subtitle').textContent = `${num(totalKm())} km · ${rides.length} Fahrten`;

  view.setFrameColor(state.settings.frameColor);
  view.setWear(COMPONENTS.map((c) => ({ id: c.id, short: c.short, pct: byId[c.id].pct, color: wearColor(byId[c.id].pct) })));

  // Hinweis oben: was bald fällig ist, sonst das nächste Teil
  const all = COMPONENTS.map((c) => ({ c, w: byId[c.id] }));
  const soon = all.filter((x) => x.w.pct >= 75).sort((a, b) => b.w.pct - a.w.pct);
  const next = all.slice().sort((a, b) => a.w.remainingKm - b.w.remainingKm || b.w.pct - a.w.pct)[0];
  const open = checkStatus(state).filter((c) => c.due).length;
  const lines = [];
  if (!rides.length && !state.settings.baselineKm) lines.push('Noch keine Fahrten. Wähle unter «Mehr» den Avinox-Ordner oder probiere die Beispieldaten.');
  if (soon.length) lines.push(`Bald fällig: ${soon.slice(0, 3).map((x) => `<b>${esc(x.c.name)}</b> ${Math.round(x.w.pct)}%`).join(', ')}${soon.length > 3 ? ` und ${soon.length - 3} weitere` : ''}`);
  else if (lines.length === 0) lines.push(`Als Nächstes: <b>${esc(next.c.name)}</b>, ${remainingText(next.c, next.w)}`);
  if (open) lines.push(`${open} Prüfung${open === 1 ? '' : 'en'} offen unter «Pflege»`);
  $('#next').innerHTML = lines.join('<br>');

  $('#tab-parts').innerHTML = COMPONENTS.map((c) => {
    const w = byId[c.id], col = wearColor(w.pct);
    return `<button class="row" data-part="${c.id}">
      <span class="title">${esc(c.name)}</span><span class="pct" style="color:${col}">${Math.round(w.pct)}%</span>
      <span class="bar"><i style="width:${Math.min(100, w.pct)}%;background:${col}"></i></span>
      <span class="sub">${remainingText(c, w)} · Lebensdauer ${unitFmt(c, w.life)}${w.measurement ? ' · gemessen' : ''}</span>
    </button>`;
  }).join('');

  $('#syncBtn').textContent = state.strava.refreshToken ? 'Synchronisieren' : 'Fahrten laden';
  renderRides(rides);
  renderCare();
  renderCosts();
  renderSettings();
}

const WET_CLASS = { trocken: 'w0', feucht: 'w1', nass: 'w2', matschig: 'w3' };
function renderRides(rides) {
  const chain = COMPONENTS[0];
  const sorted = rides.slice().sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  $('#tab-rides').innerHTML = sorted.length ? sorted.map((r) => {
    const d = new Date(r.start);
    const w = r.weather;
    const chip = w
      ? `<span class="chip ${WET_CLASS[w.label]}">${w.label}${w.temp != null ? ` · ${num(w.temp)}°C` : ''} · ${num(w.rainDuring, 1)} mm, davor ${num(w.rain24 + w.rain72, 1)} mm</span>`
      : `<span class="chip">Wetter fehlt</span>`;
    return `<div class="row">
      <span class="title">${esc(r.name)}</span><span class="pct">${num(r.km, 1)} km</span>
      <span class="sub">${d.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}, ${d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
        · ${num(r.gain)} Hm${r.descent != null ? ` ↑ ${num(r.descent)} Hm ↓` : ''} · ${num(r.movingH, 1)} h</span>
      <span class="sub">${chip} <span class="chip">Kette ×${num(rideFactor(chain, r), 2)}</span>${r.power ? `<span class="chip">Ø ${num(r.power)} W, davon Motor ${num(r.motorPower)} W</span>` : ''}${r.batteryUsed > 0 ? `<span class="chip">Akku −${num(r.batteryUsed)}%</span>` : ''}</span>
    </div>`;
  }).join('') : '<p class="empty">Noch keine Fahrten vorhanden.</p>';
}

function renderSettings() {
  const s = state.settings, st = state.strava;
  const connected = !!st.refreshToken;
  const nAvinox = state.rides.filter((r) => r.source === 'avinox').length;
  $('#tab-settings').innerHTML = `
  <div class="card">
    <h2>Avinox-App</h2>
    <p>Die App liest die Aufzeichnungen der Avinox-App direkt, ohne Strava und ohne Kosten. Darin steckt mehr als im Strava-Export: Motor- und Fahrerleistung, echte Abfahrtsmeter, Akku und der Kilometerzähler des Velos.</p>
    <p><b>Automatisch:</b> Wähle einmal den Ordner mit den Aufzeichnungen. Die App merkt ihn sich und lädt neue Fahrten bei jedem Öffnen von selbst, ohne Computer.</p>
    <p>Android sperrt den Ordner der Avinox-App (<code>${AVINOX_DIR}</code>) für andere Apps. Auf dem Handy braucht es darum einmalig eine Sync-App mit Shizuku-Zugriff, die ihn laufend nach <code>Download/Avinox</code> spiegelt. Diesen Ordner wählst du hier.</p>
    ${avinoxDir ? `<p>Gemerkter Ordner: <b>${esc(avinoxDir.name)}</b>${avinoxAccess ? '' : '. Der Zugriff muss neu bestätigt werden: tippe auf «Fahrten laden».'}</p>` : ''}
    ${nAvinox ? `<p>${nAvinox} Fahrt${nAvinox === 1 ? '' : 'en'} aus der Avinox-App geladen.</p>` : ''}
    <div class="btns">
      ${canRemember ? `<button id="avinoxDir" class="primary">${avinoxDir ? 'Anderen Ordner wählen' : 'Ordner wählen'}</button>` : ''}
      <button id="avinoxPick" ${canRemember ? '' : 'class="primary"'}>Dateien wählen</button>
      ${avinoxDir ? '<button id="avinoxForget" class="danger">Ordner vergessen</button>' : ''}
    </div>
    ${canRemember ? '' : '<p>Dieser Browser kann sich keinen Ordner merken. Das geht mit Chrome auf Android oder am Computer.</p>'}
  </div>
  <div class="card">
    <h2>Strava (optional)</h2>
    ${connected ? `<p>Verbunden${st.athlete ? ' als ' + esc(st.athlete) : ''}. «Synchronisieren» holt neue Fahrten samt Wetter.</p>
      <label for="gear">Velo</label>
      <select id="gear"><option value="">Alle Velofahrten</option>${state.bikes.map((b) => `<option value="${esc(b.id)}" ${b.id === s.gearId ? 'selected' : ''}>${esc(b.name)} (${num(b.km)} km)</option>`).join('')}</select>
      <div class="btns"><button id="disconnect" class="danger">Verbindung trennen</button></div>`
    : `<p>Alternative zum direkten Weg. Strava verlangt seit Juni 2026 für den API-Zugang ein Abo, und es kommen weniger Daten an als aus der Avinox-App.</p>
      <p>1. In der AMFLOW-App Strava verknüpfen.<br>2. Auf <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> eine eigene API-Anwendung anlegen. Als «Authorization Callback Domain» eintragen: <code>${esc(location.hostname)}</code><br>3. Client-ID und Client-Secret hier eintragen und verbinden.</p>
      <label for="cid">Client-ID</label><input id="cid" inputmode="numeric" autocomplete="off" value="${esc(st.clientId || '')}">
      <label for="csec">Client-Secret</label><input id="csec" type="password" autocomplete="off" value="${esc(st.clientSecret || '')}">
      <div class="btns"><button id="connect" class="primary">Mit Strava verbinden</button></div>`}
  </div>
  <div class="card">
    <h2>Velo</h2>
    <label for="baseline">Gefahrene Kilometer, die in den geladenen Fahrten fehlen</label>
    <input id="baseline" type="number" min="0" step="10" value="${s.baselineKm || 0}">
    <p>${s.baselineAuto ? 'Automatisch aus dem Kilometerzähler der Avinox-Aufzeichnungen berechnet. ' : ''}Zählt für alle Teile, die noch original sind.</p>
    <label for="fcol">Rahmenfarbe</label>
    <input id="fcol" type="color" value="${esc(s.frameColor)}">
    <label for="fsize">Rahmengrösse</label>
    <input id="fsize" value="${esc(s.frameSize || '')}">
    <label for="pdate">Kaufdatum</label>
    <input id="pdate" type="date" value="${esc(s.purchaseDate || '')}">
    <label for="price">Kaufpreis (CHF)</label>
    <input id="price" type="number" min="0" step="50" value="${s.price || 0}">
    ${s.purchaseDate ? `<p>Garantie zwei Jahre, bis ${day(new Date(s.purchaseDate).setFullYear(new Date(s.purchaseDate).getFullYear() + 2))}. Ab dem Kaufdatum zählen Bremsflüssigkeit und Jahresservice, solange kein Wechsel erfasst ist.</p>` : ''}
    <p>Avinox M1 mit 800-Wh-Akku · SRAM Eagle Transmission, Kassette XS-1270 10-52 · Magura MT5 eSTOP, 203 mm · FOX 36 Performance 160 mm, FOX Float Performance · Amflow HMA-30, 29 Zoll, 32 Speichen</p>
  </div>
  <div class="card">
    <h2>Daten</h2>
    <p>Alles wird nur auf diesem Gerät gespeichert, nichts geht an einen Server. Mit der Sicherung überträgst du den Stand auf ein anderes Gerät.</p>
    <p ${!s.lastBackup || Date.now() - Date.parse(s.lastBackup) > 30 * 864e5 ? 'class="note"' : ''}>Letzte Sicherung: ${s.lastBackup ? day(s.lastBackup) : 'noch nie'}. Geht das Handy verloren, sind ohne Sicherung alle Wechsel und gelernten Werte weg.</p>
    <div class="btns">
      <button id="demo">Beispieldaten laden</button>
      ${state.rides.some((r) => r.source === 'demo') ? '<button id="demoOff">Beispieldaten entfernen</button>' : ''}
      <button id="export">Sicherung speichern</button>
      <button id="import">Sicherung laden</button>
      <button id="print">Service-Nachweis drucken</button>
      <button id="reset" class="danger">Alles zurücksetzen</button>
    </div>
    <input id="importFile" type="file" accept="application/json" hidden>
  </div>`;
}

// ---------- Pflege ----------
function renderCare() {
  const list = (a) => `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const inc = (state.incidents || []).slice().reverse();
  $('#tab-care').innerHTML = `
  <div class="card">
    <h2>Prüfplan</h2>
    ${checkStatus(state).map((c) => `<div class="check">
      <div><b>${esc(c.name)}</b><p>${esc(c.items)}</p>
      <p class="${c.due ? 'due' : ''}">${c.last ? 'Zuletzt am ' + day(c.last) : 'Noch nie erfasst'} · ${c.due ? 'jetzt fällig' : `in ${c.inDays} Tagen`}</p></div>
      <button data-check="${c.id}" ${c.due ? 'class="primary"' : ''}>Erledigt</button>
    </div>`).join('')}
    <p class="note">Die App gibt Hinweise aus Schätzungen. Sie ersetzt keine Werkstatt. Bei Bremsen, Gabel, Rahmen und Akku gilt im Zweifel: nicht fahren und prüfen lassen.</p>
  </div>
  <div class="card">
    <h2>Sturz oder Panne</h2>
    <p>Nach einem Sturz diese acht Punkte prüfen und abhaken. Der Eintrag kommt in den Service-Nachweis.</p>
    ${CRASH_POINTS.map((t, i) => `<label class="radio"><input type="checkbox" class="incPt" data-i="${i}">${esc(t)}</label>`).join('')}
    <label for="incKind">Was?</label><select id="incKind"><option>Sturz</option><option>Panne</option></select>
    <label for="incNote">Notiz</label><input id="incNote" placeholder="z. B. Sturz auf die rechte Seite, Schaltauge geprüft">
    <div class="btns"><button id="incSave">Eintrag speichern</button></div>
    ${inc.map((x) => `<p class="hist">${day(x.date)}: ${esc(x.kind)}${x.note ? ', ' + esc(x.note) : ''} · ${x.ok.filter(Boolean).length} von ${x.ok.length} Punkten in Ordnung</p>`).join('')}
  </div>
  <details class="card"><summary>Vor jeder Fahrt (30 Sekunden)</summary>${list(PRE_RIDE)}</details>
  <details class="card"><summary>Drehmomente</summary>
    <table>${TORQUES.map(([n, v, ok]) => `<tr><td>${esc(n)}${ok ? '' : ' *'}</td><td>${v} Nm</td></tr>`).join('')}</table>
    <p>* nicht aus dem Handbuch bestätigt. Vor dem Anziehen nachschlagen.</p></details>
  <details class="card"><summary>Luftdruck nach Fahrergewicht</summary>
    <table><tr><th>Gewicht</th><th>Dämpfer</th><th>Reifen vorne</th><th>Reifen hinten</th></tr>
    ${PRESSURES.map(([kg, sh, f, r]) => `<tr><td>${kg} kg</td><td>${sh} psi</td><td>${f ? f + ' psi' : '–'}</td><td>${r ? r + ' psi' : '–'}</td></tr>`).join('')}</table></details>
  <details class="card"><summary>Akku-Regeln</summary>${list(BATTERY_RULES)}</details>`;
}

// ---------- Kosten ----------
function renderCosts() {
  const costs = allCosts(state), s = state.settings, km = totalKm();
  const total = costs.reduce((a, x) => a + x.chf, 0);
  const years = {};
  for (const x of costs) { const y = new Date(x.date).getFullYear(); years[y] = (years[y] || 0) + x.chf; }
  $('#tab-costs').innerHTML = `
  <div class="kv">
    <span>Unterhalt gesamt</span><span>${chf(total)}</span>
    ${Object.keys(years).sort().reverse().map((y) => `<span>davon ${y}</span><span>${chf(years[y])}</span>`).join('')}
    <span>Unterhalt pro Kilometer</span><span>${km > 0 ? chf(total / km) : '–'}</span>
    <span>Mit Kaufpreis (${chf(s.price || 0)}) pro Kilometer</span><span>${km > 0 ? chf((total + (s.price || 0)) / km) : '–'}</span>
  </div>
  <div class="card">
    <h2>Ausgabe erfassen</h2>
    <p>Teilewechsel mit Preis kommen von selbst dazu. Hier erfasst du alles andere: Werkstatt, Zubehör, Pflegemittel.</p>
    <label for="expLabel">Wofür?</label><input id="expLabel" placeholder="z. B. Gabelservice">
    <label for="expKind">Art</label><select id="expKind"><option>Service</option><option>Teil</option><option>Zubehör</option><option>Sonstiges</option></select>
    <label for="expChf">Betrag (CHF)</label><input id="expChf" type="number" min="0" step="0.05" inputmode="decimal">
    <label for="expDate">Datum</label><input id="expDate" type="date" value="${new Date().toISOString().slice(0, 10)}">
    <div class="btns"><button id="expAdd" class="primary">Speichern</button></div>
  </div>
  <div class="list">${costs.map((x) => `<div class="row">
    <span class="title">${esc(x.label)}</span><span class="pct">${chf(x.chf)}</span>
    <span class="sub">${day(x.date)} · ${esc(x.kind)}${x.id ? ` · <a href="#" data-del="${esc(x.id)}">löschen</a>` : ' · aus Teilewechsel'}</span>
  </div>`).join('')}</div>`;
}

// ---------- Service-Nachweis ----------
function printRecord() {
  const s = state.settings, rows = [];
  for (const c of COMPONENTS) {
    const cs = state.components[c.id] || {};
    for (const h of cs.history || []) rows.push([h.date, `${c.name} ersetzt nach ${unitFmt(c, h.raw)}${h.worn ? '' : ' (vorsorglich oder Defekt)'}${h.cost > 0 ? ', ' + chf(h.cost) : ''}`]);
    for (const m of cs.measurements || []) rows.push([m.date, `${c.name} gemessen: ${num(m.value, 2)} ${c.measure.unit} (Grenze ${num(m.limit, 2)} ${c.measure.unit})`]);
  }
  for (const l of state.checkLog || []) rows.push([l.date, `${CHECKS.find((c) => c.id === l.id)?.name || l.id} erledigt`]);
  for (const i of state.incidents || []) rows.push([i.date, `${i.kind}${i.note ? ': ' + i.note : ''} (${i.ok.filter(Boolean).length} von ${i.ok.length} Prüfpunkten in Ordnung)`]);
  for (const e of state.expenses || []) rows.push([e.date, `${e.kind}: ${e.label}, ${chf(e.chf)}`]);
  rows.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
  const wear = computeAll(state);
  $('#printout').innerHTML = `
    <h1>Service-Nachweis AMFLOW PL Carbon</h1>
    <p>Rahmengrösse ${esc(s.frameSize || '–')} · gekauft am ${s.purchaseDate ? day(s.purchaseDate) : '–'} · ${num(totalKm())} km · Stand ${day(Date.now())}</p>
    <h2>Arbeiten und Ereignisse</h2>
    ${rows.length ? `<table>${rows.map(([d, t]) => `<tr><td>${day(d)}</td><td>${esc(t)}</td></tr>`).join('')}</table>` : '<p>Noch keine Einträge.</p>'}
    <h2>Zustand der Teile (Schätzung der App)</h2>
    <table>${COMPONENTS.map((c, i) => `<tr><td>${esc(c.name)}</td><td>${esc(c.spec || '')}</td><td>${Math.round(wear[i].pct)} % verschlissen</td></tr>`).join('')}</table>
    <p>Selbst geführter Nachweis aus der App «Velo-Verschleiss». Kein Werkstattbeleg.</p>`;
  window.print();
}

// Verlauf «Rest in Prozent» als kleine Kurve
function chartSvg(c) {
  const segs = wearSeries(c, state);
  const t0 = segs[0][0].t, t1 = segs.at(-1).at(-1).t;
  if (!(t1 - t0 > 864e5)) return '';
  const X = (t) => 6 + ((t - t0) / (t1 - t0)) * 308, Y = (r) => 8 + (1 - r / 100) * 80;
  const lines = segs.map((p) => `<polyline points="${p.map((q) => `${X(q.t).toFixed(1)},${Y(q.rem).toFixed(1)}`).join(' ')}"/>`).join('');
  const marks = segs.slice(1).map((p) => `<line class="swap" x1="${X(p[0].t).toFixed(1)}" y1="8" x2="${X(p[0].t).toFixed(1)}" y2="88"/>`).join('');
  return `<div class="card"><h2>Verlauf: Rest in Prozent</h2>
    <svg class="chart" viewBox="0 0 320 106" role="img" aria-label="Restlebensdauer von ${esc(c.name)} über die Zeit">
      <line class="grid" x1="6" y1="8" x2="314" y2="8"/><line class="grid" x1="6" y1="48" x2="314" y2="48"/><line class="grid" x1="6" y1="88" x2="314" y2="88"/>
      ${marks}${lines}
      <text x="6" y="103">${day(t0)}</text><text x="314" y="103" text-anchor="end">heute</text>
    </svg>
    <p>100 % ist neu, 0 % heisst wechseln.${segs.length > 1 ? ' Senkrechte Linien sind Wechsel.' : ''}</p></div>`;
}

// ---------- Teil-Detail ----------
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function openPart(id) {
  const c = COMPONENTS.find((x) => x.id === id);
  const cs = state.components[id] || {};
  const w = componentWear(c, state);
  const col = wearColor(w.pct);
  view.select(id);
  const hist = (cs.history || []).slice().reverse().map((h) =>
    `<p class="hist">${day(h.date)}: ersetzt nach ${unitFmt(c, h.raw)} (${unitFmt(c, h.eff)} optimal-äquivalent), ${h.worn ? 'verschlissen' : 'vorsorglich/Defekt'}${h.cost > 0 ? ', ' + chf(h.cost) : ''}</p>`).join('');
  const lifeSrc = { manual: 'von dir festgelegt', measured: 'aus Messwert hochgerechnet', learned: `gelernt aus ${cs.learned?.length} Wechsel${cs.learned?.length > 1 ? 'n' : ''}`, default: 'Schätzwert' }[w.lifeSrc];
  const usedLabel = { km: 'Tatsächlich gefahren', h: 'Fahrstunden', cyc: 'Ladezyklen (geschätzt)', d: 'Alter' }[c.unit];
  const partners = wornPartners(state, id);
  const ms = (cs.measurements || []).slice().reverse();
  const m0 = ms[0] || c.measure;
  $('.sheet-card').innerHTML = `
    <h2>${esc(c.name)}</h2>
    <div class="big" style="color:${col}">${Math.round(w.pct)}% <span style="font-size:15px;font-weight:500;color:var(--muted)">verschlissen</span></div>
    <div class="kv">
      ${c.spec ? `<span>Verbaut</span><span>${esc(c.spec)}</span>` : ''}
      <span>${usedLabel}</span><span>${unitFmt(c, w.raw)}</span>
      ${c.unit === 'd' || c.unit === 'cyc' ? '' : `<span>Mit Wetter und Gelände gewichtet</span><span>${unitFmt(c, w.eff)}</span>`}
      <span>Lebensdauer${c.unit === 'd' || c.unit === 'cyc' ? '' : ' bei Optimalbedingungen'}</span><span>${unitFmt(c, w.life)} (${lifeSrc})</span>
      ${c.unit === 'd' || c.unit === 'cyc' ? '' : `<span>Mittlerer Faktor der letzten Fahrten</span><span>×${num(w.avgFactor, 2)}</span>`}
      ${w.measurement ? `<span>Letzter Messwert</span><span>${num(w.measurement.value, 2)} ${c.measure.unit} am ${day(w.measurement.date)}</span>` : ''}
      ${c.maxDays ? `<span>Spätestens fällig</span><span>alle ${c.maxDays} Tage</span>` : ''}
      <span>Prognose</span><span>${remainingText(c, w)}</span>
      <span>Eingebaut</span><span>${cs.installedAt ? new Date(cs.installedAt).toLocaleDateString('de-CH') : 'original'}</span>
    </div>
    ${c.safety ? '<p class="note">Sicherheitsteil: Gelerntes kann die Lebensdauer verkürzen, aber nie über den Startwert heben. Im Zweifel früher wechseln.</p>' : ''}
    ${chartSvg(c)}
    ${c.measure ? `<div class="card">
      <h2>Messwert eintragen</h2>
      <p>Ein Messwert ersetzt die Schätzung. Neuwert und Grenze sind Vorschläge: bitte mit dem Handbuch oder der Herstellerangabe abgleichen.</p>
      <label for="mVal">${esc(c.measure.label)} (${c.measure.unit})</label><input id="mVal" type="number" step="${c.measure.step}" min="0" inputmode="decimal">
      <label for="mFresh">Neuwert (${c.measure.unit})</label><input id="mFresh" type="number" step="${c.measure.step}" value="${m0.fresh}">
      <label for="mLimit">Verschleissgrenze (${c.measure.unit})</label><input id="mLimit" type="number" step="${c.measure.step}" value="${m0.limit}">
      <div class="btns"><button id="mOk">Messwert speichern</button></div>
      ${ms.map((m) => `<p class="hist">${day(m.date)}: ${num(m.value, 2)} ${c.measure.unit}, entspricht ${Math.round(measuredPct(m))} %</p>`).join('')}
    </div>` : ''}
    <div class="card">
      <h2>Teil ersetzt</h2>
      <label for="repWhen">Wann?</label><input id="repWhen" type="datetime-local" value="${localNow()}">
      <label>Warum?</label>
      <label class="radio"><input type="radio" name="why" value="worn" checked>Es war verschlissen. Die Lebensdauer wird daraus neu gelernt.</label>
      <label class="radio"><input type="radio" name="why" value="other">Vorsorglich oder wegen Defekt. Die Lebensdauer bleibt gleich.</label>
      <label for="repCost">Preis des neuen Teils (CHF, für die Kostenübersicht)</label><input id="repCost" type="number" min="0" step="0.05" inputmode="decimal" value="${c.price || ''}">
      <p class="note" id="repNote"></p>
      ${partners.length ? `<p class="note">${partners.map((x) => esc(x.name)).join(' und ')} ${partners.length > 1 ? 'sind' : 'ist'} schon stark verschlissen. Ein neues Teil nutzt sich darauf schneller ab: am besten zusammen wechseln.</p>` : ''}
      <div class="btns"><button id="repOk" class="primary">Wechsel speichern</button></div>
    </div>
    <div class="card">
      <h2>Lebensdauer von Hand anpassen</h2>
      <label for="lifeIn">Lebensdauer bei Optimalbedingungen (${c.unit})</label>
      <input id="lifeIn" type="number" min="1" value="${Math.round(w.life)}">
      <div class="btns"><button id="lifeOk">Übernehmen</button>${cs.lifeManual > 0 ? '<button id="lifeReset">Zurück zum berechneten Wert</button>' : ''}</div>
    </div>
    ${hist ? `<div class="card"><h2>Verlauf</h2>${hist}</div>` : ''}
    <div class="btns"><button id="sheetClose">Schliessen</button></div>`;
  $('#sheet').hidden = false;

  // Unverändertes Feld heisst «jetzt», sekundengenau, damit eben erfasste Messwerte noch zum alten Teil zählen
  const when0 = $('#repWhen').value;
  const repWhen = () => ($('#repWhen').value === when0 ? new Date() : new Date($('#repWhen').value)).toISOString();
  const note = () => {
    const when = repWhen();
    const at = componentWear(c, state, Date.parse(when));
    const worn = document.querySelector('input[name=why]:checked').value === 'worn';
    if (!worn || c.unit === 'd') return ($('#repNote').textContent = c.unit === 'd' ? 'Der Wechsel setzt die Zeit zurück.' : `Lebensdauer bleibt bei ${unitFmt(c, at.life)}.`);
    const observed = at.measurement && at.pct > 0 ? at.eff / (at.pct / 100) : at.eff;
    const learned = [...(cs.learned || []), observed];
    let next = learned.reduce((a, b) => a + b, 0) / learned.length;
    if (c.safety) next = Math.min(next, c.life);
    $('#repNote').textContent = `Das Teil hat ${unitFmt(c, observed)} (optimal-äquivalent) gehalten statt ${unitFmt(c, at.life)}. Neue Lebensdauer: ${unitFmt(c, next)}.`;
  };
  note();
  $('#repWhen').addEventListener('change', note);
  document.querySelectorAll('input[name=why]').forEach((r) => r.addEventListener('change', note));
  $('#repOk').addEventListener('click', () => {
    const when = repWhen();
    const worn = document.querySelector('input[name=why]:checked').value === 'worn';
    const res = replaceComponent(state, id, when, worn, Number($('#repCost').value) || null);
    save(); closeSheet(); render();
    toast(worn ? `${c.name} ersetzt. Lebensdauer neu ${unitFmt(c, res.lifeAfter)}.` : `${c.name} ersetzt.`);
  });
  $('#mOk')?.addEventListener('click', () => {
    const v = Number($('#mVal').value), fresh = Number($('#mFresh').value), limit = Number($('#mLimit').value);
    if ($('#mVal').value === '' || !Number.isFinite(v) || fresh === limit) return toast('Bitte einen Messwert eintragen.');
    addMeasurement(state, id, new Date().toISOString(), v, fresh, limit);
    save(); render(); openPart(id);
    if (measuredPct({ value: v, fresh, limit }) >= 100) toast(`${c.name}: Verschleissgrenze erreicht. Bitte ersetzen.`);
  });
  $('#lifeOk').addEventListener('click', () => {
    const v = Number($('#lifeIn').value);
    if (!(v > 0)) return;
    (state.components[id] ||= {}).lifeManual = v;
    save(); render(); openPart(id);
  });
  $('#lifeReset')?.addEventListener('click', () => { delete state.components[id].lifeManual; save(); render(); openPart(id); });
  $('#sheetClose').addEventListener('click', closeSheet);
}
function closeSheet() { $('#sheet').hidden = true; view.select(null); }
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

// ---------- Synchronisation ----------
function mergeRides(list) {
  const known = new Set(state.rides.map((r) => r.id));
  let n = 0;
  for (const r of list) if (!known.has(r.id)) { state.rides.push(r); n++; }
  return n;
}

async function fillWeather() {
  const todo = state.rides.filter((r) => !r.weather);
  let failed = 0;
  for (const r of todo) {
    if (r.lat == null) { r.lat = state.settings.homeLat; r.lon = state.settings.homeLon; }
    if (r.lat == null) { failed++; continue; }
    try { r.weather = await fetchRideWeather(r); } catch { failed++; }
  }
  // Startpunkt der letzten Fahrt als Ersatz für Fahrten ohne GPS merken
  const last = state.rides.filter((r) => r.lat != null).sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
  if (last) { state.settings.homeLat = last.lat; state.settings.homeLon = last.lon; }
  return failed;
}

// Avinox-Aufzeichnungen einlesen; ersetzt gleiche Fahrten, die schon über Strava kamen
async function importAvinox(files, quiet = false) {
  const btn = $('#syncBtn');
  btn.disabled = true;
  let added = 0, bad = 0;
  try {
    const fresh = [];
    for (const f of files) {
      try { fresh.push(avinoxRide(await f.arrayBuffer(), f.name)); } catch { bad++; }
      if (!state.avinoxSeen.includes(fileKey(f))) state.avinoxSeen.push(fileKey(f));
    }
    // Eine Datei, die beim letzten Mal noch nicht fertig geschrieben war, ersetzt ihre kürzere Fassung
    for (const r of fresh) {
      const i = state.rides.findIndex((x) => x.id === r.id);
      if (i >= 0 && r.km > state.rides[i].km + 0.2) state.rides.splice(i, 1);
    }
    added = mergeRides(fresh.filter((r) => r.km > 0.2));
    const starts = state.rides.filter((r) => r.source === 'avinox').map((r) => Date.parse(r.start));
    state.rides = state.rides.filter((r) => r.source !== 'strava' || !starts.some((t) => Math.abs(t - Date.parse(r.start)) < 15 * 60e3));
    const missing = missingKm(state.rides);
    if (missing != null && (state.settings.baselineAuto || !state.settings.baselineKm)) { state.settings.baselineKm = missing; state.settings.baselineAuto = true; }
    save(); render();
    const failed = await fillWeather();
    save(); render();
    if (!quiet || added) toast(!files.length ? 'Keine Avinox-Aufzeichnungen gefunden.'
      : `${added} neue Fahrt${added === 1 ? '' : 'en'}${bad ? `, ${bad} Datei${bad === 1 ? '' : 'en'} nicht lesbar` : ''}${failed ? `, bei ${failed} fehlt das Wetter` : ''}.`);
  } finally {
    btn.disabled = false;
  }
}
// Ordner samt Unterordnern nach Aufzeichnungen durchsuchen
async function filesIn(dir, depth = 0) {
  const out = [];
  for await (const h of dir.values()) {
    if (h.kind === 'file') { if (isAvinoxFile(h.name)) out.push(await h.getFile()); }
    else if (depth < 6) out.push(...await filesIn(h, depth + 1));
  }
  return out;
}
async function pickAvinoxDir() {
  let dir;
  try { dir = await showDirectoryPicker(); } catch { return; }
  avinoxDir = dir; avinoxAccess = true;
  await saveDir(dir).catch(() => {});
  try { await importAvinox(await filesIn(dir)); } catch (e) { toast(e.message); }
}

// Gemerkter Ordner: neue Dateien beim Öffnen der App von selbst laden
let avinoxDir = null, avinoxAccess = false, lastAuto = 0, autoBusy = false;
const fileKey = (f) => `${f.name}:${f.size}`;
async function autoImport(ask = false) {
  if (!avinoxDir || autoBusy) return false;
  autoBusy = true;
  try {
    avinoxAccess = await dirAccess(avinoxDir, ask);
    if (!avinoxAccess) { renderSettings(); if (ask) toast('Kein Zugriff auf den Ordner. Bitte unter «Mehr» neu wählen.'); return false; }
    lastAuto = Date.now();
    const files = (await filesIn(avinoxDir)).filter((f) => !state.avinoxSeen.includes(fileKey(f)));
    if (files.length) await importAvinox(files, !ask);
    else if (ask) toast('Keine neuen Fahrten im Ordner.');
    return true;
  } catch (e) {
    if (ask) toast(e.message);
    return false;
  } finally { autoBusy = false; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastAuto > 60e3) autoImport();
});
$('#avinoxFile').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) await importAvinox(files);
});

async function sync() {
  const btn = $('#syncBtn');
  btn.disabled = true;
  btn.textContent = 'Lädt …';
  try {
    let added = 0;
    if (state.strava.refreshToken) {
      state.bikes = await strava.fetchBikes(state.strava);
      const latest = Math.max(0, ...state.rides.filter((r) => r.source === 'strava').map((r) => Date.parse(r.start)));
      added = mergeRides(await strava.fetchRides(state.strava, latest));
    }
    const failed = await fillWeather();
    save(); render();
    toast(state.strava.refreshToken
      ? `${added} neue Fahrt${added === 1 ? '' : 'en'}${failed ? `, bei ${failed} fehlt das Wetter` : ''}.`
      : failed ? `Wetter bei ${failed} Fahrten nicht verfügbar.` : 'Wetter ist aktuell.');
  } catch (e) {
    save(); render();
    toast(e.message);
  } finally {
    btn.disabled = false;
    render();
  }
}
// Ohne Strava lädt die Schaltfläche neue Avinox-Aufzeichnungen
$('#syncBtn').addEventListener('click', () => {
  if (state.strava.refreshToken) { autoImport(true); return sync(); }
  if (avinoxDir) return autoImport(true);
  return canRemember ? pickAvinoxDir() : $('#avinoxFile').click();
});

// Beispielfahrten der letzten Monate; das Wetter dazu wird echt abgefragt.
function demoRides() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (let i = 0; i < 26; i++) {
    const t = new Date(Date.now() - (3 + i * 5.3 + rnd() * 3) * 864e5);
    t.setHours(i % 3 ? 17 : 10, 30, 0, 0);
    const km = 18 + rnd() * 32, gain = km * (18 + rnd() * 22), h = km / (15 + rnd() * 5);
    out.push({
      id: 'demo-' + i, source: 'demo', name: 'Beispielrunde ' + (i + 1), start: t.toISOString(), type: 'EMountainBikeRide',
      km, gain, movingH: h, elapsedH: h * 1.2, lat: 46.85, lon: 9.53, gearId: null, weather: null,
    });
  }
  return out;
}

// ---------- Ereignisse ----------
document.querySelector('.tabs').addEventListener('click', (e) => {
  const tab = e.target.dataset.tab;
  if (!tab) return;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  for (const t of ['parts', 'rides', 'care', 'costs', 'settings']) $('#tab-' + t).hidden = t !== tab;
});
$('#tab-parts').addEventListener('click', (e) => {
  const row = e.target.closest('[data-part]');
  if (row) openPart(row.dataset.part);
});
$('#tab-care').addEventListener('click', (e) => {
  const id = e.target.dataset.check;
  if (id) {
    const now = new Date().toISOString();
    state.checks[id] = now; state.checkLog.push({ id, date: now });
    save(); render();
    return toast('Erledigt und im Service-Nachweis vermerkt.');
  }
  if (e.target.id === 'incSave') {
    const ok = [...document.querySelectorAll('.incPt')].map((x) => x.checked);
    state.incidents.push({ date: new Date().toISOString(), kind: $('#incKind').value, note: $('#incNote').value.trim(), ok });
    save(); render();
    toast(ok.every(Boolean) ? 'Eintrag gespeichert.' : 'Gespeichert. Die offenen Punkte vor der nächsten Fahrt klären, im Zweifel in der Werkstatt.');
  }
});
$('#tab-costs').addEventListener('click', (e) => {
  if (e.target.dataset.del) {
    e.preventDefault();
    if (!confirm('Diese Ausgabe löschen?')) return;
    state.expenses = state.expenses.filter((x) => x.id !== e.target.dataset.del);
    save(); render();
  } else if (e.target.id === 'expAdd') {
    const label = $('#expLabel').value.trim(), v = Number($('#expChf').value), d = $('#expDate').value;
    if (!label || !(v > 0) || !d) return toast('Bitte Bezeichnung, Betrag und Datum eintragen.');
    state.expenses.push({ id: 'e' + Date.now(), date: new Date(d + 'T12:00').toISOString(), label, kind: $('#expKind').value, chf: v });
    save(); render();
  }
});
$('#tab-settings').addEventListener('click', async (e) => {
  switch (e.target.id) {
    case 'connect': {
      const id = $('#cid').value.trim(), sec = $('#csec').value.trim();
      if (!id || !sec) return toast('Bitte Client-ID und Client-Secret eintragen.');
      state.strava = { clientId: id, clientSecret: sec };
      save();
      strava.startAuth(id);
      break;
    }
    case 'avinoxPick': $('#avinoxFile').click(); break;
    case 'avinoxDir': pickAvinoxDir(); break;
    case 'avinoxForget':
      await forgetDir().catch(() => {});
      avinoxDir = null; avinoxAccess = false; renderSettings();
      break;
    case 'print': printRecord(); break;
    case 'disconnect':
      if (!confirm('Strava-Verbindung trennen? Die geladenen Fahrten bleiben erhalten.')) return;
      state.strava = {}; save(); render();
      break;
    case 'demo':
      mergeRides(demoRides()); save(); render(); sync();
      break;
    case 'demoOff':
      state.rides = state.rides.filter((r) => r.source !== 'demo'); save(); render();
      break;
    case 'export': {
      state.settings.lastBackup = new Date().toISOString(); save();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' }));
      a.download = `velo-verschleiss-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      renderSettings();
      break;
    }
    case 'import': $('#importFile').click(); break;
    case 'reset':
      if (!confirm('Wirklich alle Fahrten, Wechsel und gelernten Werte auf diesem Gerät löschen?')) return;
      state = defaults(); save(); render();
      break;
  }
});
$('#tab-settings').addEventListener('change', async (e) => {
  const s = state.settings;
  if (e.target.id === 'gear') s.gearId = e.target.value;
  else if (e.target.id === 'baseline') { s.baselineKm = Math.max(0, Number(e.target.value) || 0); s.baselineAuto = false; }
  else if (e.target.id === 'fcol') s.frameColor = e.target.value;
  else if (e.target.id === 'fsize') s.frameSize = e.target.value.trim();
  else if (e.target.id === 'pdate') s.purchaseDate = e.target.value;
  else if (e.target.id === 'price') s.price = Math.max(0, Number(e.target.value) || 0);
  else if (e.target.id === 'importFile') {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(j.rides) || !j.settings) throw 0;
      if (!confirm('Den aktuellen Stand durch die Sicherung ersetzen?')) return;
      state = migrate(j);
    } catch { return toast('Diese Datei ist keine gültige Sicherung.'); }
  } else return;
  save(); render();
});

// ---------- Start ----------
render();
loadDir().then((h) => { if (h) { avinoxDir = h; return autoImport().then(renderSettings); } });
strava.finishAuth(state.strava)
  .then((ok) => { if (ok) { save(); toast('Strava verbunden.'); return sync(); } if (state.strava.refreshToken) return sync(); })
  .catch((e) => toast(e.message));
