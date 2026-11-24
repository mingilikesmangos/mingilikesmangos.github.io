import * as THREE from 'three';
import { Character, flexPump, DIM } from '../rig.js';
import { toon, groundHeight } from '../world.js';
import { mulberry32 } from '../noise.js';

// A fallen log between the carving and the slab, with two people sitting on
// it side by side facing the wall: one working on a laptop on their lap, the
// other eating mango cubes off a plate set on the log between them.
//
// Everything is laid out in the log's local frame: +z points at the boulder,
// the log runs along x.

const CENTER = new THREE.Vector3(-1.7, 0, -3.65);
const LOG = { len: 1.8, r: 0.22, sink: 0.03 };
const APOTHEM = LOG.r * Math.cos(Math.PI / 8);          // octagonal trunk, flat face up
const LOG_TOP = 2 * APOTHEM - LOG.sink;                 // seat height above the ground
const WORKER_X = -0.38, EATER_X = 0.38;                 // eater's right hand is towards the plate

const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _inv = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

function pixelTex(W, H, draw) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

/** Octagonal log lying along x: furrowed bark, rings on the sawn ends, a
 *  broken-off branch stub. */
function buildLog() {
    const rand = mulberry32(97);
    const bark = pixelTex(24, 8, (g) => {
        g.fillStyle = '#6b4a33';
        g.fillRect(0, 0, 24, 8);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 24; x++) {
                const r = rand();
                if (r < 0.22) { g.fillStyle = '#563a28'; g.fillRect(x, y, 1, 1); }
                else if (r > 0.93) { g.fillStyle = '#7f5a3e'; g.fillRect(x, y, 1, 1); }
            }
        }
        g.fillStyle = '#4a3122';                          // furrows along the grain
        for (const y of [1, 4, 6]) {
            const x0 = Math.floor(rand() * 8);
            g.fillRect(x0, y, 10 + Math.floor(rand() * 8), 1);
        }
    });
    const rings = pixelTex(9, 9, (g) => {
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) {
                const d = Math.hypot(x - 4, y - 4);
                g.fillStyle = d > 3.6 ? '#6b4a33' : Math.round(d) % 2 ? '#c79b68' : '#e0bb87';
                g.fillRect(x, y, 1, 1);
            }
        }
        g.fillStyle = '#8a5f3c';
        g.fillRect(4, 4, 1, 1);
    });
    const geo = new THREE.CylinderGeometry(LOG.r, LOG.r, LOG.len, 8);
    geo.rotateY(Math.PI / 8);                             // a flat face on top
    geo.rotateZ(Math.PI / 2);
    const g = new THREE.Group();
    const log = new THREE.Mesh(geo, [toon({ map: bark }), toon({ map: rings }), toon({ map: rings })]);
    log.position.y = APOTHEM - LOG.sink;
    g.add(log);
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.16, 6), toon({ color: 0x5e412d }));
    stub.position.set(-0.62, APOTHEM - LOG.sink + 0.05, -0.2);
    stub.rotation.set(-1.0, 0, 0.3);
    g.add(stub);
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    return g;
}

