export type Faction = 'A' | 'B'
export type RideMode = 'foot' | 'ship' | 'rocket'

/** Where the player is and what they are sitting in. */
export type RideState = {
  mode: RideMode
  /** Ship only: true = on rails, false = player steers. */
  auto: boolean
  hp: number
  maxHp: number
  fuel: number
  maxFuel: number
  /** Ship destination, or rocket's intended target. */
  target: Faction
  /** 0..1 along the ship's flight. */
  progress: number
  speed: number
}

export type HudState = {
  // ---- legacy combat (kept: the mascots still fight on the home world) ----
  health: number
  maxHealth: number
  weaponIndex: number
  ammo: number
  reserve: number
  reloading: boolean
  reloadProgress: number
  score: number
  enemiesLeft: number
  enemiesTotal: number
  sprint: number
  spread: number
  aiming: boolean
  captured: number
  captureProgress: [number, number]
  nearestDist: number
  bearing: number
  characterId: string
  running: boolean

  // ---- the war ----
  /** Which world the player is standing on. */
  world: Faction
  ride: RideState
  /** Our heart: 0 safe, 1 stolen. Enemy heart: 0 hidden, 1 taken-ready. */
  heartA: number
  heartB: number
  bHeartRisen: boolean
  /** Remaining enemy turrets, split by size. */
  turrets: { big: number; mid: number; small: number }
  /** Living soldiers on each side. */
  allies: { friendly: number; hostile: number }
  /** Hero availability: 0/1 alive each side, enemy hero health fraction. */
  heroes: { friendly: number; hostile: number; hostileHp: number }
  /** Shuttles currently crossing between the two worlds. */
  shipsInFlight: number
  /** True when a charged ammo crate is within reach. */
  supplyNearby: boolean
  /** Seconds until the player respawns, or -1 when alive. */
  respawn: number
  /** Seconds until the next shuttle departs, or 0 while in flight. */
  shipEta: number
  /** Kills / deaths / assists across the whole match. */
  kda: { kills: number; deaths: number; assists: number }
  /** Direction to the nearest boardable vehicle, radians from heading; Infinity if none. */
  vehicleBearing: number
  vehicleDist: number
  vehicleKind: 'ship' | 'rocket' | null
}

export type EndResult = {
  won: boolean
  /** 'heart' = heart taken/stolen, 'retire' = legacy fallback. */
  cause: 'heart' | 'retire'
  kills: number
  deaths: number
  assists: number
  accuracy: number
  time: number
  captured: number
  turretsDown: number
}

export type GameEvent =
  | { kind: 'damage'; amount: number; headshot: boolean; x: number; y: number }
  | { kind: 'kill'; name: string; x: number; y: number; headshot: boolean }
  | { kind: 'hit'; headshot: boolean }
  | { kind: 'toast'; text: string; tone: 'good' | 'bad' | 'gold' }
  | { kind: 'hurt'; health: number }
  | { kind: 'respawn' }
  | { kind: 'paused' }
  | { kind: 'resumed' }
  | { kind: 'end'; result: EndResult }
  | { kind: 'lockFailed' }

export type GameCallbacks = {
  onHud: (hud: HudState) => void
  onEvent: (event: GameEvent) => void
}

const ride = (): RideState => ({
  mode: 'foot', auto: true, hp: 1, maxHp: 1, fuel: 0, maxFuel: 0,
  target: 'B', progress: 0, speed: 0,
})

export const emptyHud = (): HudState => ({
  health: 3,
  maxHealth: 3,
  weaponIndex: 0,
  ammo: 12,
  reserve: 48,
  reloading: false,
  reloadProgress: 0,
  score: 0,
  enemiesLeft: 7,
  enemiesTotal: 7,
  sprint: 1,
  spread: 0,
  aiming: false,
  captured: 0,
  captureProgress: [0, 0],
  nearestDist: -1,
  bearing: 0,
  characterId: 'pudding',
  running: false,
  world: 'A',
  ride: ride(),
  heartA: 0,
  heartB: 0,
  bHeartRisen: false,
  turrets: { big: 1, mid: 4, small: 6 },
  allies: { friendly: 3, hostile: 3 },
  heroes: { friendly: 1, hostile: 1, hostileHp: 1 },
  shipsInFlight: 0,
  supplyNearby: false,
  respawn: -1,
  shipEta: 0,
  kda: { kills: 0, deaths: 0, assists: 0 },
  vehicleBearing: Infinity,
  vehicleDist: -1,
  vehicleKind: null,
})
