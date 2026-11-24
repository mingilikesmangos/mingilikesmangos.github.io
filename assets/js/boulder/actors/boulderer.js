import * as THREE from 'three';
import { Character, DIM, POSES, gait, flexPump } from '../rig.js';
import { floorHeight } from '../world.js';
import { mulberry32 } from '../noise.js';

// ---------------------------------------------------------------------------
// A person at the crag. Runs a script of steps (walk, chalk up, climb a
// problem, fall, top out, take the fixed rope down, spot someone...).
// Scripts are built with attemptScript() and handed over with setScript().
// ---------------------------------------------------------------------------

export const V = (x, z) => new THREE.Vector3(x, 0, z);

/** The two problems on the boulder. Hold indices refer to world.holds[name]. */
export function makeProblems(world) {
    return {
        overhang: {
            holds: world.holds.overhang,
            mount: V(2.55, -0.08), face: [-1, 0],
            start: { rArm: 0, lArm: 1, rLeg: 2, lLeg: 3 },
            beta: [
                ['rArm', 4], ['lArm', 5],
                ['lLeg', 6], ['rLeg', 7],
                ['chalk', 'lArm'],
                ['rArm', 8], ['lArm', 9],
                ['rLeg', 10], ['lLeg', 6],
                ['rArm', 11, { dz: -0.07 }],
                ['lArm', 11, { dz: 0.08 }],
            ],
            crux: 5,                       // beta index of the move people come off on
            lip: 11,
            press: { rArm: [2.15, -0.3], lArm: [2.15, 0.1] },
            land: V(1.95, -0.1), landFace: [-1, 0],
        },
        slab: {
            holds: world.holds.slab,
            mount: V(-3.55, 0.05), face: [1, 0],
            start: { rArm: 0, lArm: 1, lLeg: [2, { dz: -0.1 }], rLeg: [2, { dz: 0.1 }] },
            beta: [
                ['rArm', 3],
                ['rLeg', 5], ['lLeg', 0, { dz: -0.08 }],
                ['lArm', 4],
                ['rArm', 6],
                ['lLeg', 1], ['rLeg', 3],
            ],
            crux: 0,
            lip: 6,
            press: { lArm: [-1.45, -0.25], rArm: [-1.45, 0.15] },
            land: V(-1.0, 0), landFace: [1, 0],
        },
    };
}

const WALK_SPEED = 0.95;
const HAND_OUT = 0.07;
const LIMBS = ['lArm', 'rArm', 'lLeg', 'rLeg'];
const ROPE_STEP = 0.3;

const EXTRA_POSES = {
    mantle: {
        spine: [0.55, 0, 0], neck: [-0.3, 0, 0],
        lLegUpper: [-1.5, 0, 0.15], lLegLower: [1.7, 0, 0],
        rLegUpper: [-0.2, 0, -0.05], rLegLower: [0.5, 0, 0],
    },
    shake: { ...POSES.stand, neck: [0.15, 0, 0] },
    land: {   // absorbing a short drop
        spine: [0.35, 0, 0], neck: [-0.2, 0, 0],
        lLegUpper: [-1.0, 0, 0.12], rLegUpper: [-1.0, 0, -0.12],
        lLegLower: [1.5, 0, 0], rLegLower: [1.5, 0, 0],
        lArmUpper: [-0.6, 0, 0.35], rArmUpper: [-0.6, 0, -0.35],
        lArmLower: [-0.4, 0, 0], rArmLower: [-0.4, 0, 0],
    },
    bend: {   // reaching down to the ground / into the chalk bucket
        spine: [0.65, 0, 0], neck: [-0.35, 0, 0],
        lLegUpper: [-0.45, 0, 0.08], rLegUpper: [-0.45, 0, -0.08],
        lLegLower: [0.8, 0, 0], rLegLower: [0.8, 0, 0],
        lArmUpper: [-0.55, 0, 0.12], rArmUpper: [-0.55, 0, -0.12],
        lArmLower: [-0.25, 0, 0], rArmLower: [-0.25, 0, 0],
    },
    spot: {
        ...POSES.spot,
        lLegUpper: [-0.25, 0, 0.12], rLegUpper: [-0.25, 0, -0.12],
        lLegLower: [0.45, 0, 0], rLegLower: [0.45, 0, 0],
    },
    catch: {
        neck: [-0.15, 0, 0], spine: [0.25, 0, 0],
        lLegUpper: [-0.25, 0, 0.12], rLegUpper: [-0.25, 0, -0.12],
        lLegLower: [0.45, 0, 0], rLegLower: [0.45, 0, 0],
        lArmUpper: [-1.4, 0, 0.2], rArmUpper: [-1.4, 0, -0.2],
        lArmLower: [-0.3, 0, 0], rArmLower: [-0.3, 0, 0],
    },
};
const pose = (name) => EXTRA_POSES[name] || POSES[name];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _hc = new THREE.Vector3(), _fc = new THREE.Vector3(), _out = new THREE.Vector3();
const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _left = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