function buildLaptop() {
    const silver = toon({ color: 0xc4c6cb });
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), silver);
    const keys = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.004, 0.1), toon({ color: 0x4a4d54 }));
    keys.position.set(0, 0.011, 0.035);
    const hinge = new THREE.Group();          // far edge of the base
    hinge.position.set(0, 0.01, 0.12);
    hinge.rotation.x = 0.28;                  // lid tilted back a little
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.23, 0.012), silver);
    lid.position.set(0, 0.115, 0);
    // a terminal with Clawd (the Claude Code mascot) on the welcome screen
    const CLAWD = [
        '..##########..',
        '..#.######.#..',
        '##############',
        '..##########..',
        '...#.#....#.#.',
    ];
    const screenTex = pixelTex(31, 20, (g) => {
        g.fillStyle = '#1f1e1c';
        g.fillRect(0, 0, 31, 20);
        g.fillStyle = '#d97757';
        CLAWD.forEach((row, y) => {
            [...row].forEach((c, x) => { if (c === '#') g.fillRect(8 + x, 3 + y, 1, 1); });
        });
        g.fillStyle = '#8a857c';                  // welcome text
        g.fillRect(23, 4, 5, 1);
        g.fillRect(23, 6, 4, 1);
        g.fillRect(3, 11, 18, 1);
        g.fillRect(3, 13, 12, 1);
        g.fillStyle = '#5a5650';                  // prompt box
        g.strokeStyle = '#5a5650';
        g.fillRect(2, 15, 27, 1);
        g.fillRect(2, 18, 27, 1);
        g.fillRect(2, 15, 1, 4);
        g.fillRect(28, 15, 1, 4);
        g.fillStyle = '#e8e4da';
        g.fillRect(4, 16, 1, 2);                  // cursor
    });
    const screenMat = new THREE.MeshBasicMaterial({ color: 0xd0d0d0, map: screenTex });
    const bezel = new THREE.MeshBasicMaterial({ color: 0x1c1c20 });
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.2, 0.004),
        [bezel, bezel, bezel, bezel, bezel, screenMat]);   // -z face looks at the user
    screen.position.set(0, 0.118, -0.007);
    hinge.add(lid, screen);
    g.add(base, keys, hinge);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // screen light on the face at night
    const light = new THREE.PointLight(0xffe2cc, 0, 1.6, 1.5);
    light.position.set(0, 0.14, -0.15);
    hinge.add(light);
    return {
        group: g,
        setNight(on) {
            screenMat.color.setHex(on ? 0xffffff : 0xd0d0d0);
            light.intensity = on ? 2.2 : 0;
        },
    };
}

// Black square frames with pale lenses and a dark eye behind each, plus the
// arms running back to the ears. Head front face is at z 0.15, eyes y ~0.18.
function buildGlasses() {
    const g = new THREE.Group();
    const frame = toon({ color: 0x18181c });
    const lens = toon({ color: 0xd7e9f2 });
    const eye = toon({ color: 0x241c18 });
    const box = (w, h, d, m, x, y, z) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        b.position.set(x, y, z);
        g.add(b);
    };
    const W = 0.125, H = 0.095, T = 0.024, Y0 = 0.18, Z = 0.162;
    for (const sx of [-1, 1]) {
        const cx = sx * 0.078;
        box(W, T, 0.02, frame, cx, Y0 + (H - T) / 2, Z);         // top rim
        box(W, T, 0.02, frame, cx, Y0 - (H - T) / 2, Z);         // bottom rim
        box(T, H, 0.02, frame, cx - (W - T) / 2, Y0, Z);         // sides
        box(T, H, 0.02, frame, cx + (W - T) / 2, Y0, Z);
        box(W - 2 * T, H - 2 * T, 0.006, lens, cx, Y0, Z - 0.004);
        box(0.03, 0.035, 0.004, eye, cx - sx * 0.005, Y0 - 0.004, Z - 0.002);
        box(0.02, 0.022, 0.16, frame, sx * 0.165, Y0 + 0.02, 0.08);   // temple arm
    }
    return g;
}

const MANGO = 0xf5a623;

/** Sit a character on the log at x, facing +z with both feet on the ground. */
function seat(rig, group, x) {
    const root = rig.root;
    root.position.set(x, LOG_TOP + 0.09, 0.02);
    group.localToWorld(root.position);
    root.quaternion.copy(group.quaternion);
    root.updateMatrixWorld(true);
    for (const [l, side] of [['lLeg', 1], ['rLeg', -1]]) {
        const limb = rig.limbs[l];
        const foot = root.localToWorld(new THREE.Vector3(side * 0.12, 0, DIM.thigh - 0.02));
        foot.y = groundHeight(foot.x, foot.z) + DIM.ankle;
        limb.target = foot;
        limb.pole.set(0, 0.3, 1).applyQuaternion(root.quaternion);
        limb.footDir = new THREE.Vector3(side * 0.15, 0, 1).normalize().applyQuaternion(root.quaternion);
    }
}

