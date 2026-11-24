import * as THREE from 'three';

// Renders the scene at low resolution, then composites with
// depth-based outlines (dark) and normal-based crease highlights (light).
// The canvas itself is the low-res buffer; CSS upscales it with
// `image-rendering: pixelated`.

const vert = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const frag = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float depthThreshold;
uniform float normalThreshold;
uniform float outlineStrength;
uniform float highlightStrength;
varying vec2 vUv;

float getDepth(vec2 uv) {
    // Orthographic camera: depth buffer is linear in view distance.
    return cameraNear + texture2D(tDepth, uv).r * (cameraFar - cameraNear);
}
vec3 getNormal(vec2 uv) {
    return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
}

void main() {
    vec2 texel = 1.0 / resolution;
    vec4 color = texture2D(tColor, vUv);
    float depth = getDepth(vUv);
    vec3 normal = getNormal(vUv);

    vec2 offs[4];
    offs[0] = vec2( 0.0,  1.0);
    offs[1] = vec2( 0.0, -1.0);
    offs[2] = vec2( 1.0,  0.0);
    offs[3] = vec2(-1.0,  0.0);

    float depthDiff = 0.0;
    float normalDiff = 0.0;
    for (int i = 0; i < 4; i++) {
        vec2 uv2 = vUv + offs[i] * texel;
        float d2 = getDepth(uv2);
        // Only the nearer side of a depth discontinuity gets the outline (1px thick).
        depthDiff += clamp(d2 - depth, 0.0, 4.0);

        vec3 n2 = getNormal(uv2);
        // Highlight only one side of a crease, and not across depth gaps.
        float sameSurface = step(-0.05, d2 - depth) * step(d2 - depth, 0.3);
        float side = step(0.0, dot(normal - n2, vec3(1.0, 1.0, 1.0)));
        normalDiff += (1.0 - dot(normal, n2)) * sameSurface * side;
    }

    float dEdge = step(depthThreshold, depthDiff);
    float nEdge = step(normalThreshold, normalDiff) * (1.0 - dEdge);

    vec3 c = color.rgb;
    c *= mix(1.0, outlineStrength, dEdge);
    c *= mix(1.0, highlightStrength, nEdge);

    gl_FragColor = vec4(c, color.a);
    #include <colorspace_fragment>
}`;

export class PixelPipeline {
    constructor(renderer) {
        this.renderer = renderer;
        const rtOpts = {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            generateMipmaps: false,
        };
        this.colorRT = new THREE.WebGLRenderTarget(1, 1, {
            ...rtOpts,
            depthTexture: new THREE.DepthTexture(1, 1),
        });
        this.normalRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);
        this.normalMaterial = new THREE.MeshNormalMaterial();

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                tColor: { value: this.colorRT.texture },
                tNormal: { value: this.normalRT.texture },
                tDepth: { value: this.colorRT.depthTexture },
                resolution: { value: new THREE.Vector2(1, 1) },
                cameraNear: { value: 0.1 },
                cameraFar: { value: 100 },
                depthThreshold: { value: 0.18 },
                normalThreshold: { value: 0.25 },
                outlineStrength: { value: 0.42 },
                highlightStrength: { value: 1.32 },
            },
            vertexShader: vert,
            fragmentShader: frag,
            depthTest: false,
            depthWrite: false,
        });
        this.quadScene = new THREE.Scene();
        this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    }

    setSize(w, h) {
        this.colorRT.setSize(w, h);
        this.normalRT.setSize(w, h);
        this.material.uniforms.resolution.value.set(w, h);
    }

    render(scene, camera, hideInNormalPass = []) {
        const r = this.renderer;
        const u = this.material.uniforms;
        u.cameraNear.value = camera.near;
        u.cameraFar.value = camera.far;

        // 1) color + depth (shadow map updated once per frame here)
        r.shadowMap.needsUpdate = true;
        r.setRenderTarget(this.colorRT);
        r.clear();
        r.render(scene, camera);

        // 2) view-space normals
        const hidden = [];
        for (const o of hideInNormalPass) {
            if (o.visible) { o.visible = false; hidden.push(o); }
        }
        scene.overrideMaterial = this.normalMaterial;
        r.setRenderTarget(this.normalRT);
        r.clear();
        r.render(scene, camera);
        scene.overrideMaterial = null;
        for (const o of hidden) o.visible = true;

        // 3) composite to the (low-res) canvas
        r.setRenderTarget(null);
        r.clear();
        r.render(this.quadScene, this.quadCamera);
    }
}
