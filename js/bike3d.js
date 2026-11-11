// 3D-Modell des AMFLOW PL Carbon, prozedural aus den Geometriedaten (Grösse L) aufgebaut.
// Achsen: x = Fahrtrichtung, y = oben, z = rechts (Antriebsseite). Einheiten in Metern.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// Geometrie PL Carbon, Grösse L (Herstellerangaben)
const WHEEL_R = 0.375, WHEELBASE = 1.255, HEAD_ANGLE = 64.5, FORK_LEN = 0.57, FORK_OFFSET = 0.044;
const R = V(0, WHEEL_R), F = V(WHEELBASE, WHEEL_R), BB = V(0.444, 0.3455);
const ha = THREE.MathUtils.degToRad(HEAD_ANGLE);
const AX = V(Math.cos(ha), -Math.sin(ha)); // Lenkachse, nach unten-vorne
const PERP = V(Math.sin(ha), Math.cos(ha)); // senkrecht dazu, nach vorne
const CROWN = F.clone().addScaledVector(AX, -FORK_LEN).addScaledVector(PERP, -FORK_OFFSET);
const HT_BOT = CROWN.clone().addScaledVector(AX, -0.012);
const HT_TOP = HT_BOT.clone().addScaledVector(AX, -0.115);
// Rahmenform und Drehpunkte sind vom Hersteller-Seitenfoto des PL Carbon abgenommen
// (Bildpunkte -> Meter: Hinterachse bei 40.6/580.3, 656 Bildpunkte pro Meter). Das Foto
// weicht vorne leicht von der Geometrietabelle ab, darum wird zum Steuerrohr hin angeglichen.
const P = (px, py) => {
  const t = Math.max(0, (px - 330) / 320);
  return V((px - 9 * t - 40.6) / 656, WHEEL_R + (580.3 - py + 13 * t) / 656);
};
const FRAME_OUTLINE = [[640, 204], [668, 196], [702, 258], [680, 280], [640, 340], [590, 420], [540, 500], [500, 560], [465, 592], [430, 602], [370, 605], [325, 600], [332, 570], [340, 535], [333, 500], [315, 460], [297, 425], [289, 380], [284, 336], [303, 326], [322, 336], [350, 328], [400, 304], [480, 270], [560, 236]];
const FRAME_OPENING = [[322, 366], [360, 354], [405, 346], [455, 328], [510, 302], [550, 282], [588, 262], [568, 294], [524, 352], [480, 420], [440, 490], [415, 538], [392, 552], [372, 545], [362, 518], [354, 478], [340, 440], [326, 400]];
const FRAME_W = 0.074; // Breite des Hauptrahmens
const ST_TOP = P(292, 324), SADDLE_CLAMP = P(247, 203), ST_DIR = SADDLE_CLAMP.clone().sub(ST_TOP).normalize();
const ROCKER_PIVOT = P(335, 447), ROCKER_REAR = P(286, 440), SHOCK_REAR = P(345, 420), SHOCK_FRONT = P(452, 347);
const MAIN_PIVOT = P(310, 574), HORST = P(72, 592), STAY_END = P(62, 574);
const LOGO_A = P(468, 492), LOGO_B = P(580, 320);
const COG_R = 0.06, RING_R = 0.069, CHAIN_Z = 0.052;

