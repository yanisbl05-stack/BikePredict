// Liest die Fahrtaufzeichnungen der Avinox-App (cloud_ride_rec_*.proto) direkt, ohne Strava.
// Die App legt sie auf Android unter Android/data/com.avinox.ride/files/ebike/data/ ab.
// Das Format ist nicht offiziell dokumentiert; Aufbau und Feldnummern stammen aus der
// Community (Avinox Ride Explorer): 251 Byte Kopf, danach gerahmte Protobuf-Nachrichten.
// Reine Funktionen, läuft auch in Node für Tests.

export const AVINOX_DIR = 'Android/data/com.avinox.ride/files/ebike/data';
export const isAvinoxFile = (name) => /^cloud_ride_rec_.*\.proto$/i.test(name);

const MAGIC = 0xa5a5a5a5, HEADER = 251, FRAME = 0x02eb;
// Feldnummern eines Messpunkts
const F = { speed: 7, cadence: 9, riderPower: 13, motorPower: 14, totalPower: 15, distance: 23, lat: 31, lon: 32, altitude: 39, temp: 41, battery: 71, time: 72, odo: 73 };

function varint(b, p) {
  let v = 0n, shift = 0n, x;
  do {
    if (p >= b.length) throw new Error('Datei ist abgeschnitten.');
    x = b[p++];
    v |= BigInt(x & 127) << shift;
    shift += 7n;
  } while (x & 128);
  return [v, p];
}

// Protobuf-Nachricht -> { Feldnummer: Rohwert }
function message(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = {};
  let p = 0, t;
  while (p < b.length) {
    [t, p] = varint(b, p);
    const field = Number(t >> 3n), wire = Number(t & 7n);
    if (wire === 0) [out[field], p] = varint(b, p);
    else if (wire === 1) { out[field] = dv.getBigUint64(p, true); p += 8; }
    else if (wire === 5) { out[field] = BigInt(dv.getUint32(p, true)); p += 4; }
    else if (wire === 2) { [t, p] = varint(b, p); p += Number(t); }
    else throw new Error('Unbekannter Datentyp in der Aufzeichnung.');
  }
  return out;
}

const n = (v) => (v == null ? null : Number(v));
const signed = (v) => (v == null ? null : v >= 1n << 63n ? Number(v - (1n << 64n)) : Number(v));
const f64 = (v) => {
  if (v == null) return null;
  const d = new DataView(new ArrayBuffer(8));
  d.setBigUint64(0, v, true);
  return d.getFloat64(0, true);
};

export function parseAvinox(buffer) {
  const b = new Uint8Array(buffer), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < HEADER || dv.getUint32(0, true) !== MAGIC) throw new Error('Keine Avinox-Fahrtaufzeichnung.');
  const meta = { rideId: dv.getUint32(6, true), start: dv.getUint32(10, true), end: dv.getUint32(14, true), ascent: dv.getFloat32(22, true), descent: dv.getFloat32(26, true) };
  const samples = [];
  let p = HEADER;
  while (p + 4 <= b.length) {
    const len = dv.getUint16(p + 2, true);
    if (dv.getUint16(p, true) !== FRAME || p + 4 + len > b.length) throw new Error('Aufzeichnung ist beschädigt.');
    const f = message(b.subarray(p + 4, p + 4 + len));
    const temp = signed(f[F.temp]);
    samples.push({
      t: n(f[F.time]), speed: (n(f[F.speed]) || 0) / 100, cadence: (n(f[F.cadence]) || 0) / 100,
      riderPower: (n(f[F.riderPower]) || 0) / 100, motorPower: (n(f[F.motorPower]) || 0) / 100, totalPower: (n(f[F.totalPower]) || 0) / 100,
      distance: n(f[F.distance]) || 0, lat: f64(f[F.lat]), lon: f64(f[F.lon]), altitude: f[F.altitude] == null ? null : n(f[F.altitude]) / 100,
      temp: temp == null || temp === -99900 ? null : temp / 100, battery: n(f[F.battery]), odo: n(f[F.odo]),
    });
    p += len + 6; // 4 Byte Rahmenkopf, 2 Byte Abschluss
  }
  return { meta, samples };
}

