import { EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

// Ambient occlusion darkens corners, undersides and where things meet the ground, which is most of what makes
// the plant read as real rather than flat-shaded. Its own chunk, so phones that skip it never download it.
export default function Shading() {
  return (
    <EffectComposer multisampling={4}>
      <N8AO aoRadius={7} distanceFalloff={1.2} intensity={2.4} aoSamples={16} denoiseSamples={4} halfRes color="#2a2118" />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
