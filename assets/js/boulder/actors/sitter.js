import * as THREE from 'three';
import { Character, flexPump } from '../rig.js';
import { mulberry32 } from '../noise.js';

// Someone sitting on the edge of the boulder top, legs dangling over the
// drop, gazing into the distance. Claps when the climber tops out.
const LOOK = {
    skin: 0xe3b48f,
    shirt: 0xd9a43a,      // mustard jacket
    shorts: 0x3d3d45,
    legs: 0x3d3d45,
    shoes: 0xc9c3b6,
    hair: 0x2a1f18,
};

const LEGS = {
    lLegUpper: [-1.5, 0, 0.08], rLegUpper: [-1.5, 0, -0.08],
    lLegLower: [1.3, 0, 0], rLegLower: [1.3, 0, 0],
};
const POSE = {
    gaze: {   // leaning back on the hands
        ...LEGS,
        spine: [-0.25, 0, 0],
        lArmUpper: [0.7, 0, 0.25], rArmUpper: [0.7, 0, -0.25],
        lArmLower: [0, 0, 0], rArmLower: [0, 0, 0],
    },
    hug: {    // one knee pulled up, arms around it
        ...LEGS,
        spine: [0.15, 0, 0],
        rLegUpper: [-2.3, 0, -0.05], rLegLower: [2.3, 0, 0],
        lArmUpper: [-1.0, 0, -0.15], rArmUpper: [-1.1, 0, 0.1],
        lArmLower: [-1.3, 0, 0], rArmLower: [-1.2, 0, 0],
    },
    clap: {
        ...LEGS,
        spine: [0.05, 0, 0],
        lArmUpper: [-1.1, 0, -0.25], rArmUpper: [-1.1, 0, 0.25],
        lArmLower: [-1.0, 0, 0], rArmLower: [-1.0, 0, 0],
    },
};

const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _inv = new THREE.Quaternion();

export class Sitter {
    constructor(scene, rockSurface, x = 0.25) {
        this.rig = new Character(LOOK);
        scene.add(this.rig.root);

        // Sit where the flat top starts rounding over the -z edge, then raise
        // the pelvis until neither it nor the thighs (reaching out over the
        // drop) dig into the rock.
        const h = (z) => { const hit = rockSurface(x, z); return hit ? hit.point.y : -Infinity; };
        let plateau = h(-0.8), seatZ = -1.5;
        for (let z = -0.8; z > -2.2; z -= 0.02) {
            const y = h(z);
            plateau = Math.max(plateau, y);
            if (y < plateau - 0.04) { seatZ = z + 0.02; break; }
        }
        let rootY = -Infinity;
        for (let d = -0.1; d <= 0.1; d += 0.02) rootY = Math.max(rootY, h(seatZ + d) + 0.1);       // pelvis
        for (let d = 0; d <= 0.4; d += 0.02) rootY = Math.max(rootY, h(seatZ - d) + 0.145);       // thighs
        const root = this.rig.root;
        root.quaternion.setFromAxisAngle(Y, Math.PI);      // facing -z, out over the drop
        root.position.set(x, rootY, seatZ);
        this.baseY = root.position.y;

        this.rand = mulberry32(77);
        this.mode = 'gaze';
        this.left = 6;
        this.t = 0;
        this.rig.setPose(POSE.gaze);
        this.rig.snapToPose();
    }

    update(dt, climber) {
        this.t += dt;
        this.left -= dt;
        const rig = this.rig, root = rig.root;
        if (climber.flexing) {
            this.mode = 'flex';
        } else if (this.mode === 'flex') {
            this.mode = 'gaze'; this.left = 5;
        } else if (climber.sent) {
            if (this.mode !== 'clap') { this.mode = 'clap'; this.left = 2.2; }
        } else if (this.left <= 0) {
            this.mode = this.mode === 'gaze' ? 'hug' : 'gaze';
            this.left = this.mode === 'gaze' ? 7 + this.rand() * 5 : 4 + this.rand() * 3;
        }
        rig.setPose(POSE[this.mode === 'flex' ? 'gaze' : this.mode], this.mode === 'clap' || this.mode === 'flex' ? 9 : 2.5);

        const t = this.t;
        // dangling legs swing slowly
        const swing = (ph) => 1.3 + 0.2 * Math.sin(t * 1.4 + ph);   // feet stay in front of the wall
        rig.setJoint('lLegLower', swing(0), 0, 0);
        if (this.mode !== 'hug') rig.setJoint('rLegLower', swing(1.7), 0, 0);

        let yaw = Math.sin(t * 0.23) * 0.5 + Math.sin(t * 0.07) * 0.2;   // slow look around the view
        let pitch = -0.08;
        if (this.mode === 'clap') {
            const b = Math.abs(Math.sin(t * 10));
            rig.setJoint('lArmUpper', -1.1, 0, -0.25 + 0.2 * b);
            rig.setJoint('rArmUpper', -1.1, 0, 0.25 - 0.2 * b);
            _v.copy(climber.pelvis).sub(root.position).applyQuaternion(_inv.copy(root.quaternion).invert());
            yaw = THREE.MathUtils.clamp(Math.atan2(_v.x, _v.z), -1.2, 1.2);
            pitch = 0.1;
        } else if (this.mode === 'flex') {
            // still leaning on the left hand, right fist up, looking round at them
            if (climber.t > 0.7) flexPump(rig, climber.t, 'r');
            _v.copy(climber.pelvis).sub(root.position).applyQuaternion(_inv.copy(root.quaternion).invert());
            yaw = THREE.MathUtils.clamp(Math.atan2(_v.x, _v.z), -1.2, 1.2);
            pitch = -0.1;
        } else if (this.mode === 'hug') {
            pitch = 0.05;
        }
        rig.setJoint('neck', pitch, yaw, 0);
        root.position.y = this.baseY + 0.005 * Math.sin(t * 1.5);
        rig.update(dt);
    }
}
