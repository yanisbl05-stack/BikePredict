// Wetter zum Zeitpunkt der Fahrt (Open-Meteo, kein Schlüssel nötig) und daraus ein Nässe-Index W (0..1).

const H = 3600e3;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Reine Funktion: stündliche Reihen -> Nässe-Index.
// W kombiniert Regen während der Fahrt mit dem Regen der 72 h davor (nasser, matschiger Boden).
export function wetnessFromHourly(times, precip, temp, startMs, endMs) {
  let during = 0, r24 = 0, r72 = 0, tSum = 0, tN = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i]; // Stundenbeginn in ms
    const p = precip[i] || 0;
    if (t + H > startMs && t < endMs) {
      during += p;
      if (temp[i] != null) { tSum += temp[i]; tN++; }
    } else if (t + H <= startMs && t >= startMs - 24 * H) r24 += p;
    else if (t < startMs - 24 * H && t >= startMs - 72 * H) r72 += p;
  }
  const hours = Math.max(1, (endMs - startMs) / H);
  const tempC = tN ? tSum / tN : null;
  const d = clamp(during / hours / 1.5, 0, 1); // 1.5 mm/h Dauerregen = voll nass
  let ground = clamp((r24 + 0.4 * r72) / 12, 0, 1);
  if (tempC != null) ground = clamp(ground * (tempC > 18 ? 0.75 : tempC < 6 ? 1.2 : 1), 0, 1); // Abtrocknung
  const W = 1 - (1 - d) * (1 - 0.85 * ground);
  return { W, rainDuring: during, rain24: r24, rain72: r72, temp: tempC, label: wetLabel(W) };
}

export function wetLabel(W) {
  if (W < 0.12) return 'trocken';
  if (W < 0.35) return 'feucht';
  if (W < 0.65) return 'nass';
  return 'matschig';
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export async function fetchRideWeather(ride) {
  const startMs = Date.parse(ride.start);
  const endMs = startMs + Math.max(ride.elapsedH || ride.movingH || 1, 0.25) * H;
  // Das Archiv hinkt einige Tage nach, die Vorhersage-API deckt die letzten ~3 Monate ab.
  const recent = Date.now() - startMs < 80 * 24 * H;
  const base = recent ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const url = `${base}?latitude=${ride.lat.toFixed(3)}&longitude=${ride.lon.toFixed(3)}` +
    `&hourly=precipitation,temperature_2m&start_date=${day(startMs - 72 * H)}&end_date=${day(endMs)}&timezone=GMT`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wetterdienst antwortet mit ${res.status}`);
  const j = await res.json();
  const times = j.hourly.time.map((t) => Date.parse(t + ':00Z'));
  return wetnessFromHourly(times, j.hourly.precipitation, j.hourly.temperature_2m, startMs, endMs);
}
