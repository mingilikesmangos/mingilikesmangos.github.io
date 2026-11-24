import * as THREE from 'three';
import { toon, floorHeight } from './world.js';
import { mulberry32 } from './noise.js';

// Things that make the place feel alive and that depend on the time of day:
// fireflies and headlamps at night, birds and a dragonfly during the day.
// Glowing bits don't write depth (so the outline pass leaves them alone) and
// are listed in `normalPassHidden` so they don't create creases either.

const FIREFLIES = 34;
const _v = new THREE.Vector3();

class Fireflies {
    constructor(scene, rand) {
        this.group = new THREE.Group();
        this.group.visible = false;
        const geo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
        this.items = [];
        for (let i = 0; i < FIREFLIES; i++) {
            const mat = new THREE.MeshBasicMaterial({ color: 0xe4ff7a, transparent: true, depthWrite: false });
            const mesh = new THREE.Mesh(geo, mat);
            // around the trees and the edge of the clearing, away from the boulder
            const a = rand() * Math.PI * 2, r = 3.4 + rand() * 2.6;
            const home = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
            home.y = floorHeight(home.x, home.z) + 0.35 + rand() * 1.8;
            this.items.push({
                mesh, home,
                f: [0.13 + rand() * 0.2, 0.11 + rand() * 0.2, 0.17 + rand() * 0.25],
                ph: [rand() * 6, rand() * 6, rand() * 6],
                blink: 0.25 + rand() * 0.35, blinkPh: rand() * 10,
            });
            this.group.add(mesh);
        }
        scene.add(this.group);
        this.t = 0;
    }

    update(dt) {
        if (!this.group.visible) return;
        this.t += dt;
        const t = this.t;
        for (const p of this.items) {
            p.mesh.position.set(
                p.home.x + 0.6 * Math.sin(t * p.f[0] * 2 + p.ph[0]),
                p.home.y + 0.25 * Math.sin(t * p.f[1] * 3 + p.ph[1]),
                p.home.z + 0.6 * Math.sin(t * p.f[2] * 2 + p.ph[2]),
            );
            // slow glow, then off for a while
            const c = Math.sin(t * p.blink * Math.PI * 2 * 0.5 + p.blinkPh);
            const on = Math.max(0, c) ** 2;
            p.mesh.material.opacity = on;
            p.mesh.visible = on > 0.05;
        }
    }
}

// A few birds crossing over the island now and then.
class Birds {
    constructor(scene, rand) {
        this.rand = rand;
        this.group = new THREE.Group();
        scene.add(this.group);
        const body = toon({ color: 0x2b2a30 });
        this.birds = [];
        for (let i = 0; i < 3; i++) {
            const b = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.24), body);
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), body);
            head.position.set(0, 0.03, 0.14);
            const wing = (side) => {
                const pivot = new THREE.Group();
                pivot.position.x = side * 0.04;
                const w = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.11), body);
                w.position.x = side * 0.13;
                pivot.add(w);
                return pivot;
            };
            const lw = wing(1), rw = wing(-1);
            b.add(torso, head, lw, rw);
            b.traverse((o) => { if (o.isMesh) o.castShadow = true; });
            b.visible = false;
            this.group.add(b);
            this.birds.push({ g: b, lw, rw, offset: new THREE.Vector3(), ph: rand() * 6 });
        }
        this.wait = 3 + rand() * 2;
        this.flight = null;
    }

    update(dt, day) {
        const r = this.rand;
        if (!this.flight) {
            this.wait -= dt;
            if (this.wait > 0 || !day) return;
            // straight across, roughly over the middle
            const a = r() * Math.PI * 2;
            const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
            const side = new THREE.Vector3(-dir.z, 0, dir.x);
            const start = dir.clone().multiplyScalar(-13).addScaledVector(side, (r() - 0.5) * 5);
            start.y = 5.2 + r() * 1.4;
            const n = 1 + Math.floor(r() * 3);
            this.flight = { pos: start, dir, side, t: 0, dur: 26 / 2.6, n };
            this.birds.forEach((b, i) => {
                b.g.visible = i < n;
                b.offset.set(0, (r() - 0.5) * 0.4, 0).addScaledVector(side, (i - (n - 1) / 2) * 0.7).addScaledVector(dir, -Math.abs(i - (n - 1) / 2) * 0.6);
                b.g.quaternion.setFromAxisAngle(_v.set(0, 1, 0), Math.atan2(dir.x, dir.z));
            });
        }
        const f = this.flight;
        f.t += dt;
        f.pos.addScaledVector(f.dir, 2.6 * dt);
        this.birds.forEach((b, i) => {
            if (i >= f.n) return;
            b.g.position.copy(f.pos).add(b.offset);
            b.g.position.y += 0.15 * Math.sin(f.t * 1.3 + b.ph);
            // flap, then glide for a bit
            const flapping = Math.sin(f.t * 0.9 + b.ph) > -0.3;
            const w = flapping ? 0.7 * Math.sin(f.t * 15 + b.ph) : 0.12;
            b.lw.rotation.z = w;
            b.rw.rotation.z = -w;
        });
        if (f.t > f.dur) {
            this.flight = null;
            this.birds.forEach((b) => { b.g.visible = false; });
            this.wait = 18 + r() * 22;
        }
    }
}

