import * as THREE from 'three';
import { mulberry32, hash3, noise3, fbm3, smoothstep, BAYER4 } from './noise.js';

const noise3s = (x, y) => noise3(x, y, 0.5);

// ---------------------------------------------------------------------------
// Shared look
// ---------------------------------------------------------------------------

export const WORLD_RADIUS = 6.6;

export const COLORS = {
    granite: [0x948d85, 0xa29b92, 0xafa89e],
    granitDark: 0x77706a,
    lichen: 0x9aa368,
    chalk: 0xeeeae2,
    dirt: [0x6b4f36, 0x7d5d3f, 0x8f6d4b],
    grass: [0x4f7a3a, 0x5f8f42, 0x74a34d],
    soil: [0x5a3f2b, 0x4a3324, 0x6a4b32],
    trunk: 0x5b3d26,
    pine: [0x2f5a3c, 0x3b6e45, 0x4a8150],
    bush: 0x4d7f3f,
    pebble: 0x9b958c,
};

let gradientMap = null;
function toonGradient() {
    if (gradientMap) return gradientMap;
    const steps = new Uint8Array([70, 150, 215, 255]);
    gradientMap = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
    return gradientMap;
}

export function toon(params = {}) {
    return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params });
}

function pixelTexture(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function hexToRgb(hex) {
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

// Faceted look: split vertices so every face gets its own normal.
function faceted(geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    return g;
}

function shadowy(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

// Boulder footprint (approx) used to shape the trampled dirt zone.
function dirtField(x, z) {
    const e = Math.hypot((x - 0.45) / 4.6, z / 4.1) + fbm3(x * 0.55, 3.1, z * 0.55) * 0.35;
    // a little trail leaving towards +z
    const trail = Math.abs(x - 0.9 - Math.sin(z * 0.6) * 0.6) < 0.45 && z > 2 ? 0.6 : 0;
    return Math.min(e, 1.2 - trail);
}

export function groundHeight(x, z) {
    const r = Math.hypot(x, z);
    const bump = Math.max(0, fbm3(x * 0.35, 0, z * 0.35, 3)) * 0.6;
    return bump * smoothstep(4.8, 5.6, r) * (1 - smoothstep(6.1, WORLD_RADIUS, r));
}

function groundTexture(N) {
    const R = WORLD_RADIUS;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            const x = ((i + 0.5) / N) * 2 * R - R;
            const z = ((j + 0.5) / N) * 2 * R - R;
            const e = dirtField(x, z);
            const n = fbm3(x * 1.6, 7.7, z * 1.6, 3);
            const dither = (BAYER4[(j % 4) * 4 + (i % 4)] / 16 - 0.5) * 0.35;
            const h = hash3(i, j, 11);
            let col;
            if (e < 1.0) {
                const t = n + dither;
                col = t < -0.12 ? COLORS.dirt[0] : t < 0.15 ? COLORS.dirt[1] : COLORS.dirt[2];
                if (h > 0.975) col = COLORS.pebble;
            } else if (e < 1.12 + dither) {
                col = h > 0.5 ? COLORS.grass[0] : COLORS.dirt[1];
            } else {
                const t = n + dither;
                col = t < -0.1 ? COLORS.grass[0] : t < 0.18 ? COLORS.grass[1] : COLORS.grass[2];
                if (h > 0.992) col = 0xf4f0d8;          // tiny flowers
                else if (h > 0.986) col = 0xe8c547;
            }
            const [r, gg, b] = hexToRgb(col);
            const k = (j * N + i) * 4;
            img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    return pixelTexture(c);
}

function soilTexture() {
    const W = 128, H = 12;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const h = hash3(x, y, 5);
            let col;
            if (y === 0) col = h > 0.3 ? COLORS.grass[0] : COLORS.grass[1];
            else if (y === 1) col = h > 0.6 ? COLORS.grass[0] : COLORS.soil[0];
            else {
                const band = Math.floor((y + Math.sin(x * 0.3) * 0.8) / 4) % 2;
                col = band ? COLORS.soil[1] : COLORS.soil[0];
                if (h > 0.94) col = COLORS.soil[2];
                if (h < 0.03) col = COLORS.pebble;
            }
            const [r, gg, b] = hexToRgb(col);
            const k = (y * W + x) * 4;
            img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    return pixelTexture(c);
}

function buildGround() {
    const R = WORLD_RADIUS;
    const group = new THREE.Group();

    const seg = 96;
    const geo = new THREE.PlaneGeometry(2, 2, seg, seg);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i);
        // square -> disc (elliptical grid mapping)
        const u = px * Math.sqrt(1 - (py * py) / 2);
        const v = py * Math.sqrt(1 - (px * px) / 2);
        const X = u * R, Z = -v * R;
        pos.setXYZ(i, X, groundHeight(X, Z), Z);
        uv.setXY(i, (X + R) / (2 * R), 1 - (Z + R) / (2 * R));
    }
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, toon({ map: groundTexture(112) }));
    ground.receiveShadow = true;
    group.add(ground);

    const sideTex = soilTexture();
    const side = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R - 0.25, 1.3, 72, 1, true),
        toon({ map: sideTex })
    );
    side.position.y = -0.65;
    side.receiveShadow = true;
    group.add(side);

    return group;
}

