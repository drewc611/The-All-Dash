/**
 * A small encoder transformer with a hand-written backward pass.
 *
 * Plain JavaScript, no dependencies, so the same file that trains the shipped
 * weights in Node also fine-tunes them in the browser. That is the only reason
 * this is not a PyTorch model: a model that can be trained somewhere you cannot
 * run it again is a model that can never learn from the person using it.
 *
 * Shape of it:
 *   - tokens are summed embeddings, there is no positional encoding, because the
 *     input is a set (situation facts plus the widgets under consideration) and
 *     order carries no meaning;
 *   - pre-LayerNorm blocks, multi-head self-attention, a GELU feed-forward, two
 *     residual adds per block, a final LayerNorm;
 *   - a linear head on the widget positions only.
 *
 * Everything is row-major Float64Array. A backward pass written by hand is only
 * worth anything if it is checked, so nn.test.js compares every parameter
 * tensor against finite differences.
 */

// ------------------------------------------------------------------ random

/** mulberry32: small, fast, and the same sequence in every JS engine. */
export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.int = (n) => Math.floor(next() * n)
  next.normal = () => {
    // Box-Muller; 1 - u keeps the log away from zero.
    const u = 1 - next()
    const v = next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  next.pick = (list) => list[next.int(list.length)]
  return next
}

// ------------------------------------------------------------------ params

/**
 * @typedef {object} Config
 * @property {number} ctxVocab    context token ids (field * values + value)
 * @property {number} widgetVocab widget ids the model has a row for, plus one for "unknown"
 * @property {number} categories
 * @property {number} sizes
 * @property {number} classes     output classes per widget
 * @property {number} dim
 * @property {number} heads
 * @property {number} layers
 * @property {number} ff
 */

/** Names and shapes of every parameter tensor, in a fixed order. */
export function layout(cfg) {
  const { dim: d, ff } = cfg
  const spec = [
    ['emb.ctx', [cfg.ctxVocab, d]],
    ['emb.wid', [cfg.widgetVocab, d]],
    ['emb.cat', [cfg.categories, d]],
    ['emb.size', [cfg.sizes, d]],
  ]
  for (let l = 0; l < cfg.layers; l++) {
    spec.push(
      [`l${l}.ln1.g`, [d]], [`l${l}.ln1.b`, [d]],
      [`l${l}.wq`, [d, d]], [`l${l}.bq`, [d]],
      [`l${l}.wk`, [d, d]], [`l${l}.bk`, [d]],
      [`l${l}.wv`, [d, d]], [`l${l}.bv`, [d]],
      [`l${l}.wo`, [d, d]], [`l${l}.bo`, [d]],
      [`l${l}.ln2.g`, [d]], [`l${l}.ln2.b`, [d]],
      [`l${l}.w1`, [d, ff]], [`l${l}.b1`, [ff]],
      [`l${l}.w2`, [ff, d]], [`l${l}.b2`, [d]],
    )
  }
  spec.push(['lnf.g', [d]], ['lnf.b', [d]], ['head.w', [d, cfg.classes]], ['head.b', [cfg.classes]])
  return spec
}

const sizeOf = (shape) => shape.reduce((a, b) => a * b, 1)

export function paramCount(cfg) {
  return layout(cfg).reduce((n, [, shape]) => n + sizeOf(shape), 0)
}

/** Zeroed tensors with the model's shapes: gradients, Adam moments. */
export function zerosLike(model) {
  const out = {}
  for (const [name, shape] of layout(model.config)) out[name] = new Float64Array(sizeOf(shape))
  return out
}

export function createModel(cfg, random = rng(1)) {
  if (cfg.dim % cfg.heads !== 0) throw new Error('dim must divide evenly into heads')
  const params = {}
  for (const [name, shape] of layout(cfg)) {
    const t = new Float64Array(sizeOf(shape))
    const isGain = name.endsWith('.g')
    const isBias = /\.(b|b[qkvo12])$/.test(name) || name === 'head.b'
    if (isGain) t.fill(1)
    else if (!isBias) {
      // Embeddings small, matrices scaled by fan-in. The output head starts
      // near zero so the first loss is "no opinion", not a random one.
      const scale = name.startsWith('emb.') ? 0.1 : name === 'head.w' ? 0.02 : 1 / Math.sqrt(shape[0])
      for (let i = 0; i < t.length; i++) t[i] = random.normal() * scale
    }
    params[name] = t
  }
  return { config: { ...cfg }, params }
}

