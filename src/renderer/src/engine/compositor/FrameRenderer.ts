import { compileProgram, createTexture } from './gl'

const VERTEX = `#version 300 es
in vec2 a_pos;
uniform vec2 u_scale;
uniform float u_flipY;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos.x * u_scale.x, a_pos.y * u_scale.y * u_flipY, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 o_color;
void main() { o_color = texture(u_tex, v_uv); }`

/**
 * Milestone-1 renderer: draws one source frame, letterboxed, onto the output canvas.
 * `flipY` renders bottom-up so that readPixels() yields top-down rows for FFmpeg.
 */
export class FrameRenderer {
  readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly texture: WebGLTexture
  private readonly uScale: WebGLUniformLocation
  private readonly uFlipY: WebGLUniformLocation

  constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    private readonly flipY = false
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: flipY
    }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.program = compileProgram(gl, VERTEX, FRAGMENT)
    this.texture = createTexture(gl)
    this.uScale = gl.getUniformLocation(this.program, 'u_scale')!
    this.uFlipY = gl.getUniformLocation(this.program, 'u_flipY')!

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(this.program, 'a_pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  }

  draw(source: TexImageSource, sourceWidth: number, sourceHeight: number): void {
    const { gl, canvas } = this
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.program)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

    const fit = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight)
    gl.uniform2f(this.uScale, (sourceWidth * fit) / canvas.width, (sourceHeight * fit) / canvas.height)
    gl.uniform1f(this.uFlipY, this.flipY ? -1 : 1)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  readPixels(target: Uint8Array): void {
    const { gl, canvas } = this
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, target)
  }
}
