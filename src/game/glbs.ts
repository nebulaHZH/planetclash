/**
 * Every GLB the game needs, imported so the bundler can inline them — this is
 * what lets `vite build` produce one double-clickable HTML with no asset
 * folder. Lab pages import from here too.
 */
import knightUrl from '../assets/chars/Knight.glb?url'
import barbarianUrl from '../assets/chars/Barbarian.glb?url'
import mageUrl from '../assets/chars/Mage.glb?url'
import rangerUrl from '../assets/chars/Ranger.glb?url'
import rogueUrl from '../assets/chars/Rogue.glb?url'
import rogueHoodedUrl from '../assets/chars/Rogue_Hooded.glb?url'
import usagiUrl from '../assets/usagi.glb?url'
import nailongUrl from '../assets/nailong.glb?url'
import animGeneralUrl from '../assets/anim/Rig_Medium_General.glb?url'
import animMovementBasicUrl from '../assets/anim/Rig_Medium_MovementBasic.glb?url'
import animCombatRangedUrl from '../assets/anim/Rig_Medium_CombatRanged.glb?url'
import animMovementAdvancedUrl from '../assets/anim/Rig_Medium_MovementAdvanced.glb?url'
import raygunUrl from '../assets/guns/raygun.glb?url'
import coilgunUrl from '../assets/guns/coilgun.glb?url'
import launcherUrl from '../assets/guns/launcher.glb?url'

export const CHARACTER_URLS: Record<string, string> = {
  Knight: knightUrl,
  Barbarian: barbarianUrl,
  Mage: mageUrl,
  Ranger: rangerUrl,
  Rogue: rogueUrl,
  Rogue_Hooded: rogueHoodedUrl,
}
export const ANIM_URLS: Record<string, string> = {
  General: animGeneralUrl,
  MovementBasic: animMovementBasicUrl,
  CombatRanged: animCombatRangedUrl,
  MovementAdvanced: animMovementAdvancedUrl,
}
export const GUN_URLS: Record<string, string> = {
  raygun: raygunUrl,
  coilgun: coilgunUrl,
  launcher: launcherUrl,
}
export { usagiUrl, nailongUrl }
