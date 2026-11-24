import { Boulderer, V, attemptScript, makeProblems } from './boulderer.js';

// The two friends on the overhang. Turns repeat:
//   1. white tee (me) tries and comes off at the crux, green spots
//   2. green walks to the chalk bucket, chalks up and shows how it's done,
//      white spots
//   3. white tries again and sends, green spots
const WHITE = {
    skin: 0xe8bf98,
    shirt: 0xf4f2ec,
    backText: 'beta',
    backInk: 0x1d1d22,
    shorts: 0x1f1f24,
    shoes: 0x3b3640,
    hair: 0x17151a,
    beanie: 0x8d8f93,
    beanieBand: 0x74767b,
    chalkBag: 0x2f6d6a,
};
const GREEN = {
    skin: 0xd9a77e,
    shirt: 0x4f7d4a,      // green hoodie
    shorts: 0x34495e,     // jeans
    legs: 0x34495e,
    shoes: 0xdedad2,
    hair: 0x3a2a1e,
};

const WHITE_HOME = V(3.75, 1.35);
const GREEN_HOME = V(3.55, -0.95);
// From the bottom of the rope (by the yellow pad) back round to the front
const ROPE_TO_FRONT = [V(1.7, 3.3), V(2.45, 3.8), V(3.6, 3.25)];
const WHITE_PATH = [...ROPE_TO_FRONT, V(3.95, 2.0)];
const GREEN_PATH = [...ROPE_TO_FRONT, V(4.45, 1.9), V(4.3, 0.15)];   // wide of white, past the bucket

const TURNS = [
    { who: 'white', fail: true },
    { who: 'green', fail: false },
    { who: 'white', fail: false },
];

export class Crew {
    constructor(scene, world, fx) {
        this.white = new Boulderer(scene, world, { look: WHITE, home: WHITE_HOME, face: [-1, 0], fx, seed: 7 });
        this.green = new Boulderer(scene, world, { look: GREEN, home: GREEN_HOME, face: [-1, 0.3], fx, seed: 19 });
        this.problem = makeProblems(world).overhang;
        this.turn = -1;
        this.nextTurn();
    }

    nextTurn() {
        this.turn = (this.turn + 1) % TURNS.length;
        const { who, fail } = TURNS[this.turn];
        const active = this[who];
        const other = who === 'white' ? this.green : this.white;
        this.active = active;
        const white = who === 'white';
        active.setScript(attemptScript(active, this.problem, {
            fail,
            chalk: white ? 'bag' : 'bucket',
            rand: active.rand,
            flex: true,
            // after a fall, go straight into the next turn from the pads
            home: fail ? null : active.home,
            homeFace: white ? [-1, 0] : [-1, 0.3],
            homePath: white ? WHITE_PATH : GREEN_PATH,
        }), () => this.nextTurn());
        other.setScript([{ do: 'spot', who: active }]);
    }

    get people() {
        return [this.white, this.green];
    }

    update(dt) {
        this.white.update(dt);
        this.green.update(dt);
    }
}

/**
 * What the onlookers react to: whoever just sent, else whoever is on the wall
 * or falling, else whoever is coming down, else fallback().
 */
export function audience(people, fallback = () => people[0]) {
    const focus = () => people.find((p) => p.sent)
        || people.find((p) => p.climbing || p.falling)
        || people.find((p) => p.descending)
        || fallback();
    return {
        get sent() { return people.some((p) => p.sent); },
        /** One of the group topped out and is pumping a fist at us. */
        get flexing() { return people.some((p) => p.flexing); },
        get t() { return (people.find((p) => p.flexing) || people[0]).step.t; },
        get climbing() { return focus().climbing; },
        get falling() { return focus().falling; },
        get descending() { return focus().descending; },
        get pelvis() { return focus().pelvis; },
    };
}
