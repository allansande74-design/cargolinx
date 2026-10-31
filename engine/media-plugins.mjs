/** Media-studio plugin stubs: all PLANNED via harness; no network calls. HeyGen 0 credits, FAL unfunded — registered only. */
import { register } from "./harness.mjs";

const PLANNED = [
  { id: "print-studio", name: "Print Studio", category: "tool", version: "0.1-planned", capabilities: ["brief.create", "layout.draft", "proof.approve"], entry: "PLANNED" },
  { id: "video-calls", name: "Video Calls", category: "tool", version: "0.1-planned", capabilities: ["session.schedule", "session.mirror", "clip.export"], entry: "PLANNED" },
  { id: "image-gen", name: "Image Generator", category: "tool", version: "0.1-planned", capabilities: ["prompt.create", "image.draft", "image.approve"], entry: "PLANNED" },
  { id: "audio-studio", name: "Audio Studio", category: "tool", version: "0.1-planned", capabilities: ["script.create", "voice.draft", "audio.approve"], entry: "PLANNED" },
];

for (const m of PLANNED) register({ ...m });

export function mediaStatus() {
  return PLANNED.map((m) => ({ id: m.id, name: m.name, state: "planned-registered", entry: m.entry }));
}