// ---------------------------------------------------------------------------
// Boulder
// ---------------------------------------------------------------------------

function computeCreasedNormals(geo, creaseAngle) {
    // Non-indexed geometry: for each face corner, average the normals of the
    // faces sharing that position, but only those within `creaseAngle` of
    // this face. Planar cuts keep hard edges, the rest stays smooth.
    const pos = geo.attributes.position;
    const key = (i) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const faceNormals = [];
    const byPos = new Map();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i);
        b.fromBufferAttribute(pos, i + 1);
        c.fromBufferAttribute(pos, i + 2);
        const n = new THREE.Vector3().subVectors(c, b).cross(a.clone().sub(b));
        const area = n.length();
        n.normalize();
        faceNormals.push({ n, area });
        for (let k = 0; k < 3; k++) {
            const kk = key(i + k);
            if (!byPos.has(kk)) byPos.set(kk, []);
            byPos.get(kk).push(faceNormals.length - 1);
        }
    }
    const cosT = Math.cos(creaseAngle);
    const normals = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        const own = faceNormals[Math.floor(i / 3)].n;
        v.set(0, 0, 0);
        for (const f of byPos.get(key(i))) {
            const fn = faceNormals[f];
            if (fn.n.dot(own) >= cosT) v.addScaledVector(fn.n, fn.area);
        }
        v.normalize();
        normals.set([v.x, v.y, v.z], i * 3);
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
}

const S = 1.15;              // overall boulder scale
const BOULDER_LIFT = 1.55 * S;  // local origin height above ground
const BOULDER_SHEAR = 0.38;  // top leans toward +x -> overhang on +x, slab on -x

function buildBoulder() {
    const radii = new THREE.Vector3(2.35, 2.05, 1.95);
    const geo = new THREE.IcosahedronGeometry(1, 14);
    const pos = geo.attributes.position;

    const planes = [
        [new THREE.Vector3(0, 1, 0.05), 1.72],           // flat top for the top-out
        [new THREE.Vector3(-0.85, 0.55, 0.12), 1.9],     // slab face
        [new THREE.Vector3(0.15, 0.25, 1), 1.72],        // +z face (down-climb side)
        [new THREE.Vector3(0.1, 0.15, -1), 1.75],        // -z face
        [new THREE.Vector3(0.75, -0.55, 0.2), 1.65],     // steep overhang underside
        [new THREE.Vector3(0.9, 0.35, -0.25), 2.45],     // overhang headwall
        [new THREE.Vector3(-0.45, 0.35, -0.85), 1.9],
        [new THREE.Vector3(0.55, 0.65, 0.55), 2.2],      // lip bevel
        [new THREE.Vector3(-0.5, 0.75, -0.4), 1.95],     // back-top bevel
        [new THREE.Vector3(-0.6, 0.1, 0.8), 2.05],       // corner arete
        [new THREE.Vector3(0.6, 0.15, -0.8), 2.25],
    ].map(([n, d]) => [n.normalize(), d]);

    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const dir = v.clone();
        const e = 0.72;   // <1 -> boxier than a sphere
        v.set(
            Math.sign(v.x) * Math.abs(v.x) ** e,
            Math.sign(v.y) * Math.abs(v.y) ** e,
            Math.sign(v.z) * Math.abs(v.z) ** e
        );
        v.multiply(radii);
        v.x += BOULDER_SHEAR * v.y;
        for (const [n, d] of planes) {
            const s = v.dot(n);
            if (s > d) v.addScaledVector(n, -(s - d));
        }
        const big = fbm3(v.x * 0.7, v.y * 0.7, v.z * 0.7, 3) * 0.16;
        const small = fbm3(v.x * 3.1 + 9, v.y * 3.1, v.z * 3.1, 2) * 0.035;
        v.addScaledVector(dir, big + small);
        v.multiplyScalar(S);
        v.y += BOULDER_LIFT;
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    computeCreasedNormals(geo, THREE.MathUtils.degToRad(28));

    const mesh = shadowy(new THREE.Mesh(geo, toon({ vertexColors: true })));
    mesh.name = 'boulder';
    return mesh;
}