function lookAtPoint(rig, p, maxYaw = 1.3) {
    const root = rig.root;
    _v.copy(p).sub(root.position).applyQuaternion(_inv.copy(root.quaternion).invert());
    const yaw = THREE.MathUtils.clamp(Math.atan2(_v.x, _v.z), -maxYaw, maxYaw);
    const pitch = -THREE.MathUtils.clamp(Math.atan2(_v.y - 0.6, Math.hypot(_v.x, _v.z)), -0.5, 0.6);
    rig.setJoint('neck', pitch, yaw, 0);
}

// ---------------------------------------------------------------------------
// The laptop worker
// ---------------------------------------------------------------------------

const WORKER_LOOK = {
    skin: 0xeec39c,
    shirt: 0x34405e,      // navy hoodie
    shorts: 0x9a8a6c,     // chinos
    legs: 0x9a8a6c,
    shoes: 0x2f2f35,      // black sneakers
    hair: 0x1b1612,
    backText: '3dv\nlab',
    backInk: 0xe8e4da,
};

const W_POSE = {
    type: { spine: [0.2, 0, 0], neck: [0.3, 0, 0] },
    think: { spine: [0.12, 0, 0], neck: [0.05, 0, 0] },
    stretch: {
        spine: [-0.12, 0, 0], neck: [-0.35, 0, 0],
        lArmUpper: [-2.9, 0, -0.15], rArmUpper: [-2.9, 0, 0.15],
        lArmLower: [-0.5, 0, 0], rArmLower: [-0.5, 0, 0],
    },
    watch: { spine: [0.05, 0, 0] },
    clap: { spine: [0.02, 0, 0] },
};

class Worker {
    constructor(scene, group, laptop) {
        this.rig = new Character(WORKER_LOOK);
        scene.add(this.rig.root);
        seat(this.rig, group, WORKER_X);
        this.baseY = this.rig.root.position.y;
        this.rig.joints.neck.add(buildGlasses());
        this.laptop = laptop;
        this.hands = { lArm: new THREE.Vector3(), rArm: new THREE.Vector3() };
        this.ik = false;
        this.rand = mulberry32(211);
        this.mode = 'type';
        this.left = 5;
        this.t = 0;
        this.rig.setPose(W_POSE.type);
        this.rig.snapToPose();
    }

    /** IK hand goals: on the keys (typing jitter), at the chin, or clapping in
     *  front of the chest. Stretch lets go to FK. */
    moveHands(dt, t) {
        const rig = this.rig, m = this.mode;
        if (m === 'stretch') {
            if (this.ik) {
                this.ik = false;
                rig.limbs.lArm.target = rig.limbs.rArm.target = null;
            }
            return;
        }
        if (!this.ik) {
            this.ik = true;
            for (const l of ['lArm', 'rArm']) {
                rig.endPosition(l, this.hands[l]);
                rig.limbs[l].target = this.hands[l];
            }
        }
        const typing = m === 'type' && Math.sin(t * 0.9) > -0.4;
        const e = rig.root.matrixWorld.elements;
        const left = _a.set(e[0], e[1], e[2]).normalize();
        const fwd = _b.set(e[8], e[9], e[10]).normalize();
        const clap = Math.abs(Math.sin(t * 9));
        for (const [l, side, ph] of [['lArm', 1, 0], ['rArm', -1, 1.3]]) {
            const pole = rig.limbs[l].pole.set(0, -0.6, 0).addScaledVector(left, side * 0.7);
            if (m === 'clap') {
                _c.set(side * (0.025 + 0.09 * clap), 0.4 + 0.02 * clap, 0.3);
                rig.root.localToWorld(_c);
            } else if (m === 'think' && l === 'rArm') {
                _c.set(0.02, 0.03, 0.21);                  // knuckles under the chin
                rig.joints.neck.localToWorld(_c);
                pole.addScaledVector(fwd, 0.3);
            } else {
                const tap = typing ? 0.012 * Math.max(0, Math.sin(t * 21 + ph * 3)) : 0;
                _c.set(side * 0.075 + (typing ? 0.012 * Math.sin(t * 2.3 + ph) : 0), 0.055 + tap, m === 'watch' ? -0.06 : 0.0);
                this.laptop.group.localToWorld(_c);
                pole.addScaledVector(fwd, -0.4);
            }
            this.hands[l].lerp(_c, 1 - Math.exp(-dt * (m === 'clap' ? 25 : 10)));
        }
    }