export function cloneModel(model) {
  const params = {}
  for (const k of Object.keys(model.params)) params[k] = Float64Array.from(model.params[k])
  return { config: { ...model.config }, params }
}

// -------------------------------------------------------------- primitives

/** y[T,out] = x[T,in] @ w[in,out] + b */
function linear(x, T, din, w, b, dout) {
  const y = new Float64Array(T * dout)
  for (let t = 0; t < T; t++) {
    const yo = t * dout
    for (let j = 0; j < dout; j++) y[yo + j] = b[j]
    const xo = t * din
    for (let i = 0; i < din; i++) {
      const xv = x[xo + i]
      if (xv === 0) continue
      const wo = i * dout
      for (let j = 0; j < dout; j++) y[yo + j] += xv * w[wo + j]
    }
  }
  return y
}

/** Adds into gw and gb, returns dx. */
function linearBack(dy, x, T, din, w, dout, gw, gb) {
  const dx = new Float64Array(T * din)
  for (let t = 0; t < T; t++) {
    const yo = t * dout
    const xo = t * din
    for (let j = 0; j < dout; j++) gb[j] += dy[yo + j]
    for (let i = 0; i < din; i++) {
      const xv = x[xo + i]
      const wo = i * dout
      let acc = 0
      for (let j = 0; j < dout; j++) {
        const g = dy[yo + j]
        gw[wo + j] += xv * g
        acc += g * w[wo + j]
      }
      dx[xo + i] = acc
    }
  }
  return dx
}

const EPS = 1e-5

function layerNorm(x, T, d, g, b) {
  const y = new Float64Array(T * d)
  const xhat = new Float64Array(T * d)
  const rstd = new Float64Array(T)
  for (let t = 0; t < T; t++) {
    const o = t * d
    let mean = 0
    for (let i = 0; i < d; i++) mean += x[o + i]
    mean /= d
    let variance = 0
    for (let i = 0; i < d; i++) {
      const c = x[o + i] - mean
      variance += c * c
    }
    variance /= d
    const r = 1 / Math.sqrt(variance + EPS)
    rstd[t] = r
    for (let i = 0; i < d; i++) {
      const h = (x[o + i] - mean) * r
      xhat[o + i] = h
      y[o + i] = h * g[i] + b[i]
    }
  }
  return { y, xhat, rstd }
}

function layerNormBack(dy, cache, T, d, g, gg, gb) {
  const dx = new Float64Array(T * d)
  const { xhat, rstd } = cache
  for (let t = 0; t < T; t++) {
    const o = t * d
    let m1 = 0
    let m2 = 0
    for (let i = 0; i < d; i++) {
      const dh = dy[o + i] * g[i]
      gg[i] += dy[o + i] * xhat[o + i]
      gb[i] += dy[o + i]
      m1 += dh
      m2 += dh * xhat[o + i]
    }
    m1 /= d
    m2 /= d
    for (let i = 0; i < d; i++) {
      const dh = dy[o + i] * g[i]
      dx[o + i] = rstd[t] * (dh - m1 - xhat[o + i] * m2)
    }
  }
  return dx
}

const C = Math.sqrt(2 / Math.PI)
function gelu(u) {
  const a = new Float64Array(u.length)
  const th = new Float64Array(u.length)
  for (let i = 0; i < u.length; i++) {
    const x = u[i]
    const t = Math.tanh(C * (x + 0.044715 * x * x * x))
    th[i] = t
    a[i] = 0.5 * x * (1 + t)
  }
  return { a, th }
}

function geluBack(da, u, th) {
  const du = new Float64Array(u.length)
  for (let i = 0; i < u.length; i++) {
    const x = u[i]
    const t = th[i]
    du[i] = da[i] * (0.5 * (1 + t) + 0.5 * x * (1 - t * t) * C * (1 + 3 * 0.044715 * x * x))
  }
  return du
}

// ----------------------------------------------------------------- forward

/**
 * @typedef {object} Example
 * @property {number[]} ctx      context token ids
 * @property {Array<{wid:number, cat:number, size:number}>} widgets
 * @property {number[]} [labels] one class per widget
 */

