// 3D-превью на three.js: модели дисков, 3D-диаграмма, «город» папок.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';

export const PALETTE = ['#0071e3', '#30b0c7', '#af52de', '#ff2d55', '#ff9f0a', '#34c759', '#5856d6',
  '#5ac8fa', '#ff6482', '#a2845e', '#64d2ff', '#bf5af2'];

const stages = new Set();
let webglOk = null;

export function webglAvailable() {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement('canvas');
    webglOk = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { webglOk = false; }
  return webglOk;
}

export function disposeAll() { for (const s of [...stages]) s.dispose(); }

function fmt(n) {
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']; let i = 0; n = +n || 0;
  while (Math.abs(n) >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 2 : 1) : n.toFixed(0)) + ' ' + u[i];
}

class Stage {
  constructor(el, o = {}) {
    this.el = el;
    this.t0 = performance.now();
    this.tick = [];
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = o.exposure ?? 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.className = 'stage';
    el.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    this.envTex = pm.fromScene(new RoomEnvironment(r), 0.04).texture;
    this.scene.environment = this.envTex;
    pm.dispose();

    this.camera = new THREE.PerspectiveCamera(o.fov ?? 32, 1, 0.1, 200);
    this.camera.position.set(...(o.cam ?? [0, 3, 8]));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ea, 0.55));
    const d = new THREE.DirectionalLight(0xffffff, 1.4);
    d.position.set(4, 9, 6);
    d.castShadow = true;
    d.shadow.mapSize.set(1024, 1024);
    const sc = d.shadow.camera; sc.left = sc.bottom = -8; sc.right = sc.top = 8; sc.near = 1; sc.far = 30;
    d.shadow.radius = 6; d.shadow.bias = -0.0005;
    this.scene.add(d);

    if (o.ground !== false) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.11 }));
      g.rotation.x = -Math.PI / 2; g.position.y = o.groundY ?? -0.6; g.receiveShadow = true;
      this.scene.add(g);
    }

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = !!o.zoom;
    this.controls.minDistance = o.minDist ?? 3; this.controls.maxDistance = o.maxDist ?? 30;
    this.controls.autoRotate = o.autoRotate !== 0;
    this.controls.autoRotateSpeed = o.autoRotate ?? 0.8;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.target.set(...(o.target ?? [0, 0, 0]));

    this.visible = true;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.io = new IntersectionObserver(es => { this.visible = es[0].isIntersecting; });
    this.io.observe(el);
    this.resize();
    stages.add(this);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (!this.visible || document.hidden) return;
      const t = (performance.now() - this.t0) / 1000;
      for (const f of this.tick) f(t);
      this.controls.update();
      r.render(this.scene, this.camera);
    };
    loop();
  }
  resize() {
    const w = this.el.clientWidth || 300, h = this.el.clientHeight || 200;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect(); this.io.disconnect();
    this.controls.dispose();
    this.scene.traverse(o => {
      o.geometry?.dispose?.();
      const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); });
    });
    this.envTex.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    stages.delete(this);
  }
}

// ------------------------------------------------------------ материалы
const M = {
  alu: () => new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.9, roughness: 0.3 }),
  aluLight: () => new THREE.MeshStandardMaterial({ color: 0xe4e6ea, metalness: 0.85, roughness: 0.22 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xf4f4f8, metalness: 1, roughness: 0.06 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x2a2b30, metalness: 0.5, roughness: 0.45 }),
  black: () => new THREE.MeshPhysicalMaterial({ color: 0x111215, metalness: 0.2, roughness: 0.35, clearcoat: 0.6 }),
  pcb: () => new THREE.MeshStandardMaterial({ color: 0x14181d, metalness: 0.3, roughness: 0.55 }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xe6b450, metalness: 1, roughness: 0.25 }),
  white: () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, clearcoat: 0.4 }),
};

function labelTexture(lines, { w = 512, h = 256, bg = ['#ffffff', '#eef3fb'], accent = '#0071e3', dark = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = accent; g.fillRect(0, 0, 14, h);
  const font = '-apple-system, "Segoe UI Variable Display", "Segoe UI", Arial, sans-serif';
  const maxW = w - 46 - 28;
  // шрифт уменьшается, пока строка не влезет в наклейку (длинные названия моделей не обрезаются)
  const fit = (text, weight, size) => {
    let s = Math.round(size);
    g.font = `${weight} ${s}px ${font}`;
    while (s > 10 && g.measureText(text).width > maxW) { s -= 1; g.font = `${weight} ${s}px ${font}`; }
  };
  g.fillStyle = dark ? '#f5f5f7' : '#1d1d1f';
  fit(lines[0] || '', 700, h * 0.26);
  g.fillText(lines[0] || '', 44, h * 0.42);
  g.fillStyle = dark ? 'rgba(245,245,247,.7)' : '#6e6e73';
  (lines.slice(1)).forEach((s, i) => { fit(s, 500, h * 0.13); g.fillText(s, 46, h * (0.64 + i * 0.17)); });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function box(w, h, d, mat, r = 0.04, seg = 3) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.01, h / 2.01, d / 2.01)), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------ модели дисков
function hddModel(info) {
  const g = new THREE.Group();
  const body = box(3.0, 0.5, 4.0, M.alu(), 0.12, 4); g.add(body);
  // внутренняя ниша
  const well = box(2.7, 0.06, 3.7, new THREE.MeshStandardMaterial({ color: 0x9a9da4, metalness: 0.9, roughness: 0.45 }), 0.1);
  well.position.y = 0.23; g.add(well);
  // пластина
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.05, 96), M.chrome());
  platter.position.set(0, 0.3, -0.45); platter.castShadow = true; g.add(platter);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.008, 8, 96),
    new THREE.MeshStandardMaterial({ color: 0xb8bcc6, metalness: 1, roughness: 0.15 }));
  ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.33, -0.45); g.add(ring);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 48), M.aluLight());
  hub.position.set(0, 0.34, -0.45); g.add(hub);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 12), M.dark());
    const a = i / 6 * Math.PI * 2; s.position.set(Math.cos(a) * 0.17, 0.35, -0.45 + Math.sin(a) * 0.17); g.add(s);
  }
  // коромысло головок
  const pivot = new THREE.Group(); pivot.position.set(1.0, 0.36, 1.15); g.add(pivot);
  const pv = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 32), M.aluLight()); pivot.add(pv);
  const arm = box(0.16, 0.05, 1.9, M.aluLight(), 0.02); arm.position.set(-0.35, 0.02, -0.85); arm.rotation.y = 0.38; pivot.add(arm);
  const head = box(0.12, 0.04, 0.16, M.dark(), 0.02); head.position.set(-0.72, 0.0, -1.72); pivot.add(head);
  const magnet = box(0.7, 0.08, 0.5, M.dark(), 0.04); magnet.position.set(1.0, 0.3, 1.55); g.add(magnet);
  // разъём
  const sata = box(1.2, 0.18, 0.14, M.black(), 0.02); sata.position.set(-0.5, -0.05, 2.03); g.add(sata);
  // винты
  for (const [x, z] of [[-1.35, -1.85], [1.35, -1.85], [-1.35, 1.85], [1.35, 1.85]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 16), M.chrome()); s.position.set(x, 0.27, z); g.add(s);
  }
  g.userData.tick = t => { platter.rotation.y = t * 9; hub.rotation.y = t * 9; pivot.rotation.y = Math.sin(t * 1.3) * 0.25; };
  return g;
}

