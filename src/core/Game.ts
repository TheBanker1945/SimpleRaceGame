import * as THREE from 'three';
import { AudioEngine, type CarSoundState, type SoundSource } from '../audio/AudioEngine.ts';
import { Input } from '../input/Input.ts';
import { collideWithBarriers, createBody, createContact, type ImpactResult } from '../physics/Collision.ts';
import { bodyToVehicle, vehicleToBody } from '../physics/VehicleBody.ts';
import { CameraRig, type CameraTarget } from '../render/CameraRig.ts';
import { CarModel } from '../render/CarModel.ts';
import { Effects } from '../render/Effects.ts';
import { Renderer } from '../render/Renderer.ts';
import type { TrafficCar } from '../traffic/TrafficCar.ts';
import { TrafficManager } from '../traffic/TrafficManager.ts';
import { TrafficRenderer } from '../traffic/TrafficRenderer.ts';
import { Hud } from '../ui/Hud.ts';
import { Menus } from '../ui/Menus.ts';
import { RotateOverlay } from '../ui/RotateOverlay.ts';
import { isTouchDevice, TouchControls } from '../ui/TouchControls.ts';
import { CARS, getCar, type CarDefinition, type CarId } from '../vehicle/CarCatalog.ts';
import { REVERSE } from '../vehicle/Gearbox.ts';
import { VehiclePhysics, type DriverInput } from '../vehicle/VehiclePhysics.ts';
import type { TimeOfDay } from '../world/Environment.ts';
import { BARRIER_LEFT, BARRIER_RIGHT, LANES_HALF_WIDTH, laneCenter, RIGHT_SHOULDER } from '../world/RoadConstants.ts';
import { World, type RenderPose } from '../world/World.ts';
import { FixedStepLoop } from './FixedStepLoop.ts';
import { clamp, clamp01, lerp, MS_TO_KMH, smoothstep } from './math.ts';
import { COMBO_WINDOW, Scoring } from './Scoring.ts';
import { loadBestScore, loadSettings, paintFor, saveBestScore, saveSettings, type Settings } from './Settings.ts';

export type GameState = 'menu' | 'playing' | 'paused' | 'crashing' | 'gameover';

/** Physics runs at a fixed 120 Hz (the vehicle substeps twice more internally). */
const PHYSICS_STEP = 1 / 120;
/** Distance down the fresh road where each run starts. */
const START_S = 60;
const START_SPEED_KMH = 70;
/** Closing speeds (m/s) that end the run outright (~40 km/h into traffic, ~49 km/h into a barrier). */
const HARD_HIT_TRAFFIC = 11;
const HARD_HIT_BARRIER = 13.5;
const CRASH_SEQUENCE_SECONDS = 2.6;

const NO_INPUT: DriverInput = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

/**
 * Top-level game: owns every system and runs the state machine
 * menu → playing ⇄ paused → crashing → gameover → playing …
 */
export class Game {
  private readonly container: HTMLElement;
  private readonly settings: Settings;
  private best: number;
  private readonly renderer: Renderer;
  private readonly world: World;
  private readonly input = new Input();
  private readonly loop = new FixedStepLoop(PHYSICS_STEP);
  private carDef: CarDefinition;
  private car: VehiclePhysics;
  private carModel: CarModel;
  /** Built car models, so flipping through the garage only builds each car once. */
  private readonly models = new Map<CarId, CarModel>();
  private readonly cameraRig: CameraRig;
  private readonly traffic: TrafficManager;
  private readonly audio = new AudioEngine();
  private readonly hud: Hud;
  private readonly menus: Menus;
  private readonly touch: TouchControls | null;
  private readonly rotate: RotateOverlay;
  private readonly isTouch: boolean;
  private framing = 0;
  private readonly scoring = new Scoring();
  private readonly effects = new Effects();
  private effectsOriginX = 0;
  private effectsOriginZ = 0;
  /** Pending spark burst from the last contact (road coordinates). */
  private sparkS = 0;
  private sparkD = 0;
  private sparkCount = 0;
  private readonly tmpWheel = new THREE.Vector3();
  private readonly tmpVel = new THREE.Vector3();
  private readonly tmpSpark = new THREE.Vector3();