function ease(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

export function yawQuat(dx, dz, out = new THREE.Quaternion()) {
    return out.setFromAxisAngle(Y, Math.atan2(dx, dz));
}

/**
 * One go on a problem, start to finish.
 *   chalk: 'bag' (chalk bag on the hip), 'bucket' (walks to the bucket) or 'none'
 *   home / homeFace / homePath: where to walk back to afterwards
 */
export function attemptScript(person, problem, { fail, chalk = 'bag', home, homeFace, homePath = [], flex = false, rand = Math.random }) {
    const r = rand;
    const rope = person.rope;
    const q = [];
    if (chalk === 'bag') {
        q.push(
            { do: 'idle', pose: 'handsOnHips', dur: 1.6 + r() },
            { do: 'idle', pose: 'chalkDip', dur: 1.8, rub: true },
        );
    } else if (chalk === 'bucket') {
        const b = person.world.chalkBucket;
        const spot = V(b.x, b.z).add(V(-0.4, 0.15));
        q.push(
            { do: 'idle', pose: 'handsOnHips', dur: 1.0 + r() },
            { do: 'walk', to: spot, face: [b.x - spot.x, b.z - spot.z] },
            { do: 'idle', pose: 'bend', dur: 1.4, crouch: 0.12, dip: true },
            { do: 'idle', pose: 'clap', dur: 1.4, rub: true, rubOnly: true },
        );
    }
    q.push(
        { do: 'idle', pose: 'lookUp', dur: 1.2 + r() * 0.6 },
        { do: 'walk', to: problem.mount, face: problem.face },
        { do: 'mount', problem, dur: 1.3 },
        { do: 'climb', problem, failAt: fail ? problem.crux : null, chalk: chalk === 'bag' },
    );
    if (fail) {
        q.push(
            { do: 'air' },
            { do: 'impact' },
            { do: 'getUp' },
            { do: 'idle', pose: 'shake', dur: 2.0 },
            { do: 'idle', pose: 'lookUp', dur: 1.0 },
        );
    } else {
        const top = rope.at(rope.sEdge - 0.4, new THREE.Vector3());
        q.push(
            { do: 'mantle', problem, dur: 2.4 },
            flex
                // turn round to the friends below and pump a fist with them
                ? { do: 'summit', dur: 3.2, descent: true, flex: true, face: [-problem.landFace[0], -problem.landFace[1]] }
                : { do: 'summit', dur: 2.0, descent: true },
            // wait looking down the rope, then turn round to face the rock and go down
            { do: 'walk', to: V(top.x, top.z), face: [rope.dir.x, rope.dir.z], top: true, descent: true },
            { do: 'ropeWait', top: true, descent: true },
            { do: 'idle', pose: 'stand', dur: 0.9, top: true, face: [-rope.dir.x, -rope.dir.z], descent: true },
            { do: 'ropeOn', dur: 1.5, descent: true },
            { do: 'ropeDown', descent: true },
            { do: 'stepOff', dur: 1.0, descent: true },
            { do: 'idle', pose: 'clap', dur: 0.8, clap: true },
            ...homePath.map((to) => ({ do: 'walk', to, through: true })),
        );
    }
    if (home) q.push({ do: 'walk', to: home, face: homeFace || [-1, 0] });
    return q;
}

export class Boulderer {
    constructor(scene, world, { look, home, face = [-1, 0], fx = null, seed = 7 }) {
        this.rig = new Character(look);
        this.look = look;
        this.hasChalkBag = look.chalkBag != null;
        scene.add(this.rig.root);
        this.world = world;
        this.rope = world.rope;
        this.fx = fx;
        this.rand = mulberry32(seed);
        this.home = home.clone();
        this.homeFace = face;

        this.pos = home.clone();
        this.pos.y = floorHeight(this.pos.x, this.pos.z) + DIM.hipHeight;
        this.quat = yawQuat(face[0], face[1]);
        this.rig.root.position.copy(this.pos);
        this.rig.root.quaternion.copy(this.quat);
        this.rig.setPose(POSES.stand);
        this.rig.snapToPose();

        // wall contacts: limb -> { hold: {pos, normal}, pos (current target), from, to, t, dur }
        this.contacts = {};
        this.walkPhase = 0;
        this.vel = new THREE.Vector3();
        this.onWall = false;
        this.queue = [];
        this.onDone = null;
        this.step = { do: 'idle', pose: 'stand', dur: 1e9, t: 0 };
    }

    /** Replace whatever the person is doing with a new list of steps. */
    setScript(steps, onDone = null) {
        this.queue = steps.slice();
        this.onDone = onDone;
        this.next();
    }

    next() {
        if (!this.queue.length) {
            const f = this.onDone;
            this.onDone = null;
            if (f) { f(this); if (this.queue.length || this.step.t === 0) return; }
            this.queue.push({ do: 'idle', pose: 'stand', dur: 1e9 });
        }
        this.step = this.queue.shift();
        this.step.t = 0;
        const s = this.step;
        const rig = this.rig;
        switch (s.do) {
            case 'idle':
                rig.setPose(pose(s.pose), 6);
                break;
            case 'walk':
                rig.setPose(POSES.stand, 14);
                break;
            case 'spot':
                this.spotMode = null;
                break;
            case 'mount':
                this.beginMount(s.problem);
                break;
            case 'climb':
                this.beta = s.problem.beta.filter((m) => m[0] !== 'chalk' || s.chalk);
                this.betaIndex = -1;
                this.failIndex = s.failAt == null ? null : this.beta.indexOf(s.problem.beta[s.failAt]);
                this.pause = 0.5;
                this.chalking = null;
                break;
            case 'air': {
                // peel off: push away from the wall and fall
                const out = this.wallOut(_a);
                this.vel.set(out.x, 0, out.z).normalize().multiplyScalar(0.9);
                this.vel.y = 0.25;
                this.dropHeight = this.pos.y - floorHeight(this.pos.x, this.pos.z);
                for (const l of LIMBS) this.release(l);
                this.onWall = false;
                rig.setPose(POSES.fall, 9);
                break;
            }
            case 'impact':
                s.big = this.dropHeight > 1.25;
                s.dur = s.big ? 1.5 : 0.7;
                rig.setPose(pose(s.big ? 'sitBack' : 'land'), 14);
                this.fx?.spawn(_a.copy(this.pos).add(_b.set(0, -0.12, 0)), s.big ? 14 : 4, 0.35, 0.5);
                break;
            case 'getUp':
                s.dur = this.dropHeight > 1.25 ? 0.9 : 0.5;
                rig.setPose(POSES.stand, 5);
                this.getUpFrom = this.pos.y;
                break;
            case 'mantle':
                this.beginMantle(s.problem);
                break;
            case 'summit':
                rig.setPose(s.flex ? POSES.stand : POSES.armsUp, 7);
                break;
            case 'ropeWait':
                rig.setPose(POSES.handsOnHips, 4);
                break;
            case 'ropeOn':
                this.rope.user = this;
                this.beginRope();
                break;
            case 'ropeDown':
                this.ropeOrder = ['rLeg', 'lLeg', 'rArm', 'lArm'];
                this.pause = 0.2;
                break;
            case 'stepOff': {
                for (const l of LIMBS) this.release(l);
                this.onWall = false;
                const rope = this.rope;
                const g = rope.at(rope.length, new THREE.Vector3()).addScaledVector(rope.side, 0.4).addScaledVector(rope.dir, -0.1);
                this.stepFrom = this.pos.clone();
                this.stepFromQ = this.quat.clone();
                this.stepTo = new THREE.Vector3(g.x, floorHeight(g.x, g.z) + DIM.hipHeight, g.z);
                rig.setPose(POSES.stand, 6);
                break;
            }
            default:
                this.beginStep(s);
        }
    }

    // ---------------- contacts ----------------

    holdTarget(limb, hold, opt = {}) {
        const p = hold.pos.clone();
        if (limb.endsWith('Arm')) {
            p.addScaledVector(hold.normal, HAND_OUT);
        } else {
            // the ankle sits behind and above the toe that touches the hold
            const outH = _c.set(hold.normal.x, 0, hold.normal.z).normalize();
            p.addScaledVector(hold.normal, 0.04).addScaledVector(outH, 0.13);
            p.y += 0.05;
        }
        if (opt.dz) p.z += opt.dz;
        return p;
    }

    grab(limb, hold, opt, dur, delay = 0) {
        const to = this.holdTarget(limb, hold, opt);
        const c = this.contacts[limb];
        const from = c ? c.pos.clone() : this.rig.endPosition(limb, new THREE.Vector3());
        this.contacts[limb] = { hold, pos: from.clone(), from, to, t: -delay, dur };
        this.rig.limbs[limb].target = this.contacts[limb].pos;
    }

    release(limb) {
        delete this.contacts[limb];
        this.rig.limbs[limb].target = null;
        this.rig.limbs[limb].footDir = null;
    }

    wallOut(out) {
        out.set(0, 0, 0);
        for (const c of Object.values(this.contacts)) out.add(c.hold.normal);
        if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
        return out.normalize();
    }

    /** Where the pelvis wants to be and how it is oriented, given the contacts. */
    bodyGoal(outPos, outQuat) {
        const hands = [], feet = [];
        for (const [l, c] of Object.entries(this.contacts)) (l.endsWith('Arm') ? hands : feet).push(c.pos);
        const avg = (list, v) => { v.set(0, 0, 0); list.forEach((p) => v.add(p)); return v.divideScalar(list.length); };
        const out = this.wallOut(_out);
        const hc = hands.length ? avg(hands, _hc) : null;
        if (hc && feet.length) {
            const fc = avg(feet, _fc);
            outPos.copy(fc).lerp(hc, 0.4).addScaledVector(out, 0.36);
            _up.subVectors(hc, fc).add(_fwd.set(0, 0.35, 0)).normalize();
        } else if (hc) {
            outPos.copy(hc).addScaledVector(Y, -1.02).addScaledVector(out, 0.12);
            _up.set(0, 1, 0);
        } else {
            return false;
        }
        outPos.y = Math.max(outPos.y, floorHeight(outPos.x, outPos.z) + 0.16);
        _fwd.copy(out).negate().addScaledVector(_up, out.dot(_up)).normalize();
        _left.crossVectors(_up, _fwd).normalize();
        _fwd.crossVectors(_left, _up);
        _m.makeBasis(_left, _up, _fwd);
        outQuat.setFromRotationMatrix(_m);
        return true;
    }

    updatePoles() {
        const rig = this.rig;
        rig.root.updateMatrixWorld();
        const e = rig.root.matrixWorld.elements;
        const left = _a.set(e[0], e[1], e[2]);
        const up = _b.set(e[4], e[5], e[6]);
        const out = this.wallOut(_c);
        for (const l of LIMBS) {
            const limb = rig.limbs[l];
            const c = this.contacts[l];
            if (!c) continue;
            const side = l[0] === 'l' ? 1 : -1;
            if (l.endsWith('Arm')) {
                limb.pole.copy(up).multiplyScalar(-0.8).addScaledVector(left, side * 0.5).addScaledVector(out, 0.4);
            } else {
                limb.pole.copy(left).multiplyScalar(side * 0.75).addScaledVector(up, 0.35).addScaledVector(out, 0.25);
                if (Math.abs(c.hold.normal.y) < 0.95) {
                    limb.footDir = (limb.footDir || new THREE.Vector3()).set(-c.hold.normal.x, 0, -c.hold.normal.z).normalize();
                }
            }
        }
    }

    advanceContacts(dt, bump = 0.15) {
        const out = this.wallOut(_b);
        let moving = false;
        for (const c of Object.values(this.contacts)) {
            if (c.t >= c.dur) continue;
            c.t += dt;
            const k = ease(c.t / c.dur);
            c.pos.lerpVectors(c.from, c.to, k).addScaledVector(out, bump * Math.sin(Math.PI * k));
            if (c.t < c.dur) moving = true;
            else if (c.puff) this.fx?.spawn(c.pos, 2, 0.08, 0.2);   // chalk off the hand as it latches
        }
        return moving;
    }

    followWall(dt, rate = 3.5) {
        if (!this.bodyGoal(_a, _q)) return;
        const k = 1 - Math.exp(-dt * rate);
        this.pos.lerp(_a, k);
        this.quat.slerp(_q, k);
    }

    // ---------------- per-step update ----------------

    // Subclass hooks: extra step kinds, and per-frame work before the rig is solved.
    beginStep() {}
    updateStep() { return true; }
    beforeRig() {}

    update(dt) {
        const s = this.step;
        s.t += dt;
        const rig = this.rig;
        let done = false;

        switch (s.do) {
            case 'idle':
                this.settle(dt, s.top, s.crouch || 0);
                if (s.rub && (s.rubOnly || s.t / s.dur > 0.45)) {
                    // rub the chalk in between the hands
                    rig.setPose(POSES.clap, 8);
                    const w = Math.sin(s.t * 18) * 0.18;
                    rig.setJoint('lArmLower', -1.0 + w, 0, 0);
                    rig.setJoint('rArmLower', -1.0 - w, 0, 0);
                    if (this.rand() < dt * 2.5) this.puffAt(this.rand() < 0.5 ? 'lArm' : 'rArm', 1);
                } else if (s.rub && s.t > 0.7 && !s.dipped) {
                    s.dipped = true;
                    this.puffAt('rArm', 3);
                } else if (s.dip && s.t > 0.6 && !s.dipped) {
                    s.dipped = true;
                    this.puffAt('lArm', 4); this.puffAt('rArm', 4);
                } else if (s.clap && s.t > 0.35 && !s.clapped) {
                    s.clapped = true;
                    this.puffAt('lArm', 5);
                } else if (s.pose === 'shake') {
                    const w = Math.sin(s.t * 30);
                    rig.setJoint('lArmUpper', 0.05, 0, 0.25 + 0.12 * w);
                    rig.setJoint('rArmUpper', 0.05, 0, -0.25 - 0.12 * w);
                    rig.setJoint('lArmLower', -0.2 + 0.25 * w, 0, 0);
                    rig.setJoint('rArmLower', -0.2 - 0.25 * w, 0, 0);
                }
                if (s.face) this.quat.slerp(yawQuat(s.face[0], s.face[1], _q), 1 - Math.exp(-dt * 6));
                done = s.t >= s.dur;
                break;
            case 'walk':
                done = this.walk(dt, s);
                break;
            case 'spot':
                this.updateSpot(dt, s);
                break;
            case 'mount':
            case 'ropeOn':
                done = this.updateMount(dt);
                break;
            case 'climb':
                done = this.updateClimb(dt);
                break;
            case 'air': {
                this.vel.y -= 9.8 * dt;
                this.pos.addScaledVector(this.vel, dt);
                // turn upright, keep the heading
                const f = _a.set(0, 0, 1).applyQuaternion(this.quat);
                this.quat.slerp(yawQuat(f.x, f.z, _q), 1 - Math.exp(-dt * 6));
                const floor = floorHeight(this.pos.x, this.pos.z);
                const stop = this.dropHeight > 1.25 ? 0.55 : DIM.hipHeight - 0.15;
                if (this.vel.y < 0 && this.pos.y <= floor + stop) done = true;
                break;
            }
            case 'impact': {
                const floor = floorHeight(this.pos.x, this.pos.z) + (s.big ? 0.17 : DIM.hipHeight - 0.32);
                this.pos.y += (floor - this.pos.y) * (1 - Math.exp(-dt * 18));
                const f = _a.set(0, 0, 1).applyQuaternion(this.quat);
                this.quat.slerp(yawQuat(f.x, f.z, _q), 1 - Math.exp(-dt * 10));
                if (s.big && s.t > 0.8) rig.setJoint('neck', 0.35, 0.3 * Math.sin(s.t * 3), 0);   // shake the head
                done = s.t >= s.dur;
                break;
            }
            case 'getUp': {
                const k = ease(s.t / s.dur);
                this.pos.y = THREE.MathUtils.lerp(this.getUpFrom, floorHeight(this.pos.x, this.pos.z) + DIM.hipHeight, k);
                done = s.t >= s.dur;
                break;
            }
            case 'mantle':
                done = this.updateMantle(dt);
                break;
            case 'summit':
                this.settle(dt, true);
                if (s.flex) {
                    this.quat.slerp(yawQuat(s.face[0], s.face[1], _q), 1 - Math.exp(-dt * 5));
                    if (s.t > 0.5) {
                        flexPump(rig, s.t, 'r');
                        rig.setJoint('neck', -0.15, 0, 0);
                    }
                } else if (s.t > 0.6) {
                    const b = Math.abs(Math.sin(s.t * 6));
                    rig.setJoint('lArmLower', -0.2 - 0.5 * b, 0, 0);
                    rig.setJoint('rArmLower', -0.2 - 0.5 * b, 0, 0);
                }
                done = s.t >= s.dur;
                break;
            case 'ropeWait':
                this.settle(dt, true);
                done = s.t > 0.5 && (!this.rope.user || this.rope.user === this);
                if (done) this.rope.user = this;   // claim it before turning round
                break;
            case 'ropeDown':
                done = this.updateRopeDown(dt);
                break;
            case 'stepOff': {
                const k = ease(s.t / s.dur);
                this.pos.lerpVectors(this.stepFrom, this.stepTo, k);
                this.pos.y += 0.12 * Math.sin(Math.PI * k);
                this.quat.slerpQuaternions(this.stepFromQ, yawQuat(this.rope.dir.x, this.rope.dir.z, _q), k);
                done = s.t >= s.dur;
                if (done && this.rope.user === this) this.rope.user = null;
                break;
            }
            default:
                done = this.updateStep(dt, s);
        }

        rig.root.position.copy(this.pos);
        rig.root.quaternion.copy(this.quat);
        if (this.onWall) this.updatePoles();
        this.beforeRig(dt);
        rig.update(dt);
        if (done) {
            if (s.onEnd) s.onEnd(this);
            this.next();
        }
    }

    puffAt(limb, n) {
        if (this.fx) this.fx.spawn(this.rig.endPosition(limb, _c), n);
    }

    groundAt(x, z, top) {
        if (top) {
            const hit = this.world.rockSurface(x, z);
            if (hit) return hit.point.y;
        }
        return floorHeight(x, z);
    }

    settle(dt, top = false, crouch = 0) {
        const goal = this.groundAt(this.pos.x, this.pos.z, top) + DIM.hipHeight - crouch;
        this.pos.y += (goal - this.pos.y) * (1 - Math.exp(-dt * 10));
    }

    walk(dt, s) {
        const rig = this.rig;
        const d = _a.subVectors(s.to, this.pos); d.y = 0;
        const dist = d.length();
        if (dist < (s.through ? 0.08 : 0.03)) {
            if (s.through) return true;
            this.quat.slerp(yawQuat(s.face[0], s.face[1], _q), 1 - Math.exp(-dt * 8));
            rig.setPose(POSES.stand, 10);
            this.settle(dt, s.top);
            return this.quat.angleTo(_q) < 0.05;
        }
        const step = Math.min(dist, (s.speed || WALK_SPEED) * dt);
        d.divideScalar(dist);
        this.pos.addScaledVector(d, step);
        this.quat.slerp(yawQuat(d.x, d.z, _q), 1 - Math.exp(-dt * 9));
        this.walkPhase += (step / 0.75) * Math.PI * 2;
        const fade = s.through ? 1 : Math.min(1, dist / 0.25);
        const bob = gait(rig, this.walkPhase, fade, !this.armsBusy);
        this.pos.y = this.groundAt(this.pos.x, this.pos.z, s.top) + DIM.hipHeight - 0.03 + 0.035 * bob;
        return false;
    }

    // ---------------- spotting someone else ----------------

    updateSpot(dt, s) {
        const c = s.who;
        const mode = c.falling ? 'catch' : c.flexing ? 'cheer' : c.climbing ? 'spot' : 'rest';
        const rig = this.rig;
        // stand under the climber's hips a step back from the wall, or wait at home
        const goal = mode === 'cheer' ? _c.copy(this.pos)
            : mode === 'rest' ? this.home
            : _c.set(THREE.MathUtils.clamp(c.pos.x + 0.85, 3.25, 3.7), 0, THREE.MathUtils.clamp(c.pos.z - 0.75, -1.1, -0.5));
        const d = _a.subVectors(goal, this.pos); d.y = 0;
        const dist = d.length();
        const speed = Math.min(WALK_SPEED, dist * 2.5);
        rig.setPose(pose(mode === 'rest' ? 'handsOnHips' : mode === 'cheer' ? 'stand' : mode), mode === 'catch' ? 9 : 5);
        if (mode === 'cheer' && c.step.t > 0.7) flexPump(rig, c.step.t, 'r');
        let bob = 0;
        if (dist > 0.04) {
            d.divideScalar(dist);
            const step = speed * dt;
            this.pos.addScaledVector(d, step);
            this.walkPhase += (step / 0.75) * Math.PI * 2;
            bob = gait(rig, this.walkPhase, Math.min(1, speed / 0.5), false);
        }
        const crouch = mode === 'rest' || mode === 'cheer' ? 0 : 0.07;
        const floor = floorHeight(this.pos.x, this.pos.z) + DIM.hipHeight - crouch + 0.03 * bob;
        this.pos.y += (floor - this.pos.y) * (1 - Math.exp(-dt * 8));
        // face along the walk when going somewhere, else face the climber
        const dx = c.pos.x - this.pos.x, dz = c.pos.z - this.pos.z;
        if (dist > 0.4) yawQuat(d.x, d.z, _q); else yawQuat(dx, dz, _q);
        this.quat.slerp(_q, 1 - Math.exp(-dt * 5));
        const up = Math.atan2(c.pos.y + 0.3 - (this.pos.y + 0.75), Math.hypot(dx, dz));
        rig.setJoint('neck', -THREE.MathUtils.clamp(up, -0.2, 0.7), 0, 0);
    }

    // ---------------- mount / climb ----------------

    beginMount(problem) {
        this.onWall = true;
        const r = this.rand;
        for (const [l, v] of Object.entries(problem.start)) {
            const [i, opt] = Array.isArray(v) ? v : [v, {}];
            this.grab(l, problem.holds[i], opt, 0.9 + r() * 0.3, l.endsWith('Leg') ? 0.4 : 0);
        }
        this.mountFrom = this.pos.clone();
        this.mountQuat = this.quat.clone();
        this.rig.setPose(POSES.lookUp, 6);
    }

    /** Ease from standing into the pose the current contacts imply. */
    updateMount(dt) {
        const s = this.step;
        this.advanceContacts(dt, 0.08);
        this.bodyGoal(_a, _q);
        const k = ease(s.t / s.dur);
        this.pos.lerpVectors(this.mountFrom, _a, k);
        this.quat.slerpQuaternions(this.mountQuat, _q, k);
        return s.t >= s.dur + 0.2;
    }

    updateClimb(dt) {
        const rig = this.rig, s = this.step;
        const moving = this.advanceContacts(dt);
        this.followWall(dt);

        if (this.chalking != null) {
            this.chalking -= dt;
            if (this.chalking < 0.5 && !this.chalkPuffed) { this.chalkPuffed = true; this.puffAt(this.chalkReturn[0], 4); }
            if (this.chalking <= 0) {
                const [limb, hold] = this.chalkReturn;
                this.grab(limb, hold, {}, 0.6);
                this.chalking = null;
                rig.setPose(POSES.lookUp, 6);
                this.pause = 0.9;
            }
            return false;
        }
        // the crux move: the hand slips off just before it latches
        if (this.failIndex != null && this.betaIndex === this.failIndex) {
            const c = this.contacts[this.moveLimb];
            if (c && c.t / c.dur > 0.6) return true;
        }
        if (moving) return false;
        this.pause -= dt;
        if (this.pause > 0) return false;
        if (!this.beta.length) return true;

        const [limb, idx, opt] = this.beta.shift();
        this.betaIndex++;
        if (limb === 'chalk') {
            // let go with one hand and dip into the chalk bag
            const c = this.contacts[idx];
            this.chalkReturn = [idx, c.hold];
            this.release(idx);
            const p = { ...POSES.lookUp };
            if (idx === 'lArm') { p.lArmUpper = [0.7, 0, 0.35]; p.lArmLower = [-1.3, 0, 0]; }
            else { p.rArmUpper = [0.7, 0, -0.35]; p.rArmLower = [-1.3, 0, 0]; }
            rig.setPose(p, 7);
            this.chalking = 1.6;
            this.chalkPuffed = false;
            return false;
        }
        const big = limb.endsWith('Arm');
        this.moveLimb = limb;
        const slow = this.betaIndex === this.failIndex ? 0.5 : 0;
        this.grab(limb, s.problem.holds[idx], opt || {}, (big ? 0.9 : 0.75) + slow + this.rand() * 0.35);
        this.contacts[limb].puff = big;
        this.pause = 0.25 + this.rand() * (big ? 0.9 : 0.4);
        return false;
    }

    // ---------------- top out ----------------

    beginMantle(problem) {
        const lip = problem.holds[problem.lip];
        const outH = new THREE.Vector3(lip.normal.x, 0, lip.normal.z).normalize();
        const top = this.world.rockSurface(problem.land.x, problem.land.z);
        this.m = {
            P0: this.pos.clone(),
            Q0: this.quat.clone(),
            P1: lip.pos.clone().addScaledVector(outH, 0.3).add(_b.set(0, 0.1, 0)),
            P2: new THREE.Vector3(problem.land.x, (top ? top.point.y : 3.7) + DIM.hipHeight, problem.land.z),
            Q2: yawQuat(problem.landFace[0], problem.landFace[1]),
            handsOff: false,
        };
        // feet come off, hands walk onto the top and press
        for (const l of ['lLeg', 'rLeg']) this.release(l);
        const normal = outH.clone().multiplyScalar(0.3).add(Y).normalize();
        for (const [limb, [x, z]] of Object.entries(problem.press)) {
            const hit = this.world.rockSurface(x, z);
            this.grab(limb, { pos: hit ? hit.point.clone() : lip.pos.clone(), normal }, {}, 0.5, limb === 'rArm' ? 0.2 : 0.45);
        }
        this.rig.setPose(EXTRA_POSES.mantle, 6);
    }

    updateMantle(dt) {
        const s = this.step, m = this.m;
        const k = s.t / s.dur;
        this.advanceContacts(dt, 0.12);
        const e = ease(k);
        // quadratic Bezier: out from the wall, up past the lip, onto the top
        this.pos.set(0, 0, 0)
            .addScaledVector(m.P0, (1 - e) * (1 - e))
            .addScaledVector(m.P1, 2 * (1 - e) * e)
            .addScaledVector(m.P2, e * e);
        this.quat.slerpQuaternions(m.Q0, m.Q2, ease(k * 1.3));
        if (k > 0.72 && !m.handsOff) {
            m.handsOff = true;
            for (const l of ['lArm', 'rArm']) this.release(l);
            this.onWall = false;
            this.rig.setPose(POSES.stand, 5);
        }
        return k >= 1;
    }

    // ---------------- rope descent ----------------

    /** Hands hold the rope; feet stand on the rock beside it. */
    ropePoint(limb, d) {
        const rope = this.rope;
        const n = new THREE.Vector3(), surf = new THREE.Vector3();
        const p = rope.at(d, new THREE.Vector3(), n, surf);
        if (limb.endsWith('Leg')) {
            p.copy(surf).addScaledVector(rope.side, limb === 'lLeg' ? -0.14 : 0.14);
        } else {
            p.addScaledVector(rope.side, limb === 'lArm' ? -0.03 : 0.03);
        }
        return { pos: p, normal: n };
    }

    beginRope() {
        this.onWall = true;
        const e = this.rope.sEdge;
        this.ropeS = { rArm: e - 0.1, lArm: e - 0.3, rLeg: e + 0.55, lLeg: e + 0.75 };
        for (const l of LIMBS) {
            this.grab(l, this.ropePoint(l, this.ropeS[l]), {}, 0.8, l.endsWith('Leg') ? 0.5 : 0);
        }
        this.mountFrom = this.pos.clone();
        this.mountQuat = this.quat.clone();
        this.rig.setPose({ ...POSES.stand, neck: [0.45, 0, 0] }, 5);   // look down past the feet
    }

    updateRopeDown(dt) {
        const moving = this.advanceContacts(dt, 0.08);
        this.followWall(dt, 4);
        if (moving) return false;
        this.pause -= dt;
        if (this.pause > 0) return false;
        const S = this.ropeS, bottom = this.rope.sBottom;
        if (Math.max(S.lLeg, S.rLeg) >= bottom - 0.05) return true;
        const limb = this.ropeOrder[0];
        this.ropeOrder.push(this.ropeOrder.shift());
        const other = { lArm: 'rArm', rArm: 'lArm', lLeg: 'rLeg', rLeg: 'lLeg' }[limb];
        // hands stay above the feet, feet stop at the last foothold
        const limit = limb.endsWith('Arm') ? Math.min(S.lLeg, S.rLeg) - 0.55 : bottom;
        const goal = Math.min(S[other] + ROPE_STEP, limit);
        if (goal > S[limb] + 0.02) {
            S[limb] = goal;
            this.grab(limb, this.ropePoint(limb, S[limb]), {}, 0.42 + this.rand() * 0.15);
            this.pause = 0.05 + this.rand() * 0.12;
        }
        return false;
    }

    // ---------------- state for the others ----------------

    /** Something worth cheering for. */
    get sent() {
        const s = this.step;
        return s.do === 'summit' || (s.do === 'mantle' && s.t > 1.8);
    }

    /** Topped out and turning round to celebrate with the group. */
    get flexing() {
        const s = this.step;
        return s.do === 'summit' && !!s.flex;
    }

    get falling() {
        return this.step.do === 'air' || (this.step.do === 'impact' && this.step.big);
    }

    /** On top or coming down the rope. */
    get descending() {
        return !!this.step.descent;
    }

    get climbing() {
        return this.onWall && !this.step.descent;
    }

    get pelvis() {
        return this.pos;
    }
}
