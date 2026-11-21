import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { CHARACTERS, WEAPONS } from './config'
import { Game } from './game/Game'
import { emptyHud, type EndResult, type GameEvent, type HudState } from './types'

type Phase = 'menu' | 'playing' | 'paused' | 'won' | 'lost'

type Floaty = {
  id: number
  x: number
  y: number
  text: string
  sub?: string
  kind: 'damage' | 'head' | 'kill'
  rotate: number
}

const HAT_GLYPH: Record<string, string> = {
  crown: '♛',
  antenna: '✧',
  cat: 'ᐛ',
  mushroom: '☁',
  tuft: '❀',
  bean: '🐹',
  horn: '🐲',
  snout: '🐷',
}

const SENS_KEY = 'planetclash.sens'

function loadSensitivity() {
  const raw = window.localStorage.getItem(SENS_KEY)
  const value = raw ? Number(raw) : 1
  return Number.isFinite(value) ? Math.min(3, Math.max(0.2, value)) : 1
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const idRef = useRef(0)

  const [hud, setHud] = useState<HudState>(emptyHud)
  const [phase, setPhase] = useState<Phase>('menu')
  const [characterId, setCharacterId] = useState(CHARACTERS[0].id)
  const [floaties, setFloaties] = useState<Floaty[]>([])
  const [toast, setToast] = useState<{ id: number; text: string; tone: 'good' | 'bad' | 'gold' } | null>(null)
  const [hitId, setHitId] = useState(0)
  const [hurtId, setHurtId] = useState(0)
  const [result, setResult] = useState<EndResult | null>(null)
  const [sensitivity, setSensitivity] = useState(loadSensitivity)
  const [showControls, setShowControls] = useState(true)

  const character = CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[0]
  const weapon = WEAPONS[hud.weaponIndex] ?? WEAPONS[0]
  const isGun = weapon.kind === 'gun'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const timers: number[] = []
    let toastTimer = 0

    const pushFloaty = (floaty: Omit<Floaty, 'id' | 'rotate'>) => {
      const id = Date.now() * 100 + (++idRef.current % 100)
      const rotate = Math.round((Math.random() - 0.5) * 10)
      setFloaties((prev) => [...prev.slice(-13), { ...floaty, id, rotate }])
      const timer = window.setTimeout(() => {
        setFloaties((prev) => prev.filter((f) => f.id !== id))
      }, 900)
      timers.push(timer)
    }

    const showToast = (text: string, tone: 'good' | 'bad' | 'gold') => {
      window.clearTimeout(toastTimer)
      setToast({ id: Date.now() * 100 + (++idRef.current % 100), text, tone })
      toastTimer = window.setTimeout(() => setToast(null), 2400)
    }

    const onEvent = (event: GameEvent) => {
      switch (event.kind) {
        case 'damage':
          pushFloaty({
            x: event.x,
            y: event.y,
            text: `-${event.amount}`,
            kind: event.headshot ? 'head' : 'damage',
          })
          break
        case 'kill':
          pushFloaty({
            x: event.x,
            y: event.y,
            text: event.headshot ? 'KO! 爆头' : 'KO!',
            sub: event.name,
            kind: 'kill',
          })
          if (event.headshot) showToast('爆头击倒！', 'gold')
          break
        case 'hit':
          setHitId((n) => n + 1)
          break
        case 'hurt':
          setHurtId((n) => n + 1)
          if (event.health === 1) showToast('只剩一颗心！', 'bad')
          break
        case 'toast':
          showToast(event.text, event.tone)
          break
        case 'paused':
          setPhase('paused')
          break
        case 'resumed':
          setPhase('playing')
          break
        case 'end':
          setResult(event.result)
          setPhase(event.result.won ? 'won' : 'lost')
          break
        case 'lockFailed':
          showToast('鼠标未锁定：用鼠标瞄准，Esc 暂停', 'gold')
          break
      }
    }

    const game = new Game(canvas, { onHud: setHud, onEvent })
    gameRef.current = game
    game.setSensitivity(loadSensitivity())
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      window.clearTimeout(toastTimer)
      game.dispose()
      if (gameRef.current === game) gameRef.current = null
    }
  }, [])

  useEffect(() => {
    gameRef.current?.setSensitivity(sensitivity)
    window.localStorage.setItem(SENS_KEY, String(sensitivity))
  }, [sensitivity])

  useEffect(() => {
    if (phase === 'menu') return
    setShowControls(true)
    const timer = window.setTimeout(() => setShowControls(false), 11000)
    return () => window.clearTimeout(timer)
  }, [phase])

  const start = useCallback(() => {
    setResult(null)
    setFloaties([])
    gameRef.current?.start(characterId)
    setPhase('playing')
  }, [characterId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Enter' && event.code !== 'NumpadEnter') return
      if (phase === 'menu') start()
      else if (phase === 'won' || phase === 'lost') start()
      else if (phase === 'paused') {
        gameRef.current?.resume()
        setPhase('playing')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, start])

  const resume = () => {
    gameRef.current?.resume()
    setPhase('playing')
  }

  const restart = () => {
    setFloaties([])
    setResult(null)
    gameRef.current?.start(characterId)
    setPhase('playing')
  }

  const backToMenu = () => {
    setFloaties([])
    setResult(null)
    gameRef.current?.enterMenu()
    setPhase('menu')
  }

  const pickCharacter = (id: string) => {
    setCharacterId(id)
    if (phase === 'playing' || phase === 'paused') {
      gameRef.current?.start(id)
      setPhase('playing')
    }
  }

  return (
    <div className="game-shell">
      <canvas ref={canvasRef} className="game-canvas" />
      <div className="vignette" />
      <div className="grain" />

      {phase !== 'menu' && (
        <>
          <div className="hud">
            <div className="hud-top">
              <div className="brand-block">
                <div className="brand-star">✦</div>
                <div className="brand-copy">
                  <strong>PLANET CLASH</strong>
                  <small>{character.name} · {character.role}</small>
                </div>
              </div>

              <div className="war-board">
                <div className="war-title">
                  <span>星球之心争夺战</span>
                  <small>{hud.world === 'A' ? '你在糖果星球 · 防守' : '你在紫色星球 · 进攻'}</small>
                </div>
                <div className="heart-race">
                  <div className="heart-side ours">
                    <span className="heart-pip" />
                    <div className="heart-track"><i style={{ width: `${hud.heartA * 100}%` }} /></div>
                    <small>我方 {Math.round(hud.heartA * 100)}%</small>
                  </div>
                  <div className="heart-side theirs">
                    <small>{Math.round(hud.heartB * 100)}% 敌方</small>
                    <div className="heart-track"><i style={{ width: `${hud.heartB * 100}%` }} /></div>
                    <span className="heart-pip" />
                  </div>
                </div>
                <div className="war-stats">
                  <span title="敌方剩余防御塔 大/中/小">塔 {hud.turrets.big}·{hud.turrets.mid}·{hud.turrets.small}</span>
                  <span title="我方/敌方存活士兵">队友 {hud.allies.friendly} : {hud.allies.hostile}</span>
                  <span title="正在往返途中的飞船数量">飞船在途 {hud.shipsInFlight}</span>
                  <span className="kda-chip" title="击杀 / 死亡 / 助攻">
                    KDA <b className="k">{hud.kda.kills}</b>/<b className="d">{hud.kda.deaths}</b>/<b className="a">{hud.kda.assists}</b>
                  </span>
                </div>
                <div className="hero-row">
                  <span className={`hero-tag ally ${hud.heroes.friendly ? 'alive' : 'down'}`}>
                    我方英雄 {hud.heroes.friendly ? '存活' : '阵亡'}
                  </span>
                  <span className={`hero-tag enemy ${hud.heroes.hostile ? 'alive' : 'down'}`} title="紫色星球英雄血量">
                    敌方英雄 {hud.heroes.hostile ? `${Math.round(hud.heroes.hostileHp * 100)}%` : '阵亡'}
                    {hud.heroes.hostile && <i className="hero-hp"><b style={{ width: `${hud.heroes.hostileHp * 100}%` }} /></i>}
                  </span>
                </div>
              </div>
            </div>

            <div className={hud.aiming ? 'crosshair aim' : 'crosshair'} style={{ '--gap': `${4 + hud.spread * 34}px` } as CSSProperties}>
              <i className="tick top" />
              <i className="tick bottom" />
              <i className="tick left" />
              <i className="tick right" />
              <b className="dot" />
              {hud.nearestDist > 0 && (
                <div className="tracker">
                  <span className="tracker-arrow" style={{ transform: `rotate(${hud.bearing}rad)` }}>▲</span>
                  <span>{Math.round(hud.nearestDist)}m</span>
                </div>
              )}
            </div>
            {hitId > 0 && (
              <div className="hitmarker" key={hitId}>
                <i /><i /><i /><i />
              </div>
            )}

            {hud.respawn >= 0 && (
              <div className="respawn-banner">
                <small>被击倒 · 即将在己方星球重生</small>
                <b>{Math.ceil(hud.respawn)}s</b>
              </div>
            )}

            {hud.supplyNearby && hud.ride.mode === 'foot' && hud.respawn < 0 && (
              <div className="supply-prompt">
                <b>弹药补给站已就绪</b>
                <small>走近发光黄箱即可自动补满备弹</small>
              </div>
            )}

            {/* The "I can't find the rocket" fix: a big guided prompt. */}
            {hud.vehicleKind && hud.ride.mode === 'foot' && (
              <div className="vehicle-prompt">
                <span
                  className="vehicle-arrow"
                  style={{ transform: `rotate(${hud.vehicleBearing}rad)` }}
                >➤</span>
                <div className="vehicle-copy">
                  <b>{hud.vehicleKind === 'ship' ? '飞船 shuttle' : '火箭 rocket'} 在 {Math.round(hud.vehicleDist)}m 外</b>
                  <small>跟着箭头走 · 按 <kbd>F</kbd> 登上{hud.vehicleKind === 'ship' ? '飞船' : '火箭'}</small>
                </div>
              </div>
            )}

            {hud.shipEta > 0 && hud.ride.mode === 'foot' && !hud.vehicleKind && (
              <div className="vehicle-prompt waiting">
                <span className="vehicle-arrow">◷</span>
                <div className="vehicle-copy">
                  <b>下一班飞船 {Math.ceil(hud.shipEta)}s 后出发</b>
                  <small>5 艘飞船循环往返 · 蓝色光柱停机坪按 <kbd>F</kbd> 登舰</small>
                </div>
              </div>
            )}

            {hud.ride.mode !== 'foot' && (
              <div className={`ride-panel ${hud.ride.mode}`}>
                <div className="ride-head">
                  <b>{hud.ride.mode === 'ship' ? '飞船' : '火箭'}</b>
                  {hud.ride.mode === 'ship' && (
                    <span className={hud.ride.auto ? 'auto on' : 'auto'}>
                      {hud.ride.auto ? '自动驾驶' : '手动接管'} · <kbd>E</kbd> 切换
                    </span>
                  )}
                </div>
                {hud.ride.mode === 'ship' && (
                  <div className="ride-gauge"><label>船体</label><div className="bar"><i style={{ width: `${hud.ride.hp / hud.ride.maxHp * 100}%` }} /></div></div>
                )}
                {hud.ride.mode === 'ship' && !hud.ride.auto && (
                  <div className="ride-gauge speed"><label>航速</label><div className="bar"><i style={{ width: `${Math.min(100, hud.ride.speed / 120 * 100)}%` }} /></div><b>{Math.round(hud.ride.speed)}</b></div>
                )}
                {hud.ride.mode === 'rocket' && (
                  <div className="ride-gauge fuel"><label>燃料</label><div className="bar"><i style={{ width: `${hud.ride.fuel / hud.ride.maxFuel * 100}%` }} /></div><b>{Math.ceil(hud.ride.fuel)}</b></div>
                )}
                <div className="ride-hint">
                  {hud.ride.mode === 'ship' ? (
                    hud.ride.auto
                      ? <>左键开炮 · <kbd>G</kbd> 弹射火箭 · <kbd>F</kbd> 离开</>
                      : <><kbd>W</kbd>/<kbd>S</kbd> 前进后退 · 鼠标转向 · <kbd>A</kbd>/<kbd>D</kbd> 侧移 · 飞近星球低速降落 · <kbd>F</kbd> 离开</>
                  ) : (
                    <><kbd>W</kbd> 推进 · 鼠标转向 · 左键开炮 · <kbd>F</kbd> 离开</>
                  )}
                </div>
              </div>
            )}

            <div className="hud-bottom">
              <div className="health-block">
                <div className="health-sticker">
                  <span className="hud-label">生命值</span>
                  <div className="hearts">
                    {Array.from({ length: hud.maxHealth }, (_, i) => (
                      <span key={i} className={i < hud.health ? 'heart' : 'heart broken'}>❤</span>
                    ))}
                  </div>
                </div>
                <div className="stamina-sticker">
                  <span className="hud-label">冲刺能量</span>
                  <div className="bar"><i style={{ width: `${hud.sprint * 100}%` }} /></div>
                </div>
              </div>

              <div className="controls-hint" data-visible={showControls}>
                <span><kbd>WASD</kbd> 移动</span>
                <span><kbd>F</kbd> 登船/火箭</span>
                <span><kbd>SPACE</kbd> 跳跃</span>
                <span><kbd>R</kbd> 换弹</span>
                <span><kbd>1-6</kbd> 换武器</span>
                <span><kbd>右键</kbd> 瞄准</span>
                <span><kbd>ESC</kbd> 暂停</span>
              </div>

              <div className="weapon-block">
                <div className="weapon-sticker">
                  <div className="weapon-icon" style={{ background: weapon.color }}>{weapon.icon}</div>
                  <div className="weapon-copy">
                    <small>{weapon.short} · {weapon.tagline}</small>
                    <strong>{weapon.name}</strong>
                    <span className={isGun && hud.ammo <= 2 ? 'ammo-low' : ''}>
                      {isGun ? (hud.reloading ? '换弹中…' : '按 R 换弹') : '左键使用'}
                    </span>
                  </div>
                  {isGun && (
                    <div className="ammo">
                      <b>{hud.ammo}</b>
                      <span>/ {hud.reserve}</span>
                    </div>
                  )}
                  {hud.reloading && <div className="reload-line" style={{ width: `${hud.reloadProgress * 100}%` }} />}
                </div>
                <div className="weapon-tabs">
                  {WEAPONS.map((w, i) => (
                    <button
                      key={w.id}
                      className={i === hud.weaponIndex ? 'selected' : ''}
                      style={{ '--tint': w.color } as CSSProperties}
                      title={w.name}
                    >
                      <b>{w.icon}</b>
                      <small>{i + 1}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {floaties.map((f) => (
            <div
              key={f.id}
              className={`floaty ${f.kind}`}
              style={{ left: f.x, top: f.y, '--rot': `${f.rotate}deg` } as CSSProperties}
            >
              <b>{f.text}</b>
              {f.sub && <small>{f.sub}</small>}
            </div>
          ))}

          {toast && <div key={toast.id} className={`toast ${toast.tone}`}>{toast.text}</div>}
          {hurtId > 0 && <div key={hurtId} className="hurt-flash" />}
        </>
      )}

      {phase === 'menu' && (
        <div className="menu">
          <div className="menu-card">
            <div className="eyebrow">
              <span className="tag">FIRST PERSON</span>
              <span>v2 · TOY PLANET</span>
            </div>
            <div className="logo-mark">✦</div>
            <h1>PLANET<span>CLASH</span></h1>
            <p className="tagline">
              两颗一模一样的星球，只差颜色。乘定时飞船或亲自驾驶火箭突袭敌方星球，
              拆掉守护大塔，夺走星球之心。<br />
              阵亡会在己方星球重生——战斗永不停歇。
            </p>
            <div className="feature-row">
              <span>◉ 双星攻城</span>
              <span>✦ 飞船/火箭</span>
              <span>♛ 夺心战</span>
              <span>❀ 队友协同</span>
            </div>

            <div className="roster">
              {CHARACTERS.map((c) => (
                <button
                  key={c.id}
                  className={`roster-item${c.id === characterId ? ' active' : ''}`}
                  onClick={() => setCharacterId(c.id)}
                >
                  <span className="roster-avatar" style={{ background: String(c.bodyColor), borderColor: String(c.accentColor) }}>
                    {HAT_GLYPH[c.hat] ?? '✦'}
                  </span>
                  <span className="roster-copy">
                    <b>{c.name}</b>
                    <small>{'❤'.repeat(c.health)} · {c.role}</small>
                  </span>
                  <i>{c.id === characterId ? '已选' : ''}</i>
                </button>
              ))}
            </div>

            <div className="menu-actions">
              <label className="sens">
                <span>灵敏度 <b>{sensitivity.toFixed(1)}</b></span>
                <input
                  type="range"
                  min={0.3}
                  max={2.4}
                  step={0.1}
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                />
              </label>
              <button className="play-button" onClick={start}>进入星球 <b>→</b></button>
            </div>

            <div className="keyline">
              <span><kbd>F</kbd> 登载具</span>
              <span><kbd>E</kbd> 自动驾驶</span>
              <span><kbd>G</kbd> 弹射火箭</span>
              <span><kbd>左键</kbd> 开火</span>
              <span><kbd>ESC</kbd> 暂停</span>
            </div>
            <small className="zero-resource">NO CDN · NO IMAGE · NO AUDIO FILE · WEBGL</small>
          </div>
        </div>
      )}

      {phase === 'paused' && (
        <div className="overlay">
          <div className="panel">
            <small className="panel-kicker">PAUSED</small>
            <h2>喘口气</h2>
            <p className="panel-note">继续后会重新锁定鼠标。Esc 可再次暂停。</p>

            <div className="mini-roster">
              {CHARACTERS.map((c) => (
                <button
                  key={c.id}
                  className={c.id === characterId ? 'active' : ''}
                  onClick={() => pickCharacter(c.id)}
                  title={`${c.name} · 切换角色会重新开始`}
                >
                  <span style={{ background: String(c.bodyColor) }}>{HAT_GLYPH[c.hat]}</span>
                  <b>{c.name}</b>
                </button>
              ))}
            </div>
            <small className="switch-note">切换角色会重新开始本局</small>

            <label className="sens panel-sens">
              <span>灵敏度 <b>{sensitivity.toFixed(1)}</b></span>
              <input
                type="range"
                min={0.3}
                max={2.4}
                step={0.1}
                value={sensitivity}
                onChange={(e) => setSensitivity(Number(e.target.value))}
              />
            </label>

            <div className="panel-actions">
              <button className="primary" onClick={resume}>继续 <b>▶</b></button>
              <button onClick={restart}>重新开始</button>
              <button onClick={backToMenu}>返回大厅</button>
            </div>
          </div>
        </div>
      )}

      {(phase === 'won' || phase === 'lost') && result && (
        <div className="overlay">
          <div className={`result-card ${result.won ? 'win' : 'lose'}`}>
            <div className="result-stars">{result.won ? '✦ ✧ ✦ ✧ ✦' : '· · ·'}</div>
            <small>{result.won ? 'MISSION COMPLETE' : 'MISSION FAILED'}</small>
            <h1>{result.won ? '星球之心到手！' : '星球之心失守…'}</h1>
            <p>{result.won
              ? '你拆掉了敌方守护大塔，夺走星球之心——敌方星球插上了糖果旗！'
              : '敌方士兵攻破了我的大塔，偷走了星球之心。下次守住主塔！'}</p>
            <div className="result-stats">
              <div className="kda-main" title="击杀 / 死亡 / 助攻">
                <b><span className="k">{result.kills}</span>/<span className="d">{result.deaths}</span>/<span className="a">{result.assists}</span></b>
                <small>K / D / A</small>
              </div>
              <div><b>{result.turretsDown}</b><small>摧毁塔</small></div>
              <div><b>{Math.round(result.accuracy * 100)}%</b><small>命中率</small></div>
              <div><b>{formatTime(result.time)}</b><small>用时</small></div>
            </div>
            <div className="panel-actions">
              <button className="primary" onClick={restart}>再来一局 <b>↻</b></button>
              <button onClick={backToMenu}>返回大厅</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
