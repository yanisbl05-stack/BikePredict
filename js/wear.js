// Verschleissmodell: reine Funktionen, keine Browser-APIs (läuft auch in Node für Tests).

// life  = Lebensdauer bei Optimalbedingungen (trocken, mässiges Gelände)
// unit  = km, h (Fahrstunden), cyc (Ladezyklen) oder d (Kalendertage)
// wet   = Empfindlichkeit auf Nässe/Matsch (Faktor 1 + wet * W, W = 0..1)
// climb = Empfindlichkeit auf Steigung (Antriebslast)
// descent = Empfindlichkeit auf Abfahrtsmeter (Bremslast)
// offroad = wird auf Strassenfahrten weniger belastet
// load  = Empfindlichkeit auf die mittlere Antriebsleistung
// safety = Sicherheitsteil: Gelerntes darf die Lebensdauer nur verkürzen, nie über den Startwert heben
// maxDays = spätestens nach so vielen Tagen fällig, auch wenn wenig gefahren wurde
// measure = Messwert, der die Schätzung ersetzt (fresh = Neuwert, limit = Verschleissgrenze; Vorschläge, änderbar)
// spec  = verbautes Teil laut Rechnung
export const COMPONENTS = [
  { id: 'chain', name: 'Kette', short: 'Kette', unit: 'km', life: 2500, wet: 1.5, climb: 0.4, load: 0.3, price: 59,
    spec: 'SRAM Eagle Transmission (T-Type), 126 Glieder', measure: { label: 'Längung laut Kettenlehre', unit: '%', fresh: 0, limit: 0.5, step: 0.05 } },
  { id: 'cassette', name: 'Kassette', short: 'Kassette', unit: 'km', life: 7500, wet: 1.0, climb: 0.3, load: 0.2, price: 239, spec: 'SRAM XS-1270 T-Type, 10-52' },
  { id: 'chainring', name: 'Kettenblatt', short: 'Blatt', unit: 'km', life: 7500, wet: 1.0, climb: 0.3, load: 0.2, spec: 'E-MTB-Kettenblatt mit Lockring' },
  { id: 'padsF', name: 'Bremsbeläge vorne', short: 'Belag v', unit: 'km', life: 1800, wet: 2.0, descent: 1, offroad: true, safety: true,
    spec: 'Magura MT5 eSTOP', measure: { label: 'Belagstärke mit Trägerplatte', unit: 'mm', fresh: 4, limit: 2.5, step: 0.1 } },
  { id: 'padsR', name: 'Bremsbeläge hinten', short: 'Belag h', unit: 'km', life: 1400, wet: 2.0, descent: 1, offroad: true, safety: true,
    spec: 'Magura MT5 eSTOP', measure: { label: 'Belagstärke mit Trägerplatte', unit: 'mm', fresh: 4, limit: 2.5, step: 0.1 } },
  { id: 'rotorF', name: 'Bremsscheibe vorne', short: 'Scheibe v', unit: 'km', life: 7000, wet: 1.0, descent: 0.6, safety: true,
    spec: 'Magura MDR-C, 203 mm', measure: { label: 'Scheibendicke', unit: 'mm', fresh: 2, limit: 1.8, step: 0.05 } },
  { id: 'rotorR', name: 'Bremsscheibe hinten', short: 'Scheibe h', unit: 'km', life: 6000, wet: 1.0, descent: 0.6, safety: true,
    spec: 'Magura MDR-C, 203 mm, mit Sensorring', measure: { label: 'Scheibendicke', unit: 'mm', fresh: 2, limit: 1.8, step: 0.05 } },
  { id: 'fluid', name: 'Bremsflüssigkeit', short: 'Bremsfl.', unit: 'd', life: 365, safety: true, spec: 'Magura Royal Blood (Mineralöl)' },
  { id: 'tireF', name: 'Reifen vorne', short: 'Reifen v', unit: 'km', life: 3500, wet: 0.1, descent: 0.2 },
  { id: 'tireR', name: 'Reifen hinten', short: 'Reifen h', unit: 'km', life: 2500, wet: 0.1, climb: 0.3, descent: 0.2 },
  { id: 'fork', name: 'Federgabel (Service)', short: 'Gabel', unit: 'h', life: 50, wet: 1.0, offroad: true, safety: true, maxDays: 365, spec: 'FOX 36 Performance Float GRIP, 160 mm' },
  { id: 'shock', name: 'Dämpfer (Service)', short: 'Dämpfer', unit: 'h', life: 50, wet: 1.0, offroad: true, maxDays: 365, spec: 'FOX Float Performance' },
  { id: 'bearings', name: 'Hinterbau-Lager', short: 'Lager', unit: 'km', life: 5000, wet: 1.5, offroad: true, spec: '12× 6801, 2× 6901' },
  { id: 'dropper', name: 'Sattelstütze (Service)', short: 'Stütze', unit: 'h', life: 150, wet: 0.8, offroad: true },
  { id: 'battery', name: 'Akku (Ladezyklen)', short: 'Akku', unit: 'cyc', life: 500, spec: 'Avinox, 800 Wh' },
];

