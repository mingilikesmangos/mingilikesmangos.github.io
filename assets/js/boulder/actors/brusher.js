import * as THREE from 'three';
import { POSES } from '../rig.js';
import { floorHeight, toon } from '../world.js';
import { Boulderer, V, attemptScript, makeProblems } from './boulderer.js';

// Purple tee with the long-pole brush. Loop: tries the slab start, comes off,
// picks up the brush and cleans the holds, puts it down, sends the slab, takes
// the rope down and walks back around the boulder.
const LOOK = {
    skin: 0xe9c19b,
    shirt: 0x6a4c93,       // purple tee
    shorts: 0x5a5e66,      // grey trousers
    legs: 0x5a5e66,
    shoes: 0x2b2b2b,
    hair: 0x111111,
    beanie: 0xd9783a,
    beanieBand: 0xc0632a,
};

const HOME = V(-4.35, 0.75);
const BRUSH_HEAD = V(-4.45, -0.95);           // where the brush lies on the ground
const BRUSH_PICK = V(-3.85, -0.25);           // stand here to pick it up / put it down
const CLEAN = [3, 4, 6];                      // slab holds to brush
const HOME_PATH = [V(0.2, 3.05), V(-1.2, 2.8), V(-2.6, 2.55), V(-4.0, 1.9)];

const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

function buildBrush() {
    const g = new THREE.Group();          // origin = brush head; the pole runs along local -y
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1, 0.035), toon({ color: 0xc9a86a }));
    stick.geometry.translate(0, -0.5, 0);
    stick.castShadow = true;
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.07), toon({ color: 0x8a5a32 }));
    const bristles = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.06), toon({ color: 0xece4d2 }));
    bristles.position.y = 0.045;
    block.castShadow = bristles.castShadow = true;
    g.add(stick, block, bristles);
    return { group: g, stick };
}

export class Brusher extends Boulderer {
    constructor(scene, world, fx) {
        super(scene, world, { look: LOOK, home: HOME, face: [1, 0], fx, seed: 53 });
        this.slab = makeProblems(world).slab;
        this.brush = buildBrush();
        scene.add(this.brush.group);
        this.held = false;
        this.head = new THREE.Vector3();
        this.handL = new THREE.Vector3();
        this.handR = new THREE.Vector3();
        this.layBrush();
        this.loop();
    }

    loop() {
        const q = attemptScript(this, this.slab, { fail: true, chalk: 'none', rand: this.rand });
        const toBrush = [BRUSH_HEAD.x - BRUSH_PICK.x, BRUSH_HEAD.z - BRUSH_PICK.z];
        q.push(
            { do: 'walk', to: BRUSH_PICK, face: toBrush },
            { do: 'idle', pose: 'bend', dur: 0.9, crouch: 0.12, onEnd: () => this.pickUp() },
        );
        for (const i of CLEAN) {
            const hold = this.slab.holds[i];
            const at = this.standSpot(hold);
            q.push(
                { do: 'walk', to: at, face: [hold.pos.x - at.x, hold.pos.z - at.z] },
                { do: 'brush', hold, dur: 2.6 + this.rand() * 1.2 },
                { do: 'inspect', hold, dur: 1.3 },
            );
        }
        q.push(
            { do: 'walk', to: BRUSH_PICK, face: toBrush },
            { do: 'idle', pose: 'bend', dur: 0.9, crouch: 0.12, lower: true, onEnd: () => this.putDown() },
            ...attemptScript(this, this.slab, {
                fail: false, chalk: 'none', rand: this.rand,
                homePath: HOME_PATH, home: HOME, homeFace: [1, 0],
            }),
        );
        this.setScript(q, () => this.loop());
    }

    standSpot(hold) {
        const outH = _a.set(hold.normal.x, 0, hold.normal.z).normalize();
        return new THREE.Vector3(hold.pos.x, 0, hold.pos.z).addScaledVector(outH, 0.75 + 0.35 * hold.pos.y);
    }

    pickUp() {
        this.held = this.armsBusy = true;
        this.rig.limbs.lArm.target = this.handL;
        this.rig.limbs.rArm.target = this.handR;
    }

