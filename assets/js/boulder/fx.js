import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// Chalk dust, stylised: a few bright firefly-sized specks that pop out, drift
// up and blink out. Like the fireflies they don't write depth (no outlines)
// and the group is hidden from the normal pass.
const SIZE = 0.065;

export class Puffs {
    constructor(scene, count = 32) {
        const geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
        this.group = new THREE.Group();
        scene.add(this.group);
        this.items = [];
        for (let i = 0; i < count; i++) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            this.group.add(mesh);
            this.items.push({ mesh, life: 0, vel: new THREE.Vector3() });
        }
        this.next = 0;
        this.rand = mulberry32(99);
    }

    /** `count` is the old dense count; it's thinned out to a few specks. */
    spawn(pos, count = 4, spread = 0.07, up = 0.3) {
        const r = this.rand;
        const n = Math.min(4, Math.ceil(count / 3));
        for (let i = 0; i < n; i++) {
            const p = this.items[this.next++ % this.items.length];
            p.life = 0.7 + r() * 0.5;
            p.mesh.position.set(pos.x + (r() - 0.5) * spread, pos.y + (r() - 0.5) * spread, pos.z + (r() - 0.5) * spread);
            p.vel.set((r() - 0.5) * 0.6, up * (0.5 + r()), (r() - 0.5) * 0.6);
            p.mesh.scale.setScalar(1);
            p.mesh.visible = true;
        }
    }

    update(dt) {
        const damp = Math.exp(-dt * 2.5);
        for (const p of this.items) {
            if (p.life <= 0) continue;
            p.life -= dt;
            p.vel.multiplyScalar(damp);
            p.vel.y += 0.1 * dt;
            p.mesh.position.addScaledVector(p.vel, dt);
            // full size until the very end, then a quick pop
            p.mesh.scale.setScalar(Math.min(1, p.life / 0.12));
            if (p.life <= 0) p.mesh.visible = false;
        }
    }
}
