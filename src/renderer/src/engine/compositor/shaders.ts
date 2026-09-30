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
uniform float u_opacity;
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
  vec4 l = texture(u_layer, v_uv) * u_opacity;
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
  if (u_type == 12) {
    vec2 d = (uv - 0.5) * vec2(u_aspect, 1.0);
    float radius = e * length(vec2(u_aspect, 1.0)) * 0.5 * 1.05;
    o_color = mix(a, b, 1.0 - smoothstep(radius - 0.01, radius + 0.01, length(d)));
    return;
  }
  if (u_type == 13) {
    // Blur dissolve: both pictures blur towards the middle while they cross.
    float r = sin(p * 3.14159) * 0.02;
    vec4 ba = vec4(0.0);
    vec4 bb = vec4(0.0);
    for (int i = 0; i < 16; i++) {
      float angle = float(i) * 2.39996;
      vec2 o = vec2(cos(angle), sin(angle)) * r * sqrt(float(i) / 16.0) * vec2(1.0, u_aspect);
      ba += texture(u_from, uv + o);
      bb += texture(u_to, uv + o);
    }
    o_color = mix(ba / 16.0, bb / 16.0, e);
    return;
  }
  if (u_type == 14 || u_type == 15) {
    // Whip pan: a fast push with motion blur along the move.
    float dir = u_type == 14 ? -1.0 : 1.0;
    float shift = dir * e;
    float streak = sin(p * 3.14159) * 0.12;
    vec4 sum = vec4(0.0);
    for (int i = 0; i < 12; i++) {
      float t = (float(i) / 11.0 - 0.5) * streak;
      vec2 at = uv - vec2(shift + t, 0.0);
      vec4 outgoing = sampleIn(u_from, at);
      vec4 incoming = sampleIn(u_to, at + vec2(dir, 0.0));
      sum += outgoing + incoming * (1.0 - outgoing.a);
    }
    o_color = sum / 12.0;
    return;
  }
  if (u_type == 16) {
    // Spin: the old picture turns and shrinks away, the new one turns in.
    vec2 c = (uv - 0.5) * vec2(u_aspect, 1.0);
    float angle = e * 6.28318;
    float zoom = 1.0 + sin(p * 3.14159) * 1.5;
    vec2 q = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * c * zoom;
    vec2 at = q / vec2(u_aspect, 1.0) + 0.5;
    o_color = mix(sampleIn(u_from, at), sampleIn(u_to, at), smoothstep(0.4, 0.6, p));
    return;
  }
  // Glitch: blocky horizontal tears and split colour channels, strongest at the cut.
  float strength = sin(p * 3.14159);
  float band = floor(uv.y * 24.0);
  float noise = fract(sin(band * 91.7 + floor(p * 18.0) * 13.3) * 43758.5);
  float tear = (noise - 0.5) * 0.2 * strength * step(0.55, noise);
  vec2 at = vec2(uv.x + tear, uv.y);
  float split = 0.02 * strength;
  vec4 src = p < 0.5 ? texture(u_from, at) : texture(u_to, at);
  float r = (p < 0.5 ? texture(u_from, at + vec2(split, 0.0)) : texture(u_to, at + vec2(split, 0.0))).r;
  float bl = (p < 0.5 ? texture(u_from, at - vec2(split, 0.0)) : texture(u_to, at - vec2(split, 0.0))).b;
  o_color = vec4(r, src.g, bl, src.a);
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
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
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
}`,
  levels: `${EFFECT_HEADER}
uniform float blacks, whites, gamma;
void main() {
  vec4 c = unpremultiply(texture(u_tex, v_uv));
  vec3 rgb = clamp((c.rgb - blacks) / max(whites - blacks, 1e-3), 0.0, 1.0);
  o_color = premultiply(vec4(pow(rgb, vec3(1.0 / max(gamma, 1e-3))), c.a));
}`,
  lumaKey: `${EFFECT_HEADER}
uniform float threshold, softness, invert;
void main() {
  vec4 c = unpremultiply(texture(u_tex, v_uv));
  float keep = smoothstep(threshold, threshold + softness + 1e-3, luma(c.rgb));
  if (invert > 0.5) keep = 1.0 - keep;
  o_color = premultiply(vec4(c.rgb, c.a * keep));
}`,
  // amount arrives in render pixels.
  chromaticAberration: `${EFFECT_HEADER}
uniform float amount;
void main() {
  vec2 dir = v_uv - 0.5;
  vec2 shift = dir / max(length(dir), 1e-3) * length(dir) * 2.0 * amount * u_texel;
  vec4 c = texture(u_tex, v_uv);
  vec4 r = texture(u_tex, v_uv + shift);
  vec4 b = texture(u_tex, v_uv - shift);
  // Premultiplied: the fringes of a transparent layer take the alpha of the channel that lands there.
  o_color = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
}`,
  // size arrives in render pixels; u_seed changes every frame so the grain moves.
  grain: `${EFFECT_HEADER}
uniform float amount, size, u_seed;
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main() {
  vec4 c = texture(u_tex, v_uv);
  vec2 cell = floor(v_uv / (u_texel * max(size, 1.0)));
  float n = hash(cell + fract(u_seed * 0.6180339) * 1000.0) - 0.5;
  o_color = vec4(clamp(c.rgb + n * amount * 0.5 * c.a, 0.0, c.a), c.a);
}`,
  // x/y/width/height are percentages of the frame (y down, like the project); feather in render pixels.
  mask: `${EFFECT_HEADER}
