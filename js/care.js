// Prüfplan, Checklisten und Nachschlagewerte fürs AMFLOW PL Carbon.
// Alles hier sind Hinweise. Sie ersetzen weder das Handbuch noch die Werkstatt.
const DAY = 864e5;

// days = Abstand in Tagen; winter = nur vom 1. November bis 31. März
export const CHECKS = [
  { id: 'winter', name: 'Winter-Check: Kette und Bremsen', days: 14, winter: true,
    items: 'Kette reinigen, schmieren und mit der Lehre messen. Bremsbeläge und Scheiben ansehen, Salzreste abspülen.' },
  { id: 'monthly', name: 'Monats-Check', days: 30,
    items: 'Kette messen und schmieren, Belagstärke und Scheiben prüfen, Reifen auf Schnitte und Profil, Speichenspannung, Schrauben an Vorbau, Lenker und Achsen, Akkuhalterung.' },
  { id: 'battery', name: 'Akku: voller Ladezyklus', days: 90,
    items: 'Einmal weit leer fahren und danach ganz voll laden, damit die Anzeige stimmt.' },
  { id: 'half', name: 'Halbjahres-Check: Lager und Steuersatz', days: 182,
    items: 'Hinterbau-Lager und Steuersatz auf Spiel und Knacken prüfen, Drehmomente an den Lagerpunkten kontrollieren.' },
  { id: 'year', name: 'Jahresservice in der Werkstatt', days: 365,
    items: 'Grosser Service an Gabel und Dämpfer, Bremsflüssigkeit wechseln, Motor und Software prüfen lassen.' },
];

export const isWinter = (d = new Date()) => d.getMonth() >= 10 || d.getMonth() <= 2;

// Stand je Prüfung: zuletzt erledigt, fällig in wie vielen Tagen
export function checkStatus(state, now = Date.now()) {
  const start = state.settings.purchaseDate ? Date.parse(state.settings.purchaseDate) : NaN;
  return CHECKS.filter((c) => !c.winter || isWinter(new Date(now))).map((c) => {
    const last = state.checks?.[c.id] ? Date.parse(state.checks[c.id]) : null;
    const from = last ?? start;
    const inDays = Number.isFinite(from) ? Math.ceil(c.days - (now - from) / DAY) : 0;
    return { ...c, last, inDays, due: inDays <= 0 };
  });
}

export const PRE_RIDE = ['Reifendruck', 'Bremsen: Druckpunkt und Wirkung', 'Achsen fest', 'Griffe fest', 'Lenker und Vorbau gerade und fest'];

export const CRASH_POINTS = ['Rahmen und Gabel ohne Verformung oder Risse', 'Keine losen Schrauben', 'Akku sitzt fest in der Halterung', 'Display zeigt keine Fehler',
  'Laufräder laufen rund', 'Lenker und Vorbau fest und gerade', 'Sattel fest', 'Schaltung schaltet sauber'];

// ok = aus dem Handbuch bestätigt; sonst Vorschlag, vor Gebrauch im Handbuch nachsehen
export const TORQUES = [
  ['Pedale', '30–35', true], ['Motor-Befestigungsmuttern', '20–22', true], ['Hauptlager', '24', true], ['Yoke an Wippe', '24', true],
  ['Dämpfer hinten', '20', true], ['Lager am Sitzrohr', '20', true], ['Lager an der Sitzstrebe', '20', true], ['Schwingenlager', '15', true],
  ['Dämpfer vorne', '15', true], ['Vorderachse', '9', true], ['Vorbau', '5', true], ['Lenkerklemmung', '4', true], ['Bremshebel', '4', true],
  ['Platte der Kettenführung', '2', true], ['Batterieschraube am Controller', '0.5–0.6', true],
  ['Kettenblatt-Lockring', '35', false], ['Kassette', '40', false], ['Schaltwerk', '35', false], ['Sattelklemme', '5', false],
];

// Fahrergewicht kg -> Dämpferdruck psi, Reifendruck vorne/hinten psi
export const PRESSURES = [[60, 115, 20, 23], [70, 138, 21, 24], [80, 160, 22, 25], [90, 183, 23, 27], [100, 205, null, null]];

export const BATTERY_RULES = ['Nur zwischen 0 und 40 °C laden. Im Winter den Akku erst auf Zimmertemperatur bringen.', 'Unter 10 % gleich wieder laden.',
  'Alle drei Monate einen vollen Ladezyklus fahren.', 'Für längere Pausen bei rund 30 % lagern.', 'Nach etwa 500 Ladezyklen kann die Kapazität nachlassen.'];
