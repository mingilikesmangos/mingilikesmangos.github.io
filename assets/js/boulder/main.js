import * as THREE from 'three';
import { PixelPipeline } from './pixelpass.js';
import { buildWorld } from './world.js';
import { Crew, audience } from './actors/crew.js';
import { Rester } from './actors/rester.js';
import { Brusher } from './actors/brusher.js';
import { Sitter } from './actors/sitter.js';
import { Campers } from './actors/campers.js';
import { Puffs } from './fx.js';
import { Ambience } from './ambience.js';

const EL_MIN = 0.32, EL_MAX = 0.95;
const AUTO_SPEED = 0.16;          // rad/s
const IDLE_BEFORE_AUTO = 2.5;     // s
const ZOOM_MIN = 1, ZOOM_MAX = 3;

function init(root) {
    const canvas = root.querySelector('canvas');
    const params = new URLSearchParams(location.search);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
    } catch (e) {
        root.classList.add('is-unsupported');
        return;
    }
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;   // hard, pixel-friendly shadows
    renderer.shadowMap.autoUpdate = false;

    const scene = new THREE.Scene();
    const world = buildWorld(scene);
    const pipeline = new PixelPipeline(renderer);

    const fx = new Puffs(scene);
    const crew = new Crew(scene, world, fx);
    const rester = new Rester(scene, world.chair);
    const brusher = new Brusher(scene, world, fx);
    const crowd = audience([...crew.people, brusher], () => crew.active);
    const sitter = new Sitter(scene, world.rockSurface);
    const campers = new Campers(scene);
    const ambience = new Ambience(scene, world.perches);
    const walkers = [...crew.people, brusher].map((p) => p.pos);
    for (const p of [...crew.people, brusher]) ambience.addHeadlamp(p.rig, p.look.beanie != null);
    // ?amb=N: fast-forward birds / fireflies by N seconds (debug)
    for (let i = 0, n = Math.round(Number(params.get('amb') || 0) * 60); i < n; i++) ambience.update(1 / 60, walkers);
    const hiddenInNormals = () => [...world.normalPassHidden(), ...ambience.normalPassHidden, fx.group];
    const actors = (dt) => {
        crew.update(dt);
        brusher.update(dt);
        rester.update(dt, crowd);
        sitter.update(dt, crowd);
        campers.update(dt, crowd);
        fx.update(dt);
    };
    // ?t=N: fast-forward the people to N seconds and freeze them there (debug / screenshots)
    const frozen = params.has('t');
    for (let i = 0, n = Math.round(Number(params.get('t') || 0) * 60); i < n; i++) actors(1 / 60);
    actors(0);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
    const target = new THREE.Vector3(0.3, 0.9, 0);
    if (params.has('focus')) target.fromArray(params.get('focus').split(',').map(Number));   // debug

    // ----- state -----
    const state = {
        az: params.has('az') ? Number(params.get('az')) : 0.9,
        el: params.has('el') ? Number(params.get('el')) : 0.55,
        vAz: 0,
        idle: IDLE_BEFORE_AUTO,
        autoBlend: 0,
        auto: !reducedMotion && params.get('auto') !== '0',   // always on (no toggle); ?auto=0 for debugging
        dragging: false,
        running: false,
        zoom: Number(params.get('zoom')) || 1,    // shown zoom; ?zoom=N may exceed the max (debug)
        zoomGoal: 0,
    };
    state.zoomGoal = state.zoom;

    // ----- sizing -----
    const view = { hw: 1, hh: 1 };            // frustum half size at zoom 1
    const PX = Number(params.get('px')) || 2;   // screen pixels per art pixel (?px=N to override)
    function resize() {
        const W = root.querySelector('.boulder-stage').clientWidth;
        const wide = W >= 640;
        const P = PX;
        const aspect = wide ? 16 / 10 : 1;
        const lowW = Math.max(64, Math.floor(W / P));
        const lowH = Math.max(64, Math.round(lowW / aspect));
        canvas.style.width = `${lowW * P}px`;
        canvas.style.height = `${lowH * P}px`;
        renderer.setSize(lowW, lowH, false);
        pipeline.setSize(lowW, lowH);
        view.hh = (wide ? 12.6 : 16) / 2;
        view.hw = view.hh * lowW / lowH;
        applyZoom();
        if (!state.running) renderFrame();
    }
    function applyZoom() {
        const z = state.zoom;
        camera.left = -view.hw / z; camera.right = view.hw / z;
        camera.top = view.hh / z; camera.bottom = -view.hh / z;
        camera.updateProjectionMatrix();
    }

    // ----- zoom (the + / − buttons) -----
    const zoomIn = root.querySelector('[data-action="zoom-in"]');
    const zoomOut = root.querySelector('[data-action="zoom-out"]');
    function zoomBy(f) {
        state.zoomGoal = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.zoomGoal * f));
        updateZoomButtons();
        if (!state.running) { state.zoom = state.zoomGoal; applyZoom(); renderFrame(); }
    }
    function updateZoomButtons() {
        zoomIn.disabled = state.zoomGoal >= ZOOM_MAX - 1e-3;
        zoomOut.disabled = state.zoomGoal <= ZOOM_MIN + 1e-3;
    }
    zoomIn.addEventListener('click', () => zoomBy(1.5));
    zoomOut.addEventListener('click', () => zoomBy(1 / 1.5));
    updateZoomButtons();   // ?zoom=N is left unclamped (debug)

    function placeCamera(az, el) {
        const r = 30;
        camera.position.set(
            target.x + r * Math.cos(el) * Math.sin(az),
            target.y + r * Math.sin(el),
            target.z + r * Math.cos(el) * Math.cos(az)
        );
        camera.lookAt(target);
    }

    function renderFrame() {
        placeCamera(state.az, state.el);
        world.update(0, camera, target);
        pipeline.render(scene, camera, hiddenInNormals());
    }

    // ----- input -----
    let lastX = 0, lastY = 0, lastT = 0;
    canvas.addEventListener('pointerdown', (e) => {
        state.dragging = true;
        state.vAz = 0;
        lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
        canvas.setPointerCapture(e.pointerId);
        root.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!state.dragging) return;
        const now = performance.now();
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        const dAz = -dx * 0.008;
        state.az += dAz;
        if (e.pointerType !== 'touch') {
            state.el = Math.min(EL_MAX, Math.max(EL_MIN, state.el + dy * 0.005));
        }
        const dt = Math.max(1, now - lastT) / 1000;
        state.vAz = state.vAz * 0.6 + (dAz / dt) * 0.4;
        lastX = e.clientX; lastY = e.clientY; lastT = now;
        state.idle = 0;
        state.autoBlend = 0;
    });
    const endDrag = () => {
        if (!state.dragging) return;
        state.dragging = false;
        if (performance.now() - lastT > 80) state.vAz = 0;
        root.classList.remove('is-dragging');
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('keydown', (e) => {
        const step = 0.15;
        if (e.key === 'ArrowLeft') state.az -= step;
        else if (e.key === 'ArrowRight') state.az += step;
        else if (e.key === 'ArrowUp') state.el = Math.min(EL_MAX, state.el + 0.08);
        else if (e.key === 'ArrowDown') state.el = Math.max(EL_MIN, state.el - 0.08);
        else return;
        e.preventDefault();
        state.idle = 0; state.autoBlend = 0;
    });

    // ----- day / night follows the site's dark mode -----
    const applyTheme = () => {
        const night = document.body.classList.contains('dark-mode');
        world.setNight(night);
        ambience.setNight(night);
        campers.setNight(night);
        if (!state.running) renderFrame();
    };
    new MutationObserver(applyTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // ----- loop -----
    let raf = 0, prev = 0;
    function tick(t) {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(0.05, prev ? (t - prev) / 1000 : 0);
        prev = t;

        if (!state.dragging) {
            state.az += state.vAz * dt;
            state.vAz *= Math.pow(0.03, dt);
            state.idle += dt;
            if (state.auto && state.idle > IDLE_BEFORE_AUTO) {
                state.autoBlend = Math.min(1, state.autoBlend + dt * 0.6);
            }
            state.az += AUTO_SPEED * state.autoBlend * dt;
        }


        if (state.zoom !== state.zoomGoal) {
            state.zoom += (state.zoomGoal - state.zoom) * (1 - Math.exp(-dt * 10));
            if (Math.abs(state.zoom - state.zoomGoal) < 1e-3) state.zoom = state.zoomGoal;
            applyZoom();
        }
        placeCamera(state.az, state.el);
        if (!frozen) actors(dt);
        ambience.update(dt, walkers);
        world.update(dt, camera, target);
        pipeline.render(scene, camera, hiddenInNormals());
    }
    function start() {
        if (state.running) return;
        state.running = true;
        prev = 0;
        raf = requestAnimationFrame(tick);
    }
    function stop() {
        state.running = false;
        cancelAnimationFrame(raf);
    }

    // Only animate while visible on screen.
    let onScreen = true;
    new IntersectionObserver((entries) => {
        onScreen = entries[0].isIntersecting;
        onScreen && !document.hidden ? start() : stop();
    }).observe(root);
    document.addEventListener('visibilitychange', () => {
        onScreen && !document.hidden ? start() : stop();
    });

    new ResizeObserver(resize).observe(root.querySelector('.boulder-stage'));
    resize();
    applyTheme();
    start();
}

document.querySelectorAll('[data-boulder]').forEach(init);
