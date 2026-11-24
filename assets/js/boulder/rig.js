import * as THREE from 'three';
import { toon } from './world.js';

// ---------------------------------------------------------------------------
// Blocky, slightly big-headed character rig.
//
// The root is the pelvis. The character faces local +z; its left side is +x.
// Every limb is two joints (upper/lower). A limb is either posed by forward
// kinematics (joint targets, eased with slerp) or pinned to a world-space
// target by analytic two-bone IK. Releasing an IK target eases the limb back
// into its FK pose, so transitions never pop.
// ---------------------------------------------------------------------------

export const DIM = {
    hipHeight: 0.835,    // pelvis height when standing straight
    upperArm: 0.29,
    foreArm: 0.28,       // elbow -> hand centre
    thigh: 0.36,
    shin: 0.36,          // knee -> ankle
    ankle: 0.065,        // ankle height above the floor
};

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();

function part(w, h, d, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

function joint(parent, x, y, z) {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
}

// 3x5 lowercase pixel glyphs for printing on shirts.
const GLYPHS = {
    a: ['...', '.11', '1.1', '1.1', '.11'],
    b: ['1..', '11.', '1.1', '1.1', '11.'],
    e: ['.1.', '1.1', '111', '1..', '.11'],
    t: ['.1.', '111', '.1.', '.1.', '.11'],
    d: ['..1', '.11', '1.1', '1.1', '.11'],
    l: ['11.', '.1.', '.1.', '.1.', '.11'],
    v: ['1.1', '1.1', '1.1', '.1.', '.1.'],
    3: ['111', '..1', '.11', '..1', '111'],
};

function shirtBackTexture(shirtHex, inkHex, text) {
    const W = 17, H = 22;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
    g.fillStyle = hex(shirtHex);
    g.fillRect(0, 0, W, H);
    g.fillStyle = hex(inkHex);
    text.split('\n').forEach((line, li) => {      // '\n' starts a new line
        let x0 = Math.floor((W - (line.length * 4 - 1)) / 2);
        for (const ch of line) {
            const glyph = GLYPHS[ch];
            if (glyph) {
                glyph.forEach((row, y) => {
                    [...row].forEach((px, x) => { if (px === '1') g.fillRect(x0 + x, 5 + li * 7 + y, 1, 1); });
                });
            }
            x0 += 4;
        }
    });
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export class Character {
    /**
     * look: { skin, shirt, sleeves?, shorts, legs?, shoes, hair, beanie?, beanieBand?, backText?, chalkBag? }
     *   legs: colour of the shins (skin for shorts, fabric for trousers)
     */
    constructor(look) {
        const mat = (hex) => toon({ color: hex });
        const skin = mat(look.skin);
        const shirt = mat(look.shirt);
        const sleeves = look.sleeves != null ? mat(look.sleeves) : shirt;
        const shorts = mat(look.shorts);
        const legs = look.legs != null ? mat(look.legs) : skin;
        const shoes = mat(look.shoes);
        const hair = mat(look.hair);

        this.root = new THREE.Group();          // pelvis
        this.root.add(part(0.32, 0.18, 0.2, shorts));

        if (look.chalkBag != null) {
            const bag = part(0.12, 0.13, 0.1, mat(look.chalkBag), 0, -0.01, -0.15);
            const rim = part(0.13, 0.03, 0.11, mat(0xeeeae2), 0, 0.065, -0.15);
            this.root.add(bag, rim);
        }

        const spine = joint(this.root, 0, 0.07, 0);
        // torso: +x, -x, +y, -y, +z (chest), -z (back)
        const back = look.backText
            ? toon({ map: shirtBackTexture(look.shirt, look.backInk ?? 0x222222, look.backText) })
            : shirt;
        spine.add(part(0.36, 0.46, 0.21, [shirt, shirt, shirt, shirt, shirt, back], 0, 0.23, 0));

        const neck = joint(spine, 0, 0.47, 0);
        neck.add(part(0.32, 0.31, 0.3, skin, 0, 0.16, 0));
        if (look.beanie != null) {
            neck.add(part(0.34, 0.13, 0.32, mat(look.beanie), 0, 0.33, -0.005));
            neck.add(part(0.35, 0.06, 0.33, mat(look.beanieBand ?? look.beanie), 0, 0.255, -0.005));
            neck.add(part(0.33, 0.1, 0.05, hair, 0, 0.18, -0.15));        // hair peeking out at the back
        } else {
            neck.add(part(0.34, 0.1, 0.32, hair, 0, 0.33, -0.01));
            neck.add(part(0.34, 0.2, 0.08, hair, 0, 0.22, -0.13));
        }

        const arm = (side) => {
            const sh = joint(spine, side * 0.24, 0.41, 0);
            sh.add(part(0.13, 0.14, 0.13, sleeves, 0, -0.05, 0));
            sh.add(part(0.1, 0.17, 0.1, look.sleeves != null ? sleeves : skin, 0, -0.2, 0));
            const el = joint(sh, 0, -DIM.upperArm, 0);
            el.add(part(0.09, 0.22, 0.09, skin, 0, -0.11, 0));
            el.add(part(0.1, 0.1, 0.1, skin, 0, -DIM.foreArm, 0));
            return { upper: sh, lower: el, a: DIM.upperArm, b: DIM.foreArm };
        };
        const leg = (side) => {
            const hip = joint(this.root, side * 0.1, -0.05, 0);
            hip.add(part(0.16, 0.36, 0.17, shorts, 0, -0.17, 0));
            const knee = joint(hip, 0, -DIM.thigh, 0);
            knee.add(part(0.12, 0.33, 0.13, legs, 0, -0.17, 0));
            const ankle = joint(knee, 0, -DIM.shin, 0);
            ankle.add(part(0.13, 0.08, 0.23, shoes, 0, -0.025, 0.05));
            return { upper: hip, lower: knee, a: DIM.thigh, b: DIM.shin, ankle };
        };

        this.joints = { spine, neck };
        this.limbs = { lArm: arm(1), rArm: arm(-1), lLeg: leg(1), rLeg: leg(-1) };
        for (const [name, l] of Object.entries(this.limbs)) {
            this.joints[name + 'Upper'] = l.upper;
            this.joints[name + 'Lower'] = l.lower;
            if (l.ankle) this.joints[name + 'Ankle'] = l.ankle;
            l.target = null;               // world-space IK target (Vector3) or null
            l.pole = new THREE.Vector3();  // world-space bend direction hint
            l.footDir = null;              // legs: world direction the toes should point (with IK)
        }
        // FK targets per joint
        this.fk = {};
        for (const [name, j] of Object.entries(this.joints)) this.fk[name] = new THREE.Quaternion();
        this.fkRate = 10;
    }

    /** Set FK targets. pose: { jointName: [x, y, z] } (radians); missing joints -> rest. */
    setPose(pose, rate = 10) {
        for (const name of Object.keys(this.fk)) {
            const r = pose[name];
            this.fk[name].setFromEuler(r ? _e.set(r[0], r[1], r[2]) : _e.set(0, 0, 0));
        }
        this.fkRate = rate;
    }

    /** Override a single FK joint target (for procedural motion). */
    setJoint(name, x, y, z) {
        this.fk[name].setFromEuler(_e.set(x, y, z));
    }

    snapToPose() {
        for (const [name, j] of Object.entries(this.joints)) j.quaternion.copy(this.fk[name]);
    }

    update(dt) {
        const k = 1 - Math.exp(-dt * this.fkRate);
        const ikJoints = new Set();
        for (const l of Object.values(this.limbs)) {
            if (l.target) {
                ikJoints.add(l.upper); ikJoints.add(l.lower);
                if (l.ankle && l.footDir) ikJoints.add(l.ankle);
            }
        }
        for (const [name, j] of Object.entries(this.joints)) {
            if (!ikJoints.has(j)) j.quaternion.slerp(this.fk[name], k);
        }
        this.root.updateMatrixWorld(true);
        for (const l of Object.values(this.limbs)) {
            if (!l.target) continue;
            solveTwoBone(l, l.target, l.pole);
            if (l.ankle && l.footDir) aimFoot(l.ankle, l.footDir);
        }
        this.root.updateMatrixWorld(true);
    }

    /** World position of a limb's end (hand centre / ankle). */
    endPosition(limbName, out = new THREE.Vector3()) {
        const l = this.limbs[limbName];
        l.lower.updateWorldMatrix(true, false);
        return out.set(0, -l.b, 0).applyMatrix4(l.lower.matrixWorld);
    }

    /** World position of a joint origin (e.g. shoulder). */
    jointPosition(name, out = new THREE.Vector3()) {
        this.joints[name].updateWorldMatrix(true, false);
        return out.setFromMatrixPosition(this.joints[name].matrixWorld);
    }
}

// Orientation whose local -y points along `dir` and local +z leans to `pole`.
function boneQuaternion(dir, pole, out) {
    const y = _v1.copy(dir).negate().normalize();
    const z = _v2.copy(pole).addScaledVector(y, -pole.dot(y));
    if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(y, -y.z);
    z.normalize();
    const x = _v3.crossVectors(y, z).normalize();
    _m.makeBasis(x, y, z);
    return out.setFromRotationMatrix(_m);
}

const _up = new THREE.Vector3(0, 1, 0), _fz = new THREE.Vector3(), _fx = new THREE.Vector3(), _fy = new THREE.Vector3();
const _qa = new THREE.Quaternion();

// Rotate the ankle so the foot's +z points along `dir` (sole roughly down).
function aimFoot(ankle, dir) {
    _fz.copy(dir).normalize();
    _fy.copy(_up).addScaledVector(_fz, -_fz.y);
    if (_fy.lengthSq() < 1e-4) _fy.set(0, 0, 1);
    _fy.normalize();
    _fx.crossVectors(_fy, _fz);
    _m.makeBasis(_fx, _fy, _fz);
    _qa.setFromRotationMatrix(_m);
    ankle.parent.getWorldQuaternion(_q3);
    ankle.quaternion.copy(_q3.invert().multiply(_qa));
}

const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _T = new THREE.Vector3();
const _dir = new THREE.Vector3(), _pn = new THREE.Vector3(), _tmp = new THREE.Vector3();

function solveTwoBone(limb, target, pole) {
    const { upper, lower, a, b } = limb;
    upper.updateWorldMatrix(true, false);
    _S.setFromMatrixPosition(upper.matrixWorld);
    _dir.subVectors(target, _S);
    let d = _dir.length();
    if (d < 1e-5) return;
    _dir.divideScalar(d);
    d = Math.min(Math.max(d, Math.abs(a - b) + 0.02), (a + b) * 0.999);

    _pn.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
    if (_pn.lengthSq() < 1e-6) _pn.set(0, -1, 0).addScaledVector(_dir, _dir.y);
    _pn.normalize();

    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _E.copy(_S).addScaledVector(_dir, a * cosA).addScaledVector(_pn, a * sinA);
    _T.copy(_S).addScaledVector(_dir, d);

    const upperWorld = boneQuaternion(_tmp.subVectors(_E, _S), _pn, _q1);
    const lowerWorld = boneQuaternion(_tmp.subVectors(_T, _E), _pn, _q2);

    upper.parent.getWorldQuaternion(_q3);
    upper.quaternion.copy(_q3.invert().multiply(upperWorld));
    lower.quaternion.copy(upperWorld.clone().invert().multiply(lowerWorld));
}

// ---------------------------------------------------------------------------
// FK poses (radians). Arms hang along -y at rest; +x rotation swings a limb
// backwards, -x forwards. Left limbs are on +x.
// ---------------------------------------------------------------------------

export const POSES = {
    stand: {
        lArmUpper: [0.05, 0, 0.12], rArmUpper: [0.05, 0, -0.12],
        lArmLower: [-0.15, 0, 0], rArmLower: [-0.15, 0, 0],
    },
    lookUp: {
        neck: [-0.4, 0, 0],
        lArmUpper: [0.05, 0, 0.12], rArmUpper: [0.05, 0, -0.12],
        lArmLower: [-0.2, 0, 0], rArmLower: [-0.2, 0, 0],
    },
    handsOnHips: {
        neck: [-0.25, 0, 0],
        lArmUpper: [0.15, 0, 0.7], rArmUpper: [0.15, 0, -0.7],
        lArmLower: [0, 0, -1.5], rArmLower: [0, 0, 1.5],
    },
    chalkDip: {   // right hand into the chalk bag behind the back
        neck: [0.15, 0, 0],
        spine: [0.1, 0, 0],
        lArmUpper: [0.05, 0, 0.15], lArmLower: [-0.3, 0, 0],
        rArmUpper: [0.7, 0, -0.35], rArmLower: [-1.3, 0, 0],
    },
    clap: {
        neck: [0.2, 0, 0],
        lArmUpper: [-0.9, 0, -0.25], rArmUpper: [-0.9, 0, 0.25],
        lArmLower: [-1.0, 0, 0], rArmLower: [-1.0, 0, 0],
    },
    spot: {
        neck: [-0.35, 0, 0],
        spine: [0.1, 0, 0],
        lArmUpper: [-2.35, 0, 0.15], rArmUpper: [-2.35, 0, -0.15],
        lArmLower: [-0.35, 0, 0], rArmLower: [-0.35, 0, 0],
    },
    fall: {
        neck: [0.2, 0, 0],
        lArmUpper: [-2.6, 0, 0.35], rArmUpper: [-2.6, 0, -0.35],
        lArmLower: [-0.4, 0, 0], rArmLower: [-0.4, 0, 0],
        lLegUpper: [-0.5, 0, 0.1], rLegUpper: [-0.5, 0, -0.1],
        lLegLower: [0.9, 0, 0], rLegLower: [0.9, 0, 0],
    },
    armsUp: {
        neck: [-0.3, 0, 0],
        lArmUpper: [-2.75, 0, 0.35], rArmUpper: [-2.75, 0, -0.35],
        lArmLower: [-0.25, 0, 0], rArmLower: [-0.25, 0, 0],
    },
    sitBack: {   // sitting on the ground, leaning back on the hands
        spine: [-0.25, 0, 0], neck: [-0.1, 0, 0],
        lLegUpper: [-1.45, 0, 0.12], rLegUpper: [-1.45, 0, -0.12],
        lLegLower: [0.45, 0, 0], rLegLower: [0.3, 0, 0],
        lArmUpper: [0.6, 0, 0.3], rArmUpper: [0.6, 0, -0.3],
    },
    hang: {   // legs dangling after cutting feet
        neck: [-0.3, 0, 0],
        lLegUpper: [-0.25, 0, 0.08], rLegUpper: [-0.15, 0, -0.08],
        lLegLower: [0.35, 0, 0], rLegLower: [0.25, 0, 0],
    },
};

/**
 * One arm bent and raised, fist pumping (a "yeah!" after a send).
 * Upper arm out and up, forearm straight up; works standing or sitting.
 */
export function flexPump(rig, t, side = 'r') {
    const s = side === 'r' ? 1 : -1;
    const b = Math.abs(Math.sin(t * 7));
    rig.setJoint(side + 'ArmUpper', -0.3 - 0.15 * b, 0, -s * (1.75 + 0.3 * b));
    rig.setJoint(side + 'ArmLower', 0, 0, -s * (1.4 - 0.25 * b));
    return b;
}

/** Procedural walk cycle on top of the current FK pose. fade 0..1 blends to standing. */
export function gait(rig, phase, fade = 1, swingArms = true) {
    const sn = Math.sin(phase), cs = Math.cos(phase);
    rig.setJoint('lLegUpper', -0.5 * sn * fade, 0, 0.03);
    rig.setJoint('rLegUpper', 0.5 * sn * fade, 0, -0.03);
    rig.setJoint('lLegLower', (0.1 + 0.75 * Math.max(0, cs)) * fade, 0, 0);
    rig.setJoint('rLegLower', (0.1 + 0.75 * Math.max(0, -cs)) * fade, 0, 0);
    if (swingArms) {
        rig.setJoint('lArmUpper', 0.4 * sn * fade, 0, 0.1);
        rig.setJoint('rArmUpper', -0.4 * sn * fade, 0, -0.1);
        rig.setJoint('lArmLower', -0.35, 0, 0);
        rig.setJoint('rArmLower', -0.35, 0, 0);
    }
    return Math.abs(cs) * fade;   // for a little vertical bob
}
