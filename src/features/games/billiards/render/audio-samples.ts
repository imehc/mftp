import ballUrl from "../audio/ball.wav";
import cueOneUrl from "../audio/cue-1.wav";
import cueTwoUrl from "../audio/cue-2.wav";
import pocketUrl from "../audio/pocket.wav";

export type ImpactMaterial = "ball" | "cue" | "cushion" | "pocket";

export type ImpactSamples = Record<ImpactMaterial, AudioBuffer[]>;

/** 资源随安装包发布；一次解码后复用，击球时不请求网络或分配 PCM。 */
export async function loadImpactSamples(
  context: AudioContext,
): Promise<ImpactSamples> {
  const [ball, cueOne, cueTwo, pocket] = await Promise.all(
    [ballUrl, cueOneUrl, cueTwoUrl, pocketUrl].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error("billiards: local audio asset unavailable");
      return context.decodeAudioData(await response.arrayBuffer());
    }),
  );
  return {
    ball: [ball],
    cue: [cueOne, cueTwo],
    cushion: [ball],
    pocket: [pocket],
  };
}
