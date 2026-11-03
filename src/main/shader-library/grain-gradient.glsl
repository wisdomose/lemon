// Grain gradient: four colours blended from the corners, slowly turning, with fine film grain on top.

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label Top left
 * @color
 * @default #ff7a59
 */
uniform vec3 u_a;

/**
 * @label Top right
 * @color
 * @default #ffd166
 */
uniform vec3 u_b;

/**
 * @label Bottom left
 * @color
 * @default #6c5ce7
 */
uniform vec3 u_c;

/**
 * @label Bottom right
 * @color
 * @default #00b4d8
 */
uniform vec3 u_d;

/**
 * @label Grain
 * @default 0.08
 * @range 0, 0.3
 */
uniform float u_grain;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  // The corners' pull drifts a little so the blend breathes.
  vec2 q = uv + 0.08 * vec2(sin(u_time * 0.3 + uv.y * 3.0), cos(u_time * 0.25 + uv.x * 3.0));
  vec3 top = mix(u_a, u_b, smoothstep(0.0, 1.0, q.x));
  vec3 bottom = mix(u_c, u_d, smoothstep(0.0, 1.0, q.x));
  vec3 color = mix(bottom, top, smoothstep(0.0, 1.0, q.y));
  color += (hash(floor(gl_FragCoord.xy * 2.0)) - 0.5) * u_grain;
  gl_FragColor = vec4(color, 1.0);
}