/**
 * One sequence through the network. Returns the logits for the widget
 * positions and, if `keep` is set, everything the backward pass needs.
 */
export function forward(model, example, { keep = false } = {}) {
  const { config: cfg, params: p } = model
  const d = cfg.dim
  const H = cfg.heads
  const dh = d / H
  const nc = example.ctx.length
  const nw = example.widgets.length
  const T = nc + nw

  let x = new Float64Array(T * d)
  for (let t = 0; t < nc; t++) {
    const src = example.ctx[t] * d
    for (let i = 0; i < d; i++) x[t * d + i] = p['emb.ctx'][src + i]
  }
  for (let k = 0; k < nw; k++) {
    const w = example.widgets[k]
    const o = (nc + k) * d
    const a = w.wid * d
    const b = w.cat * d
    const c = w.size * d
    for (let i = 0; i < d; i++) x[o + i] = p['emb.wid'][a + i] + p['emb.cat'][b + i] + p['emb.size'][c + i]
  }

  const blocks = []
  for (let l = 0; l < cfg.layers; l++) {
    const pre = (n) => p[`l${l}.${n}`]
    const xin = x
    const ln1 = layerNorm(xin, T, d, pre('ln1.g'), pre('ln1.b'))
    const q = linear(ln1.y, T, d, pre('wq'), pre('bq'), d)
    const k = linear(ln1.y, T, d, pre('wk'), pre('bk'), d)
    const v = linear(ln1.y, T, d, pre('wv'), pre('bv'), d)

    const att = new Float64Array(H * T * T)
    const merged = new Float64Array(T * d)
    const scale = 1 / Math.sqrt(dh)
    for (let h = 0; h < H; h++) {
      for (let i = 0; i < T; i++) {
        const row = (h * T + i) * T
        let max = -Infinity
        for (let j = 0; j < T; j++) {
          let s = 0
          for (let e = 0; e < dh; e++) s += q[i * d + h * dh + e] * k[j * d + h * dh + e]
          s *= scale
          att[row + j] = s
          if (s > max) max = s
        }
        let sum = 0
        for (let j = 0; j < T; j++) {
          const ex = Math.exp(att[row + j] - max)
          att[row + j] = ex
          sum += ex
        }
        for (let j = 0; j < T; j++) att[row + j] /= sum
        for (let e = 0; e < dh; e++) {
          let acc = 0
          for (let j = 0; j < T; j++) acc += att[row + j] * v[j * d + h * dh + e]
          merged[i * d + h * dh + e] = acc
        }
      }
    }
    const proj = linear(merged, T, d, pre('wo'), pre('bo'), d)
    const xmid = new Float64Array(T * d)
    for (let i = 0; i < xmid.length; i++) xmid[i] = xin[i] + proj[i]

    const ln2 = layerNorm(xmid, T, d, pre('ln2.g'), pre('ln2.b'))
    const u = linear(ln2.y, T, d, pre('w1'), pre('b1'), cfg.ff)
    const g = gelu(u)
    const f = linear(g.a, T, cfg.ff, pre('w2'), pre('b2'), d)
    const xout = new Float64Array(T * d)
    for (let i = 0; i < xout.length; i++) xout[i] = xmid[i] + f[i]

    if (keep) blocks.push({ xin, ln1, q, k, v, att, merged, ln2, u, g, f, xmid })
    x = xout
  }

  const lnf = layerNorm(x, T, d, p['lnf.g'], p['lnf.b'])
  // The head only reads the widget rows.
  const rows = lnf.y.subarray(nc * d)
  const logits = linear(rows, nw, d, p['head.w'], p['head.b'], cfg.classes)
  return { logits, cache: keep ? { example, nc, nw, T, blocks, lnf, rows } : null }
}

export function softmaxRows(logits, rows, cols) {
  const out = new Float64Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    const o = r * cols
    let max = -Infinity
    for (let c = 0; c < cols; c++) if (logits[o + c] > max) max = logits[o + c]
    let sum = 0
    for (let c = 0; c < cols; c++) {
      out[o + c] = Math.exp(logits[o + c] - max)
      sum += out[o + c]
    }
    for (let c = 0; c < cols; c++) out[o + c] /= sum
  }
  return out
}