  state: GameState = 'menu';
  private damage = 0;
  private crashTimer = 0;
  private crashReason = '';
  private timeScale = 1;
  private scrapeAge = 10;
  /** Simulation time of the last barrier impact that caused damage (debounces scraping). */
  private lastBarrierImpact = -10;
  private simTime = 0;
  private lastShiftCount = 0;
  private lastTime = 0;
  private fps = 60;
  private framesRendered = 0;
  private readonly orbitOnly: boolean;

  private prevS = 0;
  private prevD = 0;
  private prevPsi = 0;
  private readonly pose: RenderPose = { position: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private readonly body = createBody();
  private readonly contact = createContact();
  private readonly impact: ImpactResult = { closingSpeed: 0, impulse: 0 };
  private readonly spins: number[] = [0, 0, 0, 0];
  private readonly compressions: number[] = [0, 0, 0, 0];
  private readonly sources: SoundSource[] = [];
  private readonly camTarget: CameraTarget;
  private readonly soundState: CarSoundState = {
    rpm: 0,
    idleRPM: 850,
    limiterRPM: 7500,
    load: 0,
    throttle: 0,
    limiterCutting: false,
    speed: 0,
    slip: 0,
    onRumbleStrip: false,
    scrapeAge: 10,
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.settings = loadSettings();
    this.best = loadBestScore();
    // URL overrides (handy for testing and sharing): ?quality=high&tod=night&view=orbit
    const params = new URLSearchParams(window.location.search);
    const tod = params.get('tod');
    if (tod === 'day' || tod === 'sunset' || tod === 'night') this.settings.timeOfDay = tod as TimeOfDay;
    const q = params.get('quality');
    if (q === 'low' || q === 'medium' || q === 'high') this.settings.quality = q;
    this.orbitOnly = params.get('view') === 'orbit';
    this.isTouch = isTouchDevice() || params.has('touch');
    document.documentElement.classList.toggle('touch', this.isTouch);

    this.renderer = new Renderer(container, this.settings.quality);
    this.world = new World(this.renderer.renderer, this.renderer.scene, this.renderer.maxAnisotropy);
    this.carDef = getCar(this.settings.car);
    this.car = new VehiclePhysics(this.carDef.config);
    this.carModel = this.modelFor(this.carDef);
    this.renderer.scene.add(this.carModel.root);
    this.cameraRig = new CameraRig(this.renderer.aspect);
    this.camTarget = {
      position: this.pose.position,
      yaw: 0,
      body: this.carModel.body,
      hoodEye: this.carModel.hoodEye,
      hoodLook: this.carModel.hoodLook,
      speed: 0,
      accel: 0,
      lateralAccel: 0,
    };
    this.audio.setEngineSound(this.carDef.sound);
    this.soundState.idleRPM = this.carDef.config.idleRPM;
    this.soundState.limiterRPM = this.carDef.config.limiterRPM;
    const trafficRenderer = new TrafficRenderer(24, 260);
    this.renderer.scene.add(trafficRenderer.group);
    this.traffic = new TrafficManager(trafficRenderer);
    this.renderer.scene.add(this.effects.group);

    this.hud = new Hud(container);
    this.touch = this.isTouch ? new TouchControls(container, this.input) : null;
    this.menus = new Menus(
      container,
      this.settings,
      {
        start: () => this.startRun(),
        resume: () => this.resume(),
        restart: () => this.startRun(),
        quitToMenu: () => this.enterMenu(),
        settingsChanged: (s, key) => this.onSettingsChanged(s, key),
        carChanged: (id) => this.selectCar(id),
        click: () => {
          this.audio.init();
          this.audio.playUiClick();
        },
      },
      this.isTouch,
    );
    this.rotate = new RotateOverlay(container, this.isTouch, (blocking) => {
      if (blocking && this.state === 'playing') this.pause();
    });

    this.applyAllSettings();
    this.installBrowserHooks();
    this.enterMenu();
  }

  /**
   * Small scripting surface for automated browser tests (enabled with `?debug`):
   * read the state and trigger a crash without having to aim the car.
   */
  debugApi(): {
    state: () => GameState;
    speed: () => number;
    crash: () => void;
    score: () => number;
    traffic: () => number;
    car: () => CarId;
    selectCar: (id: CarId) => void;
  } {
    return {
      state: () => this.state,
      speed: () => this.car.speed * MS_TO_KMH,
      crash: () => this.crash('Debug crash', 1),
      score: () => this.scoring.score,
      traffic: () => this.traffic.active.length,
      car: () => this.carDef.id,
      selectCar: (id) => {
        this.settings.car = id;
        this.selectCar(id);
      },
    };
  }

  // -------------------------------------------------------------- car choice

  private modelFor(def: CarDefinition): CarModel {
    let model = this.models.get(def.id);
    if (!model) {
      model = new CarModel(def, { paint: paintFor(this.settings, def.id), withHeadlightLights: true });
      model.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      this.models.set(def.id, model);
    }
    return model;
  }

  /** Builds the other cars one at a time while the menu idles, so the garage flips instantly. */
  private prebuildModels(): void {
    const queue = CARS.filter((c) => !this.models.has(c.id));
    const idle = (cb: () => void): void => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(cb, { timeout: 3000 });
      else setTimeout(cb, 400);
    };
    const next = (): void => {
      const def = queue.shift();
      if (!def) return;
      // Only while nobody is driving: a build takes a few hundred ms.
      if (this.state === 'menu') this.modelFor(def);
      else queue.push(def);
      setTimeout(() => idle(next), 700);
    };
    setTimeout(() => idle(next), 2500);
  }