    update(dt, climber) {
        this.t += dt;
        this.left -= dt;
        const r = this.rand, rig = this.rig;
        if (climber.sent) {
            if (this.mode !== 'clap') { this.mode = 'clap'; this.left = 1.8; }
        } else if (this.left <= 0) {
            // mostly typing; looks up now and then, more often while someone climbs
            const x = r();
            const next = this.mode !== 'type' ? 'type'
                : climber.climbing && x < 0.5 ? 'watch'
                    : x < 0.55 ? 'think' : x < 0.75 ? 'watch' : x < 0.9 ? 'stretch' : 'type';
            this.mode = next;
            this.left = { type: 5 + r() * 6, think: 2.5 + r() * 2, watch: 2.5 + r() * 2.5, stretch: 1.8 }[next];
        }
        rig.setPose(W_POSE[this.mode], this.mode === 'clap' ? 9 : this.mode === 'stretch' ? 3 : 4);
        this.moveHands(dt, this.t);
        if (this.mode === 'clap' || this.mode === 'watch') lookAtPoint(rig, climber.pelvis);
        rig.root.position.y = this.baseY + 0.005 * Math.sin(this.t * 1.6);   // breathing
        rig.update(dt);
    }
}

// ---------------------------------------------------------------------------
// The mango eater
// ---------------------------------------------------------------------------

const EATER_LOOK = {
    skin: 0xe2b28a,
    shirt: 0xe58f84,      // coral tee
    shorts: 0x4a6a8f,     // denim shorts
    shoes: 0xe6e2da,      // white sneakers
    hair: 0x3a2a20,
};

const E_POSE = {
    sit: {
        spine: [0.08, 0, 0],
        lArmUpper: [-0.6, 0, 0.12], lArmLower: [-0.5, 0, 0],      // hands on the thighs
        rArmUpper: [-0.6, 0, -0.12], rArmLower: [-0.5, 0, 0],
    },
    lean: {   // leaning back on one hand on the log
        spine: [-0.18, 0, 0],
        lArmUpper: [0.55, 0, 0.35], lArmLower: [0, 0, 0],
        rArmUpper: [-0.45, 0, -0.3], rArmLower: [-0.55, 0, 0],
    },
};

const PIECES = 5;

