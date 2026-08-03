import * as THREE from 'three';
import { Avatar } from '../player/avatar.js';
import { MODE } from '../player/skier.js';

// Playing together.
//
// Firebase does two things and no more: it lists the open rooms and it carries
// the handshake. Once two browsers have shaken hands, everything — positions,
// snow, emotes — goes straight between them over WebRTC.
//
// The snow has one owner. The host holds the field, sends a compressed snapshot
// to anyone who joins, and streams only the cells that changed after that. When
// the host leaves, the next player in the room picks it up with the copy they
// already have, so a dropped connection costs a second, not the session.

const RATE = 1 / 20; // 20 state updates a second, which is plenty for skiing
const MSG = { STATE: 1, IDENTITY: 2, SNOW_PATCH: 3, SNOW_SNAPSHOT: 4, EMOTE: 5, HOST: 6 };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[(Math.random() * alphabet.length) | 0];
  return `SNOW-${s}`;
}

export class Session {
  constructor(game) {
    this.game = game;
    this.peers = new Map(); // id -> { conn, channel, avatar, state }
    this.others = [];
    this.id = Math.random().toString(36).slice(2, 10);
    this.room = null;
    this.isHost = true; // solo means you are the host of a room of one
    this.accum = 0;
    this.status = 'Solo';
    this.config = null;
    this.rooms = [];
    this.error = null;
    this.remoteRoot = new THREE.Group();
    this.remoteRoot.name = 'others';
    game.engine.scene.add(this.remoteRoot);
    this.loadConfig();
  }

  async loadConfig() {
    try {
      const res = await fetch('assets/firebase.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      this.config = await res.json();
      await this.connectFirebase();
    } catch (err) {
      // Solo still has to be a complete game — this is not an error state.
      this.status = 'Solo — no room service configured';
      this.error = 'Drop a Firebase config into assets/firebase.json to open rooms.';
    }
  }

  async connectFirebase() {
    const [{ initializeApp }, dbmod, authmod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    ]);
    this.fb = { ...dbmod, ...authmod };
    const app = initializeApp(this.config);
    this.db = dbmod.getDatabase(app);
    const auth = authmod.getAuth(app);
    await authmod.signInAnonymously(auth);
    this.uid = auth.currentUser.uid;
    this.status = 'Connected';
    this.watchRooms();
  }

  watchRooms() {
    const { ref, onValue, query, limitToLast } = this.fb;
    onValue(query(ref(this.db, 'rooms'), limitToLast(30)), (snap) => {
      const val = snap.val() || {};
      this.rooms = Object.entries(val)
        .map(([code, r]) => ({ code, ...r }))
        .filter((r) => r.public && Date.now() - (r.beat || 0) < 45000)
        .sort((a, b) => (b.beat || 0) - (a.beat || 0));
      this.onRoomsChanged?.();
    });
  }

  // ---------------------------------------------------------------- rooms

  async createRoom({ isPublic = true } = {}) {
    if (!this.db) return null;
    const { ref, set, onDisconnect, onChildAdded, remove } = this.fb;
    const code = randomCode();
    this.room = code;
    this.isHost = true;
    await set(ref(this.db, `rooms/${code}`), {
      public: isPublic,
      host: this.id,
      name: this.game.state.name,
      players: 1,
      beat: Date.now(),
      created: Date.now(),
    });
    onDisconnect(ref(this.db, `rooms/${code}`)).remove();
    this.status = `Hosting ${code}`;

    // Answer anyone who knocks.
    onChildAdded(ref(this.db, `rooms/${code}/offers`), async (snap) => {
      const from = snap.key;
      if (from === this.id) return;
      const offer = snap.val();
      const conn = this.makeConnection(from);
      conn.ondatachannel = (e) => this.attachChannel(from, e.channel);
      await conn.setRemoteDescription(offer.sdp);
      const answer = await conn.createAnswer();
      await conn.setLocalDescription(answer);
      await set(ref(this.db, `rooms/${code}/answers/${from}`), { sdp: JSON.parse(JSON.stringify(answer)) });
      this.collectIce(conn, code, from, 'hostIce');
      this.watchIce(conn, code, from, 'guestIce');
      remove(snap.ref);
    });
    this.startHeartbeat();
    this.onRoomsChanged?.();
    return code;
  }