function paintBoulder(mesh, chalkSpots) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const fn = new THREE.Vector3(), q = new THREE.Vector3();
    const col = new THREE.Color();
    const tmp = new THREE.Color();
    const p = new THREE.Vector3();
    const toLin = (hex) => new THREE.Color().setHex(hex);
    const g = COLORS.granite.map(toLin);
    const dark = toLin(COLORS.granitDark);
    const lichen = toLin(COLORS.lichen);
    const chalk = toLin(COLORS.chalk);
    const dirt = toLin(COLORS.dirt[0]);

    for (let i = 0; i < pos.count; i += 3) {
        // evaluate at the face centroid -> one flat colour per triangle
        p.set(0, 0, 0);
        fn.set(0, 0, 0);
        for (let k = 0; k < 3; k++) {
            p.add(q.fromBufferAttribute(pos, i + k));
            fn.add(q.fromBufferAttribute(nrm, i + k));
        }
        p.multiplyScalar(1 / 3);
        fn.normalize();
        const ny = fn.y;
        const n = fbm3(p.x * 0.9, p.y * 0.9, p.z * 0.9, 2);
        col.copy(n < -0.12 ? g[0] : n < 0.18 ? g[1] : g[2]);

        // sparse dark speckles / cracks
        if (hash3(Math.floor(p.x * 6), Math.floor(p.y * 6), Math.floor(p.z * 6)) > 0.965) col.lerp(dark, 0.7);
        // water streaks under the lip
        if (ny < -0.2 && noise3s(p.x * 0.9, p.z * 3.5) > 0.25) col.lerp(dark, 0.5);
        // lichen patches on top-facing surfaces
        if (ny > 0.6 && fbm3(p.x * 1.4 + 4, p.y, p.z * 1.4, 2) > 0.18) col.copy(lichen);
        // dirt splash near the ground
        if (p.y < 0.35) col.lerp(dirt, p.y < 0.12 ? 0.75 : 0.4);
        // chalk smudges around used holds
        for (const s of chalkSpots) {
            const d = p.distanceTo(s.pos);
            if (d < s.r) col.lerp(chalk, d < s.r * 0.55 ? 0.85 : 0.45);
        }
        tmp.copy(col);
        for (let k = 0; k < 3; k++) colors.set([tmp.r, tmp.g, tmp.b], (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Problems on the boulder, expressed as (height, lateral) targets that get
// raycast onto the rock surface. Indices are referenced by the problems in actors/boulderer.js.
const ROUTES = {
    overhang: {
        from: new THREE.Vector3(1, 0, 0),
        holds: [
            // [y, z, kind]
            [0.55, -0.35, 'hand'], [0.55, 0.15, 'hand'],          // sit start
            [0.25, -0.55, 'foot'], [0.3, 0.45, 'foot'],
            [1.25, -0.45, 'hand'], [1.55, 0.25, 'hand'],
            [0.8, 0.0, 'foot'], [1.05, -0.7, 'foot'],
            [2.05, -0.2, 'hand'], [2.45, 0.35, 'hand'],
            [1.6, -0.5, 'foot'], [2.85, -0.1, 'hand'],             // lip
        ],
    },
    slab: {
        from: new THREE.Vector3(-1, 0, 0),
        holds: [
            [0.9, 0.3, 'hand'], [1.3, -0.3, 'hand'], [0.4, 0.0, 'foot'],
            [1.8, 0.4, 'hand'], [2.3, -0.1, 'hand'], [1.0, 0.5, 'foot'],
            [2.95, 0.1, 'hand'],                                   // top jug
        ],
    },
};

function placeHolds(boulder) {
    const ray = new THREE.Raycaster();
    const holds = {};
    const chalkSpots = [];
    boulder.updateMatrixWorld();
    for (const [name, route] of Object.entries(ROUTES)) {
        holds[name] = [];
        for (const [y, z, kind] of route.holds) {
            const origin = new THREE.Vector3(0, y * S, z * S).addScaledVector(route.from, 10);
            ray.set(origin, route.from.clone().negate());
            const hit = ray.intersectObject(boulder, false)[0];
            if (!hit) { holds[name].push(null); continue; }   // keep indices stable
            const normal = hit.face.normal.clone().transformDirection(boulder.matrixWorld);
            holds[name].push({ pos: hit.point.clone(), normal, kind });
            chalkSpots.push({ pos: hit.point.clone(), r: kind === 'hand' ? 0.26 : 0.14 });
        }
    }
    return { holds, chalkSpots };
}

function buildHoldMeshes(holds) {
    const group = new THREE.Group();
    const handMat = toon({ color: 0xd9d4ca });
    const footMat = toon({ color: 0x9e978d });
    const geoHand = new THREE.DodecahedronGeometry(0.1, 0);
    const geoFoot = new THREE.DodecahedronGeometry(0.07, 0);
    const up = new THREE.Vector3(0, 1, 0);
    for (const list of Object.values(holds)) {
        for (const h of list) {
            if (!h) continue;
            const m = new THREE.Mesh(h.kind === 'hand' ? geoHand : geoFoot, h.kind === 'hand' ? handMat : footMat);
            m.scale.set(1.5, 0.7, 1.2);
            m.quaternion.setFromUnitVectors(up, h.normal);
            m.position.copy(h.pos).addScaledVector(h.normal, 0.02);
            shadowy(m);
            group.add(m);
        }
    }
    return group;
}

// ---------------------------------------------------------------------------
// Crash pads & props
// ---------------------------------------------------------------------------

function padTexture(base, trim, patch, seed) {
    const W = 14, H = 18;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
    g.fillStyle = hex(base); g.fillRect(0, 0, W, H);
    g.fillStyle = hex(trim);
    g.fillRect(0, 0, W, 1); g.fillRect(0, H - 1, W, 1);
    g.fillRect(0, 0, 1, H); g.fillRect(W - 1, 0, 1, H);
    // fold seam
    g.fillRect(1, Math.floor(H / 2), W - 2, 1);
    // logo patch
    g.fillStyle = hex(patch);
    g.fillRect(4 + (seed % 3), 3, 5, 3);
    // carry straps
    g.fillStyle = hex(trim);
    g.fillRect(3, 12, 1, 4); g.fillRect(W - 4, 12, 1, 4);
    // chalk: blotchy smudges, heaviest where people land and sit (the middle)
    let r = (seed + 1) * 9301 + 49297;
    const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    g.fillStyle = '#f6f4ee';
    for (let k = 0; k < 7; k++) {
        const cx = 2 + rand() * (W - 4), cy = 2 + (0.15 + 0.7 * rand()) * (H - 4);
        const n = 2 + Math.floor(rand() * 5);
        for (let i = 0; i < n; i++) {
            g.globalAlpha = 0.2 + rand() * 0.35;
            g.fillRect(Math.floor(cx + (rand() - 0.5) * 3), Math.floor(cy + (rand() - 0.5) * 3), 1 + (rand() < 0.3), 1);
        }
    }
    g.globalAlpha = 1;
    return pixelTexture(c);
}

const PADS = [
    // x, z, rotY, w, d, h, base, trim, patch
    [2.55, -0.25, 0.12, 1.25, 1.5, 0.12, 0xc8433a, 0x2b2b33, 0xf2e9d8],
    [3.15, 1.05, -0.35, 1.1, 1.3, 0.11, 0x2f4c7a, 0xd9a441, 0xd9a441],
    [3.35, -1.45, 0.5, 1.0, 1.2, 0.1, 0xe07b2e, 0x3a3a3a, 0x3a3a3a],
    [-3.15, 0.25, 0.25, 1.1, 1.35, 0.11, 0x3c8f86, 0xe8e2cf, 0xe8e2cf],
    [0.75, 2.75, -0.2, 1.2, 1.0, 0.1, 0xe3b93c, 0x4a3b2a, 0x4a3b2a],
    [1.1, -2.95, 0.15, 0.6, 0.5, 0.07, 0x7b4b8f, 0x2b2b33, 0xf2e9d8],  // sit pad
];

// Top surface height at (x, z): ground, or the top of a crash pad.
export function floorHeight(x, z) {
    let y = groundHeight(x, z);
    for (const [px, pz, ry, w, d, h] of PADS) {
        const dx = x - px * S, dz = z - pz * S;
        const c = Math.cos(ry), s = Math.sin(ry);
        const lx = c * dx - s * dz, lz = s * dx + c * dz;
        if (Math.abs(lx) <= w / 2 && Math.abs(lz) <= d / 2) {
            y = Math.max(y, groundHeight(px * S, pz * S) + h);
        }
    }
    return y;
}

function buildPads() {
    const group = new THREE.Group();
    PADS.forEach(([x, z, ry, w, d, h, base, trim, patch], i) => {
        const side = toon({ color: trim });
        const top = toon({ map: padTexture(base, trim, patch, i) });
        const body = toon({ color: base });
        // BoxGeometry face order: +x, -x, +y, -y, +z, -z
        const mats = [body, body, top, side, side, body];
        const m = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats));
        m.position.set(x * S, groundHeight(x * S, z * S) + h / 2, z * S);
        m.rotation.y = ry;
        group.add(m);
    });
    return group;
}

/** A small camping lantern standing on y; its light is switched on at night. */
function makeLantern(x, z, y, range) {
    const group = new THREE.Group();
    const body = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.2, 6), toon({ color: 0x333333 })));
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6), new THREE.MeshBasicMaterial({ color: 0x8a8a7a }));
    glass.position.y = 0.02;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 4, 8, Math.PI), toon({ color: 0x333333 }));
    handle.position.y = 0.1;
    group.add(body, glass, handle);
    group.position.set(x, y + 0.1, z);
    const light = new THREE.PointLight(0xffb35a, 0, range, 1.6);
    light.position.set(0, 0.5, 0);
    group.add(light);
    return {
        group,
        set(on) {
            light.intensity = on ? 4 : 0;
            glass.material.color.setHex(on ? 0xffd27a : 0x8a8a7a);
        },
    };
}