class Eater {
    constructor(scene, group, plate, workerHead) {
        this.rig = new Character(EATER_LOOK);
        scene.add(this.rig.root);
        seat(this.rig, group, EATER_X);
        this.baseY = this.rig.root.position.y;
        this.plate = plate;
        this.workerHead = workerHead;
        this.hand = new THREE.Vector3();
        this.held = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), toon({ color: MANGO }));
        this.held.castShadow = true;
        this.held.visible = false;
        scene.add(this.held);
        this.rand = mulberry32(307);
        this.mode = 'chew';
        this.left = 1.5;
        this.t = 0;
        this.rig.setPose(E_POSE.sit);
        this.rig.snapToPose();
    }

    setMode(mode, dur) {
        this.mode = mode;
        this.left = dur;
        const rig = this.rig, arm = rig.limbs.rArm;
        if (mode === 'reach' || mode === 'lift' || mode === 'bite') {
            if (!arm.target) {
                rig.endPosition('rArm', this.hand);
                arm.target = this.hand;
            }
        } else {
            arm.target = null;
        }
    }

    next() {
        const r = this.rand;
        switch (this.mode) {
        case 'reach': {
            const piece = this.plate.take();
            this.held.visible = !!piece;
            return this.setMode(piece ? 'lift' : 'chew', 0.6);
        }
        case 'lift': return this.setMode('bite', 0.35);
        case 'bite':
            this.held.visible = false;
            return this.setMode('chew', 1.4 + r() * 1.2);
        default: {
            if (this.plate.left === 0) { this.plate.refill(); return this.setMode('lean', 3 + r() * 2); }
            const x = r();
            if (this.mode === 'chew' && x < 0.25) return this.setMode('look', 2 + r() * 1.5);
            if (this.mode === 'chew' && x < 0.4) return this.setMode('lean', 2.5 + r() * 2);
            return this.setMode('reach', 0.7);
        }
        }
    }

    update(dt, climber) {
        this.t += dt;
        this.left -= dt;
        const rig = this.rig, root = rig.root, t = this.t;
        if (climber.flexing) {
            if (this.mode !== 'flex') {
                this.held.visible = false;
                this.setMode('flex', 0);
            }
        } else if (this.mode === 'flex') {
            this.setMode('chew', 1);
        } else if (this.left <= 0) {
            this.next();
        }

        rig.setPose(this.mode === 'lean' ? E_POSE.lean : E_POSE.sit, 4);
        const e = root.matrixWorld.elements;
        const left = _a.set(e[0], e[1], e[2]).normalize();
        rig.limbs.rArm.pole.set(0, -0.8, 0).addScaledVector(left, -0.6);
        if (this.mode === 'reach') {
            this.hand.lerp(_c.copy(this.plate.spot).add(_b.set(0, 0.03, 0)), 1 - Math.exp(-dt * 7));
        } else if (this.mode === 'lift' || this.mode === 'bite') {
            _c.set(-0.01, 0.06, 0.24);                    // just in front of the mouth
            rig.joints.neck.localToWorld(_c);
            this.hand.lerp(_c, 1 - Math.exp(-dt * (this.mode === 'bite' ? 12 : 7)));
        }

        if (this.mode === 'flex') {
            if (climber.t > 0.7) flexPump(rig, climber.t, 'r');
            lookAtPoint(rig, climber.pelvis);
        } else if (this.mode === 'look') {
            lookAtPoint(rig, this.workerHead);           // peeks at the laptop next to them
        } else if (this.mode === 'chew') {
            rig.setJoint('neck', 0.05 + 0.04 * Math.abs(Math.sin(t * 11)), 0, 0);
        } else if (this.mode === 'lean') {
            lookAtPoint(rig, climber.pelvis);
        } else {
            rig.setJoint('neck', 0.3, 0, 0);              // eyes on the plate
        }

        root.position.y = this.baseY + 0.005 * Math.sin(t * 1.4 + 1);
        rig.update(dt);
        if (this.held.visible) {
            rig.endPosition('rArm', this.held.position);
            this.held.position.y += 0.06;
        }
    }
}

// ---------------------------------------------------------------------------
// Clawd, on a leash tied round the log at the worker's right, pottering
// about beside them past the end of the log
// ---------------------------------------------------------------------------

const PET = { c: 0.03, rh: 0.04, legH: 0.06, D: 0.24, leash: 0.95, speed: 0.4 };
const KNOT_X = WORKER_X - 0.47;                          // just past the mug
// where Clawd may wander, log-local: off the end of the log on the worker's right
const ROAM = { x0: -1.55, x1: LOG.len / -2 - 0.12, z0: -0.5, z1: 0.55 };
const LEASH = 0xc0392b;

/** Voxel Clawd: the 2-row sprite (body with eye notches, arms, four pairs of
 *  stubby legs) extruded into a block. Faces +z. */