  async joinRoom(code) {
    if (!this.db) return false;
    const { ref, set, get, onValue } = this.fb;
    const roomSnap = await get(ref(this.db, `rooms/${code}`));
    if (!roomSnap.exists()) {
      this.error = `No room called ${code}.`;
      this.onRoomsChanged?.();
      return false;
    }
    this.room = code;
    this.isHost = false;
    const hostId = roomSnap.val().host;
    const conn = this.makeConnection(hostId);
    const channel = conn.createDataChannel('ski', { ordered: false, maxRetransmits: 1 });
    this.attachChannel(hostId, channel);
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    await set(ref(this.db, `rooms/${code}/offers/${this.id}`), { sdp: JSON.parse(JSON.stringify(offer)) });
    this.collectIce(conn, code, this.id, 'guestIce');
    onValue(ref(this.db, `rooms/${code}/answers/${this.id}`), async (snap) => {
      const v = snap.val();
      if (!v || conn.currentRemoteDescription) return;
      await conn.setRemoteDescription(v.sdp);
    });
    this.watchIce(conn, code, this.id, 'hostIce');
    this.status = `Joining ${code}`;
    return true;
  }

  makeConnection(peerId) {
    const conn = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }],
    });
    conn.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(conn.connectionState)) this.dropPeer(peerId);
      if (conn.connectionState === 'connected') this.status = `In ${this.room}`;
    };
    this.peers.set(peerId, { conn, channel: null, avatar: null, state: null, name: 'Skier', colour: '#fff' });
    return conn;
  }

  collectIce(conn, code, who, branch) {
    const { ref, push, set } = this.fb;
    conn.onicecandidate = (e) => {
      if (!e.candidate) return;
      set(push(ref(this.db, `rooms/${code}/${branch}/${who}`)), JSON.parse(JSON.stringify(e.candidate)));
    };
  }

  watchIce(conn, code, who, branch) {
    const { ref, onChildAdded } = this.fb;
    onChildAdded(ref(this.db, `rooms/${code}/${branch}/${who}`), (snap) => {
      const c = snap.val();
      if (c) conn.addIceCandidate(c).catch(() => {});
    });
  }

  attachChannel(peerId, channel) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      this.broadcastIdentity();
      if (this.isHost) this.sendSnapshot(peer);
    };
    channel.onclose = () => this.dropPeer(peerId);
    channel.onmessage = (e) => this.receive(peerId, e.data);
  }

  dropPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (peer.avatar) this.remoteRoot.remove(peer.avatar.root);
    try { peer.conn.close(); } catch { /* already gone */ }
    this.peers.delete(peerId);
    this.refreshOthers();
    // Host migration: whoever has the lowest id takes the snow.
    if (!this.isHost && ![...this.peers.keys()].length) {
      this.isHost = true;
      this.status = `Hosting ${this.room || 'solo'}`;
      this.game.hud?.flash('The host left. You are holding the snow now.');
    }
  }

  startHeartbeat() {
    if (this._beat) clearInterval(this._beat);
    this._beat = setInterval(() => {
      if (!this.db || !this.room || !this.isHost) return;
      const { ref, update } = this.fb;
      update(ref(this.db, `rooms/${this.room}`), {
        beat: Date.now(),
        players: this.peers.size + 1,
      });
    }, 12000);
  }

  // ---------------------------------------------------------------- messages

  send(peer, bytes) {
    const ch = peer.channel;
    if (!ch || ch.readyState !== 'open') return;
    try { ch.send(bytes); } catch { /* buffer full; the next tick will do */ }
  }

  broadcast(bytes) {
    for (const peer of this.peers.values()) this.send(peer, bytes);
  }

  broadcastIdentity() {
    const g = this.game;
    const payload = JSON.stringify({
      t: MSG.IDENTITY,
      name: g.state.name,
      colours: g.state.colours,
      kind: g.state.set ? (g.avatar.kind) : 'ski',
    });
    this.broadcast(payload);
  }

  sendSnapshot(peer) {
    const snap = this.game.snow.snapshot();
    const head = new Uint8Array(1);
    head[0] = MSG.SNOW_SNAPSHOT;
    const out = new Uint8Array(1 + snap.length);
    out.set(head, 0);
    out.set(snap, 1);
    this.send(peer, out.buffer);
  }

  receive(peerId, data) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      if (msg.t === MSG.IDENTITY) {
        peer.name = msg.name;
        peer.colour = msg.colours?.jacket || '#fff';
        peer.colours = msg.colours;
        peer.kind = msg.kind;
        if (peer.avatar) {
          peer.avatar.setColours(msg.colours);
          peer.avatar.setKind(msg.kind || 'ski');
        }
        this.refreshOthers();
      } else if (msg.t === MSG.EMOTE) {
        peer.emote = { name: msg.name, until: performance.now() + 2000 };
      } else if (msg.t === MSG.STATE) {
        peer.state = msg.s;
        peer.points = msg.p;
      }
      return;
    }
    const bytes = new Uint8Array(data);
    if (bytes[0] === MSG.SNOW_SNAPSHOT) {
      this.game.snow.applySnapshot(bytes.subarray(1));
      this.game.hud?.flash('Snow synced with the host.');
    } else if (bytes[0] === MSG.SNOW_PATCH) {
      this.game.snow.applyPatch(bytes.subarray(1));
    }
  }

  // ---------------------------------------------------------------- loop

  update(dt) {
    this.accum += dt;
    if (this.accum < RATE) {
      this.animateOthers(dt);
      return;
    }
    this.accum = 0;

    if (this.peers.size) {
      const s = this.game.skier;
      this.broadcast(JSON.stringify({
        t: MSG.STATE,
        p: Math.round(this.game.state.points),
        s: {
          x: +s.pos.x.toFixed(2), y: +s.pos.y.toFixed(2), z: +s.pos.z.toFixed(2),
          h: +s.heading.toFixed(3), r: +s.roll.toFixed(3), i: +s.pitch.toFixed(3),
          m: s.mode, v: +s.telemetry.speed.toFixed(1), k: +(s.telemetry.skid || 0).toFixed(2),
        },
      }));

      // The host is the only writer of snow, so only the host ships patches.
      if (this.isHost) {
        const patch = this.game.snow.takePatch();
        if (patch && patch.length < 60000) {
          const out = new Uint8Array(1 + patch.length);
          out[0] = MSG.SNOW_PATCH;
          out.set(patch, 1);
          this.broadcast(out.buffer);
        }
      }
    } else if (!this.isHost) {
      this.isHost = true;
    }

    this.animateOthers(dt);
  }

  animateOthers(dt) {
    for (const [, peer] of this.peers) {
      if (!peer.state) continue;
      if (!peer.avatar) {
        peer.avatar = new Avatar(this.game.assets, {
          colours: peer.colours, kind: peer.kind || 'ski',
        });
        peer.avatar.root.add(makeNameTag(peer.name || 'Skier'));
        this.remoteRoot.add(peer.avatar.root);
      }
      // A stand-in skier the remote avatar can be posed from, so the same posing
      // code drives everyone on the mountain.
      peer.proxy ||= {
        pos: new THREE.Vector3(), heading: 0, roll: 0, pitch: 0, mode: MODE.RIDE,
        edge: 0, air: { grab: 0 }, telemetry: { speed: 0, skid: 0, airborne: false },
        _tuck: false,
      };
      const p = peer.proxy;
      const s = peer.state;
      // Smooth towards the last packet rather than snapping to it.
      p.pos.lerp(new THREE.Vector3(s.x, s.y, s.z), Math.min(1, dt * 12));
      p.heading += shortestAngle(p.heading, s.h) * Math.min(1, dt * 12);
      p.roll += (s.r - p.roll) * Math.min(1, dt * 10);
      p.pitch += (s.i - p.pitch) * Math.min(1, dt * 10);
      p.mode = s.m;
      p.edge = THREE.MathUtils.clamp(-s.r * 1.6, -1, 1);
      p.telemetry.speed = s.v;
      p.telemetry.skid = s.k;
      p.telemetry.airborne = s.m === MODE.AIR;
      peer.avatar.update(dt, p);
    }
  }

  refreshOthers() {
    this.others = [...this.peers.values()]
      .filter((p) => p.state)
      .map((p) => ({
        name: p.name, colour: p.colour, points: p.points || 0,
        x: p.state.x, y: p.state.y, z: p.state.z,
      }));
  }

  emote(name) {
    this.broadcast(JSON.stringify({ t: MSG.EMOTE, name }));
  }

  // ---------------------------------------------------------------- panel

  buildPanel() {
    const wrap = el('div', 'net');
    const status = el('p', 'net__status', this.status);
    wrap.appendChild(status);

    if (!this.db) {
      wrap.appendChild(el('p', 'net__hint',
        this.error || 'Rooms need a Firebase config in assets/firebase.json. Everything else works alone.'));
      return wrap;
    }

    const actions = el('div', 'net__actions');
    const mkPublic = el('button', 'btn', 'Open a public room');
    mkPublic.addEventListener('click', async () => {
      const code = await this.createRoom({ isPublic: true });
      status.textContent = `Hosting ${code} — anyone can drop in`;
    });
    const mkPrivate = el('button', 'btn', 'Open a private room');
    mkPrivate.addEventListener('click', async () => {
      const code = await this.createRoom({ isPublic: false });
      status.textContent = `Hosting ${code} — share the code`;
    });
    actions.append(mkPublic, mkPrivate);
    wrap.appendChild(actions);

    const joinRow = el('div', 'net__join');
    const input = el('input', 'field__input');
    input.placeholder = 'SNOW-XXXX';
    input.maxLength = 9;
    const joinBtn = el('button', 'btn', 'Join by code');
    joinBtn.addEventListener('click', async () => {
      const ok = await this.joinRoom(input.value.trim().toUpperCase());
      status.textContent = ok ? `Joining ${input.value.toUpperCase()}` : this.error;
    });
    joinRow.append(input, joinBtn);
    wrap.appendChild(joinRow);

    const list = el('ul', 'net__rooms');
    const paint = () => {
      list.textContent = '';
      if (!this.rooms.length) {
        list.appendChild(el('li', 'net__empty', 'No public rooms open right now.'));
        return;
      }
      for (const r of this.rooms) {
        const li = el('li', 'net__room');
        li.append(
          el('span', 'net__code t-num', r.code),
          el('span', 'net__host', r.name || 'Someone'),
          el('span', 'net__count t-num', `${r.players || 1}/5`),
        );
        const b = el('button', 'btn btn--small', 'Join');
        b.disabled = (r.players || 1) >= 5;
        b.addEventListener('click', () => this.joinRoom(r.code));
        li.appendChild(b);
        list.appendChild(li);
      }
    };
    this.onRoomsChanged = paint;
    paint();
    wrap.appendChild(list);
    return wrap;
  }
}

function shortestAngle(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function makeNameTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 40px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(12,18,25,0.66)';
  const w = ctx.measureText(name).width + 34;
  ctx.fillRect((320 - w) / 2, 12, w, 48);
  ctx.fillStyle = '#f2f5f8';
  ctx.fillText(name.toUpperCase(), 160, 37);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: true, depthWrite: false,
  }));
  sprite.scale.set(2.4, 0.54, 1);
  sprite.position.y = 2.25;
  // Names fade out with distance so a crowded slope stays readable.
  sprite.onBeforeRender = (renderer, scene, camera) => {
    const d = camera.position.distanceTo(sprite.getWorldPosition(new THREE.Vector3()));
    sprite.material.opacity = THREE.MathUtils.clamp(1 - (d - 26) / 34, 0, 1);
    sprite.visible = sprite.material.opacity > 0.02;
  };
  return sprite;
}
