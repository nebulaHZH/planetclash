// Verify: turret/soldier rounds no longer one-shot the 3-heart player.
// Drives warzone bullet logic headlessly via CDP.
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('chrome not reachable')
}

let id = 0
const pending = new Map()
function send(ws, method, params) {
  const msgId = ++id
  ws.send(JSON.stringify({ id: msgId, method, params }))
  return new Promise((res, rej) => pending.set(msgId, { res, rej }))
}

const wsUrl = await getWsUrl()
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) }
}
const evalJs = async (expr) => {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('page err: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}

await send(ws, 'Page.enable', {})
await send(ws, 'Page.navigate', { url: 'file:///Users/bili/Documents/code/planet/PlanetClash.html?debug' })
// wait for __planet
let ready = false
for (let i = 0; i < 60; i++) {
  ready = await evalJs('!!window.__planet && !!window.__planet.war')
  if (ready) break
  await sleep(500)
}
if (!ready) throw new Error('__planet never appeared')

const result = await evalJs(`(() => {
  const g = window.__planet
  const war = g.war
  if (!war.turrets.length) return { error: 'no turrets' }

  const B = war.specs.B
  const V3 = war.specs.A.center.constructor // bundled THREE.Vector3
  war.group.updateMatrixWorld(true)
  const big = war.turrets.find((t) => t.world === 'B' && t.tier === 'big')
  // Silence all turret AI so only the manually spawned round can hit.
  for (const t of war.turrets) t.dead = true
  for (const s of war.soldiers) s.state = 'dead'
  // Player stands ~9m from the big turret on B, feet on the surface.
  const muzzle = big.tip.getWorldPosition(new V3())
  const playerPos = big.group.position.clone()
    .add(new V3(0, 0, 9)) // 9m lateral on the surface
  playerPos.setLength(big.group.position.length()) // same radial distance as turret base

  const ctx = {
    playerPos, playerWorld: 'B', playerInRide: false, playerAlive: true,
    hurtPlayer: (amt) => hits.push(amt),
    onAssist: () => {}, onWarKill: () => {}, refillAmmo: () => {},
    toast: () => {}, onEnd: () => {},
  }
  const hits = []
  window.__hits = hits

  const cases = [6, 9, 14, 16, 20] // small, mid, soldier, big, hero
  const BULLET_TIER_SPEED = 46
  for (const dmg of cases) {
    hits.length = 0
    war.spawnBullet(muzzle, playerPos, 'B', 'B', 'player', null, 46, dmg)
    // step until bullet arrives (or timeout)
    for (let i = 0; i < 400 && hits.length === 0; i++) war.update(0.02, ctx)
    if (hits.length === 0) return { error: 'bullet never hit for dmg ' + dmg }
    var lastHit = hits[hits.length - 1]
    window.__caseResult = window.__caseResult || []
    window.__caseResult.push({ dmg, hearts: lastHit })
  }
  return window.__caseResult
})()`)

console.log('cases:', JSON.stringify(result, null, 2))
const bad = Array.isArray(result) && result.some((c) => c.hearts >= 3 || c.hearts < 1)
console.log(bad ? 'FAIL: some hit removes >=3 hearts' : 'PASS: no single hit kills the 3-heart player')

ws.close()
process.exit(0)
