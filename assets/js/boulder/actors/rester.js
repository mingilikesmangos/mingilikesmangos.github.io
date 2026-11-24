import * as THREE from 'three';
import { Character, flexPump } from '../rig.js';
import { toon } from '../world.js';
import { mulberry32 } from '../noise.js';

// Someone resting in the camping chair: sips from a mug, scrolls their
// phone, watches the climber and throws their arms up when they send.
const LOOK = {
    skin: 0xf0c8a0,
    shirt: 0xa8423a,      // red flannel
    shorts: 0xb59f74,     // khaki trousers
    legs: 0xb59f74,
    shoes: 0x6b4a2e,
    hair: 0x5a3a22,
};

const SIT_LEGS = {
    lLegUpper: [-1.48, 0.08, 0.1], rLegUpper: [-1.48, -0.08, -0.1],
    lLegLower: [1.42, 0, 0], rLegLower: [1.42, 0, 0],
    spine: [-0.18, 0, 0],
};
const POSE = {
    relax: {
        ...SIT_LEGS,
        lArmUpper: [-0.4, 0, 0.22], rArmUpper: [-0.4, 0, -0.22],
        lArmLower: [-0.75, 0, 0], rArmLower: [-0.75, 0, 0],
    },
    drink: {
        ...SIT_LEGS,
        neck: [-0.3, 0, 0],
        lArmUpper: [-0.4, 0, 0.22], lArmLower: [-0.75, 0, 0],
        rArmUpper: [-0.75, 0, 0.1], rArmLower: [-2.15, 0, 0],
    },
    phone: {
        ...SIT_LEGS,
        neck: [0.5, 0, 0],
        lArmUpper: [-0.55, 0, 0.05], rArmUpper: [-0.55, 0, -0.05],
        lArmLower: [-1.25, 0, -0.25], rArmLower: [-1.25, 0, 0.25],
    },
    cheer: {
        ...SIT_LEGS,
        neck: [-0.35, 0, 0],
        spine: [0.05, 0, 0],
        lArmUpper: [-2.75, 0, 0.35], rArmUpper: [-2.75, 0, -0.35],
        lArmLower: [-0.25, 0, 0], rArmLower: [-0.25, 0, 0],
    },
};

const Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _inv = new THREE.Quaternion();

export class Rester {
    constructor(scene, chair) {
        this.rig = new Character(LOOK);
        scene.add(this.rig.root);
        const root = this.rig.root;
        root.quaternion.setFromAxisAngle(Y, chair.yaw);
        root.position.set(0, chair.seatHeight + 0.09, -0.02).applyQuaternion(root.quaternion).add(chair.pos);
        this.baseY = root.position.y;

        // mug in the right hand, phone in the left
        const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 6), toon({ color: 0xe0d8c4 }));
        mug.position.set(0, -0.3, 0.07);
        mug.castShadow = true;
        this.rig.limbs.rArm.lower.add(mug);
        this.phone = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.13), toon({ color: 0x1c1c22 }));
        this.phone.position.set(-0.03, -0.33, 0.03);
        this.phone.visible = false;
        this.rig.limbs.lArm.lower.add(this.phone);

        this.rand = mulberry32(31);
        this.mode = 'relax';
        this.left = 3;
        this.t = 0;
        this.rig.setPose(POSE.relax);
        this.rig.snapToPose();
    }

    update(dt, climber) {
        this.t += dt;
        this.left -= dt;
        const r = this.rand;
        if (climber.flexing) {
            this.mode = 'flex';     // one of the group topped out: fist up with them
        } else if (climber.sent) {
            if (this.mode !== 'cheer') { this.mode = 'cheer'; this.left = 1.6; }
        } else if (this.left <= 0) {
            // pick the next thing to do; watch more while someone is on the wall
            const x = r();
            this.mode = climber.climbing
                ? (x < 0.75 ? 'relax' : 'drink')
                : (x < 0.4 ? 'phone' : x < 0.7 ? 'drink' : 'relax');
            this.left = this.mode === 'drink' ? 1.4 + r() : 3 + r() * 4;
        }
        if (this.mode === 'flex' && !climber.flexing) { this.mode = 'relax'; this.left = 2; }
        const pose = POSE[this.mode === 'flex' ? 'relax' : this.mode];
        this.rig.setPose(pose, this.mode === 'cheer' || this.mode === 'flex' ? 9 : 4);
        this.phone.visible = this.mode === 'phone';

        const root = this.rig.root;
        if (this.mode === 'cheer') {
            // little bounce in the seat and pumping fists
            const b = Math.abs(Math.sin(this.t * 9));
            root.position.y = this.baseY + 0.03 * b;
            this.rig.setJoint('lArmLower', -0.25 - 0.6 * b, 0, 0);
            this.rig.setJoint('rArmLower', -0.25 - 0.6 * b, 0, 0);
        } else if (this.mode === 'flex') {
            if (climber.t > 0.7) flexPump(this.rig, climber.t, 'l');   // mug stays in the right hand
            root.position.y = this.baseY;
        } else {
            root.position.y = this.baseY + 0.006 * Math.sin(this.t * 1.7);   // breathing
        }

        if (this.mode !== 'phone') {
            // turn the head towards the climber (limited)
            _v.copy(climber.pelvis).sub(root.position).applyQuaternion(_inv.copy(root.quaternion).invert());
            const yaw = THREE.MathUtils.clamp(Math.atan2(_v.x, _v.z), -0.9, 0.9);
            const pitch = pose.neck ? pose.neck[0] : -0.1;
            this.rig.setJoint('neck', pitch, yaw, 0);
        }
        this.rig.update(dt);
    }
}