/** Per-widget class probabilities, as an array of arrays. */
export function predict(model, example) {
  const { logits } = forward(model, example)
  const k = model.config.classes
  const probs = softmaxRows(logits, example.widgets.length, k)
  return Array.from({ length: example.widgets.length }, (_, r) => Array.from(probs.subarray(r * k, (r + 1) * k)))
}

// ---------------------------------------------------------------- backward

/**
 * Cross-entropy over the widget positions, averaged over widgets, with the
 * gradient added into `grads`. Returns the loss. `weights` optionally scales
 * each widget's term (used to count rare classes for more).
 */
export function lossAndGrad(model, example, grads, { classWeights = null } = {}) {
  const { config: cfg, params: p } = model
  const d = cfg.dim
  const K = cfg.classes
  const { logits, cache } = forward(model, example, { keep: true })
  const { nc, nw, T, blocks, lnf, rows } = cache
  const probs = softmaxRows(logits, nw, K)
  const labels = example.labels

  let loss = 0
  let norm = 0
  const dlogits = new Float64Array(nw * K)
  for (let r = 0; r < nw; r++) {
    const w = classWeights ? classWeights[labels[r]] : 1
    norm += w
    loss -= w * Math.log(Math.max(probs[r * K + labels[r]], 1e-12))
    for (let c = 0; c < K; c++) dlogits[r * K + c] = w * (probs[r * K + c] - (c === labels[r] ? 1 : 0))
  }
  for (let i = 0; i < dlogits.length; i++) dlogits[i] /= norm
  loss /= norm

  // Head, then scatter its input gradient back into the full sequence.
  const drows = linearBack(dlogits, rows, nw, d, p['head.w'], K, grads['head.w'], grads['head.b'])
  const dlnfOut = new Float64Array(T * d)
  dlnfOut.set(drows, nc * d)
  let dx = layerNormBack(dlnfOut, lnf, T, d, p['lnf.g'], grads['lnf.g'], grads['lnf.b'])

  const H = cfg.heads
  const dh = d / H
  const scale = 1 / Math.sqrt(dh)
  for (let l = cfg.layers - 1; l >= 0; l--) {
    const pre = (n) => p[`l${l}.${n}`]
    const gr = (n) => grads[`l${l}.${n}`]
    const B = blocks[l]

    // x_out = x_mid + ffn(ln2(x_mid))
    const dg = linearBack(dx, B.g.a, T, cfg.ff, pre('w2'), d, gr('w2'), gr('b2'))
    const du = geluBack(dg, B.u, B.g.th)
    const dln2 = linearBack(du, B.ln2.y, T, d, pre('w1'), cfg.ff, gr('w1'), gr('b1'))
    const dxmidFromFfn = layerNormBack(dln2, B.ln2, T, d, pre('ln2.g'), gr('ln2.g'), gr('ln2.b'))
    const dxmid = new Float64Array(T * d)
    for (let i = 0; i < dxmid.length; i++) dxmid[i] = dx[i] + dxmidFromFfn[i]

    // x_mid = x_in + attn(ln1(x_in))
    const dmerged = linearBack(dxmid, B.merged, T, d, pre('wo'), d, gr('wo'), gr('bo'))
    const dq = new Float64Array(T * d)
    const dk = new Float64Array(T * d)
    const dv = new Float64Array(T * d)
    const dscore = new Float64Array(T)
    for (let h = 0; h < H; h++) {
      for (let i = 0; i < T; i++) {
        const row = (h * T + i) * T
        // d(attention weight) from the value mix, and d(v) from the weights.
        let dot = 0
        for (let j = 0; j < T; j++) {
          let da = 0
          for (let e = 0; e < dh; e++) {
            const dm = dmerged[i * d + h * dh + e]
            da += dm * B.v[j * d + h * dh + e]
            dv[j * d + h * dh + e] += B.att[row + j] * dm
          }
          dscore[j] = da
          dot += da * B.att[row + j]
        }
        // Softmax backward: ds_j = a_j (da_j - sum_k a_k da_k)
        for (let j = 0; j < T; j++) {
          const ds = B.att[row + j] * (dscore[j] - dot) * scale
          for (let e = 0; e < dh; e++) {
            dq[i * d + h * dh + e] += ds * B.k[j * d + h * dh + e]
            dk[j * d + h * dh + e] += ds * B.q[i * d + h * dh + e]
          }
        }
      }
    }
    const dh1 = linearBack(dq, B.ln1.y, T, d, pre('wq'), d, gr('wq'), gr('bq'))
    const dh2 = linearBack(dk, B.ln1.y, T, d, pre('wk'), d, gr('wk'), gr('bk'))
    const dh3 = linearBack(dv, B.ln1.y, T, d, pre('wv'), d, gr('wv'), gr('bv'))
    const dln1 = new Float64Array(T * d)
    for (let i = 0; i < dln1.length; i++) dln1[i] = dh1[i] + dh2[i] + dh3[i]
    const dxinFromAttn = layerNormBack(dln1, B.ln1, T, d, pre('ln1.g'), gr('ln1.g'), gr('ln1.b'))
    dx = new Float64Array(T * d)
    for (let i = 0; i < dx.length; i++) dx[i] = dxmid[i] + dxinFromAttn[i]
  }

  // Embeddings.
  const ex = example
  for (let t = 0; t < nc; t++) {
    const o = ex.ctx[t] * d
    for (let i = 0; i < d; i++) grads['emb.ctx'][o + i] += dx[t * d + i]
  }
  for (let k = 0; k < nw; k++) {
    const w = ex.widgets[k]
    const row = (nc + k) * d
    const a = w.wid * d
    const b = w.cat * d
    const c = w.size * d
    for (let i = 0; i < d; i++) {
      const g = dx[row + i]
      grads['emb.wid'][a + i] += g
      grads['emb.cat'][b + i] += g
      grads['emb.size'][c + i] += g
    }
  }
  return loss
}