function buildProps() {
    const group = new THREE.Group();
    const add = (mesh, x, y, z, ry = 0) => {
        x *= S; z *= S;
        mesh.position.set(x, groundHeight(x, z) + y, z);
        mesh.rotation.y = ry;
        group.add(shadowy(mesh));
        return mesh;
    };

    // chalk bucket
    const bucket = new THREE.Group();
    bucket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.24, 8), toon({ color: 0x2f3b4a })));
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.03, 8), toon({ color: 0xeeeae2 }));
    rim.position.y = 0.12;
    bucket.add(rim);
    bucket.children.forEach(shadowy);
    add(bucket, 3.95, 0.12, -0.55);

    // backpack
    const pack = new THREE.Group();
    const packBody = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.28), toon({ color: 0x3f5f3a }));
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.25, 0.08), toon({ color: 0x2c4429 }));
    pocket.position.set(0, -0.08, 0.17);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.1, 0.3), toon({ color: 0xb5492f }));
    lid.position.y = 0.32;
    pack.add(packBody, pocket, lid);
    pack.children.forEach(shadowy);
    const p = add(pack, -1.6, 0.3, 3.0, 0.6);
    p.rotation.z = 0.12;

    // climbing shoes (pair)
    const shoeMat = toon({ color: 0xd2492a });
    const soleMat = toon({ color: 0x232323 });
    for (const dz of [-0.09, 0.09]) {
        const shoe = new THREE.Group();
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.1), shoeMat);
        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.025, 0.105), soleMat);
        sole.position.y = -0.045;
        shoe.add(s, sole);
        shoe.children.forEach(shadowy);
        add(shoe, 1.25, 0.12, -2.55 + dz, 0.2);
    }

    // water bottle
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 6), toon({ color: 0x4aa3c9 })), -2.55, 0.12, 1.55);

    // lanterns (lit at night): by the chair, and by the slab's pad
    const lanterns = [
        makeLantern(2.0 * S, 1.95 * S, groundHeight(2.0 * S, 1.95 * S), 7),
        makeLantern(-4.75, 0.15, groundHeight(-4.75, 0.15), 5),
    ];
    lanterns.forEach((l) => group.add(l.group));

    // camping chair next to the lantern, turned towards the overhang
    const chair = new THREE.Group();
    const fabric = toon({ color: 0x2f6f8f });
    const frame = toon({ color: 0x2a2a2e });
    const cpart = (w, h, d, mat, x, y, z, rx = 0) => {
        const m = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
        m.position.set(x, y, z);
        m.rotation.x = rx;
        chair.add(m);
        return m;
    };
    cpart(0.52, 0.05, 0.46, fabric, 0, 0.36, 0);                 // seat
    cpart(0.52, 0.56, 0.04, fabric, 0, 0.64, -0.25, -0.2);       // backrest
    for (const sx of [-1, 1]) {
        cpart(0.06, 0.035, 0.44, frame, sx * 0.29, 0.54, 0.0);   // armrest
        cpart(0.03, 0.54, 0.03, frame, sx * 0.29, 0.27, 0.2);    // front leg
        cpart(0.03, 0.88, 0.03, frame, sx * 0.29, 0.44, -0.24, -0.2);  // back leg
        cpart(0.025, 0.5, 0.025, frame, sx * 0.29, 0.2, -0.02, 0.8);   // X brace
        cpart(0.025, 0.5, 0.025, frame, sx * 0.29, 0.2, -0.02, -0.8);
    }
    cpart(0.09, 0.07, 0.09, fabric, -0.31, 0.5, 0.15);           // cup holder
    const chairX = 2.45, chairZ = 2.4;
    const chairYaw = Math.atan2(2.3 - chairX * S, 0.2 - chairZ * S);
    add(chair, chairX, 0, chairZ, chairYaw);

    // spots a dragonfly can land on: bucket rim, bottle cap, backpack lid,
    // lantern handles, climbing shoes
    const perch = (x, y, z) => new THREE.Vector3(x * S, groundHeight(x * S, z * S) + y, z * S);
    const perches = [
        perch(3.95, 0.28, -0.55),
        perch(-2.55, 0.25, 1.55),
        perch(-1.6, 0.68, 3.0),
        perch(1.25, 0.17, -2.55),
        ...lanterns.map((l) => l.group.position.clone().add(new THREE.Vector3(0, 0.16, 0))),
    ];

    return {
        group, lanterns, perches,
        chair: { pos: chair.position.clone(), yaw: chairYaw, seatHeight: 0.385 },
    };
}