function sataSsdModel(info) {
  const g = new THREE.Group();
  const body = box(2.8, 0.3, 4.0, M.dark(), 0.1, 4); g.add(body);
  const lid = box(2.62, 0.04, 3.82, new THREE.MeshStandardMaterial({ color: 0x3a3b42, metalness: 0.7, roughness: 0.3 }), 0.08);
  lid.position.y = 0.15; g.add(lid);
  // наклейка: длинная сторона вдоль корпуса (Z). rotation.z поворачивает плоскость в её же плоскости,
  // поэтому ширина плоскости (3.1) после поворота ложится вдоль Z, а высота (2.2) — поперёк
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.2),
    new THREE.MeshPhysicalMaterial({ map: labelTexture(['SSD', info.model || 'Solid State Drive', info.sizeText || ''],
      { w: 720, h: 512, bg: ['#ffffff', '#e9f1ff'] }), roughness: 0.4, clearcoat: 0.5 }));
  lab.rotation.x = -Math.PI / 2; lab.rotation.z = Math.PI / 2; lab.position.y = 0.175; g.add(lab);
  const sata = box(1.3, 0.16, 0.12, M.black(), 0.02); sata.position.set(-0.4, 0, 2.02); g.add(sata);
  return g;
}

function nvmeModel(info) {
  const g = new THREE.Group();
  const pcb = box(1.4, 0.07, 4.6, M.pcb(), 0.03); g.add(pcb);
  // золотые контакты
  for (let i = 0; i < 18; i++) {
    const p = box(0.05, 0.075, 0.28, M.gold(), 0.01, 1); p.position.set(-0.6 + i * 0.07 + (i > 4 ? 0.06 : 0), 0, 2.16); g.add(p);
  }
  // чипы
  const ctrl = box(0.62, 0.09, 0.62, M.black(), 0.03); ctrl.position.set(0, 0.07, 1.25); g.add(ctrl);
  for (const z of [0.15, -0.95]) {
    const chip = box(1.05, 0.1, 0.9, M.black(), 0.03); chip.position.set(0, 0.075, z); g.add(chip);
  }
  const dram = box(0.5, 0.08, 0.35, M.black(), 0.03); dram.position.set(0.2, 0.07, -1.8); g.add(dram);
  // наклейка вдоль платы (раньше лежала поперёк и вылезала за края — «ломалась»)
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.22),
    new THREE.MeshPhysicalMaterial({ map: labelTexture(['NVMe', info.model || 'M.2 SSD', info.sizeText || ''],
      { w: 900, h: 330, bg: ['#1d1d1f', '#2c2c34'], accent: '#5ac8fa', dark: true }), roughness: 0.55, clearcoat: 0.15,
      envMapIntensity: 0.5 }));
  lab.rotation.x = -Math.PI / 2; lab.rotation.z = Math.PI / 2; lab.position.set(0, 0.132, -0.25); g.add(lab);
  // полукруглый вырез под винт
  const screw = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 12, 32, Math.PI), M.gold());
  screw.rotation.x = -Math.PI / 2; screw.position.set(0, 0.04, -2.3); g.add(screw);
  g.scale.setScalar(1.05);
  return g;
}

function usbModel(info) {
  const g = new THREE.Group();
  const body = box(1.3, 0.45, 3.0, M.white(), 0.2, 5); g.add(body);
  const plug = box(0.95, 0.3, 0.9, M.chrome(), 0.04); plug.position.z = 1.85; g.add(plug);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), new THREE.MeshStandardMaterial({ color: 0x0071e3, emissive: 0x0a84ff, emissiveIntensity: 2 }));
  led.position.set(0, 0.23, -1.0); g.add(led);
  g.userData.tick = t => { led.material.emissiveIntensity = 1.2 + Math.sin(t * 4) * 0.9; };
  return g;
}

// ------------------------------------------------------------ ноутбук (герой обзора)
// Свой дизайн «игрового» ноутбука: тёмный металл, гравировка на крышке, подсветка клавиатуры.
// Фирменные логотипы производителей намеренно не копируются.
const UIFONT = '-apple-system, "Segoe UI Variable Display", "Segoe UI", Arial, sans-serif';

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function canvasTex(c, aniso = 8) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
}
function gbShort(n) {
  const g = (n || 0) / 2 ** 30;
  return g >= 1000 ? (g / 1024).toFixed(1) + ' ТБ' : g >= 10 ? Math.round(g) + ' ГБ' : g.toFixed(1) + ' ГБ';
}