const finite = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
const validPos = (s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && (Math.abs(s.lat) > 0.01 || Math.abs(s.lon) > 0.01) && Math.abs(s.lat) <= 90;

// Aufzeichnung -> Fahrt im Format der App (wie strava.js), plus Antriebsdaten
export function avinoxRide(buffer, fileName = '') {
  const { meta, samples } = parseAvinox(buffer);
  if (!samples.length) throw new Error('Aufzeichnung enthält keine Messpunkte.');
  const first = samples[0], last = samples[samples.length - 1];
  const startS = meta.start || first.t, endS = meta.end || last.t || startS;

  let movingS = 0, pedalS = 0, powerSum = 0, riderSum = 0, motorSum = 0, tempSum = 0, tempN = 0, up = 0, down = 0, prevAlt = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // Abstand zum vorherigen Messpunkt; Pausen (Lücken) zählen nicht als Fahrzeit
    const dt = i && s.t && samples[i - 1].t ? Math.min(10, Math.max(0, s.t - samples[i - 1].t)) : 1;
    if (s.speed > 1) movingS += dt;
    if (s.cadence > 0 && s.totalPower > 0) { pedalS += dt; powerSum += s.totalPower * dt; riderSum += s.riderPower * dt; motorSum += s.motorPower * dt; }
    if (s.temp != null) { tempSum += s.temp; tempN++; }
    if (s.altitude != null) {
      // 2 m Schwelle gegen Sensorrauschen
      if (prevAlt == null) prevAlt = s.altitude;
      else if (Math.abs(s.altitude - prevAlt) >= 2) { if (s.altitude > prevAlt) up += s.altitude - prevAlt; else down += prevAlt - s.altitude; prevAlt = s.altitude; }
    }
  }
  const odoKm = last.odo ? last.odo / 1000 : null;
  const km = Math.max(...samples.map((s) => s.distance)) / 1000 || (last.odo && first.odo ? (last.odo - first.odo) / 1000 : 0);
  const pos = samples.find(validPos);
  const batt = samples.filter((s) => s.battery != null);
  return {
    id: 'avinox-' + startS, source: 'avinox', name: 'Avinox-Fahrt', file: fileName,
    start: new Date(startS * 1000).toISOString(), type: 'EMountainBikeRide',
    km, gain: finite(meta.ascent) || up, descent: finite(meta.descent) || down,
    movingH: movingS / 3600, elapsedH: Math.max(0, endS - startS) / 3600,
    lat: pos ? pos.lat : null, lon: pos ? pos.lon : null, gearId: null, weather: null,
    odoKm, power: pedalS ? powerSum / pedalS : null, riderPower: pedalS ? riderSum / pedalS : null, motorPower: pedalS ? motorSum / pedalS : null,
    tempC: tempN ? tempSum / tempN : null, batteryUsed: batt.length ? batt[0].battery - batt[batt.length - 1].battery : null,
  };
}

// Kilometer, die laut Kilometerzähler des Velos in den geladenen Fahrten fehlen
// (alles vor der ersten Aufzeichnung und nicht importierte Fahrten dazwischen).
export function missingKm(rides) {
  const real = rides.filter((r) => r.source !== 'demo');
  const withOdo = real.filter((r) => r.odoKm > 0);
  if (!withOdo.length) return null;
  const latest = withOdo.reduce((a, b) => (b.odoKm > a.odoKm ? b : a));
  const logged = real.filter((r) => Date.parse(r.start) <= Date.parse(latest.start)).reduce((a, r) => a + (r.km || 0), 0);
  return Math.max(0, Math.round(latest.odoKm - logged));
}
