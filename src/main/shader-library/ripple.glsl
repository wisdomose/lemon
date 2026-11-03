// Ripple: the node seen through moving water, rings spreading out from a point.

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label Content
 * @default pencil:object
 */
uniform sampler2D u_content;

/**
 * @label Centre
 * @default 0.5, 0.5
 */
uniform vec2 u_centre;

/**
 * @label Strength
 * @default 6
 * @range 0, 30
 */
uniform float u_strength;

/**
 * @label Ring spacing
 * @default 28
 * @range 6, 120
 */
uniform float u_spacing;

void main() {
  vec2 centre = u_centre * u_resolution;
  vec2 d = gl_FragCoord.xy - centre;
  float r = length(d);
  float wave = sin(r / u_spacing * 6.2831 - u_time * 3.0) * exp(-r / max(u_resolution.x, u_resolution.y) * 1.5);
  vec2 offset = (r > 0.0 ? d / r : vec2(0.0)) * wave * u_strength;
  gl_FragColor = texture2D(u_content, (gl_FragCoord.xy + offset) / u_resolution);
}