/** Картинка на экране ноутбука: кольцо заполненности системного диска. */
function screenTexture(info) {
  const w = 1600, h = 900;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const frac = Math.min(1, Math.max(0, info.frac ?? 0.5));
  const bg = g.createRadialGradient(w * 0.3, h * 0.42, 40, w * 0.5, h * 0.5, w * 0.8);
  bg.addColorStop(0, '#2b2e35'); bg.addColorStop(0.55, '#15171b'); bg.addColorStop(1, '#07080a');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.08)';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(w * 0.84, h * 0.5, 110 + i * 64, Math.PI * 0.55, Math.PI * 1.72); g.stroke(); }
  g.strokeStyle = 'rgba(90,200,250,.25)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(w * 0.6, 70); g.lineTo(w - 70, 70); g.lineTo(w - 70, 210); g.stroke();
  g.beginPath(); g.moveTo(70, h - 150); g.lineTo(70, h - 260); g.lineTo(230, h - 260); g.stroke();
  const cx = 430, cy = 420, R = 225;
  g.lineCap = 'round'; g.lineWidth = 46;
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  const ag = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  ag.addColorStop(0, frac > 0.9 ? '#ff9f0a' : '#64d2ff'); ag.addColorStop(1, frac > 0.9 ? '#ff453a' : '#0a84ff');
  g.save(); g.shadowColor = frac > 0.9 ? 'rgba(255,69,58,.7)' : 'rgba(10,132,255,.75)'; g.shadowBlur = 36;
  g.strokeStyle = ag; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, frac) * Math.PI * 2); g.stroke();
  g.restore();
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `700 96px ${UIFONT}`;
  g.fillText(info.free != null ? gbShort(info.free) : `${Math.round((1 - frac) * 100)}%`, cx, cy + 22);
  g.fillStyle = 'rgba(235,235,245,.62)'; g.font = `500 38px ${UIFONT}`; g.fillText('свободно', cx, cy + 82);
  g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `700 84px ${UIFONT}`; g.fillText('Чистильщик', 760, 318);
  const tg = g.createLinearGradient(760, 0, 1300, 0); tg.addColorStop(0, '#64d2ff'); tg.addColorStop(1, '#bf5af2');
  g.fillStyle = tg; g.fillText('диска', 760, 408);
  g.fillStyle = 'rgba(235,235,245,.62)'; g.font = `500 40px ${UIFONT}`;
  g.fillText(`Диск ${(info.root || 'C:').slice(0, 2)}${info.total ? ' · ' + gbShort(info.total) : ''}`, 764, 486);
  rr(g, 764, 528, 600, 24, 12); g.fillStyle = 'rgba(255,255,255,.1)'; g.fill();
  rr(g, 764, 528, Math.max(24, 600 * frac), 24, 12); g.fillStyle = ag; g.fill();
  g.fillStyle = 'rgba(235,235,245,.5)'; g.font = `500 32px ${UIFONT}`; g.fillText(`занято ${Math.round(frac * 100)}%`, 764, 600);
  g.fillStyle = 'rgba(18,19,22,.94)'; g.fillRect(0, h - 66, w, 66);
  for (let i = 0; i < 7; i++) { rr(g, w / 2 - 3.5 * 60 + i * 60 + 11, h - 54, 40, 40, 10); g.fillStyle = i === 3 ? '#0a84ff' : 'rgba(255,255,255,.14)'; g.fill(); }
  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `500 26px ${UIFONT}`; g.textAlign = 'right';
  g.fillText(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), w - 34, h - 24);
  return canvasTex(c);
}

