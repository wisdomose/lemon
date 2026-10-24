// The art-direction library and the random starting points for a new design. The dice come from
// code, not the model: left to itself a model converges on the same few looks.
import library from "./directions.json" with { type: "json" };

export interface Direction {
  id: string;
  name: string;
  idea: string;
  composition: string;
  type: string;
  colour: string;
  imagery: string;
  details: string;
}

export const DIRECTIONS = library as Direction[];
const STARTING_POINTS = 3;

/** Picks starting points at random, avoiding `recent` ones while enough others remain. */
export function pickStartingPoints(recent: string[] = [], random: () => number = Math.random): Direction[] {
  const shuffled = [...DIRECTIONS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const fresh = shuffled.filter((d) => !recent.includes(d.id));
  return (fresh.length >= STARTING_POINTS ? fresh : shuffled).slice(0, STARTING_POINTS);
}

export function libraryText(): string {
  return DIRECTIONS.map(
    (d) =>
      `## ${d.name} (${d.id})\n${d.idea}\n- Composition: ${d.composition}\n- Type: ${d.type}\n- Colour: ${d.colour}\n- Imagery: ${d.imagery}\n- Details: ${d.details}`,
  ).join("\n\n");
}
