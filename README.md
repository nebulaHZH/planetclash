# PLANET CLASH · 星球小队

第一人称「小星球」泡泡射击。在一颗半径 96 米的糖果星球上，用泡泡枪把 7 个捣蛋鬼送回糖果盒，顺手占领两个据点。

**外部资源只有模型**：没有 CDN、字体文件、图片或音频文件。贴图由 Canvas 实时绘制，音效由 Web Audio 合成，地形与掩体全部由代码生成。

## 素材与许可

| 用途 | 来源 | 许可 |
| --- | --- | --- |
| 角色模型与动作 | [KayKit Character Pack](https://kaylousberg.itch.io/) | CC0 |
| 部分道具 | [Kenney](https://kenney.nl/) | CC0 |
| 枪模 `raygun` / `coilgun` / `launcher` | [Poly Pizza](https://poly.pizza/) — Raygun by Gabriel Valdivia、Coil Gun by Vas Pupin、Sci-Fi Grenade Launcher | CC-BY 3.0 |
| 乌萨奇 `usagi.glb` | 用户提供的 STL，`tools/build-usagi.mjs` 转成 GLB 并减面 | 同人练习，不商用 |
| 奶龙 `nailong/model.glb` | [bigdiu/naiwa-nailoong-blender-model](https://github.com/bigdiu/naiwa-nailoong-blender-model)（`nailong_colored.blend`） | 同人练习，不商用 |
| 吉伊卡哇 / 猪猪侠 | 程序化重建，无外部模型文件 | 同人练习，不商用 |

CC-BY 模型在 `src/game/assets.ts` 顶部注释中标注了作者；分发本作时请保留这些署名。

## 运行

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run preview
```

## 操作

| 输入 | 动作 |
| --- | --- |
| `WASD` | 移动（沿球面，重力指向球心） |
| `Shift` | 冲刺（消耗体力） |
| `Space` | 跳跃 |
| 鼠标 | 视角（指针锁定，失败时自动降级为拖拽视角） |
| 左键 | 射击（按住连发） |
| 右键 | 机瞄 / 拉近 FOV |
| `R` | 换弹 |
| `1` `2` `3` | 切换泡泡枪 / 彩虹喷射 / 星星散弹 |
| `Esc` | 暂停（`Enter` 继续） |
| 滚轮 | 快捷切枪 |

## 玩法

- 击倒 7 名对手获胜；生命值 3 颗心，被泡泡命中掉 1 颗。
- 站在据点圆环内 2.7 秒完成占领，回复 1 颗心并补充备弹。
- 星球曲率会遮挡视线：敌人不会隔着地平线开火，玩家也需要绕到能看见对手的位置。
- 命中头部有 1.9 倍伤害；击倒会爆出彩纸、弹珠和「KO!」贴纸，没有血腥表现。

## 技术要点

- **球面重力**：位置始终归一化到 `surfaceRadius(dir)` 的解析地表，`up` 恒为当地径向；相机由 `up + heading + pitch` 重建，任意纬度都保持正立。
- **第一人称武器**：独立 `viewScene` + `viewCamera` 渲染枪模，避免被场景裁剪；HIP / ADS 两套姿态插值，带呼吸、摆动、后坐与换弹下沉。
- **卡通渲染**：`MeshToonMaterial` + 3×1 三阶渐变贴图，反向外壳描边，blob 圆形阴影（不用实时阴影贴图）。
- **程序化世界**：顶点着色的多生态星球（薄荷 / 果冻 / 砂糖 / 冰），InstancedMesh 散布 8000+ 草花石，出生点额外加密。
- **曲率遮挡**：`hasLineOfSight()` 用解析地平线判断敌我视线，枪口为起点。
- **性能**：对象池（子弹 / 粒子 / 彩纸）、共享材质、`InstancedMesh`，目标 60fps；实测 1440×813 下约 60fps。

## 目录

```
src/
  config.ts          色板、物理、玩法、角色与武器数值
  types.ts           HUD / 事件 / 结算类型
  App.tsx            菜单、HUD、暂停、结算、事件分发
  styles.css         全部 UI 与响应式布局（≥1080px 菜单分屏）
  game/
    Game.ts          渲染循环、相机、输入、射击、据点、生命周期
    player.ts        球面移动、跳跃、体力、头部摆动
    world.ts         星球、天空、地面细节、据点、地标
    enemies.ts       敌人 AI、血条、子弹池、曲率视线
    weapons.ts       三把 GLB 枪模的第一人称手套 / 手感
    toon.ts          卡通材质、描边、角色、程序化贴图
    fx.ts            粒子 / 彩纸 / 轨迹 / 光环
    audio.ts         Web Audio 合成音效
```

调试：开发模式下 `window.__planet` 指向游戏实例，可直接读取/修改运行时状态。