export function createBikeView(container, { onSelect }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
  camera.position.set(1.0, 0.72, 2.55);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const svgNS = 'http://www.w3.org/2000/svg';
  const lines = document.createElementNS(svgNS, 'svg');
  lines.classList.add('label-lines');
  const labelLayer = document.createElement('div');
  labelLayer.className = 'label-layer';
  container.append(lines, labelLayer);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.63, 0.5, 0);
  controls.enablePan = false;
  controls.minDistance = 1.4;
  controls.maxDistance = 5;
  controls.maxPolarAngle = Math.PI / 2 + 0.05;
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x50565f, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(1.5, 3, 2.5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb7ff, 0.8);
  fill.position.set(-2, 1.5, -2.5);
  scene.add(fill);

  const mat = (color, metalness = 0.2, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
  const M = {
    frame: mat(0xb7babf, 0.6, 0.42), rubber: mat(0x17181a, 0, 0.95), black: mat(0x1c1d20, 0.3, 0.6),
    steel: mat(0xb9bec6, 0.9, 0.3), dark: mat(0x3a3d44, 0.6, 0.45), stanchion: mat(0x2b2c30, 0.75, 0.28),
    cassette: mat(0x33353a, 0.85, 0.4), chain: mat(0x7d8087, 0.9, 0.35), blue: mat(0x1e8fd6, 0.5, 0.35),
    logo: new THREE.MeshBasicMaterial({ color: 0x111214, transparent: true }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0b1522, emissive: 0x2a7fd6, emissiveIntensity: 0.5, roughness: 0.2 }),
  };

  const bike = new THREE.Group();
  scene.add(bike);
  const parts = {}; // Komponenten-ID -> { meshes, mat, anchor }

  function add(mesh, id) {
    if (id) {
      const p = (parts[id] ||= { meshes: [], mats: new Map() });
      // eigenes Material pro Komponente, damit sie einzeln eingefärbt werden kann
      if (!p.mats.has(mesh.material)) p.mats.set(mesh.material, mesh.material.clone());
      mesh.material = p.mats.get(mesh.material);
      mesh.userData.part = id;
      p.meshes.push(mesh);
    }
    bike.add(mesh);
    return mesh;
  }
  function tube(a, b, r, material, id, r2 = r) {
    const d = b.clone().sub(a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, d.length(), 20), material);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    return add(m, id);
  }
  // Scheibe/Zylinder mit Achse quer zum Velo (z)
  function disc(c, r, w, material, id, inner = 0) {
    const g = inner
      ? new THREE.ExtrudeGeometry(ringShape(r, inner), { depth: w, bevelEnabled: false, curveSegments: 40 }).translate(0, 0, -w / 2)
      : new THREE.CylinderGeometry(r, r, w, 40).rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, material);
    m.position.copy(c);
    return add(m, id);
  }
  function ringShape(r, inner) {
    const s = new THREE.Shape().absarc(0, 0, r, 0, Math.PI * 2);
    s.holes.push(new THREE.Path().absarc(0, 0, inner, 0, Math.PI * 2, true));
    return s;
  }
  function box(c, sx, sy, sz, material, id, rotZ = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    m.position.copy(c);
    m.rotation.z = rotZ;
    return add(m, id);
  }
  const side = (p, z) => V(p.x, p.y, z);

  // Laufräder
  for (const [c, tireId] of [[R, 'tireR'], [F, 'tireF']]) {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.031, 0.031, 18, 72), M.rubber);
    tire.position.copy(c);
    add(tire, tireId);
    // Stollen
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2;
      for (const z of [-0.016, 0.016]) {
        const k = box(V(c.x + Math.cos(a) * (WHEEL_R - 0.002), c.y + Math.sin(a) * (WHEEL_R - 0.002), z + (i % 2 ? 0.006 : -0.006)), 0.008, 0.018, 0.012, M.rubber, tireId, a);
        k.userData.small = true;
      }
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.066, 0.013, 10, 72), M.black);
    rim.position.copy(c);
    rim.scale.z = 1.25;
    add(rim);
    disc(c, 0.024, 0.11, M.black);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2, z = i % 2 ? 0.03 : -0.03;
      tube(V(c.x + Math.cos(a + 0.5) * 0.022, c.y + Math.sin(a + 0.5) * 0.022, z), V(c.x + Math.cos(a) * 0.3, c.y + Math.sin(a) * 0.3, 0), 0.0013, M.black);
    }
  }

  // Bremsscheiben (203 mm) und Sättel, linke Seite
  for (const [c, rotorId, padId] of [[R, 'rotorR', 'padsR'], [F, 'rotorF', 'padsF']]) {
    disc(side(c, -0.062), 0.1015, 0.002, M.steel, rotorId, 0.078);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      tube(V(c.x + Math.cos(a) * 0.022, c.y + Math.sin(a) * 0.022, -0.062), V(c.x + Math.cos(a + 0.5) * 0.08, c.y + Math.sin(a + 0.5) * 0.08, -0.062), 0.004, M.steel, rotorId);
    }
    const ang = padId === 'padsF' ? 2.05 : 1.15; // Position des Sattels auf der Scheibe
    const cp = V(c.x + Math.cos(ang) * 0.095, c.y + Math.sin(ang) * 0.095, -0.062);
    box(cp, 0.075, 0.042, 0.04, M.dark, padId, ang + Math.PI / 2);
  }

  // Hauptrahmen: Umriss vom Foto als ein Stück, mit der Öffnung für den Dämpfer
  const outline = (pts) => new THREE.CatmullRomCurve3(pts.map(([x, y]) => P(x, y)), true, 'centripetal').getPoints(220).map((p) => new THREE.Vector2(p.x, p.y));
  const frameShape = new THREE.Shape(outline(FRAME_OUTLINE));
  frameShape.holes.push(new THREE.Path(outline(FRAME_OPENING)));
  const bevel = 0.012;
  add(new THREE.Mesh(new THREE.ExtrudeGeometry(frameShape, { depth: FRAME_W - 2 * bevel, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 5 }).translate(0, 0, bevel - FRAME_W / 2), M.frame));
  tube(HT_BOT, HT_TOP, 0.034, M.frame, null, 0.031);
  // Schriftzug auf beiden Seiten des Unterrohrs
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const ctx = cv.getContext('2d');
  const drawLogo = () => {
    ctx.clearRect(0, 0, 512, 96);
    ctx.font = 'italic 900 80px "Roboto Flex", Arial, sans-serif';
    ctx.fontStretch = 'ultra-expanded';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.fillText('AMFLOW', 256, 52, 500);
  };
  drawLogo();
  M.logo.map = new THREE.CanvasTexture(cv);
  // Schrift kann beim ersten Zeichnen noch fehlen
  document.fonts.load('italic 900 80px "Roboto Flex"').then(() => { drawLogo(); M.logo.map.needsUpdate = true; render(); });
  M.logo.map.colorSpace = THREE.SRGBColorSpace;
  const logoDir = LOGO_B.clone().sub(LOGO_A), logoLen = logoDir.length();
  for (const z of [1, -1]) {
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(logoLen, logoLen * 96 / 512), M.logo);
    logo.position.copy(LOGO_A).addScaledVector(logoDir, 0.5).setZ(z * (FRAME_W / 2 + 0.0008));
    if (z < 0) logo.rotation.y = Math.PI;
    logo.rotateOnWorldAxis(V(0, 0, 1), Math.atan2(logoDir.y, logoDir.x));
    add(logo);
  }
  // Avinox-Display im Oberrohr
  const ttA = P(480, 270), tdir = P(560, 236).sub(ttA).normalize();
  box(ttA.clone().addScaledVector(tdir, 0.1).add(V(-tdir.y, tdir.x).multiplyScalar(0.004)), 0.07, 0.006, 0.034, M.screen, null, Math.atan2(tdir.y, tdir.x));
  // Avinox-M1-Motor
  disc(BB, 0.06, 0.092, M.black);
  box(P(372, 597), 0.225, 0.04, 0.084, M.black); // Motorschutz

  // Hinterbau (Viergelenker mit Horst-Link)
  for (const z of [-1, 1]) {
    tube(side(MAIN_PIVOT, z * 0.042), side(HORST, z * 0.072), 0.017, M.frame, null, 0.014);
    tube(side(HORST, z * 0.072), side(R, z * 0.072), 0.012, M.frame);
    tube(side(HORST, z * 0.072), side(STAY_END, z * 0.072), 0.011, M.frame);
    tube(side(STAY_END, z * 0.072), side(R, z * 0.072), 0.012, M.frame);
    tube(side(STAY_END, z * 0.072), side(ROCKER_REAR, z * 0.05), 0.011, M.frame, null, 0.015);
    // Umlenkhebel, treibt den Dämpfer an
    tube(side(ROCKER_REAR, z * 0.05), side(ROCKER_PIVOT, z * 0.05), 0.014, M.black, 'bearings');
    tube(side(ROCKER_PIVOT, z * 0.05), side(SHOCK_REAR, z * 0.045), 0.012, M.black, 'bearings');
    tube(side(ROCKER_REAR, z * 0.05), side(SHOCK_REAR, z * 0.045), 0.008, M.black, 'bearings');
  }
  tube(side(ROCKER_REAR, -0.05), side(ROCKER_REAR, 0.05), 0.012, M.frame); // Brücke der Sitzstreben
  for (const p of [MAIN_PIVOT, HORST, ROCKER_PIVOT, ROCKER_REAR, SHOCK_REAR]) {
    const w = p === HORST ? 0.16 : p === MAIN_PIVOT ? 0.1 : 0.112;
    disc(p, p === SHOCK_REAR ? 0.008 : 0.013, w, M.steel, 'bearings');
  }

  // Dämpfer (Fox Float, 185 x 55), liegt in der Rahmenöffnung unter dem Oberrohr
  const sdir = SHOCK_FRONT.clone().sub(SHOCK_REAR);
  const sMid = SHOCK_REAR.clone().addScaledVector(sdir, 0.38);
  tube(SHOCK_REAR, sMid, 0.009, M.stanchion, 'shock');
  tube(sMid, SHOCK_FRONT.clone().addScaledVector(sdir, -0.06), 0.022, M.black, 'shock');
  tube(SHOCK_FRONT.clone().addScaledVector(sdir, -0.1), SHOCK_FRONT, 0.014, M.black, 'shock');
  disc(SHOCK_FRONT, 0.011, 0.05, M.steel, 'shock');

  // Federgabel (Fox 36, 160 mm): schwarze Standrohre, schwarze Tauchrohre
  for (const z of [-0.068, 0.068]) {
    const top = side(CROWN, z), mid = top.clone().lerp(side(F, z), 0.4);
    tube(top, mid.clone().lerp(side(F, z), 0.1), 0.018, M.stanchion, 'fork');
    tube(mid, side(F, z).addScaledVector(AX, 0.02), 0.031, M.black, 'fork', 0.027);
    disc(side(F, z), 0.03, 0.03, M.black, 'fork');
  }
  box(CROWN, 0.05, 0.034, 0.19, M.black, 'fork', -ha);
  tube(HT_BOT, CROWN.clone().addScaledVector(AX, 0.01), 0.03, M.black, 'fork');
  disc(side(CROWN.clone().addScaledVector(AX, -0.022), 0.068), 0.016, 0.02, M.blue); // Druckstufen-Einsteller
  const archP = CROWN.clone().lerp(F, 0.42);
  for (const z of [-0.068, 0.068]) tube(side(archP, z), side(archP.clone().addScaledVector(PERP, 0.045).addScaledVector(AX, -0.03), z * 0.6), 0.013, M.black, 'fork');
  tube(side(archP.clone().addScaledVector(PERP, 0.045).addScaledVector(AX, -0.03), -0.041), side(archP.clone().addScaledVector(PERP, 0.045).addScaledVector(AX, -0.03), 0.041), 0.013, M.black, 'fork');
  disc(F, 0.01, 0.16, M.steel);

  // Cockpit
  const stemA = HT_TOP.clone().addScaledVector(AX, -0.03), stemB = stemA.clone().addScaledVector(PERP, 0.045);
  tube(HT_TOP, stemA.clone().addScaledVector(AX, -0.012), 0.017, M.black);
  tube(stemA, stemB, 0.019, M.black);
  const barY = stemB.y + 0.045; // 35 mm Rise
  tube(side(stemB, -0.11), side(stemB, 0.11), 0.016, M.black);
  for (const z of [-1, 1]) {
    tube(side(stemB, z * 0.11), V(stemB.x - 0.02, barY, z * 0.3), 0.012, M.black);
    tube(V(stemB.x - 0.02, barY, z * 0.3), V(stemB.x - 0.03, barY, z * 0.4), 0.016, M.rubber);
    box(V(stemB.x + 0.02, barY - 0.012, z * 0.27), 0.07, 0.012, 0.012, M.dark, null, -0.5); // Bremshebel
  }

  // Sattelstütze (KS Rage-i, 170 mm) und Sattel
  const postTop = SADDLE_CLAMP, postMid = ST_TOP.clone().lerp(postTop, 0.42);
  tube(ST_TOP.clone().addScaledVector(ST_DIR, -0.015), ST_TOP.clone().addScaledVector(ST_DIR, 0.02), 0.022, M.black, 'dropper');
  tube(ST_TOP, postMid, 0.0175, M.black, 'dropper');
  tube(postMid, postTop, 0.014, M.stanchion, 'dropper');
  box(postTop.clone().add(V(0, 0.018, 0)), 0.07, 0.022, 0.04, M.black);
  const saddle = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), M.rubber);
  saddle.scale.set(0.132, 0.017, 0.07);
  saddle.position.copy(postTop).add(V(0, 0.046, 0));
  add(saddle);

  // Antrieb (SRAM Eagle Transmission, 10-52)
  disc(side(BB, CHAIN_Z), RING_R, 0.004, M.black, 'chainring', 0.045);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    tube(side(BB, CHAIN_Z), V(BB.x + Math.cos(a) * 0.05, BB.y + Math.sin(a) * 0.05, CHAIN_Z), 0.007, M.black, 'chainring');
  }
  const cogs = [0.105, 0.09, 0.076, 0.064, 0.053, 0.043, 0.034, 0.027, 0.022];
  cogs.forEach((r, i) => disc(side(R, 0.034 + i * 0.0045), r, 0.003, M.cassette, 'cassette'));
  // Kurbeln und Pedale
  const crankDir = V(Math.cos(-0.1), Math.sin(-0.1));
  for (const z of [1, -1]) {
    const end = BB.clone().addScaledVector(crankDir, z * 0.16);
    tube(side(BB, z * 0.082), side(end, z * 0.09), 0.019, M.black, null, 0.013);
    box(side(end, z * 0.145), 0.1, 0.014, 0.095, M.dark);
  }
  // Schaltwerk
  const pulleyU = V(R.x + 0.012, R.y - 0.085), pulleyL = V(R.x + 0.035, R.y - 0.165);
  box(V(R.x + 0.005, R.y - 0.045, CHAIN_Z + 0.018), 0.05, 0.075, 0.03, M.dark);
  tube(side(pulleyU, CHAIN_Z + 0.012), side(pulleyL, CHAIN_Z + 0.012), 0.006, M.dark);
  disc(side(pulleyU, CHAIN_Z), 0.022, 0.006, M.black);
  disc(side(pulleyL, CHAIN_Z), 0.022, 0.006, M.black);
  // Kette
  const chainPts = [
    V(BB.x, BB.y + RING_R), V(R.x + 0.005, R.y + COG_R), V(R.x - COG_R * 0.85, R.y + COG_R * 0.5), V(R.x - COG_R, R.y),
    V(R.x - COG_R * 0.6, R.y - COG_R * 0.8), V(pulleyU.x + 0.022, pulleyU.y), V(pulleyL.x - 0.022, pulleyL.y),
    V(pulleyL.x, pulleyL.y - 0.022), V(BB.x, BB.y - RING_R), V(BB.x + RING_R * 0.75, BB.y - RING_R * 0.66),
    V(BB.x + RING_R, BB.y), V(BB.x + RING_R * 0.75, BB.y + RING_R * 0.66), V(BB.x, BB.y + RING_R),
  ];
  for (let i = 0; i < chainPts.length - 1; i++) tube(side(chainPts[i], CHAIN_Z), side(chainPts[i + 1], CHAIN_Z), 0.0045, M.chain, 'chain');

  // Boden
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1.5, 64), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0.63, 0, 0);
  ground.scale.z = 0.35;
  scene.add(ground);

  // Ankerpunkte der Beschriftungen
  const anchors = {
    chain: V(0.22, R.y + COG_R + 0.006, CHAIN_Z), cassette: V(R.x, R.y - 0.02, 0.07), chainring: V(BB.x + 0.03, BB.y - 0.05, CHAIN_Z),
    padsR: V(R.x + 0.04, R.y + 0.087, -0.062), rotorR: V(R.x - 0.09, R.y - 0.03, -0.062),
    padsF: V(F.x - 0.044, F.y + 0.084, -0.062), rotorF: V(F.x + 0.07, F.y - 0.07, -0.062),
    tireR: V(R.x - 0.25, R.y + 0.27, 0), tireF: V(F.x + 0.25, F.y + 0.27, 0),
    fork: CROWN.clone().lerp(F, 0.25).setZ(0.068), shock: sMid.clone().lerp(SHOCK_FRONT, 0.5).setZ(FRAME_W / 2),
    bearings: ROCKER_PIVOT.clone().setZ(0.05), dropper: ST_TOP.clone().lerp(SADDLE_CLAMP, 0.6),
    // Akku im Unterrohr, Bremsflüssigkeit am Bremshebel: Schilder ohne eigenes Bauteil
    battery: LOGO_A.clone().lerp(LOGO_B, 0.5).setZ(FRAME_W / 2), fluid: V(stemB.x + 0.02, barY - 0.012, 0.27),
  };

  const labels = {};
  for (const id of Object.keys(anchors)) {
    const el = document.createElement('button');
    el.className = 'bike-label';
    el.addEventListener('click', () => onSelect(id));
    labelLayer.appendChild(el);
    const line = document.createElementNS(svgNS, 'line');
    lines.appendChild(line);
    labels[id] = { el, line, w: 0, h: 0 };
  }

  let selected = null;
  function setWear(items) {
    for (const it of items) {
      const l = labels[it.id], p = parts[it.id];
      if (!l) continue;
      l.el.innerHTML = `<span>${it.short}</span><b>${Math.round(it.pct)}%</b>`;
      l.el.style.setProperty('--c', it.color);
      l.line.setAttribute('stroke', it.color);
      l.w = l.el.offsetWidth; l.h = l.el.offsetHeight;
      // Die Teile behalten ihre echte Farbe; die Warnfarbe zeigt das Schild, das Teil leuchtet nur bei Auswahl
      const glow = 0;
      if (p) for (const m of p.mats.values()) { m.emissive.set(it.color); m.emissiveIntensity = glow; m.userData.glow = glow; }
    }
    layoutLabels();
    render();
  }
  function select(id) {
    selected = id;
    for (const [pid, p] of Object.entries(parts)) {
      for (const m of p.mats.values()) m.emissiveIntensity = pid === id ? 0.45 : m.userData.glow || 0;
    }
    for (const [lid, l] of Object.entries(labels)) l.el.classList.toggle('sel', lid === id);
    render();
  }
  function setFrameColor(hex) {
    M.frame.color.set(hex);
    // Schriftzug hell auf dunklem Rahmen und umgekehrt
    const c = new THREE.Color(hex);
    M.logo.color.set(0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 0.25 ? 0x111214 : 0xd9dbde);
    render();
  }

  // Beschriftungen: Anker auf den Bildschirm projizieren, nach aussen versetzen, Überlappungen auflösen
  const tmp = V(0, 0, 0);
  function layoutLabels() {
    const w = container.clientWidth, h = container.clientHeight;
    const centre = tmp.copy(controls.target).project(camera);
    const cx = (centre.x * 0.5 + 0.5) * w, cy = (-centre.y * 0.5 + 0.5) * h;
    const boxes = [];
    for (const [id, l] of Object.entries(labels)) {
      const p = anchors[id].clone().project(camera);
      const ax = (p.x * 0.5 + 0.5) * w, ay = (-p.y * 0.5 + 0.5) * h;
      let dx = ax - cx, dy = ay - cy;
      const len = Math.hypot(dx, dy) || 1;
      const push = Math.min(w, h) * 0.13;
      boxes.push({ l, ax, ay, x: ax + (dx / len) * push, y: ay + (dy / len) * push * 0.9 });
    }
    for (let it = 0; it < 24; it++) {
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = (a.l.w + b.l.w) / 2 + 4 - Math.abs(a.x - b.x), oy = (a.l.h + b.l.h) / 2 + 3 - Math.abs(a.y - b.y);
        if (ox > 0 && oy > 0) {
          const s = a.y <= b.y ? -1 : 1;
          a.y += (s * oy) / 2; b.y -= (s * oy) / 2;
        }
      }
      for (const b of boxes) {
        b.x = Math.min(w - b.l.w / 2 - 4, Math.max(b.l.w / 2 + 4, b.x));
        b.y = Math.min(h - b.l.h / 2 - 4, Math.max(b.l.h / 2 + 4, b.y));
      }
    }
    for (const b of boxes) {
      b.l.el.style.transform = `translate(${b.x - b.l.w / 2}px, ${b.y - b.l.h / 2}px)`;
      b.l.line.setAttribute('x1', b.ax); b.l.line.setAttribute('y1', b.ay);
      b.l.line.setAttribute('x2', b.x); b.l.line.setAttribute('y2', b.y);
    }
  }

  function render() {
    renderer.render(scene, camera);
  }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // Hochformat: Blickwinkel öffnen, damit das ganze Velo Platz hat
    camera.fov = Math.max(32, THREE.MathUtils.radToDeg(2 * Math.atan(0.4 / camera.aspect)));
    camera.updateProjectionMatrix();
    lines.setAttribute('viewBox', `0 0 ${w} ${h}`);
    layoutLabels();
    render();
  }
  new ResizeObserver(resize).observe(container);
  controls.addEventListener('change', () => { layoutLabels(); render(); });
  (function tick() { controls.update(); requestAnimationFrame(tick); })();

  // Antippen eines Teils im Modell
  const ray = new THREE.Raycaster();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(bike.children).find((h) => h.object.userData.part);
    if (hit) onSelect(hit.object.userData.part);
  });

  resize();
  return { setWear, select, setFrameColor };
}