/** Металлическая крышка: шлифовка, гравированные ступенчатые полосы, своя эмблема, винты. */
function lidTexture() {
  const w = 1024, h = 672;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#6b6d73'); bg.addColorStop(1, '#55575c');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`; g.fillRect(0, y, w, 1); }
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
  const engrave = path => {
    g.lineJoin = 'miter';
    g.strokeStyle = 'rgba(25,26,29,.6)'; g.lineWidth = 3; path(0, 0); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1.5; path(1.6, 1.6); g.stroke();
  };
  const bars = [[0.07, 0.17, 0.30], [0.22, 0.32, 0.44], [0.37, 0.47, 0.36], [0.52, 0.62, 0.50], [0.67, 0.77, 0.28], [0.82, 0.92, 0.40]];
  for (const [t, b, len] of bars) {
    const y0 = t * h, y1 = b * h, x1 = len * w, d = (y1 - y0) * 0.55;
    engrave((ox, oy) => {
      g.beginPath(); g.moveTo(-10 + ox, y0 + oy); g.lineTo(x1 - d + ox, y0 + oy); g.lineTo(x1 + ox, y0 + d + oy);
      g.lineTo(x1 + ox, y1 + oy); g.lineTo(-10 + ox, y1 + oy);
    });
  }
  const ex = w * 0.86, ey = h * 0.12, es = 30;
  engrave((ox, oy) => { g.beginPath(); g.moveTo(ex + ox, ey - es + oy); g.lineTo(ex + es + ox, ey + oy); g.lineTo(ex + ox, ey + es + oy); g.lineTo(ex - es + ox, ey + oy); g.closePath(); });
  engrave((ox, oy) => {
    g.beginPath(); g.moveTo(ex + ox, ey - 13 + oy); g.lineTo(ex + 4 + ox, ey - 4 + oy); g.lineTo(ex + 13 + ox, ey + oy);
    g.lineTo(ex + 4 + ox, ey + 4 + oy); g.lineTo(ex + ox, ey + 13 + oy); g.lineTo(ex - 4 + ox, ey + 4 + oy);
    g.lineTo(ex - 13 + ox, ey + oy); g.lineTo(ex - 4 + ox, ey - 4 + oy); g.closePath();
  });
  for (const [x, y] of [[0.035, 0.05], [0.965, 0.05], [0.035, 0.95], [0.965, 0.95]]) {
    g.fillStyle = '#2b2c30'; g.beginPath(); g.arc(x * w, y * h, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x * w, y * h, 9, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  }
  return canvasTex(c);
}

const RU_KEYS = { '`': 'Ё', Q: 'Й', W: 'Ц', E: 'У', R: 'К', T: 'Е', Y: 'Н', U: 'Г', I: 'Ш', O: 'Щ', P: 'З', '[': 'Х', ']': 'Ъ',
  A: 'Ф', S: 'Ы', D: 'В', F: 'А', G: 'П', H: 'Р', J: 'О', K: 'Л', L: 'Д', ';': 'Ж', "'": 'Э', Z: 'Я', X: 'Ч', C: 'С',
  V: 'М', B: 'И', N: 'Т', M: 'Ь', ',': 'Б', '.': 'Ю' };

/** Полноразмерная клавиатура с цифровым блоком; единица — ширина обычной клавиши (u). */
function keyboardLayout() {
  const keys = [];
  const MAIN = 15, GAPU = 0.35, NPW = 0.9, TOTAL = MAIN + GAPU + 4 * NPW;
  const fn = ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Ins', 'Del', 'PgUp', 'PgDn', 'Home', 'End'];
  const fw = TOTAL / fn.length;
  fn.forEach((l, i) => keys.push({ x: i * fw, z: 0, w: fw, d: 0.62, l, fn: true }));
  const z0 = 0.72;
  const rows = [
    [['`', 1], ...'1234567890-='.split('').map(k => [k, 1]), ['⌫', 2]],
    [['Tab', 1.5], ...'QWERTYUIOP[]'.split('').map(k => [k, 1]), ['\\', 1.5]],
    [['Caps', 1.75], ...'ASDFGHJKL;\''.split('').map(k => [k, 1]), ['Enter', 2.25]],
    [['Shift', 2.25], ...'ZXCVBNM,./'.split('').map(k => [k, 1]), ['Shift', 1.75], ['↑', 1]],
    [['Ctrl', 1.25], ['Fn', 1], ['⊞', 1], ['Alt', 1.25], ['', 5.5], ['Alt', 1], ['Ctrl', 1], ['←', 1], ['↓', 1], ['→', 1]],
  ];
  rows.forEach((row, r) => {
    let x = 0;
    for (const [l, w] of row) { keys.push({ x, z: z0 + r, w, d: 1, l, wasd: l.length === 1 && 'WASD'.includes(l) }); x += w; }
  });
  const nx = MAIN + GAPU;
  const np = [['Num', 0, 0], ['/', 1, 0], ['*', 2, 0], ['-', 3, 0], ['7', 0, 1], ['8', 1, 1], ['9', 2, 1], ['+', 3, 1, 1, 2],
    ['4', 0, 2], ['5', 1, 2], ['6', 2, 2], ['1', 0, 3], ['2', 1, 3], ['3', 2, 3], ['⏎', 3, 3, 1, 2], ['0', 0, 4, 2, 1], ['.', 2, 4]];
  for (const [l, c, r, w = 1, d = 1] of np) keys.push({ x: nx + c * NPW, z: z0 + r, w: w * NPW, d, l, np: true });
  return { keys, width: TOTAL, depth: z0 + 5 };
}

/** Светящиеся подписи клавиш (латиница + кириллица) — одна прозрачная текстура над клавиатурой. */
function keyLegendTexture(L) {
  const s = 108;
  const c = document.createElement('canvas'); c.width = Math.round(L.width * s); c.height = Math.round(L.depth * s);
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(80,200,255,.95)'; g.shadowBlur = 10;
  for (const k of L.keys) {
    if (!k.l) continue;
    const cx = (k.x + k.w / 2) * s, cy = (k.z + k.d / 2) * s;
    const ru = RU_KEYS[k.l];
    g.fillStyle = '#e8f8ff';
    if (ru) {
      g.font = `600 30px ${UIFONT}`; g.fillText(k.l, cx - 20, cy - 16);
      g.fillStyle = 'rgba(150,225,255,.9)'; g.font = `500 24px ${UIFONT}`; g.fillText(ru, cx + 20, cy + 18);
    } else {
      const single = k.l.length === 1;
      g.font = `${single ? 600 : 500} ${k.fn ? 19 : single ? 30 : 22}px ${UIFONT}`;
      g.fillText(k.l, cx, cy);
    }
  }
  return canvasTex(c);
}

function wordmarkTexture(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(160,163,170,.85)'; g.font = `600 44px ${UIFONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.split('').join(String.fromCharCode(8202)), 256, 50);
  return canvasTex(c);
}

function laptopModel(info) {
  const g = new THREE.Group();
  const W = 3.6, D = 2.52, H = 0.2, U = 0.18, GAP = 0.024;
  const gun = new THREE.MeshStandardMaterial({ color: 0x34363b, metalness: 0.6, roughness: 0.42 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.5, roughness: 0.52 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111215, metalness: 0.3, roughness: 0.6 });
  const port = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 });
  // корпус и верхняя панель
  const base = box(W, H, D, gun, 0.07, 4); base.position.y = H / 2; g.add(base);
  const deck = box(W - 0.07, 0.01, D - 0.07, deckMat, 0.004, 1); deck.position.y = H + 0.002; g.add(deck);
  const deckTop = H + 0.007;
  // клавиатура
  const L = keyboardLayout();
  const KW = L.width * U, KD = L.depth * U;
  const kx0 = -KW / 2, kz0 = -D / 2 + 0.36;
  const KH = 0.028, keyTop = deckTop + 0.026;
  // подсветка: светящийся ореол только под каждой клавишей (а не сплошная заливка всей области)
  const haloGeo = new THREE.PlaneGeometry(1, 1); haloGeo.rotateX(-Math.PI / 2);
  const halo = new THREE.InstancedMesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0x27b5ff, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), L.keys.length);
  const keyGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.14);
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, metalness: 0.15, roughness: 0.55 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const place = k => {
    pos.set(kx0 + (k.x + k.w / 2) * U, keyTop - KH / 2, kz0 + (k.z + k.d / 2) * U);
    scl.set(k.w * U - GAP, KH, k.d * U - GAP);
    return m4.compose(pos, q, scl);
  };
  L.keys.forEach((k, i) => {
    pos.set(kx0 + (k.x + k.w / 2) * U, deckTop + 0.0015, kz0 + (k.z + k.d / 2) * U);
    halo.setMatrixAt(i, m4.compose(pos, q, scl.set(k.w * U + 0.012, 1, k.d * U + 0.012)));
  });
  g.add(halo);
  const plain = L.keys.filter(k => !k.wasd);
  const inst = new THREE.InstancedMesh(keyGeo, keyMat, plain.length);
  plain.forEach((k, i) => inst.setMatrixAt(i, place(k)));
  inst.castShadow = true; inst.receiveShadow = true; g.add(inst);
  const wasdMat = new THREE.MeshPhysicalMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.62, roughness: 0.15,
    clearcoat: 1, emissive: 0x1aa8ff, emissiveIntensity: 0.55 });
  for (const k of L.keys.filter(k => k.wasd)) {
    const m = new THREE.Mesh(keyGeo, wasdMat); place(k).decompose(m.position, m.quaternion, m.scale); g.add(m);
  }
  const legend = new THREE.Mesh(new THREE.PlaneGeometry(KW, KD), new THREE.MeshBasicMaterial({ map: keyLegendTexture(L),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  legend.rotation.x = -Math.PI / 2; legend.position.set(0, keyTop + 0.0012, kz0 + KD / 2); g.add(legend);
  // тачпад по центру основного блока
  const mainCX = kx0 + 7.5 * U;
  const tpW = 1.26, tpD = 0.78, tpZ = kz0 + KD + 0.17 + tpD / 2;
  const tpRim = box(tpW + 0.03, 0.006, tpD + 0.03, new THREE.MeshStandardMaterial({ color: 0x5a5d63, metalness: 0.8, roughness: 0.3 }), 0.03, 2);
  tpRim.position.set(mainCX, deckTop + 0.0005, tpZ); g.add(tpRim);
  const tp = box(tpW, 0.008, tpD, new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.62, metalness: 0.2, envMapIntensity: 0.5 }), 0.028, 2);
  tp.position.set(mainCX, deckTop + 0.001, tpZ); g.add(tp);
  // индикаторы спереди
  for (const [x, col] of [[-1.62, 0xffffff], [-1.55, 0x39b6ff]]) {
    const led = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 12), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    led.position.set(x, deckTop + 0.002, D / 2 - 0.06); g.add(led);
  }
  // петли
  const pivotY = H + 0.085, pivotZ = -D / 2 + 0.1;
  const hingeMat = new THREE.MeshStandardMaterial({ color: 0x1f2024, metalness: 0.5, roughness: 0.45 });
  for (const x of [-1.25, 1.25]) {
    const hg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.62, 24), hingeMat);
    hg.rotation.z = Math.PI / 2; hg.position.set(x, pivotY, pivotZ); hg.castShadow = true; g.add(hg);
  }
  // решётки охлаждения сзади и по бокам
  const slats = [];
  for (const sx of [-1, 1]) {
    const plate = box(0.98, 0.12, 0.02, dark, 0.008, 1); plate.position.set(sx * 1.16, H * 0.5, -D / 2 - 0.004); g.add(plate);
    for (let i = 0; i < 13; i++) slats.push([sx * 1.16 - 0.42 + i * 0.07, H * 0.5, -D / 2 - 0.016, 0.026, 0.095, 0.012]);
    for (let i = 0; i < 6; i++) slats.push([sx * (W / 2 + 0.003), H * 0.52, -0.95 + i * 0.1, 0.008, 0.05, 0.065]);
  }
  const slatMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), port, slats.length);
  slats.forEach(([x, y, z, w, h, d], i) => slatMesh.setMatrixAt(i, m4.compose(pos.set(x, y, z), q, scl.set(w, h, d))));
  g.add(slatMesh);
  // порты: слева питание, LAN, HDMI, USB-A ×2, USB-C, аудио; справа USB-A
  const ports = [[-1, 0.35, 0.07, 0.07, 'round'], [-1, 0.52, 0.06, 0.1], [-1, 0.68, 0.04, 0.13], [-1, 0.84, 0.036, 0.11],
    [-1, 0.99, 0.036, 0.11], [-1, 1.12, 0.03, 0.075], [1, 0.9, 0.036, 0.11], [1, 1.04, 0.036, 0.11]];
  const blueTongue = new THREE.MeshBasicMaterial({ color: 0x1f6fff });
  for (const [sx, z, h, d, kind] of ports) {
    const geo = kind === 'round' ? new THREE.CylinderGeometry(h / 2, h / 2, 0.012, 20) : new THREE.BoxGeometry(0.012, h, d);
    const p = new THREE.Mesh(geo, port);
    if (kind === 'round') p.rotation.z = Math.PI / 2;
    p.position.set(sx * (W / 2 + 0.002), H * 0.5, z); g.add(p);
    if (h === 0.036) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.01, d * 0.8), blueTongue); t.position.set(sx * (W / 2 + 0.003), H * 0.5 + 0.006, z); g.add(t); }
  }
  // резиновые ножки
  for (const z of [-0.95, 0.95]) { const f = box(2.6, 0.02, 0.07, dark, 0.01, 1); f.position.set(0, -0.006, z); g.add(f); }

  // крышка на петлях
  const lid = new THREE.Group(); lid.position.set(0, pivotY, pivotZ); g.add(lid);
  const LW = W - 0.02, LH = 2.36, LT = 0.06, chin = 0.33;
  const lidEdge = new THREE.MeshStandardMaterial({ color: 0x4b4d52, metalness: 0.65, roughness: 0.38 });
  const lidBack = new THREE.MeshStandardMaterial({ map: lidTexture(), metalness: 0.62, roughness: 0.4 });
  const bezel = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  const lidMesh = new THREE.Mesh(new RoundedBoxGeometry(LW, LH, LT, 3, 0.025), [lidEdge, lidEdge, lidEdge, lidEdge, bezel, lidBack]);
  lidMesh.position.set(0, LH / 2, 0); lidMesh.castShadow = true; lidMesh.receiveShadow = true; lid.add(lidMesh);
  const scrW = LW - 0.17, scrH = scrW * 9 / 16;
  // экран светится сам и не отражает окружение (иначе под углом картинка «выцветает» в белое)
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTexture(info), color: 0x000000, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(scrW, scrH), screenMat);
  screen.position.set(0, chin + scrH / 2, LT / 2 + 0.0015); lid.add(screen);
  const camDot = new THREE.Mesh(new THREE.CircleGeometry(0.018, 24), new THREE.MeshPhysicalMaterial({ color: 0x050507, roughness: 0.1, clearcoat: 1 }));
  camDot.position.set(0, chin + scrH + (LH - chin - scrH) / 2, LT / 2 + 0.0016); lid.add(camDot);
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.116), new THREE.MeshBasicMaterial({ map: wordmarkTexture('ЧИСТИЛЬЩИК'), transparent: true, depthWrite: false }));
  mark.position.set(0, chin / 2 + 0.01, LT / 2 + 0.0016); lid.add(mark);
  const kbLight = new THREE.PointLight(0x2aa8ff, 0.5, 2.6); kbLight.position.set(0, deckTop + 0.3, -0.3); g.add(kbLight);
  // точка, куда «втягиваются» файлы в герое — центр экрана
  const sink = new THREE.Object3D(); sink.position.set(0, chin + scrH / 2, LT / 2 + 0.25); lid.add(sink);
  g.userData.sink = sink;
  // крышка открывается при появлении
  const OPEN = -0.36, CLOSED = Math.PI / 2;
  const t0 = performance.now();
  const animate = info.animate !== false;
  lid.rotation.x = animate ? CLOSED : OPEN;
  if (!animate) screenMat.color.setScalar(1);
  let opened = !animate;
  g.userData.tick = () => {
    if (opened) return;
    const p = Math.min(1, (performance.now() - t0 - 250) / 1500);
    if (p <= 0) return;
    const e = p >= 1 ? 1 : 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2);
    lid.rotation.x = CLOSED + (OPEN - CLOSED) * e;
    screenMat.color.setScalar(Math.min(1, Math.max(0, (p - 0.45) / 0.4)));
    if (p >= 1) opened = true;
  };
  g.userData.center = [0, 0.95, -0.35];
  return g;
}

