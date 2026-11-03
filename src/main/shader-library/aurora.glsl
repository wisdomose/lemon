// Aurora: soft bands of colour drifting across the shape, like northern lights.

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label Sky
 * @color
 * @default #0b1026
 */
uniform vec3 u_sky;

/**
 * @label First light
 * @color
 * @default #2dd4bf
 */
uniform vec3 u_first;

/**
 * @label Second light
 * @color
 * @default #a855f7
 */
uniform vec3 u_second;

/**
 * @label Speed
 * @default 0.15
 * @range 0, 1
 */
uniform float u_speed;

/**
 * @label Softness
 * @default 0.6
 * @range 0.1, 1
 */
uniform float u_softness;

float wave(vec2 p, float t, float k) {
  return sin(p.x * k + t) * 0.5 + sin(p.x * k * 0.53 - t * 1.3 + p.y * 1.7) * 0.35 + sin(p.x * k * 1.9 + t * 0.7) * 0.15;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = vec2(uv.x * u_resolution.x / u_resolution.y, uv.y);
  float t = u_time * u_speed * 6.2831;
  float band1 = 0.55 + wave(p, t, 2.3) * 0.18;
  float band2 = 0.35 + wave(p + 3.1, -t * 0.8, 3.1) * 0.14;
  float s = 0.05 + u_softness * 0.25;
  float a1 = exp(-pow((uv.y - band1) / s, 2.0));
  float a2 = exp(-pow((uv.y - band2) / (s * 0.8), 2.0));
  vec3 color = u_sky;
  color = mix(color, u_first, a1 * 0.9);
  color = mix(color, u_second, a2 * 0.8);
  color += (u_first + u_second) * 0.08 * (a1 * a2);
  gl_FragColor = vec4(color, 1.0);
}