// One dragonfly in the daytime: sits on something for a while, then darts
// about in short hops with hovers in between and lands somewhere else. It
// takes off early when someone walks up to it.
const DF_SPEED = 3.2;
const _q = new THREE.Quaternion(), _w = new THREE.Vector3();

class Dragonfly {
    constructor(scene, rand, perches) {
        this.rand = rand;
        this.perches = perches;
        const g = new THREE.Group();          // origin between the wings, nose along +z
        const box = (w, h, d, color, x, y, z) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon({ color }));
            m.position.set(x, y, z);
            g.add(m);
            return m;
        };
        box(0.035, 0.03, 0.2, 0x9a6532, 0, 0, -0.12);     // tail
        box(0.05, 0.045, 0.07, 0x6e4526, 0, 0.005, 0.01);  // thorax
        box(0.055, 0.045, 0.04, 0x3fae6a, 0, 0.01, 0.065); // head, big eyes
        const wingMat = new THREE.MeshBasicMaterial({ color: 0xe8f4f8, transparent: true, opacity: 0.6, depthWrite: false });
        this.wings = [];
        for (const [side, z] of [[1, 0.025], [-1, 0.025], [1, -0.015], [-1, -0.015]]) {
            const pivot = new THREE.Group();
            pivot.position.set(0, 0.03, z);
            const w = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.006, 0.04), wingMat);
            w.position.x = side * 0.09;
            pivot.add(w);
            pivot.userData.side = side;
            g.add(pivot);
            this.wings.push(pivot);
        }
        g.traverse((o) => { if (o.isMesh && o.material !== wingMat) o.castShadow = true; });
        g.scale.setScalar(1.5);   // toy-sized, so it reads at pixel resolution
        scene.add(g);
        this.group = g;
        this.wingMeshes = this.wings.map((p) => p.children[0]);
        this.at = Math.floor(rand() * perches.length);
        g.position.copy(perches[this.at]);
        g.rotation.y = rand() * Math.PI * 2;
        this.rest = 2 + rand() * 4;
        this.path = null;
        this.t = 0;
    }

    /** Short darts between hover points, ending on another perch. */
    takeOff() {
        const r = this.rand, from = this.group.position.clone();
        let to = this.at;
        for (let tries = 0; tries < 20 && (to === this.at || this.crowded(this.perches[to])); tries++) {
            to = Math.floor(r() * this.perches.length);
        }
        if (to === this.at) to = (to + 1) % this.perches.length;
        this.at = to;
        const end = this.perches[to];
        const pts = [];
        const n = 2 + Math.floor(r() * 3);
        for (let i = 1; i <= n; i++) {
            const k = i / (n + 1);
            const p = from.clone().lerp(end, k);
            p.x += (r() - 0.5) * 2.4;
            p.z += (r() - 0.5) * 2.4;
            p.y = Math.max(p.y, floorHeight(p.x, p.z)) + 0.6 + r() * 1.3;
            pts.push(p);
        }
        pts.push(end.clone().add(_w.set(0, 0.25, 0)), end.clone());
        this.path = { pts, i: 0, from, seg: 0, hover: 0, dur: 0 };
        this.nextSeg();
    }

    nextSeg() {
        const p = this.path;
        p.from = this.group.position.clone();
        const to = p.pts[p.i];
        const last = p.i === p.pts.length - 1;
        p.dur = Math.max(0.25, p.from.distanceTo(to) / (last ? 0.6 : DF_SPEED));
        p.seg = 0;
        p.hover = last ? 0 : 0.25 + this.rand() * 0.9;
        const dx = to.x - p.from.x, dz = to.z - p.from.z;
        if (Math.hypot(dx, dz) > 0.05) this.yaw = Math.atan2(dx, dz);
    }

    crowded(pos) {
        return this.people?.some((q) => Math.hypot(q.x - pos.x, q.z - pos.z) < 0.9 && Math.abs(q.y - pos.y) < 1.6);
    }

    update(dt, day, people) {
        this.people = people;
        const g = this.group;
        g.visible = day;
        if (!day) return;
        this.t += dt;
        const p = this.path;
        let flying = !!p;
        if (!p) {
            this.rest -= dt;
            if (this.rest <= 0 || this.crowded(g.position)) this.takeOff();
        } else if (p.seg < p.dur) {
            p.seg += dt;
            const k = Math.min(1, p.seg / p.dur);
            const e = k * k * (3 - 2 * k);    // dart: quick start, brake at the end
            g.position.lerpVectors(p.from, p.pts[p.i], e);
        } else if (p.hover > 0) {
            p.hover -= dt;                    // hover with a little drift
            g.position.y += Math.sin(this.t * 9) * 0.04 * dt;
        } else if (++p.i < p.pts.length) {
            this.nextSeg();
        } else {
            this.path = null;
            this.rest = 3 + this.rand() * 7;
            flying = false;
        }
        if (flying) {
            _q.setFromAxisAngle(_w.set(0, 1, 0), this.yaw);
            g.quaternion.slerp(_q, 1 - Math.exp(-dt * 14));
        }
        // wings buzz in flight, lie flat (slightly drooped) at rest
        for (const w of this.wings) {
            const side = w.userData.side;
            w.rotation.z = flying ? side * 0.6 * Math.sin(this.t * 70 + (w.position.z > 0 ? 0 : 1.6)) : -side * 0.08;
        }
    }
}

