/**
 * The formula column's expression language.
 *
 * A tokeniser, a Pratt parser and a walker over the resulting tree. No `eval`,
 * no `new Function`: a formula is data the app interprets, so a board pasted in
 * from someone else cannot run code in the tab.
 *
 * Columns are referenced by name in braces - {Budget} * 1.2 - and the handful
 * of functions below cover what a board actually needs: arithmetic, dates,
 * text and a conditional.
 */

const NUMBER = /^\d+(\.\d+)?/
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/
const OPERATORS = ['<=', '>=', '<>', '!=', '==', '&&', '||', '+', '-', '*', '/', '%', '^', '<', '>', '=', '(', ')', ',']

export class FormulaError extends Error {}

function tokenise(source) {
  const tokens = []
  let rest = String(source ?? '')
  let guard = 0
  while (rest.length && guard++ < 5000) {
    const ch = rest[0]
    if (/\s/.test(ch)) { rest = rest.slice(1); continue }
    if (ch === '{') {
      const close = rest.indexOf('}')
      if (close < 0) throw new FormulaError('A column reference is missing its closing brace')
      tokens.push({ kind: 'column', value: rest.slice(1, close).trim() })
      rest = rest.slice(close + 1)
      continue
    }
    if (ch === '"' || ch === "'") {
      const close = rest.indexOf(ch, 1)
      if (close < 0) throw new FormulaError('A text value is missing its closing quote')
      tokens.push({ kind: 'text', value: rest.slice(1, close) })
      rest = rest.slice(close + 1)
      continue
    }
    const number = NUMBER.exec(rest)
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) })
      rest = rest.slice(number[0].length)
      continue
    }
    const name = NAME.exec(rest)
    if (name) {
      tokens.push({ kind: 'name', value: name[0] })
      rest = rest.slice(name[0].length)
      continue
    }
    const op = OPERATORS.find((o) => rest.startsWith(o))
    if (!op) throw new FormulaError(`I do not understand "${rest[0]}"`)
    tokens.push({ kind: 'op', value: op === '=' ? '==' : op === '<>' ? '!=' : op })
    rest = rest.slice(op.length)
  }
  return tokens
}

const BINDING = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '%': 5,
  '^': 6,
}

function parse(tokens) {
  let i = 0
  const peek = () => tokens[i]
  const take = () => tokens[i++]

  function expression(minBinding = 0) {
    let left = unary()
    for (;;) {
      const token = peek()
      if (!token || token.kind !== 'op' || !(token.value in BINDING)) break
      const binding = BINDING[token.value]
      if (binding < minBinding) break
      take()
      // ^ is right-associative; everything else groups to the left.
      const right = expression(token.value === '^' ? binding : binding + 1)
      left = { kind: 'binary', op: token.value, left, right }
    }
    return left
  }

  function unary() {
    const token = peek()
    if (token?.kind === 'op' && (token.value === '-' || token.value === '+')) {
      take()
      return { kind: 'unary', op: token.value, argument: unary() }
    }
    return primary()
  }

  function primary() {
    const token = take()
    if (!token) throw new FormulaError('The formula ends too early')
    if (token.kind === 'number' || token.kind === 'text') return { kind: 'literal', value: token.value }
    if (token.kind === 'column') return { kind: 'column', name: token.value }
    if (token.kind === 'name') {
      if (peek()?.value === '(') {
        take()
        const args = []
        if (peek()?.value !== ')') {
          for (;;) {
            args.push(expression())
            if (peek()?.value === ',') { take(); continue }
            break
          }
        }
        if (take()?.value !== ')') throw new FormulaError(`${token.value}() is missing its closing bracket`)
        return { kind: 'call', name: token.value.toUpperCase(), args }
      }
      const word = token.value.toUpperCase()
      if (word === 'TRUE') return { kind: 'literal', value: 1 }
      if (word === 'FALSE') return { kind: 'literal', value: 0 }
      return { kind: 'column', name: token.value }
    }
    if (token.value === '(') {
      const inner = expression()
      if (take()?.value !== ')') throw new FormulaError('A bracket is not closed')
      return inner
    }
    throw new FormulaError(`I did not expect "${token.value}" here`)
  }

  const tree = expression()
  if (i < tokens.length) throw new FormulaError(`"${tokens[i].value}" is left over at the end`)
  return tree
}

