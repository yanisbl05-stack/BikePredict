// Strava-Anbindung direkt aus dem Browser. Die AMFLOW-App hat keinen eigenen Export,
// sie synchronisiert die Fahrten aber zu Strava, und von dort holen wir sie.

const API = 'https://www.strava.com/api/v3';
const RIDE_TYPES = new Set(['Ride', 'EBikeRide', 'EMountainBikeRide', 'MountainBikeRide', 'GravelRide']);

export const redirectUri = () => location.origin + location.pathname;

export function startAuth(clientId) {
  const st = Math.random().toString(36).slice(2);
  sessionStorage.setItem('strava_state', st);
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri(), response_type: 'code',
    approval_prompt: 'auto', scope: 'read,activity:read_all,profile:read_all', state: st,
  });
  location.href = 'https://www.strava.com/oauth/authorize?' + q;
}

async function tokenRequest(strava, params) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: strava.clientId, client_secret: strava.clientSecret, ...params }),
  });
  if (!res.ok) throw new Error('Strava-Anmeldung fehlgeschlagen (' + res.status + '). Client-ID und Secret prüfen.');
  const j = await res.json();
  strava.accessToken = j.access_token;
  strava.refreshToken = j.refresh_token;
  strava.expiresAt = j.expires_at;
  if (j.athlete) strava.athlete = [j.athlete.firstname, j.athlete.lastname].filter(Boolean).join(' ');
}

// Nach der Rückkehr von Strava: ?code=... gegen Tokens tauschen. Gibt true zurück, wenn verbunden wurde.
export async function finishAuth(strava) {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  if (!code && !q.get('error')) return false;
  history.replaceState(null, '', location.pathname);
  if (q.get('error')) throw new Error('Strava-Zugriff wurde abgelehnt.');
  if (q.get('state') !== sessionStorage.getItem('strava_state')) throw new Error('Strava-Antwort passt nicht zur Anfrage.');
  await tokenRequest(strava, { code, grant_type: 'authorization_code' });
  return true;
}

async function api(strava, path) {
  if (!strava.expiresAt || strava.expiresAt < Date.now() / 1000 + 60) {
    await tokenRequest(strava, { grant_type: 'refresh_token', refresh_token: strava.refreshToken });
  }
  const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + strava.accessToken } });
  if (res.status === 429) throw new Error('Strava-Limit erreicht. In 15 Minuten nochmals versuchen.');
  if (!res.ok) throw new Error('Strava antwortet mit ' + res.status);
  return res.json();
}

export async function fetchBikes(strava) {
  const a = await api(strava, '/athlete');
  return (a.bikes || []).map((b) => ({ id: b.id, name: b.name, km: Math.round((b.distance || 0) / 1000) }));
}

// Alle Velofahrten nach afterMs (Epoch ms), älteste zuerst.
export async function fetchRides(strava, afterMs) {
  const out = [];
  const after = Math.floor((afterMs || 0) / 1000);
  for (let page = 1; page < 50; page++) {
    const list = await api(strava, `/athlete/activities?after=${after}&per_page=100&page=${page}`);
    if (!list.length) break;
    for (const a of list) {
      const type = a.sport_type || a.type;
      if (!RIDE_TYPES.has(type)) continue;
      out.push({
        id: 'strava-' + a.id, source: 'strava', name: a.name, start: a.start_date, type,
        km: a.distance / 1000, gain: a.total_elevation_gain || 0,
        movingH: a.moving_time / 3600, elapsedH: a.elapsed_time / 3600,
        lat: a.start_latlng?.[0] ?? null, lon: a.start_latlng?.[1] ?? null,
        gearId: a.gear_id || null, watts: a.average_watts ?? null, weather: null,
      });
    }
    if (list.length < 100) break;
  }
  return out;
}
