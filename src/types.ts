export type HudState = {
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
}

export type EndResult = {
  won: boolean
  kills: number
  accuracy: number
  time: number
  captured: number
}

export type GameEvent =
  | { kind: 'damage'; amount: number; headshot: boolean; x: number; y: number }
  | { kind: 'kill'; name: string; x: number; y: number; headshot: boolean }
  | { kind: 'hit'; headshot: boolean }
  | { kind: 'toast'; text: string; tone: 'good' | 'bad' | 'gold' }
  | { kind: 'hurt'; health: number }
  | { kind: 'paused' }
  | { kind: 'resumed' }
  | { kind: 'end'; result: EndResult }
  | { kind: 'lockFailed' }

export type GameCallbacks = {
  onHud: (hud: HudState) => void
  onEvent: (event: GameEvent) => void
}

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
})
