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
  radius: 96,
  gravity: 25,
  walkSpeed: 6.8,
  sprintSpeed: 11.3,
  aimSpeed: 3.7,
  jumpSpeed: 8.6,
  eyeHeight: 1.6,
  fov: 74,
  adsFov: 52,
  near: 0.045,
  far: 1000,
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
export type CharacterModel = 'Knight' | 'Barbarian' | 'Mage' | 'Ranger' | 'Rogue' | 'Rogue_Hooded'
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
  /** KayKit character mesh used in game. */
  model: CharacterModel
  speed: number
  health: number
  description: string
}

export const CHARACTERS: CharacterConfig[] = [
  {
    id: 'knight', name: '铁桶骑士', role: '队长', headScale: 1.06,
    bodyColor: COLORS.sky, accentColor: COLORS.gold, hat: 'crown', expression: 'happy', weaponSkin: 'silver', model: 'Knight', speed: 1, health: 3,
    description: '平衡型 · 队伍前排',
  },
  {
    id: 'barbarian', name: '蛮蛮', role: '狂战士', headScale: 1.04,
    bodyColor: '#D9A16F', accentColor: COLORS.candy, hat: 'mushroom', expression: 'focused', weaponSkin: 'candy', model: 'Barbarian', speed: .94, health: 5,
    description: '五颗爱心 · 扛打的重装',
  },
  {
    id: 'mage', name: '紫袍法师', role: '法师', headScale: .98,
    bodyColor: '#8E7BD6', accentColor: COLORS.lemon, hat: 'mushroom', expression: 'focused', weaponSkin: 'bubble', model: 'Mage', speed: .96, health: 3,
    description: '远程支援 · 弹药更多',
  },
  {
    id: 'ranger', name: '绿林游侠', role: '游侠', headScale: 1.0,
    bodyColor: COLORS.mint, accentColor: COLORS.sky, hat: 'tuft', expression: 'happy', weaponSkin: 'spring', model: 'Ranger', speed: 1.08, health: 3,
    description: '敏捷 · 移动速度 +8%',
  },
  {
    id: 'rogue', name: '喵影', role: '刺客', headScale: .96,
    bodyColor: '#C0705B', accentColor: COLORS.candy, hat: 'cat', expression: 'happy', weaponSkin: 'pink', model: 'Rogue', speed: 1.16, health: 3,
    description: '全场最快 · 打完就跑',
  },
  {
    id: 'hooded', name: '夜砂', role: '潜行者', headScale: 1.0,
    bodyColor: '#2E9E63', accentColor: COLORS.mint, hat: 'cat', expression: 'focused', weaponSkin: 'bubble', model: 'Rogue_Hooded', speed: 1.1, health: 4,
    description: '四颗爱心 · 又肉又快',
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