export const UNIT_LABEL = { km: 'km', h: 'h', cyc: 'Zyklen', d: 'Tage' };
const DAY = 864e5;
// Reichweite einer Akkuladung in km, wenn die Aufzeichnung den Akkustand nicht enthält
const KM_PER_CYCLE = 70;
// Teile, die als System verschleissen: neues Teil auf verschlissenem Partner nutzt sich schnell ab
export const PARTNERS = { chain: ['cassette', 'chainring'], padsF: ['rotorF'], padsR: ['rotorR'] };

const ROAD_TYPES = new Set(['Ride', 'EBikeRide', 'VirtualRide']);
// Kilometer vor der ersten synchronisierten Fahrt zählen mit einem mittleren Faktor.
const BASELINE_FACTOR = 1.15;
// Leistung an der Kette in Watt, bei der der Antrieb «normal» verschleisst
const REF_POWER = 350;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function rideFactor(c, ride) {
  const W = ride.weather ? ride.weather.W : 0;
  const g = ride.km > 0 ? (ride.gain || 0) / ride.km : 0; // Höhenmeter pro km
  // Avinox-Aufzeichnungen liefern die echten Abfahrtsmeter; sonst gilt Aufstieg = Abfahrt
  const d = ride.km > 0 && ride.descent != null ? ride.descent / ride.km : g;
  let f = 1 + (c.wet || 0) * W;
  if (c.climb) f *= 1 + c.climb * clamp(g / 40, 0, 1.5);
  if (c.descent) f *= 1 + c.descent * (clamp(d / 30, 0.4, 2.5) - 1);
  // Mittlere Leistung an der Kette (Fahrer + Motor), nur bei Avinox-Aufzeichnungen bekannt
  if (c.load && ride.power > 0) f *= clamp(1 + c.load * (ride.power / REF_POWER - 1), 0.8, 1.4);
  // Frost: Streusalz und Schneematsch setzen allem zu, was auf Nässe reagiert
  if (c.wet && ride.weather && ride.weather.temp != null && ride.weather.temp <= 2) f *= 1 + 0.15 * Math.min(c.wet, 1.5);
  if (c.offroad && ROAD_TYPES.has(ride.type)) f *= 0.6;
  return f;
}

function rideUnits(c, ride) {
  if (c.unit === 'h') return ride.movingH || 0;
  if (c.unit === 'cyc') return ride.batteryUsed > 0 ? ride.batteryUsed / 100 : (ride.km || 0) / KM_PER_CYCLE;
  if (c.unit === 'd') return 0;
  return ride.km || 0;
}

// Fahrten des gewählten Velos (ohne Auswahl: alle).
export function activeRides(state) {
  const gear = state.settings.gearId;
  return state.rides.filter((r) => !gear || r.source !== 'strava' || r.gearId === gear);
}

export function usage(c, rides, fromMs, toMs) {
  let eff = 0, raw = 0, n = 0;
  for (const r of rides) {
    const t = Date.parse(r.start);
    if (t < fromMs || t >= toMs) continue;
    const u = rideUnits(c, r);
    raw += u;
    eff += u * rideFactor(c, r);
    n++;
  }
  return { eff, raw, n };
}

export function lifeOf(c, cs = {}) {
  if (cs.lifeManual > 0) return cs.lifeManual;
  if (cs.learned && cs.learned.length) {
    const avg = cs.learned.reduce((a, b) => a + b, 0) / cs.learned.length;
    return c.safety ? Math.min(avg, c.life) : avg;
  }
  return c.life;
}

