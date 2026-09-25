import * as THREE from 'three';
import { Input } from '../input/Input.ts';
import { CameraRig } from '../render/CameraRig.ts';
import { CarModel } from '../render/CarModel.ts';
import { Renderer } from '../render/Renderer.ts';
import { DEFAULT_VEHICLE } from '../vehicle/VehicleConfig.ts';
import { FLAT_ROAD, VehiclePhysics } from '../vehicle/VehiclePhysics.ts';
import { FlatRoad } from '../world/FlatRoad.ts';
import { laneCenter } from '../world/RoadConstants.ts';
import { FixedStepLoop } from './FixedStepLoop.ts';
import { MS_TO_KMH } from './math.ts';

/** Milestone 1: drive the car on a flat straight road. */
export class Game {
  private readonly renderer: Renderer;
  private readonly input = new Input();
  private readonly loop = new FixedStepLoop(1 / 120);
  private readonly car = new VehiclePhysics(DEFAULT_VEHICLE);
  private readonly carModel: CarModel;
  private readonly cameraRig: CameraRig;
  private readonly road: FlatRoad;
  private readonly debug: HTMLElement;
  private originS = 0;
  private lastTime = 0;
  private readonly carPos = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container, 'medium');
    const scene = this.renderer.scene;
    scene.background = new THREE.Color(0x9cc4e8);
    scene.fog = new THREE.Fog(0x9cc4e8, 150, 1400);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x4a5a3a, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.4);
    sun.position.set(-40, 80, 30);
    scene.add(sun);

    this.road = new FlatRoad(this.renderer.maxAnisotropy);
    scene.add(this.road.group);
    this.carModel = new CarModel(DEFAULT_VEHICLE, { paint: 0xb3121b, withHeadlightLights: false });
    scene.add(this.carModel.root);
    this.cameraRig = new CameraRig(this.renderer.aspect);

    this.debug = document.createElement('div');
    this.debug.style.cssText =
      'position:absolute;left:12px;top:12px;color:#fff;font:14px monospace;text-shadow:0 1px 2px #000;white-space:pre';
    container.appendChild(this.debug);

    this.car.reset(0, laneCenter(2), 60 / MS_TO_KMH);
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.cameraRig.camera.aspect = this.renderer.aspect;
    });
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

  private frame(dt: number): void {
    this.input.update(dt, this.car.speed);
    if (this.input.consume('camera')) this.cameraRig.toggle();
    if (this.input.consume('shiftUp')) this.car.gearbox.shiftUp();
    if (this.input.consume('shiftDown')) this.car.gearbox.shiftDown(this.car.omegaRear, this.car.u);
    if (this.input.consume('restart')) this.car.reset(this.car.s, laneCenter(2), 60 / MS_TO_KMH);

    this.loop.advance(dt, 1, (step) => this.car.update(step, this.input.state, FLAT_ROAD));

    if (this.car.s - this.originS > 1000) this.originS = Math.floor(this.car.s);
    const car = this.car;
    this.carPos.set(car.d, 0, car.s - this.originS);
    this.carModel.root.position.copy(this.carPos);
    this.carModel.root.rotation.y = car.psi;
    this.carModel.updateDynamics(
      car.pitch,
      car.roll,
      car.heave,
      car.steerAngle,
      car.wheels.map((w) => w.spin),
      car.wheels.map((w) => w.compression),
    );
    this.carModel.setLights(car.appliedBrake, car.gearbox.gear < 0);
    this.road.update(car.s, this.originS);

    this.cameraRig.update(dt, {
      position: this.carPos,
      yaw: car.psi,
      body: this.carModel.body,
      speed: car.speed,
      accel: car.ax,
      lateralAccel: car.ay,
    });
    this.renderer.render(this.cameraRig.camera);

    this.debug.textContent =
      `${(car.speed * MS_TO_KMH).toFixed(0)} km/h  gear ${car.gearbox.gearLabel()}  ${car.rpm.toFixed(0)} rpm\n` +
      `ABS ${car.absActive ? 'ON' : '--'}  TCS ${car.tcsActive ? 'ON' : '--'}  slip ${car.maxSlip.toFixed(2)}\n` +
      'W/S throttle/brake · A/D steer · Space handbrake · C camera · Shift/Ctrl gears';
  }
}