uniform float shape, x, y, width, height, rotation, feather, invert;
void main() {
  vec4 c = texture(u_tex, v_uv);
  vec2 size = 1.0 / u_texel;
  vec2 p = (v_uv - vec2(0.5 + x / 100.0, 0.5 - y / 100.0)) * size;
  p.y = -p.y;
  float a = radians(rotation);
  p = vec2(cos(a) * p.x + sin(a) * p.y, -sin(a) * p.x + cos(a) * p.y);
  vec2 halfSize = max(vec2(width, height) / 200.0 * size, vec2(1.0));
  float d;
  if (shape < 0.5) {
    vec2 q = abs(p) - halfSize;
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  } else {
    // Distance to an ellipse, scaled so the feather is roughly in pixels along both axes.
    d = (length(p / halfSize) - 1.0) * min(halfSize.x, halfSize.y);
  }
  float m = 1.0 - smoothstep(-feather * 0.5 - 0.5, feather * 0.5 + 0.5, d);
  if (invert > 0.5) m = 1.0 - m;
  o_color = c * m;
}`,
  // Trilinear lookup in a 3D texture; coordinates land on texel centres so the table's corners are exact.
  lut: `${EFFECT_HEADER}
precision highp sampler3D;
uniform sampler3D u_lut;
uniform float intensity, u_lutSize;
uniform vec3 u_domainMin, u_domainMax;
void main() {
  vec4 c = unpremultiply(texture(u_tex, v_uv));
  vec3 t = clamp((c.rgb - u_domainMin) / max(u_domainMax - u_domainMin, vec3(1e-6)), 0.0, 1.0);
  vec3 graded = texture(u_lut, t * (u_lutSize - 1.0) / u_lutSize + 0.5 / u_lutSize).rgb;
  o_color = premultiply(vec4(mix(c.rgb, clamp(graded, 0.0, 1.0), intensity), c.a));
}`,
  blurFillTone: `${EFFECT_HEADER}
uniform float brightness;
void main() {
  vec4 c = texture(u_tex, v_uv);
  o_color = vec4(c.rgb * brightness, c.a);
}`,
  blackWhite: `${EFFECT_HEADER}
uniform float amount, lensFilter, contrast;
void main() {
  vec4 c = unpremultiply(texture(u_tex, v_uv));
  // A coloured filter in front of the lens: that colour renders lighter.
  vec3 weights = lensFilter < 0.5 ? vec3(0.2126, 0.7152, 0.0722) : lensFilter < 1.5 ? vec3(0.7, 0.25, 0.05) : lensFilter < 2.5 ? vec3(0.2, 0.7, 0.1) : vec3(0.1, 0.3, 0.6);
  float g = dot(c.rgb, weights);
  g = clamp((g - 0.5) * (1.0 + contrast * (contrast > 0.0 ? 2.0 : 1.0)) + 0.5, 0.0, 1.0);
  o_color = premultiply(vec4(mix(c.rgb, vec3(g), amount), c.a));
}`,
  duotone: `${EFFECT_HEADER}
uniform float shadowHue, highlightHue, amount;
void main() {
  vec4 c = unpremultiply(texture(u_tex, v_uv));
  float g = luma(c.rgb);
  vec3 dark = hsv2rgb(vec3(shadowHue / 360.0, 0.75, 0.35));
  vec3 light = hsv2rgb(vec3(highlightHue / 360.0, 0.45, 1.0));
  o_color = premultiply(vec4(mix(c.rgb, mix(dark, light, smoothstep(0.0, 1.0, g)), amount), c.a));
}`,
  posterize: `${EFFECT_HEADER}
uniform float levels;
void main() {
  vec4 c = unpremultiply(texture(u_tex, v_uv));
  float n = max(levels, 2.0) - 1.0;
  o_color = premultiply(vec4(floor(c.rgb * n + 0.5) / n, c.a));
}`,
  // v_uv.y grows upwards in framebuffer space, so "top" is y > 0.5.
  mirror: `${EFFECT_HEADER}
uniform float mode;
void main() {
  vec2 uv = v_uv;
  if (mode < 0.5 || mode > 1.5) uv.x = uv.x > 0.5 ? 1.0 - uv.x : uv.x;
  if (mode > 0.5) uv.y = uv.y < 0.5 ? 1.0 - uv.y : uv.y;
  o_color = texture(u_tex, uv);
}`,
  glowExtract: `${EFFECT_HEADER}
uniform float threshold;
void main() {
  vec4 c = texture(u_tex, v_uv);
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  float bright = smoothstep(threshold, threshold + 0.1, luma(rgb));
  o_color = c * bright;
}`,
  glowCombine: `${EFFECT_HEADER}
uniform sampler2D u_glow;
uniform float intensity;
void main() {
  vec4 c = texture(u_tex, v_uv);
  vec4 g = texture(u_glow, v_uv) * intensity;
  // Screen the glow on, so it brightens without blowing out.
  o_color = vec4(c.rgb + g.rgb * (1.0 - c.rgb), max(c.a, min(1.0, g.a)));
}`,
  // offset arrives in render pixels, y down.
  shadowShape: `${EFFECT_HEADER}
uniform vec2 u_offset;
uniform float opacity;
void main() {
  float a = texture(u_tex, v_uv - vec2(u_offset.x, -u_offset.y) * u_texel).a;
  o_color = vec4(0.0, 0.0, 0.0, a * opacity);
}`,
  shadowCombine: `${EFFECT_HEADER}
uniform sampler2D u_shadow;
void main() {
  vec4 c = texture(u_tex, v_uv);
  o_color = c + texture(u_shadow, v_uv) * (1.0 - c.a);
}`
}

export const BLEND_MODES = ['normal', 'add', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const