// ---------------------------------------------------------------------------
// Vegetation
// ---------------------------------------------------------------------------

function makeTree(rand, height) {
    const g = new THREE.Group();
    const mats = [];
    const trunkMat = toon({ color: COLORS.trunk });
    mats.push(trunkMat);
    const trunk = new THREE.Mesh(faceted(new THREE.CylinderGeometry(0.1, 0.16, height * 0.35, 5)), trunkMat);
    trunk.position.y = height * 0.175;
    g.add(shadowy(trunk));
    const tiers = 3;
    const cones = [];
    for (let k = 0; k < tiers; k++) {
        const m = toon({ color: COLORS.pine[k % 3] });
        mats.push(m);
        const r = height * (0.3 - k * 0.07);
        const cone = new THREE.Mesh(faceted(new THREE.ConeGeometry(r, height * 0.42, 7)), m);
        cone.position.y = height * (0.38 + k * 0.2);
        cone.rotation.order = 'XZY';      // spin about its own axis first, then tilt in the wind
        cone.rotation.y = rand() * Math.PI;
        g.add(shadowy(cone));
        cones.push(cone);
    }
    return { group: g, mats, cones };
}

function buildVegetation(rand) {
    const group = new THREE.Group();
    const trees = [];
    const count = 11;
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.35;
        const r = 5.3 + rand() * 0.9;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const t = makeTree(rand, 2.8 + rand() * 2.0);
        t.group.position.set(x, groundHeight(x, z) - 0.05, z);
        group.add(t.group);
        trees.push({ ...t, dir: new THREE.Vector2(x, z).normalize(), scale: 1, phase: rand() * 6, stiff: 0.7 + rand() * 0.6 });
    }

    // bushes, rocks, grass tufts
    const bushMat = toon({ color: COLORS.bush });
    const rockMat = toon({ color: COLORS.granite[1] });
    const tuftMat = toon({ color: COLORS.grass[2] });
    const bushGeo = new THREE.IcosahedronGeometry(0.4, 0);
    const rockGeo = new THREE.DodecahedronGeometry(0.25, 0);
    const tuftGeo = faceted(new THREE.ConeGeometry(0.06, 0.22, 3));
    for (let i = 0; i < 9; i++) {
        const a = rand() * Math.PI * 2, r = 4.9 + rand() * 1.4;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const b = shadowy(new THREE.Mesh(bushGeo, bushMat));
        const s = 0.6 + rand() * 0.7;
        b.scale.set(s, s * 0.7, s);
        b.position.set(x, groundHeight(x, z) + 0.12 * s, z);
        b.rotation.y = rand() * 3;
        group.add(b);
    }
    for (let i = 0; i < 10; i++) {
        const a = rand() * Math.PI * 2, r = 4.4 + rand() * 1.9;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const m = shadowy(new THREE.Mesh(rockGeo, rockMat));
        const s = 0.5 + rand() * 1.1;
        m.scale.set(s, s * 0.6, s * 0.9);
        m.position.set(x, groundHeight(x, z) + 0.05, z);
        m.rotation.set(rand(), rand() * 3, rand());
        group.add(m);
    }
    const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 140);
    const dummy = new THREE.Object3D();
    let n = 0;
    while (n < 140) {
        const a = rand() * Math.PI * 2, r = 3.6 + rand() * 2.8;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (dirtField(x, z) < 1.1) continue;
        dummy.position.set(x, groundHeight(x, z) + 0.09, z);
        dummy.rotation.set((rand() - 0.5) * 0.5, rand() * 3, (rand() - 0.5) * 0.5);
        dummy.scale.setScalar(0.7 + rand() * 0.8);
        dummy.updateMatrix();
        tufts.setMatrixAt(n++, dummy.matrix);
    }
    tufts.receiveShadow = true;
    group.add(tufts);

    return { group, trees };
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fixed rope down the +z wall, above the yellow pad (the way down after a send)
// ---------------------------------------------------------------------------