function buildClawd() {
    const { c, rh, legH, D } = PET;
    const g = new THREE.Group();
    const body = new THREE.Group();            // everything above the legs (bobs)
    const coral = toon({ color: 0xd97757 });
    const ink = toon({ color: 0x1a1414 });
    const box = (parent, w, h, d, m, x, y, z) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        b.position.set(x, y, z);
        b.castShadow = true;
        parent.add(b);
        return b;
    };
    box(body, 12 * c, 4 * rh, D, coral, 0, 2 * rh, 0);
    box(body, 16 * c, rh, D * 0.55, coral, 0, 1.5 * rh, 0);       // arms
    for (const sx of [-1, 1]) box(body, c, rh, 0.012, ink, sx * 3.5 * c, 2.5 * rh, D / 2 + 0.004);
    // harness ring on the back for the leash
    box(body, 12 * c + 0.01, 0.018, 0.03, toon({ color: LEASH }), 0, 2 * rh, -D / 4);
    box(body, 0.03, 0.03, 0.03, toon({ color: 0x9a9a9a }), 0, 4 * rh + 0.012, -D / 4);
    body.position.y = legH;
    g.add(body);
    const legs = [[], []];
    [-4.5, -2.5, 2.5, 4.5].forEach((x, i) => {
        for (const sz of [-1, 1]) {
            const leg = box(g, c, legH, c * 1.2, coral, x * c, legH / 2, sz * D / 4);
            legs[(i + (sz > 0 ? 1 : 0)) % 2].push(leg);
        }
    });
    return { group: g, body, legs, collar: new THREE.Vector3(0, legH + 4 * rh + 0.02, -D / 4) };
}

class Pet {
    constructor(scene, group) {
        this.scene = scene;
        this.frame = group;                      // the log's frame
        this.model = buildClawd();
        scene.add(this.model.group);
        this.axisY = APOTHEM - LOG.sink;         // log axis height in the log frame
        this.anchor = new THREE.Vector3();
        this.pos = new THREE.Vector2(-1.2, 0.25); // log-local ground position
        this.goal = this.pos.clone();
        this.yaw = -1.9;                         // log-local heading (0 = towards the boulder)
        this.yawGoal = this.yaw;
        this.rand = mulberry32(512);
        this.mode = 'sit';
        this.left = 1;
        this.phase = 0;
        this.t = 0;
        // leash: a short chain of thin boxes following a sagging curve
        const m = toon({ color: LEASH });
        this.links = [];
        for (let i = 0; i < 10; i++) {
            const l = new THREE.Mesh(new THREE.BoxGeometry(0.014, 1, 0.014), m);
            scene.add(l);
            this.links.push(l);
        }
        this.place(0);
    }

    pickGoal() {
        // somewhere off the end of the log, a little way from where it is now
        const r = this.rand;
        for (let k = 0; k < 20; k++) {
            const x = ROAM.x0 + r() * (ROAM.x1 - ROAM.x0), z = ROAM.z0 + r() * (ROAM.z1 - ROAM.z0);
            if (this.pos.distanceTo(_g.set(x, z)) > 0.25) return this.goal.set(x, z);
        }
        return this.goal.set((ROAM.x0 + ROAM.x1) / 2, 0);
    }

    next(climber) {
        const r = this.rand, x = r();
        if (this.mode === 'walk' || this.mode === 'hop') {
            if (x < 0.45) { this.mode = 'sit'; this.left = 1.5 + r() * 3; }
            else { this.mode = 'look'; this.left = 1.2 + r() * 1.5; this.yawGoal = this.yaw + (r() - 0.5) * 3; }
        } else {
            if (climber.climbing && x < 0.35) {   // turn to watch the climber
                this.mode = 'sit'; this.left = 2 + r() * 2; this.yawGoal = 0;
            } else {
                this.mode = 'walk'; this.left = 8; this.pickGoal();
            }
        }
    }