function makeDisk(info) {
  const k = (info.kind || '').toUpperCase();
  if (k === 'LAPTOP') return laptopModel(info);
  if (k.includes('NVME')) return nvmeModel(info);
  if (k.includes('HDD')) return hddModel(info);
  if (k.includes('USB')) return usbModel(info);
  return sataSsdModel(info);
}

function usageRing(stage, frac, y = -0.55, R = 3.0) {
  const grp = new THREE.Group(); grp.position.y = y; grp.rotation.x = -Math.PI / 2;
  const free = new THREE.Mesh(new THREE.TorusGeometry(R, 0.055, 16, 200),
    new THREE.MeshStandardMaterial({ color: 0xe3e3e8, roughness: 0.5 }));
  grp.add(free);
  const usedMat = new THREE.MeshStandardMaterial({ color: frac > 0.9 ? 0xff3b30 : 0x0071e3, roughness: 0.3, metalness: 0.2,
    emissive: frac > 0.9 ? 0x661100 : 0x002a66, emissiveIntensity: 0.6 });
  let used = null;
  stage.scene.add(grp);
  const start = performance.now();
  stage.tick.push(() => {
    const p = Math.min(1, (performance.now() - start) / 1400);
    if (p >= 1 && used && used.userData.done) return;
    const e = 1 - Math.pow(1 - p, 3);
    const arc = Math.max(0.0001, frac * e * Math.PI * 2);
    if (used) { used.geometry.dispose(); grp.remove(used); }
    used = new THREE.Mesh(new THREE.TorusGeometry(R, 0.085, 16, 200, arc), usedMat);
    used.rotation.z = Math.PI / 2;
    used.userData.done = p >= 1;
    grp.add(used);
  });
  return grp;
}

