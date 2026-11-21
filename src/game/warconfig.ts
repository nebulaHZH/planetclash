import * as THREE from 'three'
import type { Faction } from '../types'
import { plainRadius } from './world'

/**
 * Both worlds share one layout expressed in LOCAL directions. A per-planet
 * frame rotates local +Y onto that world's capital direction, so the two
 * planets are geometrically identical and differ only in palette — exactly
 * the "same base, different colour" the war calls for.
 */
export type PlanetSpec = {
  faction: Faction
  center: THREE.Vector3
  radius: number
  /** Unit world-space direction of local +Y (where the capital/heart sits). */
  capitalDir: THREE.Vector3
  frame: THREE.Quaternion
  palette: {
    sea: string
    land: string
    rock: string
    cap: string
    accent: string
    heart: string
  }
}

const UP = new THREE.Vector3(0, 1, 0)

export function makeSpec(
  faction: Faction,
  center: THREE.Vector3,
  radius: number,
  capitalDir: THREE.Vector3,
  palette: PlanetSpec['palette'],
): PlanetSpec {
  return {
    faction,
    center: center.clone(),
    radius,
    capitalDir: capitalDir.clone().normalize(),
    frame: new THREE.Quaternion().setFromUnitVectors(UP, capitalDir.clone().normalize()),
    palette,
  }
}

/** Local unit direction -> world unit direction for a planet. */
export function localToWorldDir(spec: PlanetSpec, local: THREE.Vector3, out = new THREE.Vector3()) {
  return out.copy(local).applyQuaternion(spec.frame).normalize()
}

/** Walking/terrain radius at a world-space unit direction on a planet. */
export function surfaceFor(spec: PlanetSpec, worldDir: THREE.Vector3, bDigs?: (d: THREE.Vector3) => number) {
  const base = plainRadius(worldDir) - (spec.radius - 96)
  return spec.faction === 'B' && bDigs ? base - bDigs(worldDir) : base
}

const _placeDir = new THREE.Vector3()
/** Place a point on a planet from a local direction plus a radial lift. */
export function placeOn(spec: PlanetSpec, local: THREE.Vector3, lift = 0, bDigs?: (d: THREE.Vector3) => number, out = new THREE.Vector3()) {
  const dir = localToWorldDir(spec, local, _placeDir)
  const r = surfaceFor(spec, dir, bDigs) + lift
  return out.copy(spec.center).addScaledVector(dir, r)
}

// -------------------------------------------------------------- layout map
// Identical on both planets. Every number below is a LOCAL direction.
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize()

export const LAYOUT = {
  capital: v(0, 1, 0),
  /** Big turret stands between the landing pad and the heart. */
  big: v(0.02, 0.97, -0.22),
  /** Four medium turrets ring the heart at a comfortable spacing. */
  mid: [v(0.19, 0.97, 0.02), v(-0.19, 0.97, 0.02), v(0, 0.97, 0.2), v(0, 0.97, -0.2)],
  /** Smaller towers scattered wide and sparse — never a wall. */
  small: [
    v(0.34, 0.92, 0.28), v(-0.36, 0.91, 0.24), v(0.3, 0.9, -0.34), v(-0.32, 0.9, -0.3),
    v(0.46, 0.84, -0.02), v(-0.44, 0.85, 0.06),
  ],
  /** Shuttle + rocket pad, a short hop from the capital. */
  pad: v(0.2, 0.96, 0.14),
  rocketPad: v(-0.16, 0.97, 0.13),
  /** Safe spawn on the far side, behind the capital. */
  spawn: v(-0.06, -0.98, -0.14),
  /** Where squads gather before boarding. */
  rally: v(0.12, 0.97, -0.06),
  /** Ammo/supply crate, a short walk from the pad on each world. */
  supply: v(0.3, 0.95, 0.02),
  /** Enemy hero spawns and rallies beside the squads. */
  heroRally: v(-0.02, 0.97, -0.1),
} as const

// ------------------------------------------------------------------ tuning
export const WAR = {
  /** A whole fleet ferries on a rolling timetable, so a shuttle is never far away. */
  shipCount: 5,         // shuttles in the rotating fleet
  shipCruise: 6,        // seconds a docked shuttle waits before departing
  shipFlight: 11,       // seconds per crossing
  shipHp: 260,
  shipCannonDamage: 34,
  shipCannonRange: 90,
  shipCannonPeriod: 0.24,
  // Manual flight is a free rigid body: W/S thrust along the nose, mouse steers.
  shipThrust: 78,       // forward/back acceleration (m/s²)
  shipStrafe: 46,       // lateral acceleration (m/s²)
  shipMaxSpeed: 120,    // terminal speed under sustained thrust
  shipDamping: 0.55,    // velocity bleed per second so releasing W coasts to a stop
  shipLandingDist: 4.5, // radial gap at which a low-speed ship sets down on a world
  shipLandingSpeed: 30, // below this radial speed a manual landing is safe

  /** A standing ammo crate refills the player's reserve on a cooldown. */
  supplyAmmo: 90,       // rounds granted per refill
  supplyCooldown: 8,    // seconds before a crate can refill again
  supplyRadius: 4.5,    // how close the player must stand

  /** One hero per side: tougher than a soldier, hits harder, leads the charge. */
  hero: { hp: 520, speed: 4.2, damage: 20, period: 0.62, range: 34, respawn: 9, commute: 8 },

  // Thrust must beat surface gravity (gravity/r² ≈ 54 m/s² at r≈96) or the
  // rocket can never leave the pad. Net climb ≈ 100 m/s² feels responsive.
  rocketThrust: 165,
  rocketBurn: 9,        // fuel units per second at full thrust
  rocketFuel: 100,
  rocketLaunch: 16,     // initial radial kick so a fresh rocket clears the pad
  rocketHp: 90,
  rocketCannonDamage: 18,
  rocketCannonRange: 60,
  rocketCannonPeriod: 0.16,
  /** Below this radial speed a landing is safe, above it the rocket crashes. */
  safeLanding: 26,
  gravity: 5e5,

  turret: {
    big: { hp: 620, range: 78, damage: 16, period: 0.85 },
    mid: { hp: 260, range: 62, damage: 9, period: 1.1 },
    small: { hp: 120, range: 44, damage: 6, period: 1.45 },
  } as const,

  heartCaptureTime: 7,
  soldier: { hp: 110, speed: 3.4, damage: 14, period: 0.7, range: 26, respawn: 6, commute: 9 },
  squadPerSide: 2,
  respawnTime: 2.6,

  /** Pacing: AI chip damage vs structures, and how soon invasions start. */
  aiStructureDamageScale: 0.5,   // AI soldiers/heroes chew turrets at half player DPS
  aiFirstWaveDelay: 13,          // seconds before the first AI wave heads for a shuttle
  aiWaveInterval: 26,            // seconds between later AI board attempts

  /** Enemy-world digging: repeated shovels deepen one shaft down to bedrock. */
  digMaxB: 6,           // deepest a B-side hole can go, matching A's DIG_MAX
  digStepB: 1.55,       // extra depth per shovelful on the same spot
  digRadiusB: 5.2,      // surface footprint of a B-side hole
} as const

/** Gravity acceleration at a world point from both planets. */
export function gravityAt(point: THREE.Vector3, specs: PlanetSpec[], out = new THREE.Vector3()) {
  out.set(0, 0, 0)
  for (const spec of specs) {
    const d = _g.copy(spec.center).sub(point)
    const r2 = Math.max(900, d.lengthSq())
    out.addScaledVector(d.normalize(), WAR.gravity / r2)
  }
  return out
}
const _g = new THREE.Vector3()