function avgSpeed(rides) {
  let km = 0, h = 0;
  for (const r of rides) { km += r.km || 0; h += r.movingH || 0; }
  return h > 0 ? km / h : 15;
}
// Kilometer pro Tag in den letzten 90 Tagen, um Tage in Kilometer umzurechnen
function kmPerDay(rides, nowMs) {
  let km = 0;
  for (const r of rides) if (Date.parse(r.start) > nowMs - 90 * DAY) km += r.km || 0;
  return Math.max(1, km / 90);
}
// Beginn der Nutzung eines Teils: Einbau, sonst Kaufdatum, sonst erste Fahrt
function sinceMs(cs, state, rides) {
  if (cs.installedAt) return Date.parse(cs.installedAt);
  if (state.settings.purchaseDate) return Date.parse(state.settings.purchaseDate);
  return rides.length ? Math.min(...rides.map((r) => Date.parse(r.start))) : NaN;
}
// Verschleiss in Prozent aus einem Messwert
export function measuredPct(m) {
  return Math.max(0, ((m.value - m.fresh) / (m.limit - m.fresh)) * 100);
}

export function componentWear(c, state, toMs = Infinity) {
  const cs = state.components[c.id] || {};
  const rides = activeRides(state);
  const nowMs = Math.min(toMs, Date.now());
  const fromMs = cs.installedAt ? Date.parse(cs.installedAt) : -Infinity;
  const baseKm = cs.installedAt ? 0 : state.settings.baselineKm || 0;
  // Originalteil: Kilometer von vor den geladenen Fahrten mitzählen
  const base = c.unit === 'h' ? baseKm / avgSpeed(rides) : c.unit === 'cyc' ? baseKm / KM_PER_CYCLE : c.unit === 'd' ? 0 : baseKm;
  const used = (untilMs) => {
    const u = usage(c, rides, fromMs, untilMs);
    u.raw += base; u.eff += base * BASELINE_FACTOR;
    return u;
  };
  const u = used(toMs);
  const days = Math.max(0, (nowMs - sinceMs(cs, state, rides)) / DAY) || 0;
  if (c.unit === 'd') u.raw = u.eff = days;

  let life = lifeOf(c, cs), lifeSrc = cs.lifeManual > 0 ? 'manual' : cs.learned?.length ? 'learned' : 'default';
  let pct = (u.eff / life) * 100;
  // Messwert hat Vorrang (Messungen bis eine Stunde nach dem Einbau gehören noch zum alten Teil): Stand zum Messzeitpunkt, danach mit der daraus hochgerechneten Lebensdauer weiter
  const m = (cs.measurements || []).filter((x) => Date.parse(x.date) >= fromMs + 36e5 && Date.parse(x.date) <= toMs).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (m) {
    const mp = measuredPct(m), effAt = used(Date.parse(m.date)).eff;
    if (mp >= 10 && effAt > 0 && !(cs.lifeManual > 0)) { life = effAt / (mp / 100); lifeSrc = 'measured'; }
    pct = mp + ((u.eff - effAt) / life) * 100;
  }
  // Spätestens nach maxDays fällig (z. B. jährlicher Service)
  const timePct = c.maxDays ? (days / c.maxDays) * 100 : 0;
  const byTime = timePct > pct;
  if (byTime) pct = timePct;

  const recent = rides.slice().sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).slice(0, 10);
  const ru = usage(c, recent, -Infinity, Infinity);
  const avgFactor = ru.raw > 0 ? ru.eff / ru.raw : c.unit === 'd' || c.unit === 'cyc' ? 1 : 1.2;
  const remaining = Math.max(0, (life * (1 - pct / 100)) / avgFactor);
  const perDay = kmPerDay(rides, nowMs);
  const daysLeft = c.unit === 'd' ? remaining : byTime ? Math.max(0, c.maxDays - days) : null;
  const remainingKm = daysLeft != null ? daysLeft * perDay : c.unit === 'h' ? remaining * avgSpeed(rides) : c.unit === 'cyc' ? remaining * KM_PER_CYCLE : remaining;
  return { id: c.id, eff: u.eff, raw: u.raw, rides: u.n, life, lifeSrc, pct, avgFactor, remaining, remainingKm, days, daysLeft, byTime, measurement: m || null };
}