/** A lamp on the forehead with a soft beam, lit at night. */
function makeHeadlamp(rig, hasBeanie) {
    const neck = rig.joints.neck;
    const strapMat = toon({ color: 0x26262b });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.04), strapMat);
    lamp.position.set(0, 0.25, 0.165);
    neck.add(lamp);
    if (!hasBeanie) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.345, 0.04, 0.325), strapMat);
        strap.position.set(0, 0.25, -0.005);
        neck.add(strap);
    }
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.012), new THREE.MeshBasicMaterial({ color: 0x9a9a92 }));
    lens.position.set(0, 0.25, 0.187);
    neck.add(lens);

    const light = new THREE.SpotLight(0xfff0d0, 0, 6, 0.5, 0.6, 1.4);
    light.position.set(0, 0.25, 0.19);
    light.target.position.set(0, 0.05, 2.5);
    neck.add(light, light.target);

    // the beam: an open cone, apex at the lamp, pointing along the head's +z
    const geo = new THREE.ConeGeometry(0.42, 2.2, 10, 1, true);
    geo.translate(0, -1.1, 0);
    geo.rotateX(-Math.PI / 2 - 0.09);
    const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xfff0c8, transparent: true, opacity: 0.07, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    beam.position.copy(light.position);
    beam.visible = false;
    neck.add(beam);

    return {
        beam,
        set(on) {
            light.intensity = on ? 5 : 0;
            beam.visible = on;
            lens.material.color.setHex(on ? 0xfff6dc : 0x9a9a92);
        },
    };
}

export class Ambience {
    constructor(scene, perches = []) {
        const rand = mulberry32(4242);
        this.fireflies = new Fireflies(scene, rand);
        this.birds = new Birds(scene, rand);
        this.dragonfly = perches.length > 1 ? new Dragonfly(scene, rand, perches) : null;
        this.lamps = [];
        this.night = false;
    }

    addHeadlamp(rig, hasBeanie = false) {
        const lamp = makeHeadlamp(rig, hasBeanie);
        lamp.set(this.night);
        this.lamps.push(lamp);
    }

    setNight(night) {
        this.night = night;
        this.fireflies.group.visible = night;
        for (const l of this.lamps) l.set(night);
    }

    /** Objects that must not show up in the normal pass. */
    get normalPassHidden() {
        return [this.fireflies.group, ...this.lamps.map((l) => l.beam), ...(this.dragonfly?.wingMeshes || [])];
    }

    /** people: positions to keep the dragonfly away from. */
    update(dt, people = []) {
        this.fireflies.update(dt);
        this.birds.update(dt, !this.night);
        this.dragonfly?.update(dt, !this.night, people);
    }
}
