// Dither: the node in two colours, shaded with an ordered 4 × 4 pattern, like an old screen.

/** @resolution */
uniform vec2 u_resolution;

/**
 * @label Content
 * @default pencil:object
 */
uniform sampler2D u_content;

/**
 * @label Pixel size
 * @default 3
 * @range 1, 12
 */
uniform float u_pixel;

/**
 * @label Dark
 * @color
 * @default #1b1f3b
 */
uniform vec3 u_dark;

/**
 * @label Light
 * @color
 * @default #9bf6b0
 */
uniform vec3 u_light;

float bayer(vec2 p) {
  // The 4 × 4 Bayer matrix, as a threshold in 0..1.
  vec2 q = mod(p, 4.0);
  float x = q.x, y = q.y;
  float v = 0.0;
  v += mod(x, 2.0) * 2.0 + mod(y, 2.0) * 3.0 - 4.0 * mod(x, 2.0) * mod(y, 2.0);
  v *= 4.0;
  vec2 h = floor(q / 2.0);
  v += mod(h.x, 2.0) * 2.0 + mod(h.y, 2.0) * 3.0 - 4.0 * mod(h.x, 2.0) * mod(h.y, 2.0);
  return (v + 0.5) / 16.0;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy / u_pixel);
  vec4 c = texture2D(u_content, (cell + 0.5) * u_pixel / u_resolution);
  float light = dot(c.rgb / max(c.a, 0.001), vec3(0.299, 0.587, 0.114));
  vec3 color = light > bayer(cell) ? u_light : u_dark;
  gl_FragColor = vec4(color, 1.0) * step(0.5, c.a);
}