/** 3D-модель диска с кольцом заполненности. info: {kind, frac, model, sizeText} */
export function mountDisk(el, info, opts = {}) {
  if (!webglAvailable()) return null;
  const s = new Stage(el, { cam: opts.cam ?? [5.6, 5.1, 7.9], fov: 30, autoRotate: opts.autoRotate ?? 1.1,
    groundY: -0.62, target: opts.target ?? [0, 0, 0] });
  const m = makeDisk(info);
  m.rotation.y = opts.rotY ?? -0.5;
  s.scene.add(m);
  s.model = m;
  if (m.userData.tick) s.tick.push(m.userData.tick);
  const bob = opts.bob ?? 0.06;
  s.tick.push(t => { m.position.y = Math.sin(t * 1.4) * bob; });
  if (info.frac != null) usageRing(s, info.frac);
  return s;
}

/** Статичный вид модели с заданного ракурса (страница проверки моделей). */
export function mountView(el, kind, opts = {}) {
  if (!webglAvailable()) return null;
  const s = new Stage(el, { cam: opts.cam ?? [5, 4, 7], fov: 30, autoRotate: 0, groundY: -0.62, zoom: true, minDist: 1,
    maxDist: 40, target: opts.target ?? [0, 0, 0] });
  const m = makeDisk({ ...(opts.info || {}), kind, animate: opts.animate });
  m.rotation.y = opts.rotY ?? 0;
  s.scene.add(m);
  if (m.userData.tick) s.tick.push(m.userData.tick);
  if (opts.ring && opts.info?.frac != null) usageRing(s, opts.info.frac);
  return s;
}

