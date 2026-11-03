// The design systems that come with Lemon ("Choose a style" → Design Systems). Each is a .pen file in
// src/main/design-systems with a picture of its example screen in src/renderer/agent/design-systems,
// both made by Lemon's agent from the brief here (scripts/design-systems.ts).
export interface DesignSystem {
  id: string;
  name: string;
  /** What the agent was asked to make it like. */
  brief: string;
}

export const DESIGN_SYSTEMS: DesignSystem[] = [
  { id: "graphite", name: "Graphite", brief: "dark and dense, for tools people use all day; neutral greys, one electric-blue accent, tight radii, compact sizes." },
  { id: "citrus", name: "Citrus", brief: "light and friendly; warm off-white surfaces, a zesty lime-and-orange accent pair, generous rounding and soft shadows." },
  { id: "harbor", name: "Harbor", brief: "calm and trustworthy, for finance and health; navy and sea-green on white, plain sans type, square-ish corners, clear focus states." },
];
