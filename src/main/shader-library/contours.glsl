// Contours: the lines of a topographic map over gently rolling ground, every fifth line heavier.
#extension GL_OES_standard_derivatives : enable

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label Paper
 * @color
 * @default #f4efe6
 */
uniform vec3 u_paper;

/**
 * @label Ink
 * @color
 * @default #8a5a3b
 */
uniform vec3 u_ink;

/**
 * @label Lines
 * @default 12
 * @range 4, 60
 */
uniform float u_lines;

/**
 * @label Scale
 * @default 1.6
 * @range 0.5, 10
 */
uniform float u_scale;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float ground(vec2 p) {
  float h = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    h += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return h;
}

void main() {
  vec2 p = gl_FragCoord.xy / u_resolution.y * u_scale + vec2(u_time * 0.02, 0.0);
  float h = ground(p) * u_lines;
  float f = fract(h);
  float width = fwidth(h) * 1.2;
  float line = 1.0 - smoothstep(0.0, width, min(f, 1.0 - f));
  float heavy = mod(floor(h + 0.5), 5.0) < 0.5 ? 1.0 : 0.55;
  gl_FragColor = vec4(mix(u_paper, u_ink, line * heavy), 1.0);
}