/** Герой: 3D-ноутбук (на экране — системный диск) + «файлы», которые втягиваются в экран. */
export function mountHero(el, info) {
  if (!webglAvailable()) return null;
  const s = mountDisk(el, { ...info, kind: 'LAPTOP' }, { cam: [6.3, 5.3, 7.7], target: [0, 0.7, -0.3], autoRotate: 0.55, bob: 0.04 });
  const sinkObj = s.model.userData.sink;
  const sinkPos = new THREE.Vector3();
  const N = 16;
  const geo = new RoundedBoxGeometry(0.26, 0.34, 0.025, 2, 0.035);
  const cols = [0x0071e3, 0x30b0c7, 0xaf52de, 0xff2d55, 0xff9f0a, 0x34c759, 0xffffff];
  const parts = [];
  for (let i = 0; i < N; i++) {
    const mat = new THREE.MeshPhysicalMaterial({ color: cols[i % cols.length], roughness: 0.25, clearcoat: 0.8,
      transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true;
    const p = { mesh, a: Math.random() * Math.PI * 2, r: 3.2 + Math.random() * 1.1, y: 0.4 + Math.random() * 1.8,
      sp: 0.25 + Math.random() * 0.35, life: Math.random(), spin: (Math.random() - 0.5) * 3 };
    parts.push(p); s.scene.add(mesh);
  }
  s.tick.push(t => {
    if (sinkObj) sinkObj.getWorldPosition(sinkPos); else sinkPos.set(0, 0.25, 0);
    for (const p of parts) {
      p.life += 0.0025 * p.sp * 4;
      if (p.life > 1) { p.life = 0; p.a = Math.random() * Math.PI * 2; p.r = 3.2 + Math.random() * 1.1; p.y = 0.4 + Math.random() * 1.8; }
      const k = Math.pow(p.life, 2.2);
      const a = p.a + t * p.sp;
      const ox = Math.cos(a) * p.r, oz = Math.sin(a) * p.r;
      p.mesh.position.set(ox + (sinkPos.x - ox) * k, p.y + (sinkPos.y - p.y) * k, oz + (sinkPos.z - oz) * k);
      p.mesh.rotation.set(t * p.spin, a, t * p.spin * 0.6);
      const sc = 1 - k * 0.85; p.mesh.scale.setScalar(sc);
      p.mesh.material.opacity = Math.min(1, (1 - k) * 1.6);
    }
  });
  return s;
}

// ------------------------------------------------------------ 3D-столбцы
function addTip(el) {
  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; el.appendChild(tip); return tip;
}

function hoverPick(s, el, meshes, onHover, onClick) {
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let hovered = null, down = null;
  const pick = e => {
    const r = el.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, s.camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    return { obj: hit ? hit.object : null, x: e.clientX - r.left, y: e.clientY - r.top };
  };
  s.renderer.domElement.addEventListener('pointermove', e => {
    const h = pick(e);
    if (h.obj !== hovered) { hovered = h.obj; el.style.cursor = hovered && onClick ? 'pointer' : ''; }
    onHover(h);
  });
  s.renderer.domElement.addEventListener('pointerleave', () => { hovered = null; onHover({ obj: null }); });
  s.renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  s.renderer.domElement.addEventListener('pointerup', e => {
    if (!onClick || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const h = pick(e); if (h.obj) onClick(h.obj);
  });
}

/** data: [{label, value}] */
export function mountBars(el, data) {
  if (!webglAvailable() || !data.length) return null;
  const n = data.length;
  const span = Math.max(6, n * 1.05);
  const s = new Stage(el, { cam: [span * 0.15, span * 0.42, span * 0.95], fov: 32, autoRotate: 0.35, groundY: 0,
    target: [0, 1.1, 0] });
  const base = box(span + 0.8, 0.16, 2.6, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, clearcoat: 0.3 }), 0.08);
  base.position.y = 0.08; s.scene.add(base);
  const max = Math.max(...data.map(d => d.value), 1);
  const bars = [];
  data.forEach((d, i) => {
    const h = 0.15 + 3.4 * (d.value / max);
    const mat = new THREE.MeshPhysicalMaterial({ color: PALETTE[i % PALETTE.length], roughness: 0.25, metalness: 0.05,
      clearcoat: 0.7, clearcoatRoughness: 0.2 });
    const m = new THREE.Mesh(new RoundedBoxGeometry(0.72, h, 0.72, 3, 0.1), mat);
    m.castShadow = true; m.receiveShadow = true;
    m.position.set(-span / 2 + 0.55 + i * (span - 1.1) / Math.max(1, n - 1) * (n > 1 ? 1 : 0), 0.16, 0);
    if (n === 1) m.position.x = 0;
    m.userData = { h, d, i };
    m.scale.y = 0.001;
    s.scene.add(m); bars.push(m);
  });
  const start = performance.now();
  s.tick.push(() => {
    const t = (performance.now() - start) / 1000;
    for (const m of bars) {
      const p = Math.min(1, Math.max(0, (t - m.userData.i * 0.07) / 0.9));
      const e = 1 - Math.pow(1 - p, 3) + (p < 1 ? 0 : 0);
      const target = m.userData.hover ? 1.06 : 1;
      m.scale.y = Math.max(0.001, e * target);
      m.position.y = 0.16 + (m.userData.h * m.scale.y) / 2;
    }
  });
  const tip = addTip(el);
  hoverPick(s, el, bars, h => {
    bars.forEach(b => { b.userData.hover = b === h.obj; b.material.emissive?.set(b === h.obj ? 0x222222 : 0x000000); });
    if (!h.obj) { tip.hidden = true; return; }
    const d = h.obj.userData.d;
    tip.hidden = false; tip.style.left = h.x + 'px'; tip.style.top = h.y + 'px';
    tip.textContent = `${d.label} — ${fmt(d.value)}`;
  });
  return s;
}

// ------------------------------------------------------------ полка с играми
function coverTexture(name, color, w = 300, h = 420) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const base = new THREE.Color(color);
  const dark = base.clone().multiplyScalar(0.45);
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, '#' + base.getHexString()); gr.addColorStop(1, '#' + dark.getHexString());
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.12)';
  g.beginPath(); g.arc(w * 0.85, h * 0.12, w * 0.55, 0, Math.PI * 2); g.fill();
  const font = '-apple-system, "Segoe UI Variable Display", "Segoe UI", Arial, sans-serif';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  g.fillStyle = 'rgba(255,255,255,.95)'; g.font = `800 ${Math.round(w * 0.36)}px ${font}`; g.textAlign = 'center';
  g.fillText(initials, w / 2, h * 0.46);
  g.font = `600 ${Math.round(w * 0.075)}px ${font}`;
  const words = name.split(/\s+/); let line = '', y = h * 0.74;
  for (const word of words) {
    if (g.measureText(line + word).width > w * 0.84 && line) { g.fillText(line.trim(), w / 2, y); line = ''; y += w * 0.095; }
    line += word + ' ';
    if (y > h * 0.95) break;
  }
  if (line && y <= h * 0.95) g.fillText(line.trim(), w / 2, y);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** games: [{id, name, image, size, _old, _last}], onPick(game) */