  /** Swaps in another car (physics, model, sound). Only used from the menus, with the car parked. */
  private selectCar(id: CarId): void {
    const def = getCar(id);
    if (def.id === this.carDef.id) return;
    const { s, d } = this.car;
    this.carDef = def;
    this.car = new VehiclePhysics(def.config);
    this.car.gearbox.mode = this.settings.transmission;
    this.car.absEnabled = this.car.tcsEnabled = this.car.escEnabled = this.settings.assists;
    this.car.reset(s, d, 0);
    this.prevS = this.car.s;
    this.prevD = this.car.d;
    this.prevPsi = this.car.psi;
    this.lastShiftCount = this.car.gearbox.shiftCount;

    this.renderer.scene.remove(this.carModel.root);
    this.carModel = this.modelFor(def);
    this.renderer.scene.add(this.carModel.root);
    this.carModel.setPaint(paintFor(this.settings, def.id));
    this.carModel.setHeadlights(this.world.isNight, this.renderer.profile.headlightSpots);
    this.camTarget.body = this.carModel.body;
    this.camTarget.hoodEye = this.carModel.hoodEye;
    this.camTarget.hoodLook = this.carModel.hoodLook;

    this.audio.setEngineSound(def.sound);
    this.soundState.idleRPM = def.config.idleRPM;
    this.soundState.limiterRPM = def.config.limiterRPM;
  }

  // ------------------------------------------------------------------ setup

  private applyAllSettings(): void {
    const s = this.settings;
    this.renderer.applyQuality(s.quality);
    this.cameraRig.camera.aspect = this.renderer.aspect;
    this.world.applySettings(this.renderer.profile, s.timeOfDay);
    this.traffic.setDrawDistance(this.renderer.profile.drawDistance);
    this.carModel.setHeadlights(this.world.isNight, this.renderer.profile.headlightSpots);
    this.carModel.setPaint(paintFor(s, this.carDef.id));
    this.car.gearbox.mode = s.transmission;
    this.car.absEnabled = this.car.tcsEnabled = this.car.escEnabled = s.assists;
    this.audio.setVolume(s.volume);
    this.touch?.setManual(s.transmission === 'manual');
  }

  private onSettingsChanged(s: Settings, key: keyof Settings): void {
    saveSettings(s);
    switch (key) {
      case 'quality':
        this.renderer.applyQuality(s.quality);
        this.cameraRig.camera.aspect = this.renderer.aspect;
        this.world.applySettings(this.renderer.profile, s.timeOfDay);
        this.traffic.setDrawDistance(this.renderer.profile.drawDistance);
        this.carModel.setHeadlights(this.world.isNight, this.renderer.profile.headlightSpots);
        break;
      case 'timeOfDay':
        this.world.applySettings(this.renderer.profile, s.timeOfDay);
        this.carModel.setHeadlights(this.world.isNight, this.renderer.profile.headlightSpots);
        break;
      case 'transmission':
        this.car.gearbox.mode = s.transmission;
        this.touch?.setManual(s.transmission === 'manual');
        break;
      case 'assists':
        this.car.absEnabled = this.car.tcsEnabled = this.car.escEnabled = s.assists;
        break;
      case 'paints':
        this.carModel.setPaint(paintFor(s, this.carDef.id));
        break;
      case 'steering':
        // Changed by a tap, so iOS can show its motion-permission prompt now.
        this.touch?.setTilt(s.steering === 'tilt');
        break;
      case 'car':
        // The garage already swapped the car through carChanged.
        break;
      case 'volume':
        this.audio.setVolume(s.volume);
        break;
      case 'showFps':
        break;
    }
  }

