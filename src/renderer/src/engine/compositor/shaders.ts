export const FULLSCREEN_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_pos;
uniform float u_flipY;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  vec2 ndc = a_pos * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, ndc.y * u_flipY, 0.0, 1.0);
}`

export const LAYER_VERTEX = `#version 300 es
layout(location = 0) in vec2 a_pos;
uniform mat3 u_matrix;
uniform vec4 u_uvRect;
out vec2 v_uv;
void main() {
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, a_pos);
  vec3 p = u_matrix * vec3(v_uv, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`

/** Draws one layer, premultiplied, with half-pixel edge antialiasing for rotated/scaled quads. */
export const LAYER_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_uvRect;
uniform float u_opacity;
out vec4 o_color;
void main() {
  vec2 edge = min(v_uv - u_uvRect.xy, u_uvRect.zw - v_uv) / max(fwidth(v_uv), vec2(1e-6));
  float aa = clamp(min(edge.x, edge.y) + 0.5, 0.0, 1.0);
  o_color = texture(u_tex, v_uv) * (u_opacity * aa);
}`

export const COPY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 o_color;
void main() { o_color = texture(u_tex, v_uv); }`

/** Blends a premultiplied layer over an opaque backdrop. Mode order matches BLEND_MODES. */
export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_backdrop;
uniform sampler2D u_layer;
uniform int u_mode;
out vec4 o_color;
vec3 blend(vec3 b, vec3 s) {
  if (u_mode == 1) return min(b + s, 1.0);
  if (u_mode == 2) return b * s;
  if (u_mode == 3) return 1.0 - (1.0 - b) * (1.0 - s);
  if (u_mode == 4) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (u_mode == 5) return min(b, s);
  if (u_mode == 6) return max(b, s);
  return s;
}
void main() {
  vec4 b = texture(u_backdrop, v_uv);
  vec4 l = texture(u_layer, v_uv);
  if (l.a <= 0.0) { o_color = b; return; }
  vec3 s = l.rgb / l.a;
  o_color = vec4(mix(b.rgb, blend(b.rgb, s), l.a), 1.0);
}`

/** u_type indexes TRANSITIONS in core/effects/registry. Inputs are premultiplied. */
export const TRANSITION_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform int u_type;
uniform float u_aspect;
out vec4 o_color;
vec4 sampleIn(sampler2D t, vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture(t, uv);
}
void main() {
  float p = clamp(u_progress, 0.0, 1.0);
  float e = p * p * (3.0 - 2.0 * p);
  vec2 uv = v_uv;
  vec4 a = texture(u_from, uv);
  vec4 b = texture(u_to, uv);
  if (u_type == 0) { o_color = mix(a, b, p); return; }
  if (u_type == 1 || u_type == 2) {
    vec4 dip = u_type == 1 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    o_color = p < 0.5 ? mix(a, dip, p * 2.0) : mix(dip, b, p * 2.0 - 1.0);
    return;
  }
  // v_uv.y grows upwards in framebuffer space.
  if (u_type >= 3 && u_type <= 6) {
    float soft = 0.02;
    float pos = u_type == 3 ? 1.0 - uv.x : u_type == 4 ? uv.x : u_type == 5 ? uv.y : 1.0 - uv.y;
    float m = smoothstep(pos - soft, pos + soft, e * (1.0 + 2.0 * soft) - soft);
    o_color = mix(a, b, m);
    return;
  }
  if (u_type >= 7 && u_type <= 10) {
    vec2 dir = u_type == 7 ? vec2(-1.0, 0.0) : u_type == 8 ? vec2(1.0, 0.0) : u_type == 9 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    vec4 outgoing = sampleIn(u_from, uv - dir * e);
    vec4 incoming = sampleIn(u_to, uv - dir * (e - 1.0));
    o_color = outgoing + incoming * (1.0 - outgoing.a);
    return;
  }
  if (u_type == 11) {
    vec2 c = vec2(0.5);
    vec4 za = sampleIn(u_from, c + (uv - c) / (1.0 + e * 1.5));
    vec4 zb = sampleIn(u_to, c + (uv - c) / (0.4 + 0.6 * e));
    o_color = mix(za, zb, smoothstep(0.3, 0.7, p));
    return;
  }
  vec2 d = (uv - 0.5) * vec2(u_aspect, 1.0);
  float radius = e * length(vec2(u_aspect, 1.0)) * 0.5 * 1.05;
  o_color = mix(a, b, 1.0 - smoothstep(radius - 0.01, radius + 0.01, length(d)));
}`

const EFFECT_HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
out vec4 o_color;
vec4 unpremultiply(vec4 c) { return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 premultiply(vec4 c) { return vec4(c.rgb * c.a, c.a); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
`

/** Fragment shaders per effect type. Uniform names equal the param keys in the registry. */
export const EFFECT_FRAGMENTS: Record<string, string> = {
  color: `${EFFECT_HEADER}
uniform float exposure, contrast, saturation, temperature, tint, hue;
void main() {
  vec4 c = unpremultiply(texture(u_tex, v_uv));
  vec3 rgb = c.rgb * pow(2.0, exposure * 2.0);
  rgb.r += temperature * 0.15; rgb.b -= temperature * 0.15;
  rgb.g -= tint * 0.12; rgb.r += tint * 0.06; rgb.b += tint * 0.06;
  rgb = (rgb - 0.5) * (1.0 + contrast * (contrast > 0.0 ? 2.0 : 1.0)) + 0.5;
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(luma), rgb, 1.0 + saturation * (saturation > 0.0 ? 2.0 : 1.0));
  if (hue != 0.0) { vec3 hsv = rgb2hsv(clamp(rgb, 0.0, 1.0)); hsv.x = fract(hsv.x + hue / 360.0); rgb = hsv2rgb(hsv); }
  o_color = premultiply(vec4(clamp(rgb, 0.0, 1.0), c.a));
}`,
  // Separable gaussian; u_direction selects the pass. radius arrives already scaled to render pixels.
  blur: `${EFFECT_HEADER}
uniform float radius;
uniform vec2 u_direction;
void main() {
  if (radius < 0.5) { o_color = texture(u_tex, v_uv); return; }
  float sigma = radius * 0.5;
  float taps = min(ceil(radius), 24.0);
  float stride = radius / taps;
  vec4 sum = vec4(0.0); float total = 0.0;
  for (float i = -taps; i <= taps; i += 1.0) {
    float x = i * stride;
    float w = exp(-0.5 * x * x / (sigma * sigma));
    sum += texture(u_tex, v_uv + u_direction * u_texel * x) * w;
    total += w;
  }
  o_color = sum / total;
}`,
  sharpen: `${EFFECT_HEADER}
uniform float amount;
void main() {
  vec4 c = texture(u_tex, v_uv);
  vec4 n = texture(u_tex, v_uv + vec2(0.0, u_texel.y)) + texture(u_tex, v_uv - vec2(0.0, u_texel.y))
         + texture(u_tex, v_uv + vec2(u_texel.x, 0.0)) + texture(u_tex, v_uv - vec2(u_texel.x, 0.0));
  o_color = vec4(clamp(c.rgb + (c.rgb * 4.0 - n.rgb) * amount, 0.0, c.a), c.a);
}`,
  vignette: `${EFFECT_HEADER}
uniform float amount, softness;
void main() {
  vec4 c = texture(u_tex, v_uv);
  float d = length((v_uv - 0.5) * 2.0) / 1.4142;
  float v = smoothstep(1.0 - amount * 0.9, 1.0 - amount * 0.9 + 0.05 + softness, d + 0.3 * amount);
  o_color = vec4(c.rgb * (1.0 - v * amount), c.a);
}`,
  sepia: `${EFFECT_HEADER}
uniform float amount;
void main() {
  vec4 c = unpremultiply(texture(u_tex, v_uv));
  vec3 s = vec3(dot(c.rgb, vec3(0.393, 0.769, 0.189)), dot(c.rgb, vec3(0.349, 0.686, 0.168)), dot(c.rgb, vec3(0.272, 0.534, 0.131)));
  o_color = premultiply(vec4(mix(c.rgb, min(s, 1.0), amount), c.a));
}`,
  invert: `${EFFECT_HEADER}
uniform float amount;
void main() {
  vec4 c = unpremultiply(texture(u_tex, v_uv));
  o_color = premultiply(vec4(mix(c.rgb, 1.0 - c.rgb, amount), c.a));
}`,
  pixelate: `${EFFECT_HEADER}
uniform float size;
void main() {
  vec2 block = u_texel * max(size, 1.0);
  o_color = texture(u_tex, (floor(v_uv / block) + 0.5) * block);
}`,
  chromaKey: `${EFFECT_HEADER}
uniform float hue, tolerance, softness, spill;
void main() {
  vec4 c = unpremultiply(texture(u_tex, v_uv));
  vec3 hsv = rgb2hsv(c.rgb);
  float dh = abs(hsv.x - hue / 360.0); dh = min(dh, 1.0 - dh) * 2.0;
  // Grey and dark pixels have no meaningful hue, so they are never keyed.
  float match = (1.0 - smoothstep(tolerance, tolerance + softness + 0.001, dh)) * smoothstep(0.1, 0.3, hsv.y) * smoothstep(0.1, 0.25, hsv.z);
  float nearKey = 1.0 - smoothstep(tolerance, tolerance + 0.35, dh);
  vec3 rgb = mix(c.rgb, vec3(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))), nearKey * spill * hsv.y);
  o_color = premultiply(vec4(rgb, c.a * (1.0 - match)));
}`
}

export const BLEND_MODES = ['normal', 'add', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const