export function mountShelf(el, games, onPick) {
  if (!webglAvailable() || !games.length) return null;
  const list = games.slice(0, 24);
  const rows = list.length > 8 ? 2 : 1;
  const perRow = Math.ceil(list.length / rows);
  const W = 1.22, Hh = 1.72, D = 0.2, gap = 0.2, shelfH = Hh + 0.42;
  const width = Math.max(4.5, perRow * (W + gap));
  // камера подбирается под размер окна, чтобы полка заполняла кадр
  const fov = 32, aspect = (el.clientWidth || 900) / (el.clientHeight || 400), tan = Math.tan((fov / 2) * Math.PI / 180);
  const cy = (rows * shelfH) / 2;
  const dist = Math.max((width / 2 + 0.5) / (tan * aspect), (cy + 0.55) / tan) + 0.6;
  const s = new Stage(el, { cam: [0, cy + dist * 0.12, dist], fov, autoRotate: 0, groundY: -0.01, target: [0, cy - 0.05, 0] });
  s.controls.minAzimuthAngle = -0.6; s.controls.maxAzimuthAngle = 0.6;
  s.controls.minPolarAngle = 1.05; s.controls.maxPolarAngle = 1.62;
  const wood = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.45, clearcoat: 0.3 });
  for (let r = 0; r < rows; r++) {
    const plank = box(width + 0.7, 0.12, 1.1, wood, 0.05); plank.position.set(0, r * shelfH, 0); s.scene.add(plank);
  }
  const back = box(width + 0.7, rows * shelfH + 0.2, 0.08, new THREE.MeshStandardMaterial({ color: 0xf2f2f6, roughness: 0.8 }), 0.04);
  back.position.set(0, (rows * shelfH) / 2 - 0.05, -0.56); s.scene.add(back);
  const loader = new THREE.TextureLoader();
  const cases = [];
  list.forEach((g, i) => {
    const r = Math.floor(i / perRow), c = i % perRow;
    const n = Math.min(perRow, list.length - r * perRow);
    const x = -((n - 1) * (W + gap)) / 2 + c * (W + gap);
    const col = PALETTE[i % PALETTE.length];
    const spine = new THREE.MeshStandardMaterial({ color: g._old ? 0x9c9ca3 : col, roughness: 0.45, metalness: 0.05 });
    const front = new THREE.MeshPhysicalMaterial({ map: coverTexture(g.name, g._old ? '#8e8e93' : col), roughness: 0.32,
      clearcoat: 0.9, clearcoatRoughness: 0.15, color: g._old ? 0xb9b9be : 0xffffff });
    const m = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, D), [spine, spine, spine, spine, front, spine]);
    m.castShadow = true; m.receiveShadow = true;
    m.position.set(x, r * shelfH + 0.06 + Hh / 2, 0);
    m.rotation.z = g._old ? (((i * 7919) % 100) / 100 - 0.5) * 0.12 : 0;
    m.userData = { g, i, z: 0 };
    s.scene.add(m); cases.push(m);
    if (g.image) {
      loader.load(`/api/game_image?id=${encodeURIComponent(g.id)}&kind=portrait`, tex => {
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
        front.map?.dispose(); front.map = tex; front.needsUpdate = true;
      }, undefined, () => {});
    }
  });
  const start = performance.now();
  s.tick.push(t => {
    const k = Math.min(1, (performance.now() - start) / 900);
    for (const m of cases) {
      const target = m.userData.hover ? 0.55 : 0;
      m.userData.z += (target - m.userData.z) * 0.14;
      const intro = Math.min(1, Math.max(0, k * 1.6 - m.userData.i * 0.04));
      m.position.z = m.userData.z + (1 - (1 - Math.pow(1 - intro, 3))) * 2.5;
      m.rotation.y = m.userData.hover ? Math.sin(t * 2) * 0.05 : 0;
    }
    s.camera.position.x += (Math.sin(t * 0.25) * 0.4 - s.camera.position.x) * 0.002;
  });
  const tip = addTip(el);
  hoverPick(s, el, cases, h => {
    cases.forEach(c => { c.userData.hover = c === h.obj; });
    if (!h.obj) { tip.hidden = true; return; }
    const g = h.obj.userData.g;
    tip.hidden = false; tip.style.left = h.x + 'px'; tip.style.top = h.y + 'px';
    tip.textContent = `${g.name} — ${g._last} — ${fmt(g.size)}`;
  }, onPick ? obj => onPick(obj.userData.g) : null);
  return s;
}

// ------------------------------------------------------------ «город» папок (treemap в 3D)
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((a, b) => a + b.v, 0) || 1;
  const scale = (w * h) / total;
  let rest = items.map(it => ({ ...it, a: it.v * scale }));
  const worst = (row, len) => {
    const s = row.reduce((a, b) => a + b.a, 0);
    const mx = Math.max(...row.map(r => r.a)), mn = Math.min(...row.map(r => r.a));
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };
  while (rest.length) {
    const len = Math.min(w, h);
    let row = [rest[0]], i = 1;
    while (i < rest.length && worst([...row, rest[i]], len) <= worst(row, len)) { row.push(rest[i]); i++; }
    const s = row.reduce((a, b) => a + b.a, 0);
    if (w >= h) {
      const rw = s / h; let cy = y;
      for (const r of row) { const rh = r.a / rw; out.push({ ...r, x, y: cy, w: rw, h: rh }); cy += rh; }
      x += rw; w -= rw;
    } else {
      const rh = s / w; let cx = x;
      for (const r of row) { const rw2 = r.a / rh; out.push({ ...r, x: cx, y, w: rw2, h: rh }); cx += rw2; }
      y += rh; h -= rh;
    }
    rest = rest.slice(i);
  }
  return out;
}

/** rows: [{name, size, dir}], onPick(row) */
export function mountCity(el, rows, onPick) {
  if (!webglAvailable()) return null;
  const items = rows.filter(r => r.size > 0).slice(0, 60).map((r, i) => ({ v: r.size, r, i }));
  const s = new Stage(el, { cam: [0, 9.5, 11.5], fov: 34, autoRotate: 0.45, groundY: 0, zoom: true, minDist: 6, maxDist: 26,
    target: [0, 0.6, 0] });
  const W = 12, H = 8;
  const plate = box(W + 0.6, 0.14, H + 0.6, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.55, clearcoat: 0.25 }), 0.12);
  plate.position.y = 0.07; s.scene.add(plate);
  if (!items.length) return s;
  const max = items[0].v;
  const rects = squarify(items, -W / 2, -H / 2, W, H);
  const blocks = [];
  for (const q of rects) {
    const gap = 0.07;
    const w = Math.max(0.05, q.w - gap), d = Math.max(0.05, q.h - gap);
    const hgt = 0.12 + 3.2 * Math.sqrt(q.v / max);
    const col = q.r.dir ? PALETTE[q.i % PALETTE.length] : '#c7c7cc';
    const mat = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, hgt, d, 2, Math.min(0.06, w / 3, d / 3)), mat);
    m.castShadow = true; m.receiveShadow = true;
    m.position.set(q.x + q.w / 2, 0.14, q.y + q.h / 2);
    m.userData = { hgt, row: q.r, i: q.i };
    m.scale.y = 0.001;
    s.scene.add(m); blocks.push(m);
  }
  const start = performance.now();
  s.tick.push(() => {
    const t = (performance.now() - start) / 1000;
    for (const m of blocks) {
      const p = Math.min(1, Math.max(0, (t - m.userData.i * 0.025) / 0.8));
      const e = 1 - Math.pow(1 - p, 3);
      const k = m.userData.hover ? 1.08 : 1;
      m.scale.y = Math.max(0.001, e * k);
      m.position.y = 0.14 + (m.userData.hgt * m.scale.y) / 2;
    }
  });
  const tip = addTip(el);
  hoverPick(s, el, blocks, h => {
    blocks.forEach(b => { b.userData.hover = b === h.obj; b.material.emissive.set(b === h.obj ? 0x1a1a1a : 0x000000); });
    s.controls.autoRotate = !h.obj;
    if (!h.obj) { tip.hidden = true; return; }
    const r = h.obj.userData.row;
    tip.hidden = false; tip.style.left = h.x + 'px'; tip.style.top = h.y + 'px';
    tip.textContent = `${r.dir ? '📁' : '📄'} ${r.name} — ${fmt(r.size)}`;
  }, onPick ? obj => onPick(obj.userData.row) : null);
  return s;
}
