// Keyboard and mouse. Keyboard and mouse only — no pad, by decision.
//
// Everything the game reads comes out of `state`, so the same fields can be fed
// by a replay or by the network without the movement code knowing the difference.

export const ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  tuck: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  grab: ['KeyE'],
  interact: ['KeyF'],
  camera: ['KeyC'],
  emote: ['KeyG'],
  map: ['KeyM'],
  scoreboard: ['Tab'],
};

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, left: false, right: false };
    this.pointerLocked = false;
    this.enabled = true;
    this.state = {
      steer: 0, // -1 left .. +1 right
      throttle: 0, // W
      brake: 0, // S
      tuck: false,
      jump: false,
      jumpHeld: false,
      grab: false,
      lookX: 0,
      lookY: 0,
      zoom: 0,
    };

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.repeat) return;
      // Never swallow the browser's own escapes and reloads.
      if (e.code === 'F5' || (e.metaKey || e.ctrlKey)) return;
      this.keys.add(e.code);
      this.pressedThisFrame.add(e.code);
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    };
    this._onWheel = (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    };
    this._onDown = (e) => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    };
    this._onUp = (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    };
    this._onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      this.onPointerLockChange?.(this.pointerLocked);
    };
    this._onContext = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    this.dom.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('mousedown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.dom.addEventListener('contextmenu', this._onContext);
  }

  requestPointerLock() {
    this.dom.requestPointerLock?.();
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(action) {
    return ACTIONS[action].some((code) => this.keys.has(code));
  }

  pressed(action) {
    return ACTIONS[action].some((code) => this.pressedThisFrame.has(code));
  }

  /** Call once per frame, before anything reads `state`. */
  sample(sensitivity = 1) {
    const s = this.state;
    const left = this.down('left') ? 1 : 0;
    const right = this.down('right') ? 1 : 0;
    s.steer = right - left;
    s.throttle = this.down('forward') ? 1 : 0;
    s.brake = this.down('back') ? 1 : 0;
    s.tuck = this.down('tuck');
    s.jump = this.pressed('jump');
    s.jumpHeld = this.down('jump');
    s.grab = this.down('grab');
    s.lookX = this.mouse.dx * 0.0022 * sensitivity;
    s.lookY = this.mouse.dy * 0.0022 * sensitivity;
    s.zoom = this.mouse.wheel;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    return s;
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.dom.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mouseup', this._onUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.dom.removeEventListener('contextmenu', this._onContext);
  }
}