  private installBrowserHooks(): void {
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.cameraRig.camera.aspect = this.renderer.aspect;
      this.hud.resize();
    });
    // Drag to spin the car in the garage (mouse or finger).
    const canvas = this.renderer.renderer.domElement;
    let dragId: number | null = null;
    let dragX = 0;
    const dragTarget = this.container;
    dragTarget.addEventListener('pointerdown', (e) => {
      if (this.state !== 'menu' || this.menus.activeScreen !== 'garage') return;
      if (e.target !== canvas && !(e.target as HTMLElement).classList?.contains('menus')) return;
      dragId = e.pointerId;
      dragX = e.clientX;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return;
      this.cameraRig.drag(dragX - e.clientX);
      dragX = e.clientX;
    });
    const endDrag = (e: PointerEvent): void => {
      if (e.pointerId === dragId) dragId = null;
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    // Browsers only allow audio after a user gesture.
    const unlock = (): void => this.audio.init();
    window.addEventListener('pointerdown', unlock);
    // iOS only unlocks Web Audio from touchend/click, not touchstart.
    window.addEventListener('touchend', unlock);
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
    // Auto-pause when the tab loses focus.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    window.addEventListener('blur', () => {
      if (this.state === 'playing') this.pause();
    });
    // Guard against losing a run to an accidental Ctrl+W / navigation.
    window.addEventListener('beforeunload', (e) => {
      if (this.state === 'playing' || this.state === 'paused') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ------------------------------------------------------------ state changes

  private resetWorld(playerD: number, speedKmh: number): void {
    const seed = (Math.random() * 1e9) | 0;
    // `?start=<meters>` begins the run far down the road (and far from the world origin)
    // to demonstrate the floating origin on very long drives.
    const far = Math.max(0, Number(new URLSearchParams(window.location.search).get('start')) || 0);
    const startS = far + START_S;
    this.world.reset(seed, startS, far, far * 0.7, far * 0.7);
    this.car.reset(startS, playerD, speedKmh / MS_TO_KMH);
    this.car.gearbox.mode = this.settings.transmission;
    this.lastShiftCount = this.car.gearbox.shiftCount;
    this.traffic.seed(seed);
    this.traffic.reset(startS);
    this.prevS = this.car.s;
    this.prevD = this.car.d;
    this.prevPsi = this.car.psi;
    this.loop.reset();
    this.world.poseAt(this.car.s, this.car.d, 0, this.pose);
    this.effects.clear();
    this.effectsOriginX = this.world.originX;
    this.effectsOriginZ = this.world.originZ;
    this.sparkCount = 0;
  }

  /** Title screen: the car is parked on the hard shoulder while traffic streams past. */
  enterMenu(): void {
    this.state = 'menu';
    this.timeScale = 1;
    this.resetWorld(-LANES_HALF_WIDTH - RIGHT_SHOULDER / 2 - 0.2, 0);
    this.hud.show(false);
    this.touch?.show(false);
    this.menus.showStart(this.best);
    this.input.clearPresses();
    this.audio.resume();
  }

  startRun(): void {
    this.audio.init();
    if (this.isTouch) this.enterMobileFullscreen();
    this.resetWorld(laneCenter(2), START_SPEED_KMH);
    this.scoring.reset();
    this.damage = 0;
    this.crashTimer = 0;
    this.timeScale = 1;
    this.scrapeAge = 10;
    this.state = 'playing';
    this.menus.show(null);
    this.hud.show(true);
    this.showTouchControls(true);
    this.input.clearPresses();
    this.cameraRig.reset(this.cameraTarget());
    this.audio.resume();
  }

  private showTouchControls(visible: boolean): void {
    if (!this.touch) return;
    this.touch.show(visible);
    if (visible) {
      this.touch.setManual(this.settings.transmission === 'manual');
      this.touch.setTilt(this.settings.steering === 'tilt');
    }
  }

  /**
   * Phones: go fullscreen and lock to landscape when a run starts (needs the tap that
   * started it). Unsupported browsers (iPhone Safari) just keep the rotate prompt.
   */
  private enterMobileFullscreen(): void {
    const root = document.documentElement;
    const lock = (): void => {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      o?.lock?.('landscape').catch(() => undefined);
    };
    if (!document.fullscreenElement && root.requestFullscreen) {
      root
        .requestFullscreen({ navigationUI: 'hide' })
        .then(lock)
        .catch(() => undefined);
    } else {
      lock();
    }
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.menus.show('pause');
    this.showTouchControls(false);
    this.audio.suspend();
  }

  private resume(): void {
    if (this.state !== 'paused' || this.rotate.isBlocking) return;
    this.state = 'playing';
    this.menus.show(null);
    this.showTouchControls(true);
    this.input.clearPresses();
    this.audio.resume();
  }

  private crash(reason: string, intensity: number): void {
    if (this.state !== 'playing') return;
    this.state = 'crashing';
    this.crashReason = reason;
    this.crashTimer = CRASH_SEQUENCE_SECONDS;
    this.cameraRig.addTrauma(1);
    this.audio.playCrash(intensity);
    this.hud.showBanner('WRECKED!', CRASH_SEQUENCE_SECONDS);
  }

  private gameOver(): void {
    this.state = 'gameover';
    this.timeScale = 1;
    this.showTouchControls(false);
    const score = Math.floor(this.scoring.score);
    const newBest = score > this.best;
    if (newBest) {
      this.best = score;
      saveBestScore(score);
    }
    this.hud.show(false);
    const s = this.scoring;
    this.menus.showGameOver({
      score,
      best: this.best,
      newBest,
      distanceKm: s.distance / 1000,
      time: s.time,
      topSpeed: s.topSpeedKmh,
      averageSpeed: s.averageSpeedKmh,
      nearMisses: s.nearMisses,
      closeCalls: s.closeCalls,
      maxCombo: s.maxCombo,
      highSpeedTime: s.highSpeedTime,
      reason: this.crashReason,
    });
  }

  // --------------------------------------------------------------------- loop

  start(): void {
    this.prebuildModels();
    this.lastTime = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      this.frame(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private handleActions(): void {
    const input = this.input;
    if (input.consume('fullscreen')) this.toggleFullscreen();
    switch (this.state) {
      case 'menu': {
        if (input.consume('garage') && this.menus.activeScreen === 'start') this.menus.open('garage', 'start');
        const screen = this.menus.activeScreen;
        if (screen === 'garage') {
          if (input.consume('left')) this.menus.garageStep(-1);
          if (input.consume('right')) this.menus.garageStep(1);
        }
        if (input.consume('pause')) this.menus.back();
        else if (input.consume('confirm') && (screen === 'start' || screen === 'garage')) this.startRun();
        break;
      }
      case 'playing':
        if (input.consume('pause')) this.pause();
        else if (input.consume('restart')) this.startRun();
        if (input.consume('camera')) this.cameraRig.toggle();
        if (input.consume('shiftUp') && this.car.gearbox.mode === 'manual') this.car.gearbox.shiftUp();
        if (input.consume('shiftDown') && this.car.gearbox.mode === 'manual') this.car.gearbox.shiftDown(this.car.omegaRear, this.car.u);
        break;
      case 'paused':
        if (input.consume('pause')) {
          if (!this.menus.back()) this.resume();
        } else if (input.consume('restart')) this.startRun();
        else if (input.consume('confirm') && this.menus.activeScreen === 'pause') this.resume();
        break;
      case 'crashing':
        if (input.consume('restart')) this.startRun();
        if (input.consume('camera')) this.cameraRig.toggle();
        break;
      case 'gameover':
        if (input.consume('restart') || input.consume('confirm')) this.startRun();
        else if (input.consume('pause')) this.enterMenu();
        break;
    }
    // Presses that don't apply to the current state are dropped.
    input.clearPresses();
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (!this.container.requestFullscreen) return;
    void this.container
      .requestFullscreen()
      .then(() => {
        // In fullscreen, Chrome lets a page capture Ctrl+W etc. so shifting down can't close the tab.
        const nav = navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void> } };
        return nav.keyboard?.lock?.();
      })
      .catch(() => undefined);
  }

  private frame(dt: number): void {
    // Portrait on a phone: the rotate prompt covers everything, so don't spend battery rendering.
    if (this.rotate.isBlocking) {
      this.input.clearPresses();
      return;
    }
    this.fps = lerp(this.fps, dt > 0 ? 1 / dt : 60, 0.05);
    this.input.update(dt, this.car.speed);
    this.handleActions();

    if (this.state === 'crashing') {
      this.crashTimer -= dt;
      // Slow motion for the first moment of the crash, then back to real time.
      const elapsed = CRASH_SEQUENCE_SECONDS - this.crashTimer;
      this.timeScale = lerp(0.3, 1, smoothstep(0.7, 1.6, elapsed));
      if (this.crashTimer <= 0) this.gameOver();
    }

    if (this.state !== 'paused') {
      this.loop.advance(dt, this.timeScale, (step) => this.fixedUpdate(step));
    }
    this.world.update(this.car.s);
    this.render(dt);
  }

  private fixedUpdate(dt: number): void {
    const car = this.car;
    this.prevS = car.s;
    this.prevD = car.d;
    this.prevPsi = car.psi;

    if (this.state === 'menu') {
      // Parked car: keep it still and let traffic flow past.
      this.traffic.fixedUpdate(dt, car);
      this.traffic.events.length = 0;
      return;
    }

    const driving = this.state === 'playing';
    // After a crash the driver stands on the brakes.
    const controls: DriverInput = driving ? this.input.state : { ...NO_INPUT, brake: this.state === 'gameover' ? 1 : 0.6 };
    car.update(dt, controls, this.world.path);

    this.scrapeAge += dt;
    this.simTime += dt;
    vehicleToBody(car, this.body);
    if (collideWithBarriers(this.body, BARRIER_LEFT, BARRIER_RIGHT, 0.25, 0.35, this.impact, this.contact)) {
      bodyToVehicle(this.body, car);
      this.scrapeAge = 0;
      // Grinding along the rail is one long contact: count it as a new impact only every 0.35 s.
      const hit = this.impact.closingSpeed;
      if (car.speed > 4) this.queueSparks(this.contact.py, -this.contact.px, 2 + Math.min(10, hit * 3));
      if (hit > 1.5 && (this.simTime - this.lastBarrierImpact > 0.35 || hit > HARD_HIT_BARRIER)) {
        this.lastBarrierImpact = this.simTime;
        this.onImpact(hit, HARD_HIT_BARRIER, 'Hit the barrier');
      }
    }

    this.traffic.fixedUpdate(dt, car);
    for (const e of this.traffic.events) {
      if (e.kind === 'collision') {
        this.scrapeAge = 0;
        this.queueSparks((car.s + e.car.s) / 2, (car.d + e.car.d) / 2, 6 + Math.min(30, e.closingSpeed * 3));
        this.onImpact(e.closingSpeed, HARD_HIT_TRAFFIC, `Hit a ${describe(e.car)}`);
      } else if (e.kind === 'nearMiss' && driving) {
        this.onNearMiss(e.car, e.gap);
      }
    }
    this.traffic.events.length = 0;

    if (driving) this.scoring.update(dt, car.s - this.prevS, car.speed * MS_TO_KMH);
    const shifts = car.gearbox.shiftCount;
    if (shifts !== this.lastShiftCount) {
      this.lastShiftCount = shifts;
      if (driving && car.gearbox.gear > 0) this.audio.playShift(car.gearbox.lastShiftDirection > 0);
    }
  }

  private queueSparks(s: number, d: number, count: number): void {
    this.sparkS = s;
    this.sparkD = d;
    this.sparkCount = Math.min(40, this.sparkCount + count);
  }

  private onImpact(closingSpeed: number, hardThreshold: number, what: string): void {
    if (this.state !== 'playing') return;
    const kmh = closingSpeed * MS_TO_KMH;
    this.cameraRig.addTrauma(clamp(closingSpeed * 0.05, 0.1, 0.8));
    this.damage = Math.min(100, this.damage + closingSpeed * closingSpeed * 0.35);
    this.scoring.collision();
    this.hud.flashDamage();
    if (closingSpeed > hardThreshold) {
      this.crash(`${what} at ${Math.round(kmh)} km/h`, 1);
    } else if (this.damage >= 100) {
      this.crash('Too much damage — the car gave up', 0.8);
    } else {
      this.audio.playImpact(clamp01(closingSpeed / hardThreshold));
      if (closingSpeed > 3) this.hud.popup('IMPACT', 0, 'bad');
    }
  }

  private onNearMiss(car: TrafficCar, gap: number): void {
    const r = this.scoring.nearMiss(gap);
    this.hud.popup(r.close ? 'CLOSE CALL!' : r.combo > 1 ? `NEAR MISS ×${r.combo}` : 'NEAR MISS', r.points, r.close ? 'close' : 'near');
    // Cars on the left (higher d) are heard on the left.
    const pan = car.d > this.car.d ? -0.8 : 0.8;
    this.audio.playWhoosh(pan, r.close ? 1 : 0.7);
    if (Math.random() < (r.close ? 0.6 : 0.25)) this.audio.playHorn(6, pan, car.type.isTruck);
  }

  // ------------------------------------------------------------------- render

  private cameraTarget(): CameraTarget {
    const t = this.camTarget;
    t.yaw = this.pose.yaw;
    t.speed = this.car.speed;
    t.accel = this.car.ax;
    t.lateralAccel = this.car.ay;
    return t;
  }

  private render(dt: number): void {
    const car = this.car;
    const a = this.loop.alpha;
    const s = lerp(this.prevS, car.s, a);
    const d = lerp(this.prevD, car.d, a);
    const psi = lerp(this.prevPsi, car.psi, a);
    this.world.poseAt(s, d, psi, this.pose);
    const root = this.carModel.root;
    root.position.copy(this.pose.position);
    root.rotation.order = 'YXZ';
    root.rotation.set(this.pose.pitch * Math.cos(psi), this.pose.yaw, this.pose.pitch * Math.sin(psi));
    for (let i = 0; i < 4; i++) {
      this.spins[i] = car.wheels[i].spin;
      this.compressions[i] = car.wheels[i].compression;
    }
    this.carModel.updateDynamics(car.pitch, car.roll, car.heave, car.steerAngle, this.spins, this.compressions);
    this.carModel.setLights(car.appliedBrake, car.gearbox.gear === REVERSE);

    const camera = this.cameraRig.camera;
    this.updateFraming();
    const garage = this.state === 'menu' && this.menus.activeScreen === 'garage';
    if (this.state === 'menu' || this.orbitOnly) this.cameraRig.updateOrbit(dt, this.pose.position, this.pose.yaw, garage);
    else this.cameraRig.update(this.state === 'paused' ? 0 : dt, this.cameraTarget());
    this.traffic.render(a, this.world, camera, this.world.isNight);
    this.updateEffects(this.state === 'paused' ? 0 : dt * this.timeScale);
    this.world.environment.update(dt, camera, this.pose.position, this.pose.position.y);
    this.renderer.render(camera);

    this.updateAudio(dt);
    if (this.state === 'playing' || this.state === 'paused' || this.state === 'crashing') this.updateHud(dt);

    this.framesRendered++;
    if (this.framesRendered === 3) document.getElementById('loading')?.classList.add('hidden');
  }

  /** In the menus the car is framed beside the menu panel (on wide screens). */
  private updateFraming(): void {
    const wide = window.innerWidth > window.innerHeight * 1.15 && window.innerWidth >= 640;
    let target = 0;
    if (this.state === 'menu' && wide) target = this.menus.activeScreen === 'garage' ? 0.2 : this.menus.activeScreen === 'start' ? 0.12 : 0;
    if (target !== this.framing) {
      this.framing = target;
      this.cameraRig.setFraming(target);
    }
  }

  /** Tire smoke, skid marks and sparks for the player's car. */
  private updateEffects(dt: number): void {
    const fx = this.effects;
    if (this.world.originX !== this.effectsOriginX || this.world.originZ !== this.effectsOriginZ) {
      fx.shiftOrigin(this.world.originX - this.effectsOriginX, this.world.originZ - this.effectsOriginZ);
      this.effectsOriginX = this.world.originX;
      this.effectsOriginZ = this.world.originZ;
    }
    fx.setViewport(this.renderer.renderer.domElement.height, this.cameraRig.camera.fov);
    if (dt <= 0) return;
    const car = this.car;
    const root = this.carModel.root;
    root.updateMatrixWorld();
    // World-space velocity of the car for particle inheritance.
    // Body frame (forward u, left v) → car local (+Z forward, +X left) → world by heading.
    this.tmpVel.set(car.v, 0, car.u).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.pose.yaw);
    const active = this.state !== 'menu';
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const sliding = active && car.speed > 2.5 && w.fz > 300 && w.slip > 1.35;
      if (!sliding) {
        fx.skidMark(i, null);
        continue;
      }
      // Wheel contact patch: body x (forward) → local +Z, body y (left) → local +X.
      this.tmpWheel.set(w.y, 0, w.x);
      root.localToWorld(this.tmpWheel);
      fx.skidMark(i, this.tmpWheel);
      const intensity = Math.min(1, (w.slip - 1.2) / 3);
      if (Math.random() < dt * (10 + intensity * 40)) fx.tireSmoke(this.tmpWheel, this.tmpVel, intensity, this.world.isNight);
    }
    if (this.sparkCount > 0) {
      this.world.toRender(this.sparkS, this.sparkD, this.tmpSpark, 0.45);
      fx.sparkBurst(this.tmpSpark, this.tmpVel, Math.round(this.sparkCount));
      this.sparkCount = 0;
    }
    fx.update(dt);
  }

  private updateAudio(dt: number): void {
    if (!this.audio.ready || this.state === 'paused') return;
    const car = this.car;
    const st = this.soundState;
    st.rpm = car.rpm;
    // Parked or wrecked: the engine just idles.
    st.load = this.state === 'playing' ? car.engineLoad : 0;
    st.throttle = car.appliedThrottle;
    st.limiterCutting = car.limiter.cutting;
    st.speed = car.speed;
    st.slip = car.speed > 2 ? car.maxSlip : 0;
    // Right wheels over the rumble strip next to the right edge line.
    const rightWheel = car.d - car.cfg.trackRear / 2;
    st.onRumbleStrip = rightWheel < -LANES_HALF_WIDTH - 0.12 && rightWheel > -LANES_HALF_WIDTH - 0.6;
    st.scrapeAge = this.scrapeAge;
    const n = this.traffic.collectSoundSources(this.world, this.loop.alpha, car.s, this.sources);
    this.audio.update(dt, st, this.cameraRig.camera, this.sources.slice(0, n));
  }

  private updateHud(dt: number): void {
    const car = this.car;
    const cfg = car.cfg;
    const sc = this.scoring;
    this.hud.update(dt, {
      speedKmh: car.speed * MS_TO_KMH,
      rpm: car.rpm,
      redlineRPM: cfg.redlineRPM,
      limiterRPM: cfg.limiterRPM,
      maxRPM: Math.ceil((cfg.limiterRPM + 300) / 1000) * 1000,
      maxSpeedKmh: this.carDef.specs.topSpeedKmh > 290 ? 360 : 320,
      gear: car.gearbox.gearLabel(),
      shifting: car.gearbox.isShifting(),
      manual: car.gearbox.mode === 'manual',
      score: sc.score,
      best: this.best,
      distanceKm: sc.distance / 1000,
      time: sc.time,
      multiplier: sc.multiplier,
      combo: sc.combo,
      comboFraction: sc.comboTimer / COMBO_WINDOW,
      damage: this.damage,
      abs: car.absActive,
      tcs: car.tcsActive,
      esc: car.escActive,
      limiter: car.limiter.cutting,
      cameraMode: this.cameraRig.mode,
      fps: this.settings.showFps ? this.fps : null,
    });
  }
}

function describe(car: TrafficCar): string {
  switch (car.type.kind) {
    case 'semi':
      return 'semi truck';
    case 'boxTruck':
      return 'box truck';
    case 'van':
      return 'van';
    case 'suv':
      return 'SUV';
    case 'hatch':
      return 'hatchback';
    default:
      return 'car';
  }
}
