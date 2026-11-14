// Ember Yard's look plan, in one place: a desert rail-yard at dusk. Six values and one
// accent hue; the lighting makes every shade the game needs, so no other colour appears in
// the code. The same six names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#1a130e', // dusk sky / fog
  surface: '#4a3a28', // sun-baked concrete
  hairline: '#2e241a', // rusted steel
  ink: '#f2e8d5', // sand-worn white
  muted: '#b08d5f', // faded ochre
  accent: '#e86a2a', // ember orange
  teal: '#3fae9c', // defender team tint
};

export function shade(name) {
  return PALETTE[name];
}
