import * as THREE from 'three';
import { Avatar } from '../player/avatar.js';
import { MODE } from '../player/skier.js';

// Playing together.
//
// Firebase does two things and no more: it lists the open rooms and it carries
// the handshake. Once two browsers have shaken hands, everything — positions,
// snow, emotes — goes straight between them over WebRTC.
//
// The topology is a star, not a mesh: every guest holds exactly one connection,
// to the host, and the host repeats what it hears to everyone else. Five people
// is four connections instead of ten, and it means the snow only ever has one
// owner.
//
// The snow has one owner. The host holds the field, sends a compressed snapshot
// to anyone who joins, and streams the cells that changed after that. Guests
// carve too, so they ship their own rectangles up to the host, which applies
// them and passes them on — otherwise only the host's tracks would exist.
//
// Two channels per connection, because the two kinds of traffic want opposite
// things. Position updates are unreliable and unordered: a lost one is replaced
// 50 ms later and re-sending it would only make the skier stutter. Snow and
// identity go over a reliable ordered channel, chunked, because a snapshot is
// 50–170 kB and a half-arrived snapshot is worse than none.

const RATE = 1 / 20; // 20 state updates a second, which is plenty for skiing
const CHUNK = 16 * 1024; // SCTP-safe payload; big messages are split into these
const MAX_PATCH = 512 * 1024; // a rectangle bigger than this is a bug, not a carve

const MSG = {
  STATE: 1,
  IDENTITY: 2,
  SNOW_PATCH: 3,
  SNOW_SNAPSHOT: 4,
  EMOTE: 5,
  LEAVE: 7,
};

// Root of everything this game writes. The Realtime Database is shared with the
// other Gzowo games and `rooms/` at the top level already belongs to the Gzowo's
// Games dashboard, so every path here starts inside our own branch.
const ROOT = 'skiTogether/rooms';

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

/** Wait until a data channel has drained enough to take more without ballooning. */
function drain(ch) {
  return new Promise((resolve) => {
    ch.bufferedAmountLowThreshold = 256 * 1024;
    const done = () => { ch.removeEventListener('bufferedamountlow', done); resolve(); };
    ch.addEventListener('bufferedamountlow', done);
    setTimeout(done, 2000); // never hang on a channel that stopped reporting
  });
}

export class Session {
  constructor(game) {
    this.game = game;
    // A direct WebRTC connection. Guests hold one (the host); the host holds one
    // per guest.
    this.peers = new Map(); // peerId -> { conn, live, bulk, ... }
    // Everyone else on the mountain, whether we talk to them directly or hear
    // about them through the host.
    this.remotes = new Map(); // playerId -> { name, colours, state, avatar, ... }
    this.others = [];
    this.id = Math.random().toString(36).slice(2, 10);
    this.room = null;
    this.isHost = true; // solo means you are the host of a room of one
    this.accum = 0;
    this.status = 'Solo';
    this.config = null;
    this.rooms = [];
    this.error = null;
    this.synced = true; // a guest is not allowed to push snow before it has the host's
    this.watchers = []; // Firebase listener teardowns, so leaving a room is clean
    this.remoteRoot = new THREE.Group();
    this.remoteRoot.name = 'others';
    game.engine.scene.add(this.remoteRoot);
    this.loadConfig();
  }