    update(dt, climber) {
        this.t += dt;
        this.left -= dt;
        if (climber.sent && this.mode !== 'hop') { this.mode = 'hop'; this.left = 1.8; this.yawGoal = 0; }
        else if (this.left <= 0) this.next(climber);

        let moving = false;
        if (this.mode === 'walk') {
            const d = _g.copy(this.goal).sub(this.pos);
            const len = d.length();
            if (len < 0.03) this.left = 0;
            else {
                this.yawGoal = Math.atan2(d.x, d.y);
                const turn = Math.abs(wrap(this.yawGoal - this.yaw));
                if (turn < 0.6) {                    // turn first, then scuttle
                    const step = Math.min(len, PET.speed * dt);
                    this.pos.addScaledVector(d, step / len);
                    this.phase += step * 38;
                    moving = true;
                }
            }
        }
        this.yaw += wrap(this.yawGoal - this.yaw) * (1 - Math.exp(-dt * 8));
        this.moving = moving;
        this.place(dt);
    }

    place(dt) {
        const { group, body, legs, collar } = this.model;
        const t = this.t;
        _v.set(this.pos.x, 0, this.pos.y);
        this.frame.localToWorld(_v);
        group.position.set(_v.x, groundHeight(_v.x, _v.z) + 0.01, _v.z);
        group.quaternion.copy(this.frame.quaternion).multiply(_inv.setFromAxisAngle(Y, this.yaw));
        // gait: legs lift in two alternating sets, body bounces with each step
        let bob = 0.004 * Math.sin(t * 3);
        const s = Math.sin(this.phase);
        legs[0].forEach((l) => { l.position.y = PET.legH / 2 + (this.moving ? Math.max(0, s) * 0.025 : 0); });
        legs[1].forEach((l) => { l.position.y = PET.legH / 2 + (this.moving ? Math.max(0, -s) * 0.025 : 0); });
        if (this.moving) bob = Math.abs(s) * 0.015;
        if (this.mode === 'hop') {
            const h = Math.abs(Math.sin(t * 9));
            group.position.y += h * 0.12;
            body.scale.set(1 + (1 - h) * 0.08, 1 - (1 - h) * 0.12, 1);
        } else {
            body.scale.set(1, 1, 1);
        }
        body.position.y = PET.legH + bob;
        if (this.mode === 'look') body.rotation.z = 0.12 * Math.sin(t * 2.2);
        else body.rotation.z *= 0.9;
        group.updateMatrixWorld(true);

        // leash from the knot on the log (on the side facing Clawd) to the harness ring
        const b = body.localToWorld(_b.copy(collar).sub(_c.set(0, PET.legH, 0)));
        this.frame.worldToLocal(_c.copy(b));
        _d.set(0, _c.y - this.axisY, _c.z).normalize().multiplyScalar(LOG.r + 0.01);
        const a = this.frame.localToWorld(this.anchor.set(KNOT_X, this.axisY + _d.y, _d.z));
        const span = a.distanceTo(b);
        const sag = Math.max(0.02, (PET.leash - span) * 0.45);
        const n = this.links.length;
        let prev = _a.copy(a);
        for (let i = 1; i <= n; i++) {
            const u = i / n;
            const p = _c.lerpVectors(a, b, u);
            p.y -= sag * 4 * u * (1 - u);
            p.y = Math.max(p.y, groundHeight(p.x, p.z) + 0.012);
            const link = this.links[i - 1];
            _d.subVectors(p, prev);
            const len = _d.length();
            link.position.addVectors(prev, p).multiplyScalar(0.5);
            link.scale.y = len + 0.006;
            link.quaternion.setFromUnitVectors(Y, _d.divideScalar(len || 1));
            prev.copy(p);
        }
    }
}

const _g = new THREE.Vector2(), _d = new THREE.Vector3();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------------------