    putDown() {
        this.held = this.armsBusy = false;
        this.rig.limbs.lArm.target = null;
        this.rig.limbs.rArm.target = null;
        this.layBrush();
    }

    /** The brush lying on the ground, pole pointing at the pick-up spot. */
    layBrush() {
        const g = this.brush.group;
        this.head.set(BRUSH_HEAD.x, floorHeight(BRUSH_HEAD.x, BRUSH_HEAD.z) + 0.03, BRUSH_HEAD.z);
        g.position.copy(this.head);
        const dir = _a.subVectors(BRUSH_PICK, BRUSH_HEAD).setY(0).normalize();
        g.quaternion.setFromUnitVectors(_b.set(0, -1, 0), dir);
        this.brush.stick.scale.y = 1.7;
    }

    beginStep(s) {
        if (s.do === 'brush' || s.do === 'inspect') this.rig.setPose(POSES.stand, 6);
    }

    updateStep(dt, s) {
        if (s.do === 'brush' || s.do === 'inspect') {
            this.settle(dt);
            return s.t >= s.dur;
        }
        return true;
    }

    beforeRig(dt) {
        if (!this.held) return;
        const rig = this.rig, s = this.step;
        rig.root.updateMatrixWorld(true);
        const fwd = _d.set(0, 0, 1).applyQuaternion(this.quat);
        const goal = _c;
        let rate = 5;
        if (s.do === 'brush' || s.do === 'inspect') {
            const hold = s.hold;
            goal.copy(hold.pos).addScaledVector(hold.normal, 0.07);
            if (s.do === 'brush') {
                const tangent = _b.crossVectors(hold.normal, Y).normalize();
                goal.addScaledVector(tangent, Math.sin(s.t * 16) * 0.07);
                goal.y += Math.sin(s.t * 8) * 0.015;
                rate = s.t > 0.6 ? 30 : 5;
                if (s.t > 0.6 && this.rand() < dt * 2) this.fx?.spawn(this.head, 1, 0.1, 0.15);   // old chalk coming off
            } else {
                goal.addScaledVector(hold.normal, 0.35);
                goal.y -= 0.25;
            }
        } else if (s.do === 'idle' && s.lower) {
            goal.set(BRUSH_HEAD.x, floorHeight(BRUSH_HEAD.x, BRUSH_HEAD.z) + 0.05, BRUSH_HEAD.z);
            rate = 3;
        } else {
            // carried upright in front
            goal.copy(this.pos).add(_b.set(0, 1.5, 0)).addScaledVector(fwd, 0.5);
        }
        this.head.lerp(goal, 1 - Math.exp(-dt * rate));

        // pole runs from the head back to just in front of the belly
        const belly = rig.jointPosition('spine', new THREE.Vector3()).add(_a.set(0, 0.12, 0)).addScaledVector(fwd, 0.17);
        const dir = belly.sub(this.head);
        const L = dir.length();
        dir.divideScalar(L);
        const g = this.brush.group;
        g.position.copy(this.head);
        g.quaternion.setFromUnitVectors(_a.set(0, -1, 0), dir);
        this.brush.stick.scale.y = L + 0.25;
        this.handR.copy(this.head).addScaledVector(dir, L - 0.5);
        this.handL.copy(this.head).addScaledVector(dir, L - 0.12);
        const e = rig.root.matrixWorld.elements;
        const left = _b.set(e[0], e[1], e[2]);
        for (const [l, side] of [['lArm', 1], ['rArm', -1]]) {
            rig.limbs[l].pole.set(0, -0.7, 0).addScaledVector(left, side * 0.6);
        }
        if (s.do === 'brush' || s.do === 'inspect') {
            _a.subVectors(this.head, rig.jointPosition('neck', _b));
            const pitch = Math.atan2(_a.y, Math.hypot(_a.x, _a.z));
            rig.setJoint('neck', -THREE.MathUtils.clamp(pitch, -0.4, 0.7), 0, 0);
        }
    }
}