const DAY = 86400000
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'boolean') return v ? 1 : 0
  const parsed = Number(String(v).replace(/[^0-9.eE+-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}
const str = (v) => (v === null || v === undefined ? '' : String(v))
const days = (v) => {
  const date = v instanceof Date ? v : new Date(str(v))
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / DAY)
}

const FUNCTIONS = {
  SUM: (args) => args.reduce((a, b) => a + num(b), 0),
  AVG: (args) => (args.length ? args.reduce((a, b) => a + num(b), 0) / args.length : 0),
  MIN: (args) => (args.length ? Math.min(...args.map(num)) : 0),
  MAX: (args) => (args.length ? Math.max(...args.map(num)) : 0),
  ABS: ([a]) => Math.abs(num(a)),
  ROUND: ([a, digits]) => {
    const factor = 10 ** Math.max(0, Math.min(6, Math.round(num(digits))))
    return Math.round(num(a) * factor) / factor
  },
  FLOOR: ([a]) => Math.floor(num(a)),
  CEIL: ([a]) => Math.ceil(num(a)),
  IF: ([test, yes, no]) => (truthy(test) ? yes ?? '' : no ?? ''),
  AND: (args) => (args.every(truthy) ? 1 : 0),
  OR: (args) => (args.some(truthy) ? 1 : 0),
  NOT: ([a]) => (truthy(a) ? 0 : 1),
  CONCAT: (args) => args.map(str).join(''),
  UPPER: ([a]) => str(a).toUpperCase(),
  LOWER: ([a]) => str(a).toLowerCase(),
  LEN: ([a]) => str(a).length,
  TODAY: () => Math.floor(Date.now() / DAY),
  DAYS: ([a, b]) => {
    const from = days(a)
    const to = b === undefined ? Math.floor(Date.now() / DAY) : days(b)
    return from === null || to === null ? '' : to - from
  },
  COUNT: (args) => args.filter((v) => v !== '' && v !== null && v !== undefined).length,
  PERCENT: ([a, b]) => (num(b) === 0 ? 0 : Math.round((num(a) / num(b)) * 1000) / 10),
}

const truthy = (v) => !(v === '' || v === 0 || v === null || v === undefined || v === false)

function evaluateNode(node, scope) {
  switch (node.kind) {
    case 'literal':
      return node.value
    case 'column': {
      const key = node.name.toLowerCase()
      return Object.hasOwn(scope, key) ? scope[key] : ''
    }
    case 'unary': {
      const value = evaluateNode(node.argument, scope)
      return node.op === '-' ? -num(value) : num(value)
    }
    case 'binary': {
      const left = evaluateNode(node.left, scope)
      if (node.op === '&&') return truthy(left) ? (truthy(evaluateNode(node.right, scope)) ? 1 : 0) : 0
      if (node.op === '||') return truthy(left) ? 1 : truthy(evaluateNode(node.right, scope)) ? 1 : 0
      const right = evaluateNode(node.right, scope)
      switch (node.op) {
        case '+':
          // + joins text when either side is text, and adds when both are numbers.
          return typeof left === 'string' || typeof right === 'string'
            ? (isNumericish(left) && isNumericish(right) ? num(left) + num(right) : str(left) + str(right))
            : num(left) + num(right)
        case '-': return num(left) - num(right)
        case '*': return num(left) * num(right)
        case '/': return num(right) === 0 ? '' : num(left) / num(right)
        case '%': return num(right) === 0 ? '' : num(left) % num(right)
        case '^': return num(left) ** num(right)
        case '==': return str(left) === str(right) ? 1 : 0
        case '!=': return str(left) === str(right) ? 0 : 1
        case '<': return num(left) < num(right) ? 1 : 0
        case '>': return num(left) > num(right) ? 1 : 0
        case '<=': return num(left) <= num(right) ? 1 : 0
        case '>=': return num(left) >= num(right) ? 1 : 0
        default: throw new FormulaError(`Unknown operator ${node.op}`)
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.name]
      if (!fn) throw new FormulaError(`There is no ${node.name}() function`)
      return fn(node.args.map((arg) => evaluateNode(arg, scope)))
    }
    default:
      throw new FormulaError('Malformed formula')
  }
}

const isNumericish = (v) => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v))

/** Parse once, run many times. Returns { run(scope), error }. */
export function compileFormula(source) {
  if (!String(source ?? '').trim()) return { run: () => '', error: null }
  try {
    const tree = parse(tokenise(source))
    return {
      error: null,
      run(scope) {
        try {
          const value = evaluateNode(tree, lower(scope))
          return typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value
        } catch (err) {
          return err instanceof FormulaError ? '' : ''
        }
      },
    }
  } catch (err) {
    const message = err instanceof FormulaError ? err.message : 'That formula does not parse'
    return { error: message, run: () => '' }
  }
}

const lower = (scope) => Object.fromEntries(Object.entries(scope || {}).map(([k, v]) => [k.toLowerCase(), v]))

export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS)
