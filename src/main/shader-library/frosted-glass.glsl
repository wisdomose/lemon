// Frosted glass: what is behind the shape, blurred and bent slightly near its edges, with a bright rim.

/** @resolution */
uniform vec2 u_resolution;

/**
 * @label Behind
 * @default pencil:background
 */
uniform sampler2D u_behind;

/** @sdf */
uniform sampler2D u_shape;

/**
 * @label Frost
 * @default 10
 * @range 0, 30
 */
uniform float u_frost;

/**
 * @label Bend
 * @default 12
 * @range 0, 40
 */
uniform float u_bend;

/**
 * @label Tint
 * @color
 * @default #ffffff
 */
uniform vec3 u_tint;

/**
 * @label Tint strength
 * @default 0.12
 * @range 0, 0.6
 */
uniform float u_tintAmount;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec4 field = texture2D(u_shape, uv);
  float d = field.r;
  // Near the edge the view bends inwards, as through the thick rim of a lens.
  float edge = exp(-d / max(u_bend, 0.001));
  vec2 bent = uv - field.gb * edge * u_bend / u_resolution;
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int x = -3; x <= 3; x++) {
    for (int y = -3; y <= 3; y++) {
      vec2 o = vec2(float(x), float(y)) * u_frost / 3.0 / u_resolution;
      float w = exp(-float(x * x + y * y) / 8.0);
      sum += texture2D(u_behind, bent + o).rgb * w;
      total += w;
    }
  }
  vec3 color = mix(sum / total, u_tint, u_tintAmount);
  color += vec3(0.35) * exp(-d / 1.5);
  gl_FragColor = vec4(color, 1.0);
}
