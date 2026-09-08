/** Decode the entities Office XML actually uses, including hex numeric ones. */
export function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex) => codePoint(parseInt(hex, 16), whole))
    .replace(/&#(\d+);/g, (whole, dec) => codePoint(Number(dec), whole))
    .replace(/&amp;/g, '&')
}

/** Out-of-range code points keep the original entity text rather than vanishing. */
const codePoint = (n, original) =>
  Number.isFinite(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : original
