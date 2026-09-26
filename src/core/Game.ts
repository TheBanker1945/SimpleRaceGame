import * as THREE from 'three';
import { Input } from '../input/Input.ts';
import { collideWithBarriers, createBody, createContact, type ImpactResult } from '../physics/Collision.ts';
import { bodyToVehicle, vehicleToBody } from '../physics/VehicleBody.ts';
import { CameraRig } from '../render/CameraRig.ts';
import { CarModel } from '../render/CarModel.ts';
import { Renderer } from '../render/Renderer.ts';
import { DEFAULT_VEHICLE } from '../vehicle/VehicleConfig.ts';
import { VehiclePhysics } from '../vehicle/VehiclePhysics.ts';
import type { TimeOfDay } from '../world/Environment.ts';
import { BARRIER_LEFT, BARRIER_RIGHT, laneCenter } from '../world/RoadConstants.ts';
import { World, type RenderPose } from '../world/World.ts';
import { FixedStepLoop } from './FixedStepLoop.ts';
import { lerp, MS_TO_KMH } from './math.ts';
import { loadSettings, type Settings } from './Settings.ts';

const START_S = 60;

/** Milestone 3: drive the procedural highway. */
export class Game {
  private readonly renderer: Renderer;
  private readonly world: World;
  private readonly input = new Input();
  private readonly loop = new FixedStepLoop(1 / 120);
  private readonly car = new VehiclePhysics(DEFAULT_VEHICLE);
  private readonly carModel: CarModel;
  private readonly cameraRig: CameraRig;
  private readonly debug: HTMLElement;
  private readonly settings: Settings;
  private lastTime = 0;
  private readonly orbitView: boolean;

  private prevS = 0;
  private prevD = 0;
  private prevPsi = 0;
  private readonly pose: RenderPose = { position: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private readonly body = createBody();
  private readonly contact = createContact();
  private readonly impact: ImpactResult = { closingSpeed: 0, impulse: 0 };

  constructor(container: HTMLElement) {
    this.settings = loadSettings();
    const params = new URLSearchParams(window.location.search);
    const tod = params.get('tod');
    if (tod === 'day' || tod === 'sunset' || tod === 'night') this.settings.timeOfDay = tod as TimeOfDay;
    const q = params.get('quality');
    if (q === 'low' || q === 'medium' || q === 'high') this.settings.quality = q;
    this.orbitView = params.get('view') === 'orbit';

    this.renderer = new Renderer(container, this.settings.quality);
    this.world = new World(this.renderer.renderer, this.renderer.scene, this.renderer.maxAnisotropy);
    this.carModel = new CarModel(DEFAULT_VEHICLE, { paint: this.settings.paint, withHeadlightLights: true });
    this.carModel.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.renderer.scene.add(this.carModel.root);
    this.cameraRig = new CameraRig(this.renderer.aspect);
    this.world.applySettings(this.renderer.profile, this.settings.timeOfDay);
    this.carModel.setHeadlights(this.world.isNight);

    this.debug = document.createElement('div');
    this.debug.style.cssText =
      'position:absolute;left:12px;top:12px;color:#fff;font:14px monospace;text-shadow:0 1px 2px #000;white-space:pre';
    container.appendChild(this.debug);

    this.newRun();
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.cameraRig.camera.aspect = this.renderer.aspect;
    });
  }

  private newRun(): void {
    const seed = (Math.random() * 1e9) | 0;
    // `?start=<meters>` begins the run that far down the road and millions of meters from the
    // world origin, to demonstrate that the floating origin keeps everything precise.
    const far = Number(new URLSearchParams(window.location.search).get('start')) || 0;
    const roadStart = Math.max(0, far);
    const startS = roadStart + START_S;
    this.world.reset(seed, startS, roadStart, far * 0.7, far * 0.7);
    this.car.reset(startS, laneCenter(2), 70 / MS_TO_KMH);
    this.prevS = this.car.s;
    this.prevD = this.car.d;
    this.prevPsi = this.car.psi;
    this.loop.reset();
  }

  start(): void {
    this.lastTime = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      this.frame(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private fixedUpdate(dt: number): void {
    const car = this.car;
    this.prevS = car.s;
    this.prevD = car.d;
    this.prevPsi = car.psi;
    car.update(dt, this.input.state, this.world.path);
    vehicleToBody(car, this.body);
    if (collideWithBarriers(this.body, BARRIER_LEFT, BARRIER_RIGHT, 0.25, 0.35, this.impact, this.contact)) {
      bodyToVehicle(this.body, car);
      if (this.impact.closingSpeed > 2) this.cameraRig.addTrauma(Math.min(0.6, this.impact.closingSpeed * 0.04));
    }
  }

  private frame(dt: number): void {
    const car = this.car;
    this.input.update(dt, car.speed);
    if (this.input.consume('camera')) this.cameraRig.toggle();
    if (this.input.consume('shiftUp')) car.gearbox.shiftUp();
    if (this.input.consume('shiftDown')) car.gearbox.shiftDown(car.omegaRear, car.u);
    if (this.input.consume('restart')) this.newRun();

    this.loop.advance(dt, 1, (step) => this.fixedUpdate(step));
    this.world.update(car.s);

    const a = this.loop.alpha;
    const s = lerp(this.prevS, car.s, a);
    const d = lerp(this.prevD, car.d, a);
    const psi = lerp(this.prevPsi, car.psi, a);
    this.world.poseAt(s, d, psi, this.pose);
    const root = this.carModel.root;
    root.position.copy(this.pose.position);
    root.rotation.order = 'YXZ';
    root.rotation.set(this.pose.pitch * Math.cos(psi), this.pose.yaw, this.pose.pitch * Math.sin(psi));
    this.carModel.updateDynamics(
      car.pitch,
      car.roll,
      car.heave,
      car.steerAngle,
      car.wheels.map((w) => w.spin),
      car.wheels.map((w) => w.compression),
    );
    this.carModel.setLights(car.appliedBrake, car.gearbox.gear < 0);

    if (this.orbitView) this.cameraRig.updateOrbit(dt, this.pose.position);
    else this.cameraRig.update(dt, {
      position: this.pose.position,
      yaw: this.pose.yaw,
      body: this.carModel.body,
      speed: car.speed,
      accel: car.ax,
      lateralAccel: car.ay,
    });
    this.world.environment.update(dt, this.cameraRig.camera, this.pose.position, this.pose.position.y);
    this.renderer.render(this.cameraRig.camera);

    this.debug.textContent =
      `${(car.speed * MS_TO_KMH).toFixed(0)} km/h  gear ${car.gearbox.gearLabel()}  ${car.rpm.toFixed(0)} rpm\n` +
      `ABS ${car.absActive ? 'ON' : '--'}  TCS ${car.tcsActive ? 'ON' : '--'}  ESC ${car.escActive ? 'ON' : '--'}  slip ${car.maxSlip.toFixed(2)}\n` +
      `s ${car.s.toFixed(0)} m  d ${car.d.toFixed(2)}  calls ${this.renderer.renderer.info.render.calls}`;
  }
}