// --------------------------------------------------------------- optimiser

export function createAdam(model) {
  return { step: 0, m: zerosLike(model), v: zerosLike(model) }
}

/**
 * AdamW. `scale` divides the accumulated gradient (the batch size), `clip` is
 * the global-norm ceiling, and decay skips gains, biases and embeddings'
 * unused rows by only touching matrices.
 */
export function adamStep(model, grads, state, { lr = 1e-3, beta1 = 0.9, beta2 = 0.999, eps = 1e-8, decay = 0.01, scale = 1, clip = 1 } = {}) {
  let sq = 0
  for (const name of Object.keys(grads)) {
    const g = grads[name]
    for (let i = 0; i < g.length; i++) {
      g[i] *= scale
      sq += g[i] * g[i]
    }
  }
  const norm = Math.sqrt(sq)
  const k = norm > clip ? clip / norm : 1
  state.step += 1
  const c1 = 1 - beta1 ** state.step
  const c2 = 1 - beta2 ** state.step
  for (const name of Object.keys(grads)) {
    const g = grads[name]
    const m = state.m[name]
    const v = state.v[name]
    const w = model.params[name]
    const decays = decay > 0 && /\.w[qkvo12]?$/.test(name)
    for (let i = 0; i < g.length; i++) {
      const gi = g[i] * k
      m[i] = beta1 * m[i] + (1 - beta1) * gi
      v[i] = beta2 * v[i] + (1 - beta2) * gi * gi
      let upd = (m[i] / c1) / (Math.sqrt(v[i] / c2) + eps)
      if (decays) upd += decay * w[i]
      w[i] -= lr * upd
      g[i] = 0
    }
  }
  return norm
}

// ------------------------------------------------------------ persistence

function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(text) {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Float32, little-endian, every tensor in layout order, as base64. */
export function exportWeights(model) {
  const total = paramCount(model.config)
  const f32 = new Float32Array(total)
  let at = 0
  for (const [name] of layout(model.config)) {
    f32.set(model.params[name], at)
    at += model.params[name].length
  }
  return toBase64(new Uint8Array(f32.buffer))
}

export function importWeights(config, text) {
  const bytes = fromBase64(text)
  const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  if (f32.length !== paramCount(config)) {
    throw new Error(`weights hold ${f32.length} values, this architecture needs ${paramCount(config)}`)
  }
  const params = {}
  let at = 0
  for (const [name, shape] of layout(config)) {
    const n = sizeOf(shape)
    params[name] = Float64Array.from(f32.subarray(at, at + n))
    at += n
  }
  return { config: { ...config }, params }
}