export class Campers {
    constructor(scene) {
        const group = new THREE.Group();
        const toWall = Math.atan2(-CENTER.x, -CENTER.z);          // local +z towards the boulder
        group.rotation.y = toWall;
        // rest the log on the highest bit of ground under it
        let y = -Infinity;
        for (const sx of [-1, -0.5, 0, 0.5, 1]) {
            _v.set(sx * LOG.len / 2, 0, 0).applyAxisAngle(Y, toWall).add(CENTER);
            y = Math.max(y, groundHeight(_v.x, _v.z));
        }
        group.position.set(CENTER.x, y, CENTER.z);
        scene.add(group);
        group.add(buildLog());

        // laptop on the worker's lap (thighs top out ~0.035 above the pelvis)
        this.laptop = buildLaptop();
        this.laptop.group.position.set(WORKER_X, LOG_TOP + 0.09 + 0.045, 0.27);
        group.add(this.laptop.group);

        // mug of coffee on the log by the worker
        const mug = new THREE.Group();
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 6), toon({ color: 0xeeeae2 }));
        const coffee = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.004, 6), toon({ color: 0x4a2f1e }));
        coffee.position.y = 0.049;
        cup.castShadow = true;
        mug.add(cup, coffee);
        mug.position.set(WORKER_X - 0.36, LOG_TOP + 0.05, 0.02);
        group.add(mug);

        // plate of mango cubes on the log between them, a whole mango at the far end
        const plateMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.02, 8), toon({ color: 0xf4f1ea }));
        plateMesh.position.set(0.02, LOG_TOP + 0.01, 0.02);
        plateMesh.castShadow = true;
        group.add(plateMesh);
        const mangoMat = toon({ color: MANGO });
        const cubes = [];
        for (let i = 0; i < PIECES; i++) {
            const c = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), mangoMat);
            const a = (i / PIECES) * Math.PI * 2 + 0.3;
            c.position.set(plateMesh.position.x + Math.cos(a) * 0.045, LOG_TOP + 0.045, plateMesh.position.z + Math.sin(a) * 0.045);
            c.rotation.y = a;
            c.castShadow = true;
            group.add(c);
            cubes.push(c);
        }
        const whole = new THREE.Group();
        const fruit = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.1), toon({ color: 0xf2b134 }));
        const blush = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.092, 0.102), toon({ color: 0xe0623a }));
        blush.position.x = 0.035;
        const stem = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.02), toon({ color: 0x4f7a2c }));
        stem.position.set(-0.05, 0.055, 0);
        fruit.castShadow = true;
        whole.add(fruit, blush, stem);
        whole.position.set(EATER_X + 0.36, LOG_TOP + 0.045, 0.0);
        whole.rotation.y = 0.5;
        group.add(whole);

        // rope knotted round the log at the worker's right for Clawd's leash
        const knot = new THREE.Mesh(new THREE.TorusGeometry(LOG.r + 0.004, 0.014, 4, 8), toon({ color: LEASH }));
        knot.rotation.y = Math.PI / 2;
        knot.rotation.x = Math.PI / 8;
        knot.position.set(KNOT_X, APOTHEM - LOG.sink, 0);
        group.add(knot);

        group.updateMatrixWorld(true);

        let left = PIECES;
        const plateSpot = plateMesh.getWorldPosition(new THREE.Vector3());
        const plate = {
            spot: plateSpot,
            get left() { return left; },
            take() {
                if (left === 0) return null;
                cubes[--left].visible = false;
                return true;
            },
            refill() { left = PIECES; cubes.forEach((c) => { c.visible = true; }); },
        };

        this.worker = new Worker(scene, group, this.laptop);
        const head = this.worker.rig.jointPosition('neck', new THREE.Vector3());
        this.eater = new Eater(scene, group, plate, head);
        this.pet = new Pet(scene, group);
    }

    setNight(night) {
        this.laptop.setNight(night);
    }

    update(dt, climber) {
        this.worker.update(dt, climber);
        this.eater.update(dt, climber);
        this.pet.update(dt, climber);
    }
}
