// Neon edge: a glowing tube of light along the inside of the shape's outline, from its distance field.

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/** @sdf */
uniform sampler2D u_shape;

/**
 * @label Glow
 * @color
 * @default #ff3df2
 */
uniform vec3 u_glow;

/**
 * @label Inside
 * @color
 * @default #12021a
 */
uniform vec3 u_inside;

/**
 * @label Tube width
 * @default 3
 * @range 1, 12
 */
uniform float u_width;

/**
 * @label Flicker
 * @default 0.15
 * @range 0, 1
 */
uniform float u_flicker;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  // Distance to the outline, inside the shape (r channel, in node units).
  float d = texture2D(u_shape, uv).r;
  float tube = exp(-pow((d - u_width * 2.0) / u_width, 2.0));
  float halo = exp(-d / (u_width * 6.0)) * 0.45;
  float buzz = 1.0 - u_flicker * 0.5 * (0.5 + 0.5 * sin(u_time * 23.0) * sin(u_time * 7.3));
  vec3 color = u_inside + u_glow * (halo + tube * 1.4) * buzz + vec3(tube * 0.6 * buzz);
  gl_FragColor = vec4(color, 1.0);
}