const ROPE_X = 0.9;
const ROPE_COIL_Z = 2.6;

function buildRope(boulder, rockSurface) {
    const group = new THREE.Group();
    const pts = [], normals = [], surf = [];
    const ray = new THREE.Raycaster();
    const back = new THREE.Vector3(0, 0, -1);
    const faceNormal = (hit) => hit.face.normal.clone().transformDirection(boulder.matrixWorld);

    // 1) across the top, from the anchor to the edge
    let lastY = 3.7, z = 0.45;
    for (; z < 2.5; z += 0.08) {
        const hit = rockSurface(ROPE_X, z);
        if (!hit || hit.normal.y < 0.55) break;
        pts.push(hit.point.clone().addScaledVector(hit.normal, 0.03));
        normals.push(hit.normal);
        surf.push(hit.point.clone());
        lastY = hit.point.y;
    }
    const iEdge = pts.length - 1;
    // 2) down the wall; below the bulge the rope hangs free, so it never moves back in
    let zMax = -Infinity, iBottom = iEdge;
    for (let y = lastY - 0.08; y > 0.04; y -= 0.08) {
        ray.set(new THREE.Vector3(ROPE_X, y, 10), back);
        const hit = ray.intersectObject(boulder, false)[0];
        const wz = hit ? hit.point.z : zMax;
        const n = hit ? faceNormal(hit) : new THREE.Vector3(0, 0, 1);
        if (wz >= zMax) { zMax = wz; normals.push(n); } else normals.push(new THREE.Vector3(0, 0, 1));
        pts.push(new THREE.Vector3(ROPE_X, y, zMax + 0.03));
        surf.push(new THREE.Vector3(ROPE_X, y, wz));
        if (y > 0.4) iBottom = pts.length - 1;
    }
    // 3) along the ground to the coil
    for (let gz = zMax + 0.1; gz <= ROPE_COIL_Z; gz += 0.1) {
        const p = new THREE.Vector3(ROPE_X, floorHeight(ROPE_X, gz) + 0.03, gz);
        pts.push(p); normals.push(new THREE.Vector3(0, 1, 0)); surf.push(p.clone());
    }

    const s = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + pts[i].distanceTo(pts[i - 1]));

    const ropeMat = toon({ color: 0xe0562b });
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    group.add(shadowy(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 2, 0.025, 4), ropeMat)));
    // coil at the bottom
    const end = pts[pts.length - 1];
    for (let i = 0; i < 3; i++) {
        const ring = shadowy(new THREE.Mesh(new THREE.TorusGeometry(0.17 - i * 0.02, 0.025, 4, 10), ropeMat));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(end.x + 0.05 - i * 0.02, end.y + 0.01 + i * 0.04, end.z + 0.12 - i * 0.03);
        group.add(ring);
    }
    // two bolts + sling at the anchor
    const steel = toon({ color: 0x6d7178 });
    const a = pts[0];
    for (const dx of [-0.12, 0.12]) {
        const bolt = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.07), steel));
        bolt.position.set(a.x + dx, a.y + 0.01, a.z - 0.08);
        group.add(bolt);
    }
    const sling = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.12), toon({ color: 0x3f7fc4 })));
    sling.position.set(a.x, a.y + 0.01, a.z - 0.03);
    group.add(sling);

    const seg = (d) => {
        d = Math.max(0, Math.min(s[s.length - 1], d));
        let i = 1;
        while (i < s.length - 1 && s[i] < d) i++;
        return [i, (d - s[i - 1]) / Math.max(1e-6, s[i] - s[i - 1])];
    };
    /** Point on the rope at arc length d (optionally its surface normal and the rock behind it). */
    const at = (d, out = new THREE.Vector3(), nOut = null, surfOut = null) => {
        const [i, k] = seg(d);
        out.lerpVectors(pts[i - 1], pts[i], k);
        if (nOut) nOut.lerpVectors(normals[i - 1], normals[i], k).normalize();
        if (surfOut) surfOut.lerpVectors(surf[i - 1], surf[i], k);
        return out;
    };
    return {
        group, at,
        sEdge: s[iEdge], sBottom: s[iBottom], length: s[s.length - 1],
        dir: new THREE.Vector3(0, 0, 1),     // horizontal direction the rope runs (anchor -> coil)
        side: new THREE.Vector3(1, 0, 0),    // across the rope
    };
}