  async loadConfig() {
    try {
      // Resolved against this module, not the page, so the test harness in
      // tests/ finds the same config the game does.
      const url = new URL('../../assets/firebase.json', import.meta.url);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}`);
      this.config = await res.json();
      await this.connectFirebase();
    } catch (err) {
      // Solo still has to be a complete game — this is not an error state.
      console.warn('[net] rooms unavailable:', err);
      this.status = 'Solo — no room service configured';
      this.error = 'Drop a Firebase config into assets/firebase.json to open rooms.';
      this.onRoomsChanged?.();
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
    this.status = 'Connected — no room yet';
    this.watchRooms();
    this.onRoomsChanged?.();
  }

  watchRooms() {
    const { ref, onValue, query, limitToLast } = this.fb;
    onValue(query(ref(this.db, ROOT), limitToLast(30)), (snap) => {
      const val = snap.val() || {};
      this.rooms = Object.entries(val)
        .map(([code, r]) => ({ code, ...r }))
        .filter((r) => r.public && Date.now() - (r.beat || 0) < 45000)
        .sort((a, b) => (b.beat || 0) - (a.beat || 0));
      this.onRoomsChanged?.();
    }, (err) => {
      // A rules failure here is silent otherwise, and the room list just stays
      // empty forever while everything looks fine.
      console.warn('[net] room list refused:', err);
      this.error = 'The room list was refused by the database rules.';
      this.onRoomsChanged?.();
    });
  }

  // ---------------------------------------------------------------- rooms

  async createRoom({ isPublic = true } = {}) {
    if (!this.db) return null;
    await this.leaveRoom();
    const { ref, set, onDisconnect, onChildAdded, remove } = this.fb;
    const code = randomCode();
    this.room = code;
    this.isHost = true;
    this.synced = true;
    await set(ref(this.db, `${ROOT}/${code}`), {
      public: isPublic,
      host: this.id,
      name: this.game.state.name,
      players: 1,
      beat: Date.now(),
      created: Date.now(),
    });
    onDisconnect(ref(this.db, `${ROOT}/${code}`)).remove();
    this.status = `Hosting ${code}`;

    // Answer anyone who knocks.
    const offers = ref(this.db, `${ROOT}/${code}/offers`);
    this.watchers.push(onChildAdded(offers, async (snap) => {
      const from = snap.key;
      if (from === this.id || this.peers.has(from)) return;
      const offer = snap.val();
      try {
        const conn = this.makeConnection(from);
        conn.ondatachannel = (e) => this.attachChannel(from, e.channel);
        // The handler has to exist before the description is set, or the
        // candidates gathered during the round trip below are simply lost and
        // the connection never leaves "checking".
        this.collectIce(conn, code, from, 'hostIce');
        this.watchIce(conn, code, from, 'guestIce');
        await conn.setRemoteDescription(offer.sdp);
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        await set(ref(this.db, `${ROOT}/${code}/answers/${from}`), {
          sdp: JSON.parse(JSON.stringify(answer)),
        });
        remove(snap.ref);
      } catch (err) {
        console.warn('[net] failed to answer', from, err);
        this.dropPeer(from);
      }
    }));
    this.startHeartbeat();
    this.onRoomsChanged?.();
    return code;
  }

  async joinRoom(code) {
    if (!this.db) return false;
    await this.leaveRoom();
    const { ref, set, get, onValue, onDisconnect } = this.fb;
    const roomSnap = await get(ref(this.db, `${ROOT}/${code}`));
    if (!roomSnap.exists()) {
      this.error = `No room called ${code}.`;
      this.onRoomsChanged?.();
      return false;
    }
    this.room = code;
    this.isHost = false;
    this.synced = false; // wait for the host's snow before pushing any of ours
    const hostId = roomSnap.val().host;
    const conn = this.makeConnection(hostId);
    // Unreliable for movement, reliable for everything that must arrive whole.
    const live = conn.createDataChannel('ski', { ordered: false, maxRetransmits: 0 });
    const bulk = conn.createDataChannel('snow', { ordered: true });
    this.attachChannel(hostId, live);
    this.attachChannel(hostId, bulk);

    this.collectIce(conn, code, this.id, 'guestIce');
    this.watchIce(conn, code, this.id, 'hostIce');
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    await set(ref(this.db, `${ROOT}/${code}/offers/${this.id}`), {
      sdp: JSON.parse(JSON.stringify(offer)),
    });
    // Our half of the handshake should not outlive us in the database.
    onDisconnect(ref(this.db, `${ROOT}/${code}/offers/${this.id}`)).remove();
    onDisconnect(ref(this.db, `${ROOT}/${code}/answers/${this.id}`)).remove();
    onDisconnect(ref(this.db, `${ROOT}/${code}/guestIce/${this.id}`)).remove();

    this.watchers.push(onValue(ref(this.db, `${ROOT}/${code}/answers/${this.id}`), async (snap) => {
      const v = snap.val();
      if (!v || conn.currentRemoteDescription) return;
      try {
        await conn.setRemoteDescription(v.sdp);
      } catch (err) {
        console.warn('[net] bad answer', err);
      }
    }));
    this.status = `Joining ${code}`;
    this.onRoomsChanged?.();
    return true;
  }

  /** Tear a room down without touching the game: solo is a valid state. */
  async leaveRoom() {
    for (const off of this.watchers) { try { off(); } catch { /* already gone */ } }
    this.watchers = [];
    if (this._beat) { clearInterval(this._beat); this._beat = null; }
    for (const peerId of [...this.peers.keys()]) this.dropPeer(peerId, { quiet: true });
    for (const id of [...this.remotes.keys()]) this.dropRemote(id);
    if (this.db && this.room) {
      const { ref, remove } = this.fb;
      const code = this.room;
      const path = this.isHost ? `${ROOT}/${code}` : `${ROOT}/${code}/offers/${this.id}`;
      try { await remove(ref(this.db, path)); } catch { /* someone else cleaned up */ }
    }
    this.room = null;
    this.isHost = true;
    this.synced = true;
    this.status = this.db ? 'Connected — no room yet' : this.status;
    this.onRoomsChanged?.();
  }

  makeConnection(peerId) {
    const conn = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }],
    });
    conn.onconnectionstatechange = () => {
      const s = conn.connectionState;
      if (s === 'failed' || s === 'closed') this.dropPeer(peerId);
      if (s === 'connected') {
        this.status = `In ${this.room}`;
        this.onRoomsChanged?.();
      }
    };
    this.peers.set(peerId, {
      conn, live: null, bulk: null, seq: 0, parts: new Map(),
    });
    return conn;
  }

  collectIce(conn, code, who, branch) {
    const { ref, push, set } = this.fb;
    conn.onicecandidate = (e) => {
      if (!e.candidate) return;
      set(push(ref(this.db, `${ROOT}/${code}/${branch}/${who}`)),
        JSON.parse(JSON.stringify(e.candidate))).catch(() => {});
    };
  }

  watchIce(conn, code, who, branch) {
    const { ref, onChildAdded } = this.fb;
    this.watchers.push(onChildAdded(ref(this.db, `${ROOT}/${code}/${branch}/${who}`), (snap) => {
      const c = snap.val();
      if (c) conn.addIceCandidate(c).catch(() => {});
    }));
  }

  attachChannel(peerId, channel) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    const bulk = channel.label === 'snow';
    peer[bulk ? 'bulk' : 'live'] = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      if (!bulk) return;
      // Identity and the snow both ride the reliable channel, so the moment it
      // opens is the moment there is anything worth saying.
      this.sendIdentity(peer);
      if (this.isHost) {
        this.sendRoster(peer);
        this.sendSnapshot(peer);
      }
    };
    channel.onclose = () => this.dropPeer(peerId);
    channel.onmessage = (e) => this.receive(peerId, e.data);
  }

  dropPeer(peerId, { quiet = false } = {}) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    try { peer.conn.close(); } catch { /* already gone */ }
    this.peers.delete(peerId);

    if (this.isHost) {
      // A guest left: tell the rest so their avatar goes away too.
      this.dropRemote(peerId);
      this.relay(null, JSON.stringify({ t: MSG.LEAVE, id: peerId }));
    } else {
      // We lost the host, and with it everyone we only heard about through it.
      for (const id of [...this.remotes.keys()]) this.dropRemote(id);
      if (!quiet && this.room) {
        this.isHost = true;
        this.synced = true;
        this.status = `Hosting ${this.room}`;
        this.game.hud?.flash('The host left. You are holding the snow now.');
      }
    }
    this.refreshOthers();
    this.onRoomsChanged?.();
  }

  dropRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    if (r.avatar) {
      this.remoteRoot.remove(r.avatar.root);
      r.avatar.dispose?.();
    }
    this.remotes.delete(id);
    this.refreshOthers();
  }

  startHeartbeat() {
    if (this._beat) clearInterval(this._beat);
    this._beat = setInterval(() => {
      if (!this.db || !this.room || !this.isHost) return;
      const { ref, update } = this.fb;
      update(ref(this.db, `${ROOT}/${this.room}`), {
        beat: Date.now(),
        players: this.peers.size + 1,
      }).catch(() => {});
    }, 12000);
  }

  // ---------------------------------------------------------------- messages

  /** Small, loss-tolerant traffic: positions. */
  sendLive(peer, text) {
    const ch = peer.live;
    if (!ch || ch.readyState !== 'open') return;
    try { ch.send(text); } catch { /* buffer full; the next tick will do */ }
  }

  /** Anything that must arrive whole, split into chunks the transport accepts. */
  async sendBulk(peer, type, payload) {
    const ch = peer.bulk;
    if (!ch || ch.readyState !== 'open') return;
    const seq = peer.seq = (peer.seq + 1) & 255;
    const total = payload.length;
    for (let off = 0; off === 0 || off < total; off += CHUNK) {
      const slice = payload.subarray(off, Math.min(total, off + CHUNK));
      const out = new Uint8Array(10 + slice.length);
      const view = new DataView(out.buffer);
      out[0] = type;
      out[1] = seq;
      view.setUint32(2, total);
      view.setUint32(6, off);
      out.set(slice, 10);
      if (ch.bufferedAmount > 1024 * 1024) await drain(ch);
      if (ch.readyState !== 'open') return;
      try { ch.send(out.buffer); } catch { return; }
    }
  }

  broadcastBulk(type, payload, except = null) {
    for (const [id, peer] of this.peers) {
      if (id === except) continue;
      this.sendBulk(peer, type, payload);
    }
  }

  broadcastLive(text, except = null) {
    for (const [id, peer] of this.peers) {
      if (id === except) continue;
      this.sendLive(peer, text);
    }
  }

  /**
   * Host-only: repeat a reliable text message to everyone but its author. This
   * is what makes a star topology look like a mesh to the players.
   */
  relay(from, text) {
    if (!this.isHost) return;
    const payload = textBytes(text);
    for (const [id, peer] of this.peers) {
      if (id === from) continue;
      this.sendBulk(peer, MSG.IDENTITY, payload);
    }
  }

  identityPayload() {
    const g = this.game;
    return JSON.stringify({
      t: MSG.IDENTITY,
      id: this.id,
      name: g.state.name,
      colours: g.state.colours,
      kind: g.avatar?.kind || 'ski',
    });
  }

  sendIdentity(peer) {
    this.sendBulk(peer, MSG.IDENTITY, textBytes(this.identityPayload()));
  }

  broadcastIdentity() {
    const payload = textBytes(this.identityPayload());
    for (const peer of this.peers.values()) this.sendBulk(peer, MSG.IDENTITY, payload);
  }

  /** Host-only: tell a newcomer who else is already on the mountain. */
  sendRoster(peer) {
    for (const [id, r] of this.remotes) {
      this.sendBulk(peer, MSG.IDENTITY, textBytes(JSON.stringify({
        t: MSG.IDENTITY, id, name: r.name, colours: r.colours, kind: r.kind,
      })));
    }
  }

  sendSnapshot(peer) {
    this.sendBulk(peer, MSG.SNOW_SNAPSHOT, this.game.snow.snapshot());
  }

  receive(peerId, data) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    // The unreliable channel carries plain JSON strings; the reliable one is
    // always framed binary.
    if (typeof data === 'string') { this.handleText(peerId, data); return; }

    const bytes = new Uint8Array(data);
    if (bytes.length < 10) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = bytes[0], seq = bytes[1];
    const total = view.getUint32(2), off = view.getUint32(6);
    const body = bytes.subarray(10);

    let payload = null;
    if (off === 0 && body.length >= total) {
      payload = body.subarray(0, total);
    } else {
      const key = `${type}:${seq}`;
      let part = peer.parts.get(key);
      if (!part) {
        if (off !== 0) return; // joined mid-message; wait for the next one
        part = { buf: new Uint8Array(total), got: 0 };
        peer.parts.set(key, part);
      }
      part.buf.set(body, off);
      part.got += body.length;
      if (part.got < total) return;
      peer.parts.delete(key);
      payload = part.buf;
    }
    this.handleBulk(peerId, type, payload);
  }

  handleBulk(peerId, type, payload) {
    // Everything that is not snow is a JSON message; the frame type only says
    // that, and the real message type lives inside the JSON.
    if (type === MSG.IDENTITY || type === MSG.EMOTE || type === MSG.LEAVE) {
      this.handleText(peerId, decodeText(payload));
      return;
    }
    if (type === MSG.SNOW_SNAPSHOT) {
      try {
        this.game.snow.applySnapshot(payload);
        this.synced = true;
        this.game.hud?.flash('Snow synced with the host.');
      } catch (err) {
        console.warn('[net] bad snapshot', err);
      }
      return;
    }
    if (type === MSG.SNOW_PATCH) {
      try {
        this.game.snow.applyPatch(payload);
      } catch (err) {
        console.warn('[net] bad patch', err);
        return;
      }
      // The host is the meeting point for snow: what one guest carves has to
      // reach the others, and only the host can put it there.
      if (this.isHost) this.broadcastBulk(MSG.SNOW_PATCH, payload, peerId);
    }
  }

  handleText(peerId, text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    const id = msg.id || peerId;
    if (id === this.id) return;

    if (msg.t === MSG.IDENTITY) {
      const r = this.remote(id);
      r.name = msg.name || 'Skier';
      r.colours = msg.colours;
      r.colour = msg.colours?.jacket || '#fff';
      r.kind = msg.kind || 'ski';
      if (r.avatar) {
        r.avatar.setColours(r.colours);
        r.avatar.setKind(r.kind);
        if (r.tag?.name !== r.name) this.setNameTag(r);
      }
      this.refreshOthers();
      if (this.isHost) this.relay(peerId, text);
    } else if (msg.t === MSG.EMOTE) {
      this.remote(id).emote = { name: msg.name, until: performance.now() + 2000 };
      if (this.isHost) this.relay(peerId, text);
    } else if (msg.t === MSG.STATE) {
      const r = this.remote(id);
      r.state = msg.s;
      r.points = msg.p;
      r.seen = performance.now();
      if (this.isHost) this.broadcastLive(text, peerId);
    } else if (msg.t === MSG.LEAVE) {
      this.dropRemote(msg.id);
    }
  }

  /** Hang a fresh name sprite over a remote skier, replacing any older one. */
  setNameTag(r) {
    if (r.tag) r.avatar.root.remove(r.tag);
    r.tag = makeNameTag(r.name || 'Skier');
    r.tag.name = r.name;
    r.avatar.root.add(r.tag);
  }

  remote(id) {
    let r = this.remotes.get(id);
    if (!r) {
      r = { name: 'Skier', colour: '#fff', colours: null, kind: 'ski', state: null };
      this.remotes.set(id, r);
    }
    return r;
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
      this.broadcastLive(JSON.stringify({
        t: MSG.STATE,
        id: this.id,
        p: Math.round(this.game.state.points),
        s: {
          x: +s.pos.x.toFixed(2), y: +s.pos.y.toFixed(2), z: +s.pos.z.toFixed(2),
          h: +s.heading.toFixed(3), r: +s.roll.toFixed(3), i: +s.pitch.toFixed(3),
          m: s.mode, v: +s.telemetry.speed.toFixed(1), k: +(s.telemetry.skid || 0).toFixed(2),
        },
      }));

      // Everyone carves, so everyone ships their rectangle. Guests hold theirs
      // back until the host's snapshot has landed, or they would be pushing a
      // patch of a mountain nobody else has.
      if (this.isHost || this.synced) {
        const patch = this.game.snow.takePatch();
        if (patch && patch.length <= MAX_PATCH) {
          this.broadcastBulk(MSG.SNOW_PATCH, patch);
        } else if (patch) {
          // A rectangle this big is a raw dump of half the mountain, and the
          // RLE snapshot of the same thing is an order of magnitude smaller.
          // Dropping it would lose real snow, so send the compressed truth.
          if (this.isHost) {
            const snap = this.game.snow.snapshot();
            for (const peer of this.peers.values()) this.sendBulk(peer, MSG.SNOW_SNAPSHOT, snap);
          } else {
            console.warn('[net] skipped an oversized snow patch', patch.length);
          }
        }
      }
    }

    this.animateOthers(dt);
    this.refreshOthers();
  }

  animateOthers(dt) {
    for (const [, r] of this.remotes) {
      if (!r.state) continue;
      if (!r.avatar) {
        r.avatar = new Avatar(this.game.assets, {
          colours: r.colours, kind: r.kind || 'ski',
        });
        this.setNameTag(r);
        this.remoteRoot.add(r.avatar.root);
      }
      // A stand-in skier the remote avatar can be posed from, so the same posing
      // code drives everyone on the mountain.
      r.proxy ||= {
        pos: new THREE.Vector3(r.state.x, r.state.y, r.state.z),
        heading: r.state.h, roll: 0, pitch: 0, mode: MODE.RIDE,
        edge: 0, air: { grab: 0 }, telemetry: { speed: 0, skid: 0, airborne: false },
        _tuck: false,
      };
      const p = r.proxy;
      const s = r.state;
      // Smooth towards the last packet rather than snapping to it.
      p.pos.lerp(TMP.set(s.x, s.y, s.z), Math.min(1, dt * 12));
      p.heading += shortestAngle(p.heading, s.h) * Math.min(1, dt * 12);
      p.roll += (s.r - p.roll) * Math.min(1, dt * 10);
      p.pitch += (s.i - p.pitch) * Math.min(1, dt * 10);
      p.mode = s.m;
      p.edge = THREE.MathUtils.clamp(-s.r * 1.6, -1, 1);
      p.telemetry.speed = s.v;
      p.telemetry.skid = s.k;
      p.telemetry.airborne = s.m === MODE.AIR;
      r.avatar.update(dt, p);
    }
  }

  refreshOthers() {
    this.others = [...this.remotes.values()]
      .filter((r) => r.state)
      .map((r) => ({
        name: r.name, colour: r.colour, points: r.points || 0,
        x: r.state.x, y: r.state.y, z: r.state.z,
      }));
  }

  emote(name) {
    const payload = textBytes(JSON.stringify({ t: MSG.EMOTE, id: this.id, name }));
    for (const peer of this.peers.values()) this.sendBulk(peer, MSG.EMOTE, payload);
  }

  // ---------------------------------------------------------------- panel

  /**
   * The room panel. It repaints itself whenever anything changes, because the
   * Firebase config arrives a second after the panel is first opened and a panel
   * that says "no room service" forever is a bug the player cannot tell from a
   * broken game.
   */
  buildPanel() {
    const wrap = el('div', 'net');
    this.onRoomsChanged = () => this.paintPanel(wrap);
    this.paintPanel(wrap);
    return wrap;
  }

  paintPanel(wrap) {
    wrap.textContent = '';
    wrap.appendChild(el('p', 'net__status', this.status));

    if (!this.db) {
      wrap.appendChild(el('p', 'net__hint', this.error || 'Looking for the room service…'));
      return;
    }
    if (this.error) wrap.appendChild(el('p', 'net__hint', this.error));

    const actions = el('div', 'net__actions');
    const host = async (isPublic) => {
      this.error = null;
      try {
        await this.createRoom({ isPublic });
      } catch (err) {
        console.warn('[net] could not open a room', err);
        this.error = 'The database refused to open the room.';
      }
      this.paintPanel(wrap);
    };
    const mkPublic = el('button', 'btn', 'Open a public room');
    mkPublic.addEventListener('click', () => host(true));
    const mkPrivate = el('button', 'btn', 'Open a private room');
    mkPrivate.addEventListener('click', () => host(false));
    actions.append(mkPublic, mkPrivate);
    if (this.room) {
      const leave = el('button', 'btn', 'Leave the room');
      leave.addEventListener('click', async () => {
        await this.leaveRoom();
        this.paintPanel(wrap);
      });
      actions.appendChild(leave);
    }
    wrap.appendChild(actions);

    const joinRow = el('div', 'net__join');
    const input = el('input', 'field__input');
    input.placeholder = 'SNOW-XXXX';
    input.maxLength = 9;
    // A repaint must not eat a half-typed code.
    input.value = this._joinCode || '';
    input.addEventListener('input', () => { this._joinCode = input.value; });
    const joinBtn = el('button', 'btn', 'Join by code');
    const join = async (code) => {
      this.error = null;
      try {
        await this.joinRoom(code);
      } catch (err) {
        console.warn('[net] could not join', err);
        this.error = 'That room would not let us in.';
      }
      this.paintPanel(wrap);
    };
    joinBtn.addEventListener('click', () => join(input.value.trim().toUpperCase()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join(input.value.trim().toUpperCase());
    });
    joinRow.append(input, joinBtn);
    wrap.appendChild(joinRow);

    const list = el('ul', 'net__rooms');
    if (!this.rooms.length) {
      list.appendChild(el('li', 'net__empty', 'No public rooms open right now.'));
    } else {
      for (const r of this.rooms) {
        const li = el('li', 'net__room');
        li.append(
          el('span', 'net__code t-num', r.code),
          el('span', 'net__host', r.name || 'Someone'),
          el('span', 'net__count t-num', `${r.players || 1}/5`),
        );
        const b = el('button', 'btn btn--small', r.code === this.room ? 'You' : 'Join');
        b.disabled = (r.players || 1) >= 5 || r.code === this.room;
        b.addEventListener('click', () => join(r.code));
        li.appendChild(b);
        list.appendChild(li);
      }
    }
    wrap.appendChild(list);

    if (this.room) {
      wrap.appendChild(el('p', 'net__hint',
        `${this.isHost ? 'You are hosting' : 'You are in'} ${this.room} — `
        + `${this.peers.size + 1} on the mountain. Share the code.`));
    }
  }
}

const TMP = new THREE.Vector3();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const textBytes = (s) => encoder.encode(s);
const decodeText = (bytes) => decoder.decode(bytes);

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
