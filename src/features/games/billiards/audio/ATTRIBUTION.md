# 台球音效来源

以下素材的来源页面均标注 **CC0 1.0 Universal**：
https://creativecommons.org/publicdomain/zero/1.0/

核对日期：2026-10-10。使用 Freesound 提供的高质量 MP3 预览转为本地单声道 PCM WAV；应用运行时无需访问 Freesound。

| 本地文件             | 作者与原素材                                                                                                     | 处理                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ball.wav             | Za-Games — [billiard ball clack](https://freesound.org/people/Za-Games/sounds/539854/)                           | 截除前端静音、去直流、峰值归一化和短淡出                                           |
| cue-1.wav、cue-2.wav | craigsmith — [S02-22 Billiards cue stick hits ball.wav](https://freesound.org/people/craigsmith/sounds/675330/)  | 从预览约 0.15–0.52 秒、3.70–4.05 秒范围提取两次独立击球，去静音/直流、归一化和淡出 |
| pocket.wav           | Yarmonics / Stuart Bowditch — [B_1 pool ball falling.wav](https://freesound.org/people/Yarmonics/sounds/441857/) | 保留球落入袋内的连续撞击，去直流、归一化和淡出                                     |

库边音使用 ball.wav 的低通、低音量版本，作为碰撞录音的加工音效，不宣称它是独立录制的橡胶库边声音。运行时只小幅改变回放速率，避免每次击球完全相同。
