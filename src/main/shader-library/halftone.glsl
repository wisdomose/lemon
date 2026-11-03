// Halftone: the node redrawn as printed dots, larger where it is darker, on a turned screen.

/** @resolution */
uniform vec2 u_resolution;

/**
 * @label Content
 * @default pencil:object
 */
uniform sampler2D u_content;

/**
 * @label Dot spacing
 * @default 8
 * @range 3, 32
 */
uniform float u_spacing;

/**
 * @label Screen angle
 * @default 45
 * @range 0, 90
 */
uniform float u_angle;

/**
 * @label Ink
 * @color
 * @default #111111
 */
uniform vec3 u_ink;

/**
 * @label Paper
 * @color
 * @default #f6f1e7
 */
uniform vec3 u_paper;

void main() {
  float a = radians(u_angle);
  mat2 turn = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 p = turn * gl_FragCoord.xy;
  vec2 cell = (floor(p / u_spacing) + 0.5) * u_spacing;
  vec2 centre = cell * turn;
  vec4 c = texture2D(u_content, centre / u_resolution);
  float coverage = c.a;
  float dark = coverage * (1.0 - dot(c.rgb / max(c.a, 0.001), vec3(0.299, 0.587, 0.114)));
  float radius = sqrt(dark) * u_spacing * 0.7;
  float ink = 1.0 - smoothstep(radius - 0.75, radius + 0.75, length(p - cell));
  vec3 color = mix(u_paper, u_ink, ink);
  gl_FragColor = vec4(color, 1.0) * max(coverage, 0.0);
}