// Crew logo carved into the -z wall, under the person sitting on the edge.
// A grid is wrapped onto the rock by raycasting each vertex; the logo's alpha
// cuts it out. A pale copy a little lower reads as the lit bottom lip of the cut.
const LOGO_URL = new URL('../../images/beta_logo_primary_replaced_lowercase_white-transparent.png', import.meta.url).href;
const LOGO_CROP = [0.095, 0.14, 0.905, 0.86];   // u0, v0, u1, v1: the logo without its margins

function buildLogo(boulder, { x = -0.5, y = 1.75, width = 3.0 } = {}) {
    const [u0, v0, u1, v1] = LOGO_CROP;
    const height = width * ((v1 - v0) * 1436) / ((u1 - u0) * 2048);
    const tex = new THREE.TextureLoader().load(LOGO_URL);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const ray = new THREE.Raycaster();
    const dir = new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3();
    boulder.updateMatrixWorld();
    const NX = 40, NY = 26;

    const layer = (color, out, drop, order) => {
        const pos = [], uv = [], idx = [];
        for (let j = 0; j <= NY; j++) {
            for (let i = 0; i <= NX; i++) {
                const a = i / NX, b = j / NY;
                // seen from -z, the viewer's right is -x
                const px = x + (0.5 - a) * width, py = y + (b - 0.5) * height - drop;
                ray.set(new THREE.Vector3(px, py, -10), dir);
                const hit = ray.intersectObject(boulder, false)[0];
                if (hit) {
                    n.copy(hit.face.normal).transformDirection(boulder.matrixWorld);
                    pos.push(hit.point.x + n.x * out, hit.point.y + n.y * out, hit.point.z + n.z * out);
                } else {
                    pos.push(px, py, 0);
                }
                uv.push(u0 + a * (u1 - u0), v0 + b * (v1 - v0));
            }
        }
        for (let j = 0; j < NY; j++) {
            for (let i = 0; i < NX; i++) {
                const k = j * (NX + 1) + i;
                idx.push(k, k + 1, k + NX + 1, k + 1, k + NX + 2, k + NX + 1);   // facing -z
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const mat = toon({ color, map: tex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order });
        const m = new THREE.Mesh(geo, mat);
        m.receiveShadow = true;
        m.renderOrder = order;
        return m;
    };
    const group = new THREE.Group();
    group.add(layer(0xc9c2b6, 0.008, 0.018, 1));   // lit lip below the cut
    group.add(layer(COLORS.granitDark, 0.012, 0, 2));   // the cut itself
    return group;
}

export function buildWorld(scene) {
    const rand = mulberry32(20251124);

    const ground = buildGround();
    scene.add(ground);

    const boulder = buildBoulder();
    const { holds, chalkSpots } = placeHolds(boulder);
    paintBoulder(boulder, chalkSpots);
    scene.add(boulder);
    scene.add(buildHoldMeshes(holds));
    const logo = buildLogo(boulder);
    scene.add(logo);

    scene.add(buildPads());
    const props = buildProps();
    scene.add(props.group);

    const veg = buildVegetation(rand);
    scene.add(veg.group);

    // Lights
    const ambient = new THREE.AmbientLight(0xd2dbee, 1.05);
    scene.add(ambient);
    const fill = new THREE.DirectionalLight(0xc4d4ff, 0.7);   // cool bounce from the other side
    fill.position.set(-6, 4, -7);
    scene.add(fill);
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.6);
    sun.position.set(7, 13, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -10; sc.right = 10; sc.top = 10; sc.bottom = -10; sc.near = 1; sc.far = 40;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);

    const camDir = new THREE.Vector2();
    let windT = 0;
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const _o = new THREE.Vector3();
    /** Highest point of the boulder above (x, z): { point, normal } or null. */
    const rockSurface = (x, z) => {
        ray.set(_o.set(x, 20, z), down);
        const hit = ray.intersectObject(boulder, false)[0];
        if (!hit) return null;
        return { point: hit.point.clone(), normal: hit.face.normal.clone().transformDirection(boulder.matrixWorld) };
    };

    const rope = buildRope(boulder, rockSurface);
    rope.user = null;   // one person on the rope at a time
    scene.add(rope.group);

    // a lantern on top beside the person sitting on the edge
    const topLantern = rockSurface(0.85, -1.15);
    const lanterns = [
        ...props.lanterns,
        makeLantern(0.85, -1.15, topLantern ? topLantern.point.y : 3.8, 5),
    ];
    scene.add(lanterns[lanterns.length - 1].group);

    return {
        holds,
        rope,
        chair: props.chair,
        chalkBucket: new THREE.Vector3(3.95 * S, 0, -0.55 * S),
        perches: [
            ...props.perches,
            lanterns[lanterns.length - 1].group.position.clone().add(new THREE.Vector3(0, 0.16, 0)),
            ...[[-1.2, 0.3], [2.2, 1.2]].map(([x, z]) => rockSurface(x, z)?.point.add(new THREE.Vector3(0, 0.01, 0))).filter(Boolean),
        ],
        rockSurface,
        // Trees on the camera side of the boulder shrink into the ground so
        // they never block the view (toy-diorama style).
        update(dt, camera, target) {
            camDir.set(camera.position.x - target.x, camera.position.z - target.z).normalize();
            const k = dt > 0 ? 1 - Math.exp(-dt * 8) : 1;
            // wind: slow sway plus gusts rolling across the island along +x
            windT += dt;
            for (const t of veg.trees) {
                const x = t.group.position.x;
                const gust = Math.max(0, Math.sin(windT * 0.35 - x * 0.12)) ** 3;
                // the trunk stays put; each tier rocks about its own centre,
                // a little out of step with the one below, more so higher up
                const amp = (0.05 + 0.1 * gust) / t.stiff;
                t.cones.forEach((c, i) => {
                    const ph = t.phase - i * 0.7;
                    const a = amp * (0.7 + 0.3 * i);
                    c.rotation.z = -a * (0.3 + Math.sin(windT * 2.1 + ph));
                    c.rotation.x = 0.4 * a * Math.sin(windT * 1.6 + ph * 1.3);
                });

                const f = t.dir.dot(camDir);
                const goal = f > 0.42 ? 0 : 1;
                t.scale += (goal - t.scale) * k;
                const s = t.scale < 0.02 ? 0 : t.scale;
                t.group.visible = s > 0;
                t.group.scale.set(0.6 + 0.4 * s, s, 0.6 + 0.4 * s);
            }
        },
        normalPassHidden() {
            return [logo];   // no outline around the carving
        },
        setNight(night) {
            if (night) {
                ambient.color.setHex(0x34406a); ambient.intensity = 0.9;
                fill.intensity = 0.15;
                sun.color.setHex(0x9db4ff); sun.intensity = 1.1;
                lanterns.forEach((l) => l.set(true));
            } else {
                ambient.color.setHex(0xd2dbee); ambient.intensity = 1.05;
                fill.intensity = 0.7;
                sun.color.setHex(0xfff0d2); sun.intensity = 2.6;
                lanterns.forEach((l) => l.set(false));
            }
        },
    };
}
