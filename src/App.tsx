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
  const kills = hud.enemiesTotal - hud.enemiesLeft
  const progress = Math.min(1, kills / hud.enemiesTotal)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const timers: number[] = []
    let toastTimer = 0

    const pushFloaty = (floaty: Omit<Floaty, 'id' | 'rotate'>) => {
      const id = ++idRef.current
      const rotate = Math.round((Math.random() - 0.5) * 10)
      setFloaties((prev) => [...prev.slice(-13), { ...floaty, id, rotate }])
      const timer = window.setTimeout(() => {
        setFloaties((prev) => prev.filter((f) => f.id !== id))
      }, 900)
      timers.push(timer)
    }

    const showToast = (text: string, tone: 'good' | 'bad' | 'gold') => {
      window.clearTimeout(toastTimer)
      setToast({ id: ++idRef.current, text, tone })
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

              <div className="objective">
                <div className="objective-top">
                  <span>击倒目标</span>
                  <b>{kills}</b>
                  <i>/ {hud.enemiesTotal}</i>
                </div>
                <div className="objective-bar"><i style={{ width: `${progress * 100}%` }} /></div>
                <div className="objective-sub">
                  <span>据点 {hud.captured}/2</span>
                  <span>剩余 {hud.enemiesLeft}</span>
                </div>
              </div>

              <div className="pads">
                {[0, 1].map((i) => {
                  const value = hud.captureProgress[i] ?? 0
                  const done = value >= 0.999
                  return (
                    <div key={i} className={`pad-chip${done ? ' done' : ''}`}>
                      <span className="pad-dot" style={{ '--fill': `${value * 100}%` } as CSSProperties}><i>{i === 0 ? 'A' : 'B'}</i></span>
                      <div>
                        <small>据点 {i === 0 ? 'A' : 'B'}</small>
                        <b>{done ? '已占领' : value > 0.02 ? `${Math.round(value * 100)}%` : '未占领'}</b>
                      </div>
                    </div>
                  )
                })}
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
                <span><kbd>SPACE</kbd> 跳跃</span>
                <span><kbd>SHIFT</kbd> 冲刺</span>
                <span><kbd>R</kbd> 换弹</span>
                <span><kbd>右键</kbd> 瞄准</span>
                <span><kbd>ESC</kbd> 暂停</span>
              </div>

              <div className="weapon-block">
                <div className="weapon-sticker">
                  <div className="weapon-icon" style={{ background: weapon.color }}>{weapon.icon}</div>
                  <div className="weapon-copy">
                    <small>{weapon.short} · {weapon.tagline}</small>
                    <strong>{weapon.name}</strong>
                    <span className={hud.ammo <= 2 ? 'ammo-low' : ''}>{hud.reloading ? '换弹中…' : '按 R 换弹'}</span>
                  </div>
                  <div className="ammo">
                    <b>{hud.ammo}</b>
                    <span>/ {hud.reserve}</span>
                  </div>
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
              在小星球上，用泡泡、彩虹和星星<br />
              把 7 个捣蛋鬼送回糖果盒。
            </p>
            <div className="feature-row">
              <span>◉ 球形重力</span>
              <span>✦ 三把武器</span>
              <span>♛ 五个角色</span>
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
              <span><kbd>WASD</kbd> 移动</span>
              <span><kbd>鼠标</kbd> 瞄准</span>
              <span><kbd>左键</kbd> 射击</span>
              <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 换枪</span>
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
            <h1>{result.won ? '星球清场！' : '被泡泡淹没了…'}</h1>
            <p>{result.won ? '7 个捣蛋鬼全部回盒，糖果星球恢复供电。' : '别灰心，据点能回血，先占点再开火。'}</p>
            <div className="result-stats">
              <div><b>{result.kills}</b><small>击倒</small></div>
              <div><b>{Math.round(result.accuracy * 100)}%</b><small>命中率</small></div>
              <div><b>{formatTime(result.time)}</b><small>用时</small></div>
              <div><b>{result.captured}/2</b><small>据点</small></div>
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
