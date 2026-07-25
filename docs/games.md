# 小游戏架构说明

首页 `games` 分类下的游戏共用一套**回合制游戏框架**(`src/features/games/engine/`),
人机(AI)与联机能力与具体游戏解耦。新增游戏时按本文接入,无需重写这些层。

## 分层

```
src/features/games/
  engine/          游戏无关:回合循环、玩家控制器、AI 抽象、联机传输接口
  billiards/       第一个游戏(台球/八球):物理、规则、AI 策略、渲染
```

### engine 层(游戏无关)

- `types.ts` — 核心契约:
  - `GameDefinition<S, M, P>`:游戏 = 纯函数规则。`applyMove(state, move, seat)`
    **必须确定性**(同输入同输出),这是 AI 试算复用与将来联机 lockstep(只同步落子)的基础。
    `P` 是"表现数据"(渲染回放所需,如台球的物理帧序列),引擎不解析。
  - `PlayerController`:座位的出手来源抽象。回合循环对本地玩家/AI/远端一视同仁。
- `controllers.ts` — `LocalController`(UI 调 `submit(move)` 提交)、
  `AiController`(包装 `AiStrategy` + 难度,快搜也垫底 700ms 更像"思考")、
  `RemoteController`(阶段三占位)。
- `ai.ts` — `AiStrategy<S, M>` 接口、三档 `Difficulty`、确定性 PRNG(`createRng`,
  **AI 噪声不许用 `Math.random`**,否则联机回放会分叉)、`yieldToUi` 让搜索不卡帧。
- `match.ts` — `MatchRunner`:请求出手 → `applyMove` → 等 UI 回放完 → 下一回合;
  React 侧用 `useMatchSnapshot`(useSyncExternalStore)订阅,逐帧渲染不经过 React。
- `transport.ts` — 联机接口预留(`MatchTransport`:seq + move + stateHash),未实现。

### 接入一个新游戏的最小清单

1. 实现 `GameDefinition`(初始状态工厂 + `applyMove` 判定);
2. 可选:实现 `AiStrategy` 支持人机;
3. 写渲染组件(建议模式:React 只挂载/传 props,逐帧动画走 canvas/Pixi,
   通过 `MatchRunner` 的 `onMoveResolved` 钩子回放表现数据);
4. 页面组件里组装 `MatchRunner` + 控制器(参考 `billiards/BilliardsGame.tsx` 的 `Match`);
5. `src/routes/games/<id>.tsx` 建路由(不要 `setLastTool`,游戏不进"上次工具"),
   `src/features/home/entries.tsx` 加 `category: "games"` 入口。

## 台球(billiards)实现要点

- **物理**:`@dimforge/rapier2d-compat`(WASM)。`physics.ts` 的 `simulateShot`
  每杆**新建 world → 模拟至静止 → 销毁**,状态进状态出,无隐藏可变量;固定步长 1/120s、
  固定构建顺序、CCD 防穿模。输出:终局球位 + 帧序列(回放用)+ 事件流(音效/进袋动画用)。
  渲染层的库边形状直接复用 `cushionSegments()`,画面与碰撞几何一致。
- **规则**(`rules.ts`):八球 + 练习两个变体共用一个工厂。对 WPA 规则的简化:
  不要求碰库、首个进球定花色、开球进黑八重置、自由球全台可放。
- **AI**(`ai.ts`):几何枚举候选(目标球×袋口 ghost ball + 路径畅通预筛)→
  按难度加高斯噪声 → 真实模拟打分。难度差异 = 噪声大小 + 模拟条数 +
  是否评估走位(hard)+ 故意失误概率(easy)。
- **渲染**(`render/`):Pixi v8,React 不参与逐帧;竖屏时整个舞台旋转 90°,
  指针坐标经 `toLocal` 自动换算。参考线为纯几何(`guides.ts`),与模拟共享常量。
- **音效/震动**(`render/audio.ts`):WebAudio 合成(无外部素材),音量∝撞击强度;
  `navigator.vibrate` 仅 Android 生效,iOS WebView 无此 API 自动跳过。
  注意 iOS 自动播放策略:首次手势里调用 `unlockAudio()`(舞台 pointerdown 已接)。

## 阶段三(联机)预留设计

台球的 `applyMove` 已满足确定性,联机时:双方各自跑同一模拟,只交换
`(seq, seat, move)`,每步校验 `stateHash`;`RemoteController` 实现
`requestMove` = 等待 `MatchTransport.onRemoteMove`。需要新增的只有传输实现
(WebSocket 中继或局域网)与房间/匹配 UI。
