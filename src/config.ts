import type { ColorRepresentation } from 'three'

/** 7-color toy palette. Keep new art inside these roles. */
export const COLORS = {
  mint: '#8FE4C2',
  candy: '#FF7FA8',
  lemon: '#FFE38A',
  sky: '#9EDCFF',
  outline: '#2B1B2F',
  skin: '#FFD2AE',
  white: '#FFFDF8',
  shadow: '#7651A5',
  gold: '#F8B84E',
  plum: '#3A2452',
} as const

/** First-person tuning. Units are metres-ish; radius is planet scale. */
export const PHYSICS = {
  radius: 40,
  gravity: 25,
  walkSpeed: 6.8,
  sprintSpeed: 11.3,
  aimSpeed: 3.7,
  jumpSpeed: 8.6,
  eyeHeight: 1.6,
  fov: 74,
  adsFov: 52,
  near: 0.045,
  far: 460,
  sens: 0.0022,
} as const

export const GAME = {
  killTarget: 7,
  captureRadius: 3.6,
  captureTime: 2.7,
  headshotMult: 1.9,
  invuln: 0.9,
  ammoReward: 5,
  maxParticles: 420,
} as const

export type Hat = 'crown' | 'antenna' | 'cat' | 'mushroom' | 'tuft'
export type Expression = 'happy' | 'focused' | 'hurt' | 'ko'

export type CharacterConfig = {
  id: string
  name: string
  role: string
  headScale: number
  bodyColor: ColorRepresentation
  accentColor: ColorRepresentation
  hat: Hat
  expression: Expression
  weaponSkin: string
  speed: number
  health: number
  description: string
}

export const CHARACTERS: CharacterConfig[] = [
  {
    id: 'pudding', name: '布丁队长', role: '指挥官', headScale: 1.06,
    bodyColor: COLORS.lemon, accentColor: COLORS.candy, hat: 'crown', expression: 'happy', weaponSkin: 'silver', speed: 1, health: 3,
    description: '平衡型 · 憨憨的星球领队',
  },
  {
    id: 'bobo', name: '啵啵', role: '弹跳手', headScale: 1.02,
    bodyColor: COLORS.mint, accentColor: COLORS.sky, hat: 'tuft', expression: 'happy', weaponSkin: 'bubble', speed: 1.06, health: 3,
    description: 'Q 弹史莱姆 · 跑得轻快',
  },
  {
    id: 'rivet', name: '铆钉', role: '机械师', headScale: .98,
    bodyColor: COLORS.sky, accentColor: COLORS.gold, hat: 'antenna', expression: 'focused', weaponSkin: 'spring', speed: .95, health: 3,
    description: '天线机器人 · 后坐力更稳',
  },
  {
    id: 'mia', name: '喵桑', role: '刺客', headScale: .9,
    bodyColor: COLORS.white, accentColor: COLORS.candy, hat: 'cat', expression: 'happy', weaponSkin: 'pink', speed: 1.18, health: 3,
    description: '猫耳刺客 · 全场最快',
  },
  {
    id: 'dafu', name: '大福', role: '重装', headScale: 1.14,
    bodyColor: '#FFAAC2', accentColor: COLORS.mint, hat: 'mushroom', expression: 'happy', weaponSkin: 'candy', speed: .82, health: 5,
    description: '蘑菇团子 · 五颗爱心重装',
  },
]

export type WeaponConfig = {
  id: string
  name: string
  short: string
  icon: string
  color: string
  auto: boolean
  /** shots per second */
  rate: number
  damage: number
  magazine: number
  reserve: number
  pellets: number
  /** radians at hip */
  spreadHip: number
  /** radians while aiming */
  spreadAim: number
  recoil: number
  range: number
  falloffStart: number
  reload: number
  draw: number
  viewmodel: 'pistol' | 'smg' | 'shotgun'
  tagline: string
  sound: 'pew' | 'brr' | 'boom'
}

export const WEAPONS: WeaponConfig[] = [
  {
    id: 'bubble', name: '泡泡枪', short: 'BUBBLE', icon: '◉', color: COLORS.sky,
    auto: false, rate: 3, damage: 26, magazine: 12, reserve: 48, pellets: 1,
    spreadHip: .006, spreadAim: .0015, recoil: .85, range: 90, falloffStart: 40,
    reload: 1, draw: .3, viewmodel: 'pistol', tagline: '单发 · 精准 · 高伤', sound: 'pew',
  },
  {
    id: 'spray', name: '彩虹喷射', short: 'RAINBOW', icon: '✦', color: COLORS.candy,
    auto: true, rate: 11, damage: 9, magazine: 36, reserve: 108, pellets: 1,
    spreadHip: .034, spreadAim: .014, recoil: .32, range: 70, falloffStart: 35,
    reload: 1.35, draw: .35, viewmodel: 'smg', tagline: '全自动 · 彩虹弹幕', sound: 'brr',
  },
  {
    id: 'star', name: '星星散弹', short: 'STAR', icon: '★', color: COLORS.gold,
    auto: false, rate: .95, damage: 8, magazine: 6, reserve: 30, pellets: 8,
    spreadHip: .11, spreadAim: .085, recoil: 2.6, range: 32, falloffStart: 11,
    reload: 1.5, draw: .42, viewmodel: 'shotgun', tagline: '八颗星 · 近距离清场', sound: 'boom',
  },
]