export function computeAll(state) {
  return COMPONENTS.map((c) => componentWear(c, state));
}

// Verlauf «Rest in Prozent» über die Zeit, je Einbau ein Abschnitt (100 % beim Einbau, 0 % = Wechsel fällig)
export function wearSeries(c, state, nowMs = Date.now()) {
  const cs = state.components[c.id] || {};
  const rides = activeRides(state).slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const hist = (cs.history || []).slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const first = Math.min(sinceMs({}, state, rides) || nowMs, rides.length ? Date.parse(rides[0].start) : nowMs);
  const bounds = [first, ...hist.map((h) => Date.parse(h.date)), nowMs];
  const segments = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i], b = bounds[i + 1], current = i === bounds.length - 2;
    const life = current ? componentWear(c, state).life : hist[i].lifeBefore || c.life;
    const base = i === 0 ? (state.settings.baselineKm || 0) * BASELINE_FACTOR / (c.unit === 'h' ? avgSpeed(rides) : c.unit === 'cyc' ? KM_PER_CYCLE : 1) : 0;
    const rem = (eff, t) => {
      let p = c.unit === 'd' ? (t - a) / DAY / life : eff / life;
      if (c.maxDays) p = Math.max(p, (t - a) / DAY / c.maxDays);
      return Math.max(0, 100 * (1 - p));
    };
    let eff = c.unit === 'd' ? 0 : base;
    const pts = [{ t: a, rem: rem(eff, a) }];
    for (const r of rides) {
      const t = Date.parse(r.start);
      if (t < a || t >= b) continue;
      eff += rideUnits(c, r) * rideFactor(c, r);
      pts.push({ t, rem: rem(eff, t) });
    }
    pts.push({ t: b, rem: current ? Math.max(0, 100 - componentWear(c, state).pct) : rem(eff, b) });
    segments.push(pts);
  }
  return segments;
}

// Teil ersetzt. worn=true: das Teil war wirklich am Ende, die bis dahin gefahrene
// Optimal-Äquivalenz wird als neue Lebensdauer gelernt (Mittel über alle Wechsel).
export function replaceComponent(state, id, whenISO, worn, cost = null) {
  const c = COMPONENTS.find((x) => x.id === id);
  const cs = (state.components[id] ||= {});
  const w = componentWear(c, state, Date.parse(whenISO));
  const lifeBefore = w.life;
  (cs.history ||= []).push({ date: whenISO, eff: w.eff, raw: w.raw, worn, lifeBefore, cost });
  // Gelernt wird, was das Teil bis 100 % gehalten hätte (bei Messwert: daraus hochgerechnet)
  const observed = w.measurement && w.pct > 0 ? w.eff / (w.pct / 100) : w.eff;
  if (worn && observed > 0 && c.unit !== 'd') {
    (cs.learned ||= []).push(observed);
    delete cs.lifeManual;
  }
  cs.installedAt = whenISO;
  return { observed, lifeBefore, lifeAfter: lifeOf(c, cs) };
}

export function wearColor(pct) {
  if (pct >= 90) return '#e5484d';
  if (pct >= 75) return '#f08c3a';
  if (pct >= 50) return '#e2c044';
  return '#3fb97c';
}

// Messwert eintragen (Kettenlehre, Belag- oder Scheibendicke)
export function addMeasurement(state, id, whenISO, value, fresh, limit) {
  const cs = (state.components[id] ||= {});
  (cs.measurements ||= []).push({ date: whenISO, value, fresh, limit });
}

// Partnerteile, die schon stark verschlissen sind (z. B. Kassette beim Kettenwechsel)
export function wornPartners(state, id, threshold = 70) {
  return (PARTNERS[id] || []).map((pid) => COMPONENTS.find((c) => c.id === pid)).filter((c) => componentWear(c, state).pct >= threshold);
}

// Ausgaben: Teilewechsel mit Preis plus frei erfasste Posten
export function allCosts(state) {
  const out = [];
  for (const c of COMPONENTS) for (const h of state.components[c.id]?.history || []) if (h.cost > 0) out.push({ date: h.date, label: c.name, chf: h.cost, kind: 'Teil' });
  for (const e of state.expenses || []) out.push({ date: e.date, label: e.label, chf: e.chf, kind: e.kind || 'Sonstiges', id: e.id });
  return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
