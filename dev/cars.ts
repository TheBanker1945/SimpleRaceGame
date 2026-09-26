// Development-only car viewer: `npm run dev`, then open /dev/cars.html?car=vortex
// Renders one car from four angles (or ?view=front|rear|side|top|three for a single view).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CarModel } from '../src/render/CarModel.ts';
import { getCar, isCarId } from '../src/vehicle/CarCatalog.ts';

const params = new URLSearchParams(location.search);
const id = params.get('car');
const def = getCar(isCarId(id) ? id : 'vortex');
const paint = params.get('paint') ? parseInt(params.get('paint') as string, 16) : def.defaultPaint;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa6bd);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x3a3326, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(6, 10, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -5;
sun.shadow.camera.right = sun.shadow.camera.top = 5;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const t0 = performance.now();
const car = new CarModel(def, { paint, withHeadlightLights: false });
const buildMs = performance.now() - t0;
car.root.traverse((o) => {
  if (o instanceof THREE.Mesh) o.castShadow = true;
});
scene.add(car.root);
if (params.has('matte')) {
  car.paintMaterial.roughness = 0.9;
  car.paintMaterial.metalness = 0;
  car.paintMaterial.clearcoat = 0;
}
car.setHeadlights(params.has('night'));
let tris = 0;
const breakdown: string[] = [];
car.root.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const n = (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3;
  tris += n;
  const m = Array.isArray(o.material) ? 'shell' : (o.material as THREE.Material).type + ':' + ((o.material as THREE.MeshStandardMaterial).color?.getHexString() ?? '');
  breakdown.push(`${m}=${n}`);
});
console.log(breakdown.join(' '));
(window as unknown as { carStats: unknown }).carStats = { buildMs, tris };
console.log(`built ${def.id} in ${buildMs.toFixed(1)} ms, ${tris} triangles`);

const views: Record<string, [number, number, number, number]> = {
  // camera position, fov
  three: [5.2, 1.7, 5.6, 32],
  rear: [-4.6, 1.9, -5.8, 32],
  side: [7.6, 0.75, 0, 30],
  front: [0.001, 0.8, 8, 26],
  top: [0.001, 9, 0.001, 32],
  back: [0.001, 0.9, -8, 26],
  low: [3.8, 0.45, 3.2, 40],
};
const single = params.get('view');
const layout = single ? [single] : ['three', 'rear', 'side', 'front'];
const cams = layout.map((v) => {
  const [x, y, z, fov] = views[v] ?? views.three;
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  cam.position.set(x, y, z);
  cam.lookAt(0, v === 'top' ? 0 : 0.55, 0);
  if (v === 'top') cam.up.set(0, 0, -1), cam.lookAt(0, 0, 0);
  return cam;
});
function render(): void {
  const W = innerWidth;
  const H = innerHeight;
  renderer.setScissorTest(true);
  const cols = cams.length > 1 ? 2 : 1;
  const rows = cams.length > 1 ? 2 : 1;
  cams.forEach((cam, i) => {
    const w = W / cols;
    const h = H / rows;
    const x = (i % cols) * w;
    const y = H - (Math.floor(i / cols) + 1) * h;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
  });
}
render();
(window as unknown as { ready: boolean }).ready = true;
