// Svg2Gfx.js - a JavaScript port of svg2gfx (https://github.com/codewitch-honey-crisis/svg2gfx)
// Converts an SVG document into a C++ routine that draws it with a gfx::canvas.
//
// Main entry points:
//   svgGenerate(svg, options)        -> { code, warnings, stats, width, height, functionName }
//   svgGeneratePreview(svg, options) -> same as above, but `code` holds only the first part of
//                                       the output (options.previewLines, default 48 lines)
//   svgMakeIdentifier(text)          -> a valid C++ identifier derived from a file name
//
// `svg` may be a string, an ArrayBuffer/typed array of UTF-8 text, or an already parsed XML Document.
// options: { functionName, prefix, sourceName, dpi = 96, precision, comments = true, previewLines }

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

// ---------------------------------------------------------------------------------------------
// DOM helpers (only attributes/elements without a namespace prefix count, like XLinq's Attribute())
// ---------------------------------------------------------------------------------------------
const childElements = (e) => {
    const r = [];
    for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) r.push(n);
    return r;
};
const attr = (e, name) => (e.hasAttributeNS(null, name) ? e.getAttributeNS(null, name) : null);
const localName = (e) => e.localName || e.nodeName;
const parentElement = (e) => (e.parentNode && e.parentNode.nodeType === 1 ? e.parentNode : null);
const isSvgElement = (e) => !e.namespaceURI || e.namespaceURI === SVG_NS;
const descendantsAndSelf = (root) => {
    const r = [];
    const walk = (e) => { r.push(e); for (const c of childElements(e)) walk(c); };
    walk(root);
    return r;
};
const isWsp = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
const isDigit = (c) => c >= "0" && c <= "9";
const isAlnum = (c) => isDigit(c) || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const roundAway = (v, digits = 0) => {
    const m = Math.pow(10, digits);
    return (Math.sign(v) * Math.round(Math.abs(v) * m)) / m;
};
const parseFloatStrict = (s) => {
    s = s.trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
    return Number(s);
};

// ---------------------------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------------------------
class Scanner {
    constructor(s) { this.s = s ?? ""; this.pos = 0; }
    get atEnd() { return this.pos >= this.s.length; }
    get peek() { return this.pos < this.s.length ? this.s[this.pos] : "\0"; }
    get rest() { return this.pos < this.s.length ? this.s.substring(this.pos) : ""; }
    skipWsp() { while (this.pos < this.s.length && isWsp(this.s[this.pos])) ++this.pos; }
    skipCommaWsp() {
        this.skipWsp();
        if (this.pos < this.s.length && this.s[this.pos] === ",") ++this.pos;
        this.skipWsp();
    }
    tryChar(c) {
        this.skipWsp();
        if (this.pos < this.s.length && this.s[this.pos] === c) { ++this.pos; return true; }
        return false;
    }
    numberAhead() {
        this.skipWsp();
        if (this.atEnd) return false;
        const c = this.s[this.pos];
        if (isDigit(c) || c === ".") return true;
        if ((c === "+" || c === "-") && this.pos + 1 < this.s.length) {
            const n = this.s[this.pos + 1];
            return isDigit(n) || n === ".";
        }
        return false;
    }
    // returns the number or null. An exponent is only consumed when digits follow it ("2em").
    tryNumber() {
        this.skipWsp();
        const s = this.s, n = s.length, start = this.pos;
        let i = start;
        if (i < n && (s[i] === "+" || s[i] === "-")) ++i;
        const digitsStart = i;
        while (i < n && isDigit(s[i])) ++i;
        const hasInt = i > digitsStart;
        let hasFrac = false;
        if (i < n && s[i] === ".") {
            let f = i + 1;
            while (f < n && isDigit(s[f])) ++f;
            hasFrac = f > i + 1;
            if (hasFrac || hasInt) i = f;
        }
        if (!hasInt && !hasFrac) return null;
        if (i < n && (s[i] === "e" || s[i] === "E")) {
            let e = i + 1;
            if (e < n && (s[e] === "+" || s[e] === "-")) ++e;
            if (e < n && isDigit(s[e])) {
                while (e < n && isDigit(s[e])) ++e;
                i = e;
            }
        }
        const v = Number(s.substring(start, i));
        if (!Number.isFinite(v)) return null;
        this.pos = i;
        return v;
    }
    tryFlag() {
        this.skipCommaWsp();
        if (this.atEnd) return null;
        const c = this.s[this.pos];
        if (c === "0" || c === "1") { ++this.pos; return c === "1"; }
        return null;
    }
    readIdent() {
        this.skipWsp();
        const start = this.pos;
        while (this.pos < this.s.length && (isAlnum(this.s[this.pos]) || this.s[this.pos] === "-" || this.s[this.pos] === "_")) ++this.pos;
        return this.s.substring(start, this.pos);
    }
    static parseNumberList(s) {
        const sc = new Scanner(s);
        const list = [];
        sc.skipWsp();
        while (!sc.atEnd) {
            const v = sc.tryNumber();
            if (v === null) return null;
            list.push(v);
            sc.skipCommaWsp();
        }
        return list;
    }
}

// ---------------------------------------------------------------------------------------------
// Matrix (same layout and multiplication order as gfx::matrix; row vectors)
// ---------------------------------------------------------------------------------------------
const mat = (a, b, c, d, e, f) => ({ a, b, c, d, e, f });
const IDENTITY = mat(1, 0, 0, 1, 0, 0);
// apply l first, then r
const matMul = (l, r) => mat(
    l.a * r.a + l.b * r.c,
    l.a * r.b + l.b * r.d,
    l.c * r.a + l.d * r.c,
    l.c * r.b + l.d * r.d,
    l.e * r.a + l.f * r.c + r.e,
    l.e * r.b + l.f * r.d + r.f);
const matTranslate = (x, y) => mat(1, 0, 0, 1, x, y);
const matScale = (x, y) => mat(x, 0, 0, y, 0, 0);
const matRotate = (rad) => { const c = Math.cos(rad), s = Math.sin(rad); return mat(c, s, -s, c, 0, 0); };
const matIsIdentity = (m) => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
const deg = (d) => d * Math.PI / 180.0;

const parseTransform = (text) => {
    if (!text || text.trim().length === 0) return IDENTITY;
    const sc = new Scanner(text);
    let m = IDENTITY;
    sc.skipWsp();
    while (!sc.atEnd) {
        const name = sc.readIdent();
        if (name.length === 0) return null;
        if (!sc.tryChar("(")) return null;
        const args = [];
        sc.skipWsp();
        while (sc.numberAhead()) {
            const v = sc.tryNumber();
            if (v === null) return null;
            args.push(v);
            sc.skipCommaWsp();
        }
        if (!sc.tryChar(")")) return null;
        let t;
        switch (name) {
            case "matrix":
                if (args.length !== 6) return null;
                t = mat(args[0], args[1], args[2], args[3], args[4], args[5]);
                break;
            case "translate":
                if (args.length === 1) t = matTranslate(args[0], 0);
                else if (args.length === 2) t = matTranslate(args[0], args[1]);
                else return null;
                break;
            case "scale":
                if (args.length === 1) t = matScale(args[0], args[0]);
                else if (args.length === 2) t = matScale(args[0], args[1]);
                else return null;
                break;
            case "rotate":
                if (args.length === 1) t = matRotate(deg(args[0]));
                else if (args.length === 3)
                    t = matMul(matMul(matTranslate(-args[1], -args[2]), matRotate(deg(args[0]))), matTranslate(args[1], args[2]));
                else return null;
                break;
            case "skewX":
                if (args.length !== 1) return null;
                t = mat(1, 0, Math.tan(deg(args[0])), 1, 0, 0);
                break;
            case "skewY":
                if (args.length !== 1) return null;
                t = mat(1, Math.tan(deg(args[0])), 0, 1, 0, 0);
                break;
            default:
                return null;
        }
        m = matMul(t, m);
        sc.skipCommaWsp();
    }
    return m;
};

// ---------------------------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------------------------
const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : roundAway(v));
const rgba = (r, g, b, a) => ({ r: clampByte(r), g: clampByte(g), b: clampByte(b), a: clampByte(a) });
const rgbaWithAlpha = (c, factor) => rgba(c.r, c.g, c.b, c.a * factor);
const rgbaToCpp = (c) => `gfx::vector_pixel(${c.a}, ${c.r}, ${c.g}, ${c.b})`;
const BLACK = rgba(0, 0, 0, 255);

const NAMED_COLORS = (() => {
    const t = {
        aliceblue: "f0f8ff", antiquewhite: "faebd7", aqua: "00ffff", aquamarine: "7fffd4", azure: "f0ffff",
        beige: "f5f5dc", bisque: "ffe4c4", black: "000000", blanchedalmond: "ffebcd", blue: "0000ff",
        blueviolet: "8a2be2", brown: "a52a2a", burlywood: "deb887", cadetblue: "5f9ea0", chartreuse: "7fff00",
        chocolate: "d2691e", coral: "ff7f50", cornflowerblue: "6495ed", cornsilk: "fff8dc", crimson: "dc143c",
        cyan: "00ffff", darkblue: "00008b", darkcyan: "008b8b", darkgoldenrod: "b8860b", darkgray: "a9a9a9",
        darkgreen: "006400", darkgrey: "a9a9a9", darkkhaki: "bdb76b", darkmagenta: "8b008b", darkolivegreen: "556b2f",
        darkorange: "ff8c00", darkorchid: "9932cc", darkred: "8b0000", darksalmon: "e9967a", darkseagreen: "8fbc8f",
        darkslateblue: "483d8b", darkslategray: "2f4f4f", darkslategrey: "2f4f4f", darkturquoise: "00ced1",
        darkviolet: "9400d3", deeppink: "ff1493", deepskyblue: "00bfff", dimgray: "696969", dimgrey: "696969",
        dodgerblue: "1e90ff", firebrick: "b22222", floralwhite: "fffaf0", forestgreen: "228b22", fuchsia: "ff00ff",
        gainsboro: "dcdcdc", ghostwhite: "f8f8ff", gold: "ffd700", goldenrod: "daa520", gray: "808080",
        green: "008000", greenyellow: "adff2f", grey: "808080", honeydew: "f0fff0", hotpink: "ff69b4",
        indianred: "cd5c5c", indigo: "4b0082", ivory: "fffff0", khaki: "f0e68c", lavender: "e6e6fa",
        lavenderblush: "fff0f5", lawngreen: "7cfc00", lemonchiffon: "fffacd", lightblue: "add8e6",
        lightcoral: "f08080", lightcyan: "e0ffff", lightgoldenrodyellow: "fafad2", lightgray: "d3d3d3",
        lightgreen: "90ee90", lightgrey: "d3d3d3", lightpink: "ffb6c1", lightsalmon: "ffa07a",
        lightseagreen: "20b2aa", lightskyblue: "87cefa", lightslategray: "778899", lightslategrey: "778899",
        lightsteelblue: "b0c4de", lightyellow: "ffffe0", lime: "00ff00", limegreen: "32cd32", linen: "faf0e6",
        magenta: "ff00ff", maroon: "800000", mediumaquamarine: "66cdaa", mediumblue: "0000cd",
        mediumorchid: "ba55d3", mediumpurple: "9370db", mediumseagreen: "3cb371", mediumslateblue: "7b68ee",
        mediumspringgreen: "00fa9a", mediumturquoise: "48d1cc", mediumvioletred: "c71585", midnightblue: "191970",
        mintcream: "f5fffa", mistyrose: "ffe4e1", moccasin: "ffe4b5", navajowhite: "ffdead", navy: "000080",
        oldlace: "fdf5e6", olive: "808000", olivedrab: "6b8e23", orange: "ffa500", orangered: "ff4500",
        orchid: "da70d6", palegoldenrod: "eee8aa", palegreen: "98fb98", paleturquoise: "afeeee",
        palevioletred: "db7093", papayawhip: "ffefd5", peachpuff: "ffdab9", peru: "cd853f", pink: "ffc0cb",
        plum: "dda0dd", powderblue: "b0e0e6", purple: "800080", rebeccapurple: "663399", red: "ff0000",
        rosybrown: "bc8f8f", royalblue: "4169e1", saddlebrown: "8b4513", salmon: "fa8072", sandybrown: "f4a460",
        seagreen: "2e8b57", seashell: "fff5ee", sienna: "a0522d", silver: "c0c0c0", skyblue: "87ceeb",
        slateblue: "6a5acd", slategray: "708090", slategrey: "708090", snow: "fffafa", springgreen: "00ff7f",
        steelblue: "4682b4", tan: "d2b48c", teal: "008080", thistle: "d8bfd8", tomato: "ff6347",
        turquoise: "40e0d0", violet: "ee82ee", wheat: "f5deb3", white: "ffffff", whitesmoke: "f5f5f5",
        yellow: "ffff00", yellowgreen: "9acd32",
    };
    const r = {};
    for (const k in t) r[k] = rgba(parseInt(t[k].substr(0, 2), 16), parseInt(t[k].substr(2, 2), 16), parseInt(t[k].substr(4, 2), 16), 255);
    return r;
})();

const parseHexColor = (h) => {
    if (!/^[0-9a-fA-F]*$/.test(h)) return null;
    const H = (i) => parseInt(h.substr(i, 1), 16);
    const HH = (i) => parseInt(h.substr(i, 2), 16);
    switch (h.length) {
        case 3: return rgba(H(0) * 17, H(1) * 17, H(2) * 17, 255);
        case 4: return rgba(H(0) * 17, H(1) * 17, H(2) * 17, H(3) * 17);
        case 6: return rgba(HH(0), HH(2), HH(4), 255);
        case 8: return rgba(HH(0), HH(2), HH(4), HH(6));
        default: return null;
    }
};
const splitColorArgs = (args) => {
    const parts = args.replace(/\//g, " / ").split(/[,\s]+/).filter((p) => p.length > 0 && p !== "/");
    return parts.length === 3 || parts.length === 4 ? parts : null;
};
const colorComponent = (p, percentScale) => {
    const pct = p.endsWith("%");
    let v = parseFloatStrict(pct ? p.substring(0, p.length - 1) : p);
    if (v === null) return null;
    if (pct) v = v / 100.0 * percentScale;
    return v;
};
const colorAlpha = (parts) => {
    if (parts.length < 4) return 1;
    const a = colorComponent(parts[3], 1.0);
    return a === null ? null : clamp(a, 0, 1);
};
const parseColor = (text, currentColor) => {
    if (text == null) return null;
    const s = text.trim();
    if (s.length === 0) return null;
    if (s[0] === "#") return parseHexColor(s.substring(1));
    const lower = s.toLowerCase();
    if (lower === "currentcolor") return currentColor;
    if (lower === "transparent") return rgba(0, 0, 0, 0);
    const paren = lower.indexOf("(");
    if (paren > 0 && lower.endsWith(")")) {
        const fn = lower.substring(0, paren).trim();
        const p = splitColorArgs(lower.substring(paren + 1, lower.length - 1));
        if (!p) return null;
        if (fn === "rgb" || fn === "rgba") {
            const r = colorComponent(p[0], 255), g = colorComponent(p[1], 255), b = colorComponent(p[2], 255), a = colorAlpha(p);
            if (r === null || g === null || b === null || a === null) return null;
            return rgba(r, g, b, a * 255);
        }
        if (fn === "hsl" || fn === "hsla") {
            let h = parseFloatStrict(p[0].endsWith("deg") ? p[0].substring(0, p[0].length - 3) : p[0]);
            let sat = colorComponent(p[1], 1), l = colorComponent(p[2], 1);
            const a = colorAlpha(p);
            if (h === null || sat === null || l === null || a === null) return null;
            if (!p[1].endsWith("%")) sat /= 100;
            if (!p[2].endsWith("%")) l /= 100;
            sat = clamp(sat, 0, 1); l = clamp(l, 0, 1);
            h = (((h % 360) + 360) % 360) / 360.0;
            const hue = (m1, m2, t) => {
                if (t < 0) t += 1; if (t > 1) t -= 1;
                if (t < 1.0 / 6) return m1 + (m2 - m1) * t * 6;
                if (t < 0.5) return m2;
                if (t < 2.0 / 3) return m1 + (m2 - m1) * (2.0 / 3 - t) * 6;
                return m1;
            };
            const q = l <= 0.5 ? l * (1 + sat) : l + sat - l * sat;
            const pp = 2 * l - q;
            return rgba(hue(pp, q, h + 1.0 / 3) * 255, hue(pp, q, h) * 255, hue(pp, q, h - 1.0 / 3) * 255, a * 255);
        }
        return null;
    }
    return NAMED_COLORS[lower] ?? null;
};

// ---------------------------------------------------------------------------------------------
// Lengths
// ---------------------------------------------------------------------------------------------
const UNITS = { "": "none", px: "px", pt: "pt", pc: "pc", mm: "mm", cm: "cm", in: "in", em: "em", ex: "ex", "%": "%" };
const parseLength = (text) => {
    if (text == null) return null;
    const sc = new Scanner(text.trim());
    const v = sc.tryNumber();
    if (v === null) return null;
    const unit = UNITS[sc.rest.trim().toLowerCase()];
    if (unit === undefined) return null;
    return { value: v, unit };
};
// axis: "x", "y" or "other"
const resolveLength = (l, ctx, axis, fontSize) => {
    const v = l.value;
    switch (l.unit) {
        case "none": case "px": return v;
        case "pt": return v / 72.0 * ctx.dpi;
        case "pc": return v / 6.0 * ctx.dpi;
        case "mm": return v / 25.4 * ctx.dpi;
        case "cm": return v / 2.54 * ctx.dpi;
        case "in": return v * ctx.dpi;
        case "em": return v * fontSize;
        case "ex": return v * fontSize * 0.5;
        case "%": {
            const basis = axis === "x" ? ctx.viewportWidth : axis === "y" ? ctx.viewportHeight
                : Math.sqrt(ctx.viewportWidth * ctx.viewportWidth + ctx.viewportHeight * ctx.viewportHeight) / Math.SQRT2;
            return v / 100.0 * basis;
        }
    }
    return v;
};
const lengthAsFraction = (l) => (l.unit === "%" ? l.value / 100.0 : l.value);
const pctLen = (v) => ({ value: v, unit: "%" });

// ---------------------------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------------------------
const parseDeclarations = (text) => {
    const list = [];
    if (!text || text.trim().length === 0) return list;
    for (const decl of text.split(";")) {
        const colon = decl.indexOf(":");
        if (colon <= 0) continue;
        const name = decl.substring(0, colon).trim().toLowerCase();
        let value = decl.substring(colon + 1).trim();
        const imp = value.toLowerCase().indexOf("!important");
        if (imp >= 0) value = value.substring(0, imp).trim();
        if (name.length > 0 && value.length > 0) list.push([name, value]);
    }
    return list;
};
const SIMPLE_SELECTOR = /^(\*|[A-Za-z][\w-]*)?((?:[#.][\w-]+)*)$/;
const parseStylesheet = (text, rules, warn) => {
    text = text.replace(/\/\*[\s\S]*?\*\//g, " ");
    let pos = 0;
    while (pos < text.length) {
        const open = text.indexOf("{", pos);
        if (open < 0) break;
        const selectorText = text.substring(pos, open).trim();
        let depth = 1, i = open + 1;
        while (i < text.length && depth > 0) {
            if (text[i] === "{") ++depth;
            else if (text[i] === "}") --depth;
            ++i;
        }
        const body = text.substring(open + 1, Math.max(open + 1, i - 1));
        pos = i;
        if (selectorText.startsWith("@")) {
            warn(`CSS at-rule '${selectorText}' ignored`);
            continue;
        }
        const decls = parseDeclarations(body);
        for (const raw of selectorText.split(",")) {
            const sel = raw.trim();
            if (sel.length === 0) continue;
            const m = SIMPLE_SELECTOR.exec(sel);
            if (!m) {
                warn(`CSS selector '${sel}' is not supported (only tag, #id and .class) and was ignored`);
                continue;
            }
            const s = { tag: null, id: null, classes: [] };
            if (m[1] && m[1] !== "*") s.tag = m[1];
            for (const p of (m[2] || "").matchAll(/([#.])([\w-]+)/g)) {
                if (p[1] === "#") s.id = p[2]; else s.classes.push(p[2]);
            }
            s.specificity = (s.id !== null ? 10000 : 0) + s.classes.length * 100 + (s.tag !== null ? 1 : 0);
            rules.push({ selector: s, declarations: decls, order: rules.length });
        }
    }
};
const selectorMatches = (s, e) => {
    if (s.tag !== null && s.tag !== localName(e)) return false;
    if (s.id !== null && attr(e, "id") !== s.id) return false;
    if (s.classes.length > 0) {
        const cls = (attr(e, "class") ?? "").split(/\s+/).filter((c) => c.length > 0);
        for (const c of s.classes) if (!cls.includes(c)) return false;
    }
    return true;
};

// ---------------------------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------------------------
// paint: { kind: "none"|"color"|"currentColor"|"url", color, url, fallback }
const PAINT_NONE = { kind: "none" };
const PAINT_BLACK = { kind: "color", color: BLACK };
const parsePaint = (value) => {
    const v = value.trim();
    const lower = v.toLowerCase();
    if (lower === "none") return PAINT_NONE;
    if (lower === "currentcolor") return { kind: "currentColor" };
    if (lower.startsWith("url(")) {
        const close = v.indexOf(")");
        if (close < 0) return null;
        const inner = v.substring(4, close).trim().replace(/^['"]+|['"]+$/g, "").trim();
        if (!inner.startsWith("#")) return null;
        const rest = v.substring(close + 1).trim();
        let fallback = rest.length > 0 ? parsePaint(rest) : null;
        if (fallback && fallback.kind === "url") fallback = null;
        return { kind: "url", url: inner.substring(1), fallback };
    }
    const c = parseColor(v, BLACK);
    return c ? { kind: "color", color: c } : null;
};

const STYLE_PROPERTIES = new Set([
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "color", "font-size",
    "visibility", "display", "opacity", "stop-color", "stop-opacity",
]);

const defaultStyle = () => ({
    // inherited
    fill: PAINT_BLACK, fillOpacity: 1, fillRule: "non_zero",
    stroke: PAINT_NONE, strokeWidth: 1, strokeOpacity: 1,
    lineCap: "butt", lineJoin: "miter", miterLimit: 4,
    dash: null, dashOffset: 0, color: BLACK, fontSize: 16, visible: true,
    // not inherited
    ownOpacity: 1, opacity: 1, display: true, stopColor: BLACK, stopOpacity: 1,
});
const inheritStyle = (p) => ({ ...p, ownOpacity: 1, display: true, stopColor: BLACK, stopOpacity: 1 });

const parseOpacity = (v) => {
    v = v.trim();
    const pct = v.endsWith("%");
    let o = parseFloatStrict(pct ? v.substring(0, v.length - 1) : v);
    if (o === null) return null;
    if (pct) o /= 100;
    return clamp(o, 0, 1);
};

class StyleResolver {
    constructor(ctx) { this.ctx = ctx; this.cache = new Map(); }

    declared(e) {
        const d = new Map();
        for (const a of Array.from(e.attributes)) {
            if (a.namespaceURI || a.prefix) continue;
            if (STYLE_PROPERTIES.has(a.localName || a.name)) d.set(a.localName || a.name, a.value);
        }
        const matching = this.ctx.rules.filter((r) => selectorMatches(r.selector, e))
            .sort((x, y) => (x.selector.specificity - y.selector.specificity) || (x.order - y.order));
        for (const rule of matching)
            for (const [k, v] of rule.declarations) if (STYLE_PROPERTIES.has(k)) d.set(k, v);
        for (const [k, v] of parseDeclarations(attr(e, "style")))
            if (STYLE_PROPERTIES.has(k)) d.set(k, v);
        return d;
    }

    computeFor(e) {
        if (this.cache.has(e)) return this.cache.get(e);
        const p = parentElement(e);
        const parent = p ? this.computeFor(p) : defaultStyle();
        return this.compute(e, parent);
    }

    compute(e, parent) {
        if (this.cache.has(e)) return this.cache.get(e);
        const ctx = this.ctx;
        const d = this.declared(e);
        const s = inheritStyle(parent);
        const get = (name) => (d.has(name) ? d.get(name).trim() : null);
        const isInherit = (v) => v !== null && v.toLowerCase() === "inherit";
        const warn = (prop, value) => ctx.warn(`<${localName(e)}>: invalid ${prop} value '${value}' ignored`);

        const color = get("color");
        if (color !== null && !isInherit(color)) {
            const c = parseColor(color, parent.color);
            if (c) s.color = c;
        }
        const fs = get("font-size");
        if (fs !== null && !isInherit(fs)) {
            const fsl = parseLength(fs);
            if (fsl) s.fontSize = fsl.unit === "%" ? parent.fontSize * fsl.value / 100.0 : resolveLength(fsl, ctx, "other", parent.fontSize);
        }

        for (const [name, raw] of d) {
            const v = raw.trim();
            if (name === "color" || name === "font-size") continue;
            if (isInherit(v)) {
                switch (name) {
                    case "opacity": s.ownOpacity = parent.ownOpacity; break;
                    case "display": s.display = parent.display; break;
                    case "stop-color": s.stopColor = parent.stopColor; break;
                    case "stop-opacity": s.stopOpacity = parent.stopOpacity; break;
                }
                continue;
            }
            const lv = v.toLowerCase();
            switch (name) {
                case "fill": { const p = parsePaint(v); if (p) s.fill = p; else warn(name, v); break; }
                case "stroke": { const p = parsePaint(v); if (p) s.stroke = p; else warn(name, v); break; }
                case "fill-opacity": { const o = parseOpacity(v); if (o !== null) s.fillOpacity = o; break; }
                case "stroke-opacity": { const o = parseOpacity(v); if (o !== null) s.strokeOpacity = o; break; }
                case "opacity": { const o = parseOpacity(v); if (o !== null) s.ownOpacity = o; break; }
                case "stop-opacity": { const o = parseOpacity(v); if (o !== null) s.stopOpacity = o; break; }
                case "stop-color": { const c = parseColor(v, s.color); if (c) s.stopColor = c; else warn(name, v); break; }
                case "fill-rule":
                    if (lv === "evenodd") s.fillRule = "even_odd"; else if (lv === "nonzero") s.fillRule = "non_zero";
                    break;
                case "stroke-linecap":
                    if (lv === "butt" || lv === "round" || lv === "square") s.lineCap = lv;
                    break;
                case "stroke-linejoin":
                    if (lv === "miter" || lv === "round" || lv === "bevel") s.lineJoin = lv;
                    else if (lv === "miter-clip" || lv === "arcs") s.lineJoin = "miter";
                    break;
                case "stroke-miterlimit": {
                    const ml = parseFloatStrict(v);
                    if (ml !== null && ml >= 1) s.miterLimit = ml;
                    break;
                }
                case "stroke-width": {
                    const sw = parseLength(v);
                    if (sw) { const w = resolveLength(sw, ctx, "other", s.fontSize); if (w >= 0) s.strokeWidth = w; }
                    break;
                }
                case "stroke-dashoffset": {
                    const l = parseLength(v);
                    if (l) s.dashOffset = resolveLength(l, ctx, "other", s.fontSize);
                    break;
                }
                case "stroke-dasharray": {
                    const r = this.parseDashArray(v, s.fontSize);
                    s.dash = r.dash;
                    if (!r.ok) warn(name, v);
                    break;
                }
                case "visibility":
                    if (lv === "visible") s.visible = true; else if (lv === "hidden" || lv === "collapse") s.visible = false;
                    break;
                case "display":
                    s.display = lv !== "none";
                    break;
            }
        }
        s.opacity = parent.opacity * s.ownOpacity;
        this.cache.set(e, s);
        return s;
    }

    parseDashArray(v, fontSize) {
        if (v.trim().toLowerCase() === "none") return { dash: null, ok: true };
        const parts = v.split(/[,\s]+/).filter((p) => p.length > 0);
        let list = [];
        for (const p of parts) {
            const l = parseLength(p);
            if (!l) return { dash: null, ok: false };
            const n = resolveLength(l, this.ctx, "other", fontSize);
            if (n < 0) return { dash: null, ok: false };
            list.push(n);
        }
        if (list.length === 0 || list.every((x) => x === 0)) return { dash: null, ok: true };
        if (list.length % 2 === 1) list = list.concat(list);
        return { dash: list, ok: true };
    }
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------
// segment: { kind: "move"|"line"|"quad"|"cubic"|"arc"|"close", sx, sy, x1, y1, x2, y2, x, y, rx, ry, angleDeg, large, sweep }
class Bounds {
    constructor() { this.valid = false; this.minX = this.minY = this.maxX = this.maxY = 0; }
    add(x, y) {
        if (!this.valid) { this.minX = this.maxX = x; this.minY = this.maxY = y; this.valid = true; return; }
        if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
        if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
    }
    get width() { return this.valid ? this.maxX - this.minX : 0; }
    get height() { return this.valid ? this.maxY - this.minY : 0; }
}
const quadAt = (p0, p1, p2, t) => (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
const quadExtrema = (p0, p1, p2) => {
    const d = p0 - 2 * p1 + p2;
    if (Math.abs(d) > 1e-12) { const t = (p0 - p1) / d; if (t > 0 && t < 1) return [t]; }
    return [];
};
const cubicAt = (p0, p1, p2, p3, t) => {
    const mt = 1 - t;
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
};
const cubicExtrema = (p0, p1, p2, p3) => {
    const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
    const r = [];
    if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) > 1e-12) { const t = -c / b; if (t > 0 && t < 1) r.push(t); }
        return r;
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) return r;
    const sq = Math.sqrt(disc);
    const t1 = (-b + sq) / (2 * a), t2 = (-b - sq) / (2 * a);
    if (t1 > 0 && t1 < 1) r.push(t1);
    if (t2 > 0 && t2 < 1) r.push(t2);
    return r;
};
const sampleArc = (s, steps) => {
    let rx = Math.abs(s.rx), ry = Math.abs(s.ry);
    const out = [];
    if (rx < 1e-12 || ry < 1e-12) return out;
    const phi = deg(s.angleDeg), cos = Math.cos(phi), sin = Math.sin(phi);
    const dx2 = (s.sx - s.x) / 2, dy2 = (s.sy - s.y) / 2;
    const x1p = cos * dx2 + sin * dy2, y1p = -sin * dx2 + cos * dy2;
    const lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if (lambda > 1) { const l = Math.sqrt(lambda); rx *= l; ry *= l; }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
    if (s.large === s.sweep) coef = -coef;
    const cxp = coef * rx * y1p / ry, cyp = -coef * ry * x1p / rx;
    const cx = cos * cxp - sin * cyp + (s.sx + s.x) / 2, cy = sin * cxp + cos * cyp + (s.sy + s.y) / 2;
    const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!s.sweep && dtheta > 0) dtheta -= 2 * Math.PI;
    else if (s.sweep && dtheta < 0) dtheta += 2 * Math.PI;
    for (let i = 0; i <= steps; ++i) {
        const th = theta1 + dtheta * i / steps, ct = Math.cos(th), st = Math.sin(th);
        out.push([cx + rx * ct * cos - ry * st * sin, cy + rx * ct * sin + ry * st * cos]);
    }
    return out;
};

class PathGeometry {
    constructor() { this.type = "path"; this.segs = []; }
    get hasDrawing() { return this.segs.some((s) => s.kind !== "move"); }
    moveTo(x, y, sx, sy) { this.segs.push({ kind: "move", sx, sy, x, y }); }
    lineTo(x, y, sx, sy) { this.segs.push({ kind: "line", sx, sy, x, y }); }
    cubicTo(x1, y1, x2, y2, x, y, sx, sy) { this.segs.push({ kind: "cubic", sx, sy, x1, y1, x2, y2, x, y }); }
    close() { this.segs.push({ kind: "close" }); }
    getBounds() {
        const b = new Bounds();
        for (const s of this.segs) {
            switch (s.kind) {
                case "move": case "line": b.add(s.x, s.y); break;
                case "quad":
                    b.add(s.sx, s.sy); b.add(s.x, s.y);
                    for (const t of quadExtrema(s.sx, s.x1, s.x)) b.add(quadAt(s.sx, s.x1, s.x, t), quadAt(s.sy, s.y1, s.y, t));
                    for (const t of quadExtrema(s.sy, s.y1, s.y)) b.add(quadAt(s.sx, s.x1, s.x, t), quadAt(s.sy, s.y1, s.y, t));
                    break;
                case "cubic":
                    b.add(s.sx, s.sy); b.add(s.x, s.y);
                    for (const t of cubicExtrema(s.sx, s.x1, s.x2, s.x)) b.add(cubicAt(s.sx, s.x1, s.x2, s.x, t), cubicAt(s.sy, s.y1, s.y2, s.y, t));
                    for (const t of cubicExtrema(s.sy, s.y1, s.y2, s.y)) b.add(cubicAt(s.sx, s.x1, s.x2, s.x, t), cubicAt(s.sy, s.y1, s.y2, s.y, t));
                    break;
                case "arc":
                    b.add(s.sx, s.sy); b.add(s.x, s.y);
                    for (const [x, y] of sampleArc(s, 64)) b.add(x, y);
                    break;
            }
        }
        return b;
    }
}
class EllipseGeometry {
    constructor(cx, cy, rx, ry) { this.type = "ellipse"; this.cx = cx; this.cy = cy; this.rx = rx; this.ry = ry; }
    get isCircle() { return this.rx === this.ry; }
    getBounds() {
        const b = new Bounds();
        b.add(this.cx - this.rx, this.cy - this.ry);
        b.add(this.cx + this.rx, this.cy + this.ry);
        return b;
    }
}

// Path storage each operation uses in plutovg (a command header plus one element per point).
// quad_to is stored as a cubic; arc_to becomes at most four cubics (one per quarter turn);
// circle()/ellipse() add a move, four cubics and a close.
const SEGMENT_ELEMENTS = { move: 2, line: 2, quad: 4, cubic: 4, arc: 16, close: 2 };
const ELLIPSE_ELEMENTS = 20;

const isPathCommand = (c) => "MmZzLlHhVvCcSsQqTtAa".indexOf(c) >= 0;
// returns { geometry, error }. Rendering stops at the first error (per the SVG error handling rules).
const parsePathData = (d) => {
    const g = new PathGeometry();
    if (!d || d.trim().length === 0) return { geometry: g, error: null };
    const sc = new Scanner(d);
    let cx = 0, cy = 0, sx = 0, sy = 0, lcx = 0, lcy = 0;
    let cmd = "\0", prev = "\0", first = true, needMove = false, error = null;
    const a = [0, 0, 0, 0, 0, 0, 0];
    const nums = (n) => {
        for (let i = 0; i < n; ++i) {
            if (i > 0) sc.skipCommaWsp();
            const v = sc.tryNumber();
            if (v === null) return false;
            a[i] = v;
        }
        return true;
    };
    loop:
    while (true) {
        sc.skipCommaWsp();
        if (sc.atEnd) break;
        const c = sc.peek;
        if (isPathCommand(c)) { cmd = c; ++sc.pos; }
        else if (cmd === "\0" || !sc.numberAhead()) { error = `unexpected '${c}' at offset ${sc.pos}`; break; }
        if (first) {
            if (cmd !== "M" && cmd !== "m") { error = "path data must begin with a moveto"; break; }
            first = false;
        }
        const rel = cmd >= "a" && cmd <= "z";
        const up = cmd.toUpperCase();
        if (up === "Z") {
            g.close();
            cx = sx; cy = sy;
            prev = "Z";
            needMove = true;
            cmd = "\0";
            continue;
        }
        if (needMove && up !== "M") g.moveTo(sx, sy, cx, cy);
        needMove = false;
        const ox = rel ? cx : 0, oy = rel ? cy : 0;
        switch (up) {
            case "M":
                if (!nums(2)) { error = "bad moveto"; break loop; }
                cx = sx = a[0] + ox; cy = sy = a[1] + oy;
                g.moveTo(cx, cy, cx, cy);
                cmd = rel ? "l" : "L";
                break;
            case "L":
                if (!nums(2)) { error = "bad lineto"; break loop; }
                g.lineTo(a[0] + ox, a[1] + oy, cx, cy);
                cx = a[0] + ox; cy = a[1] + oy;
                break;
            case "H":
                if (!nums(1)) { error = "bad horizontal lineto"; break loop; }
                g.lineTo(a[0] + ox, cy, cx, cy);
                cx = a[0] + ox;
                break;
            case "V":
                if (!nums(1)) { error = "bad vertical lineto"; break loop; }
                g.lineTo(cx, a[0] + oy, cx, cy);
                cy = a[0] + oy;
                break;
            case "C":
                if (!nums(6)) { error = "bad curveto"; break loop; }
                g.cubicTo(a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy, cx, cy);
                lcx = a[2] + ox; lcy = a[3] + oy;
                cx = a[4] + ox; cy = a[5] + oy;
                break;
            case "S": {
                if (!nums(4)) { error = "bad smooth curveto"; break loop; }
                let x1 = cx, y1 = cy;
                if (prev === "C" || prev === "S") { x1 = 2 * cx - lcx; y1 = 2 * cy - lcy; }
                g.cubicTo(x1, y1, a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, cx, cy);
                lcx = a[0] + ox; lcy = a[1] + oy;
                cx = a[2] + ox; cy = a[3] + oy;
                break;
            }
            case "Q":
                if (!nums(4)) { error = "bad quadratic curveto"; break loop; }
                g.segs.push({ kind: "quad", sx: cx, sy: cy, x1: a[0] + ox, y1: a[1] + oy, x: a[2] + ox, y: a[3] + oy });
                lcx = a[0] + ox; lcy = a[1] + oy;
                cx = a[2] + ox; cy = a[3] + oy;
                break;
            case "T": {
                if (!nums(2)) { error = "bad smooth quadratic curveto"; break loop; }
                let x1 = cx, y1 = cy;
                if (prev === "Q" || prev === "T") { x1 = 2 * cx - lcx; y1 = 2 * cy - lcy; }
                g.segs.push({ kind: "quad", sx: cx, sy: cy, x1, y1, x: a[0] + ox, y: a[1] + oy });
                lcx = x1; lcy = y1;
                cx = a[0] + ox; cy = a[1] + oy;
                break;
            }
            case "A": {
                if (!nums(3)) { error = "bad arc"; break loop; }
                const large = sc.tryFlag();
                const sweep = large === null ? null : sc.tryFlag();
                if (large === null || sweep === null) { error = "bad arc flags"; break loop; }
                sc.skipCommaWsp();
                let ex = sc.tryNumber();
                if (ex === null) { error = "bad arc"; break loop; }
                sc.skipCommaWsp();
                let ey = sc.tryNumber();
                if (ey === null) { error = "bad arc"; break loop; }
                ex += ox; ey += oy;
                const rx = Math.abs(a[0]), ry = Math.abs(a[1]);
                if (ex === cx && ey === cy) {
                    // zero-length arc: omitted per spec
                } else if (rx === 0 || ry === 0) {
                    g.lineTo(ex, ey, cx, cy);
                } else {
                    g.segs.push({ kind: "arc", sx: cx, sy: cy, rx, ry, angleDeg: a[2], large, sweep, x: ex, y: ey });
                }
                cx = ex; cy = ey;
                break;
            }
        }
        prev = up;
    }
    return { geometry: g, error };
};

// ---------------------------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------------------------
const gradientHref = (e) => {
    let h = e.hasAttributeNS(XLINK_NS, "href") ? e.getAttributeNS(XLINK_NS, "href") : attr(e, "href");
    h = h?.trim();
    return h && h.startsWith("#") ? h.substring(1) : null;
};
const isGradient = (e) => localName(e) === "linearGradient" || localName(e) === "radialGradient";
const resolveGradient = (ctx, id) => {
    const head = ctx.ids.get(id);
    if (!head || !isGradient(head)) return null;
    const chain = [];
    const seen = new Set();
    for (let e = head; e && !seen.has(e);) {
        seen.add(e);
        if (isGradient(e)) chain.push(e); else break;
        const next = gradientHref(e);
        e = next !== null && ctx.ids.has(next) ? ctx.ids.get(next) : null;
    }
    const gattr = (name) => {
        for (const e of chain) { const a = attr(e, name); if (a !== null) return a; }
        return null;
    };
    const glen = (name) => { const a = gattr(name); return a !== null ? parseLength(a) : null; };
    const g = {
        linear: localName(head) === "linearGradient", objectBoundingBox: true, transform: IDENTITY, spread: "pad",
        x1: pctLen(0), y1: pctLen(0), x2: pctLen(100), y2: pctLen(0),
        cx: pctLen(50), cy: pctLen(50), r: pctLen(50), fx: null, fy: null, fr: pctLen(0), stops: [],
    };
    if (gattr("gradientUnits")?.trim() === "userSpaceOnUse") g.objectBoundingBox = false;
    const gt = gattr("gradientTransform");
    if (gt !== null) {
        const m = parseTransform(gt);
        if (m) g.transform = m; else ctx.warn(`gradient '${id}': invalid gradientTransform ignored`);
    }
    const spread = gattr("spreadMethod")?.trim();
    if (spread === "reflect" || spread === "repeat") g.spread = spread;
    if (g.linear) {
        for (const k of ["x1", "y1", "x2", "y2"]) { const l = glen(k); if (l) g[k] = l; }
    } else {
        for (const k of ["cx", "cy", "r", "fr"]) { const l = glen(k); if (l) g[k] = l; }
        g.fx = glen("fx"); g.fy = glen("fy");
    }
    for (const e of chain) {
        const stops = childElements(e).filter((s) => localName(s) === "stop");
        if (stops.length === 0) continue;
        let last = 0;
        for (const s of stops) {
            let off = 0;
            const os = attr(s, "offset")?.trim();
            if (os != null) {
                const pct = os.endsWith("%");
                const ov = parseFloatStrict(pct ? os.substring(0, os.length - 1) : os);
                if (ov !== null) off = pct ? ov / 100 : ov;
            }
            off = clamp(off, 0, 1);
            if (off < last) off = last;
            last = off;
            const st = ctx.styles.computeFor(s);
            g.stops.push({ offset: off, color: rgbaWithAlpha(st.stopColor, st.stopOpacity) });
        }
        break;
    }
    return g;
};

// ---------------------------------------------------------------------------------------------
// C++ writer
// ---------------------------------------------------------------------------------------------
// Shortest decimal string that round-trips to the same 32-bit float.
const float32String = (f) => {
    for (let p = 1; p <= 9; ++p) {
        const s = f.toPrecision(p);
        if (Math.fround(Number(s)) === f) return String(Number(s));
    }
    return String(f);
};
class CppWriter {
    constructor(precision) { this.lines = []; this.indent = 0; this.precision = precision; }
    doIndent() { ++this.indent; }
    outdent() { --this.indent; }
    line(text = "") { this.lines.push(text.length > 0 ? " ".repeat(this.indent * 4) + text : ""); }
    toString() { return this.lines.length ? this.lines.join("\n") + "\n" : ""; }
    F(v) {
        if (Number.isInteger(this.precision)) v = roundAway(v, this.precision);
        let f = Math.fround(v);
        if (!Number.isFinite(f)) f = 0;
        if (f === 0) return "0.f";
        let s = float32String(f);
        if (s.indexOf("e") < 0 && s.indexOf(".") < 0) s += ".";
        return s + "f";
    }
    Pt(x, y) { return `gfx::pointf(${this.F(x)}, ${this.F(y)})`; }
    Mat(m) { return `gfx::matrix(${this.F(m.a)}, ${this.F(m.b)}, ${this.F(m.c)}, ${this.F(m.d)}, ${this.F(m.e)}, ${this.F(m.f)})`; }
    checked(call) { this.line(`res = ${call}; if (res != gfx::gfx_result::success) return res;`); }
}
const cppComment = (s) => s.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\*\//g, "* /");
const fmt3 = (v) => { const r = Number(v.toFixed(3)); return String(Object.is(r, -0) ? 0 : r); };

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------
class Generator {
    constructor(opt) {
        this.opt = opt;
        this.warnings = [];
        this.ctx = {
            dpi: opt.dpi, viewportWidth: 300, viewportHeight: 150,
            rules: [], ids: new Map(), styles: null,
            warn: (m) => { if (!this.warnings.includes(m)) this.warnings.push(m); },
        };
        this.w = new CppWriter(opt.precision);
        this.state = new Map();
        // plutovg path storage needed by the largest shape, in path elements
        this.maxPathElements = 0;
        this.stats = {
            shapes: 0, elements: 0, skippedElements: 0, groups: 0, gradients: 0, gradientFills: 0, gradientStrokes: 0,
            dashedStrokes: 0, cssRules: 0,
            byElement: {}, segments: { move: 0, line: 0, quad: 0, cubic: 0, arc: 0, close: 0 },
            filled: 0, stroked: 0, colors: new Set(),
        };
    }

    generate(doc) {
        const ctx = this.ctx, opt = this.opt, w = this.w;
        const root = doc.documentElement;
        if (!root) throw new Error("empty document");
        if (localName(root) !== "svg") throw new Error("root element is not <svg>");

        const all = descendantsAndSelf(root);
        this.stats.elements = all.length;
        for (const e of all) {
            const id = attr(e, "id");
            if (id && !ctx.ids.has(id)) ctx.ids.set(id, e);
            if (isGradient(e)) ++this.stats.gradients;
        }
        for (const style of all.filter((e) => localName(e) === "style" && isSvgElement(e))) {
            const type = attr(style, "type");
            if (type !== null && type.trim() !== "text/css") continue;
            parseStylesheet(style.textContent ?? "", ctx.rules, ctx.warn);
        }
        this.stats.cssRules = ctx.rules.length;
        ctx.styles = new StyleResolver(ctx);

        // --- sizing (intrinsic size, viewBox and preserveAspectRatio) ---
        const rootStyle = ctx.styles.compute(root, defaultStyle());
        let width = this.rootLength(root, "width", rootStyle);
        let height = this.rootLength(root, "height", rootStyle);
        let vbx = 0, vby = 0, vbw = 0, vbh = 0;
        const vb = Scanner.parseNumberList(attr(root, "viewBox") ?? "");
        const hasViewBox = vb !== null && vb.length === 4 && vb[2] > 0 && vb[3] > 0;
        if (vb !== null && vb.length > 0 && !hasViewBox) ctx.warn("invalid viewBox ignored");
        if (hasViewBox) { [vbx, vby, vbw, vbh] = vb; }
        if (width <= 0 || height <= 0) {
            if (hasViewBox) {
                const ratio = vbw / vbh;
                if (width <= 0 && height > 0) width = height * ratio;
                else if (width > 0 && height <= 0) height = width / ratio;
                else { width = vbw; height = vbh; }
            } else {
                if (width <= 0) width = 300;
                if (height <= 0) height = 150;
            }
        }
        ctx.viewportWidth = hasViewBox ? vbw : width;
        ctx.viewportHeight = hasViewBox ? vbh : height;
        const view = hasViewBox ? viewBoxMatrix(vbx, vby, vbw, vbh, width, height, attr(root, "preserveAspectRatio")) : IDENTITY;
        const rootCtm = matMul(this.localTransform(root), view);

        // --- body ---
        w.doIndent();
        for (const child of childElements(root)) this.walk(child, rootStyle, rootCtm);
        w.outdent();
        const body = w.toString();

        // --- assemble the routine ---
        const fn = opt.functionName;
        const o = new CppWriter(opt.precision);
        o.line("// Automatically generated by https://codewitch-honey-crisis.github.io/gfx_web/svg-gen")
        o.line("#pragma once");
        o.line("#include <gfx.hpp>");
        o.line("");
        o.line(`// Intrinsic size: ${fmt3(width)} x ${fmt3(height)}, ${this.stats.shapes} shape(s)`);
        o.line(`constexpr gfx::sizef ${fn}_dimensions(${o.F(width)}, ${o.F(height)});`);
        for (const m of this.warnings) o.line(`// warning: ${cppComment(m)}`);
        o.line("template <typename Destination>");
        o.line(`gfx::gfx_result ${fn}(Destination& destination, gfx::spoint16 location = gfx::spoint16(0, 0), const gfx::matrix& transform = gfx::matrix::create_identity()) {`);
        o.doIndent();
        o.line("const gfx::size16 canvas_size = destination.dimensions();");
        o.line("if (canvas_size.width == 0 || canvas_size.height == 0) return gfx::gfx_result::success;");
        o.line("gfx::canvas cvs(canvas_size);");
        o.line("gfx::gfx_result res = cvs.initialize();");
        o.line("if (res != gfx::gfx_result::success) return res;");
        if (this.maxPathElements > 0) {
            // The canvas keeps its path storage between renders, so reserving room for the
            // largest shape up front means no path building call below can allocate (or fail).
            if (opt.comments) o.line("// reserve path storage for the largest shape so path building never allocates");
            o.line(`res = cvs.reserve(${Math.ceil(this.maxPathElements / 2)});`);
            o.line("if (res != gfx::gfx_result::success) return res;");
        }
        o.line("res = gfx::draw::canvas(destination, cvs);");
        o.line("if (res != gfx::gfx_result::success) return res;");
        o.line("gfx::matrix xform(transform);");
        o.line("xform *= gfx::matrix::create_translate((float)location.x, (float)location.y);");
        const head = o.toString();
        const tail = new CppWriter();
        tail.doIndent();
        tail.line("return gfx::gfx_result::success;");
        tail.outdent();
        tail.line("}");
        this.width = width;
        this.height = height;
        return head + body + tail.toString();
    }

    rootLength(root, name, style) {
        const a = attr(root, name);
        if (a === null || a.trim() === "auto") return 0;
        const l = parseLength(a);
        if (!l || l.unit === "%") return 0;
        return resolveLength(l, this.ctx, "other", style.fontSize);
    }

    localTransform(e) {
        const t = attr(e, "transform");
        if (t === null) return IDENTITY;
        const m = parseTransform(t);
        if (m) return m;
        this.ctx.warn(`<${localName(e)}>: invalid transform '${t}' ignored`);
        return IDENTITY;
    }

    describe(e) {
        const id = attr(e, "id"), cls = attr(e, "class");
        let s = "<" + localName(e);
        if (id !== null) s += ` id="${id}"`;
        if (cls !== null) s += ` class="${cls}"`;
        return cppComment(s + ">");
    }

    walk(e, parentStyle, parentCtm) {
        if (!isSvgElement(e)) return; // editor metadata (inkscape:, sodipodi:, ...)
        const name = localName(e);
        switch (name) {
            case "g":
            case "a": {
                const style = this.ctx.styles.compute(e, parentStyle);
                if (!style.display) return;
                ++this.stats.groups;
                this.warnIgnoredEffects(e);
                const ctm = matMul(this.localTransform(e), parentCtm);
                for (const child of childElements(e)) this.walk(child, style, ctm);
                return;
            }
            case "path": case "rect": case "circle": case "ellipse": case "line": case "polyline": case "polygon":
                this.renderShape(e, parentStyle, parentCtm);
                return;
            case "defs": case "linearGradient": case "radialGradient": case "stop": case "style":
            case "title": case "desc": case "metadata": case "symbol":
                return;
            case "clipPath": case "mask": case "pattern": case "marker": case "filter":
                return;
            default:
                ++this.stats.skippedElements;
                this.ctx.warn(`<${name}> is not supported and was skipped`);
                if (this.opt.comments) this.w.line(`// skipped unsupported ${this.describe(e)}`);
                return;
        }
    }

    warnIgnoredEffects(e) {
        for (const a of ["clip-path", "mask", "filter"]) {
            const v = attr(e, a);
            if (v !== null && v.trim() !== "none") this.ctx.warn(`${a} is not supported and was ignored (on ${this.describe(e)})`);
        }
    }

    len(e, name) {
        const a = attr(e, name);
        if (a === null) return null;
        const l = parseLength(a);
        if (l) return l;
        if (a.trim() !== "auto") this.ctx.warn(`<${localName(e)}>: invalid ${name} '${a}' ignored`);
        return null;
    }
    L(e, name, axis, s, def = 0) {
        const l = this.len(e, name);
        return l ? resolveLength(l, this.ctx, axis, s.fontSize) : def;
    }
    optLen(e, name, axis, s) {
        const l = this.len(e, name);
        return l ? resolveLength(l, this.ctx, axis, s.fontSize) : null;
    }

    buildGeometry(e, s) {
        switch (localName(e)) {
            case "path": {
                const { geometry, error } = parsePathData(attr(e, "d"));
                if (error !== null) this.ctx.warn(`${this.describe(e)}: path data error (${error}); rendered up to the error`);
                return geometry.hasDrawing ? geometry : null;
            }
            case "rect": {
                const x = this.L(e, "x", "x", s), y = this.L(e, "y", "y", s);
                const w = this.L(e, "width", "x", s), h = this.L(e, "height", "y", s);
                if (w <= 0 || h <= 0) return null;
                let rxo = this.optLen(e, "rx", "x", s), ryo = this.optLen(e, "ry", "y", s);
                if (rxo !== null && rxo < 0) rxo = null;
                if (ryo !== null && ryo < 0) ryo = null;
                let rx = rxo ?? ryo ?? 0, ry = ryo ?? rxo ?? 0;
                rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
                return rectPath(x, y, w, h, rx, ry);
            }
            case "circle": {
                const r = this.L(e, "r", "other", s);
                if (r <= 0) return null;
                return new EllipseGeometry(this.L(e, "cx", "x", s), this.L(e, "cy", "y", s), r, r);
            }
            case "ellipse": {
                const rxo = this.optLen(e, "rx", "x", s), ryo = this.optLen(e, "ry", "y", s);
                const rx = rxo ?? ryo ?? 0, ry = ryo ?? rxo ?? 0;
                if (rx <= 0 || ry <= 0) return null;
                return new EllipseGeometry(this.L(e, "cx", "x", s), this.L(e, "cy", "y", s), rx, ry);
            }
            case "line": {
                const g = new PathGeometry();
                const x1 = this.L(e, "x1", "x", s), y1 = this.L(e, "y1", "y", s);
                const x2 = this.L(e, "x2", "x", s), y2 = this.L(e, "y2", "y", s);
                g.moveTo(x1, y1, x1, y1);
                g.lineTo(x2, y2, x1, y1);
                return g;
            }
            case "polyline":
            case "polygon": {
                let pts = Scanner.parseNumberList(attr(e, "points") ?? "");
                if (pts === null) {
                    pts = [];
                    const sc = new Scanner(attr(e, "points") ?? "");
                    let v;
                    while ((v = sc.tryNumber()) !== null) { pts.push(v); sc.skipCommaWsp(); }
                    this.ctx.warn(`${this.describe(e)}: bad points list; rendered up to the error`);
                }
                if (pts.length % 2 === 1) pts.pop();
                if (pts.length < 4) return null;
                const g = new PathGeometry();
                g.moveTo(pts[0], pts[1], pts[0], pts[1]);
                for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1], pts[i - 2], pts[i - 1]);
                if (localName(e) === "polygon") g.close();
                return g;
            }
        }
        return null;
    }

    resolvePaint(p, s, bounds, prop) {
        switch (p.kind) {
            case "none": return { kind: "none" };
            case "color": return { kind: "color", color: p.color };
            case "currentColor": return { kind: "color", color: s.color };
        }
        const ctx = this.ctx;
        const g = resolveGradient(ctx, p.url);
        if (!g) {
            const target = ctx.ids.get(p.url);
            if (target) ctx.warn(`${prop}: paint server <${localName(target)} id="${p.url}"> is not supported`);
            else ctx.warn(`${prop}: url(#${p.url}) does not reference anything`);
            return p.fallback ? this.resolvePaint(p.fallback, s, bounds, prop) : { kind: "none" };
        }
        if (g.stops.length === 0) return { kind: "none" };
        if (g.stops.length === 1) return { kind: "color", color: g.stops[0].color };
        const rp = { kind: "url", linear: g.linear, spread: g.spread, stops: g.stops, transform: IDENTITY };
        if (g.objectBoundingBox) {
            if (bounds.width <= 0 || bounds.height <= 0) return { kind: "none" };
            const bbox = matMul(matScale(bounds.width, bounds.height), matTranslate(bounds.minX, bounds.minY));
            rp.transform = matMul(g.transform, bbox);
            rp.x1 = lengthAsFraction(g.x1); rp.y1 = lengthAsFraction(g.y1); rp.x2 = lengthAsFraction(g.x2); rp.y2 = lengthAsFraction(g.y2);
            rp.cx = lengthAsFraction(g.cx); rp.cy = lengthAsFraction(g.cy); rp.r = lengthAsFraction(g.r); rp.fr = lengthAsFraction(g.fr);
            rp.fx = g.fx ? lengthAsFraction(g.fx) : rp.cx; rp.fy = g.fy ? lengthAsFraction(g.fy) : rp.cy;
        } else {
            const fs = s.fontSize, R = (l, axis) => resolveLength(l, ctx, axis, fs);
            rp.transform = g.transform;
            rp.x1 = R(g.x1, "x"); rp.y1 = R(g.y1, "y"); rp.x2 = R(g.x2, "x"); rp.y2 = R(g.y2, "y");
            rp.cx = R(g.cx, "x"); rp.cy = R(g.cy, "y"); rp.r = R(g.r, "other"); rp.fr = R(g.fr, "other");
            rp.fx = g.fx ? R(g.fx, "x") : rp.cx; rp.fy = g.fy ? R(g.fy, "y") : rp.cy;
        }
        if (!g.linear && rp.r <= 0) return { kind: "color", color: g.stops[g.stops.length - 1].color };
        return rp;
    }

    // Emits a setter only when it differs from what the canvas already holds.
    set(key, statement) {
        if (this.state.get(key) === statement) return;
        this.state.set(key, statement);
        this.w.line(statement);
    }

    emitGradient(prefix, p) {
        const w = this.w;
        w.line(`gfx::gradient_stop ${prefix}_stops[] = {`);
        w.doIndent();
        for (const st of p.stops) {
            w.line(`{${w.F(st.offset)}, ${rgbaToCpp(st.color)}},`);
            this.stats.colors.add(rgbaToCpp(st.color));
        }
        w.outdent();
        w.line("};");
        w.line(`gfx::gradient ${prefix}_gradient;`);
        w.line(`${prefix}_gradient.type = gfx::gradient_type::${p.linear ? "linear" : "radial"};`);
        w.line(`${prefix}_gradient.spread = gfx::spread_method::${p.spread};`);
        w.line(`${prefix}_gradient.transform = ${matIsIdentity(p.transform) ? "gfx::matrix::create_identity()" : w.Mat(p.transform)};`);
        if (p.linear) {
            w.line(`${prefix}_gradient.linear.x1 = ${w.F(p.x1)};`);
            w.line(`${prefix}_gradient.linear.y1 = ${w.F(p.y1)};`);
            w.line(`${prefix}_gradient.linear.x2 = ${w.F(p.x2)};`);
            w.line(`${prefix}_gradient.linear.y2 = ${w.F(p.y2)};`);
        } else {
            w.line(`${prefix}_gradient.radial.cx = ${w.F(p.cx)};`);
            w.line(`${prefix}_gradient.radial.cy = ${w.F(p.cy)};`);
            w.line(`${prefix}_gradient.radial.fx = ${w.F(p.fx)};`);
            w.line(`${prefix}_gradient.radial.fy = ${w.F(p.fy)};`);
            w.line(`${prefix}_gradient.radial.cr = ${w.F(p.r)};`);
            w.line(`${prefix}_gradient.radial.fr = ${w.F(p.fr)};`);
        }
        w.line(`${prefix}_gradient.stops = ${prefix}_stops;`);
        w.line(`${prefix}_gradient.stops_size = ${p.stops.length};`);
        // fill_gradient()/stroke_gradient() also switch the paint type to gradient
        w.line(`cvs.${prefix}_gradient(${prefix}_gradient);`);
        this.state.set(`${prefix}_paint_type`, `cvs.${prefix}_paint_type(gfx::paint_type::gradient);`);
    }

    renderShape(e, parentStyle, parentCtm) {
        const ctx = this.ctx, w = this.w, stats = this.stats;
        const s = ctx.styles.compute(e, parentStyle);
        if (!s.display) return;
        this.warnIgnoredEffects(e);
        const ctm = matMul(this.localTransform(e), parentCtm);
        const geo = this.buildGeometry(e, s);
        if (!geo || !s.visible) return;
        const bounds = geo.getBounds();
        let fill = this.resolvePaint(s.fill, s, bounds, "fill");
        let stroke = s.strokeWidth > 0 ? this.resolvePaint(s.stroke, s, bounds, "stroke") : { kind: "none" };
        const fillOpacity = s.fillOpacity * s.opacity, strokeOpacity = s.strokeOpacity * s.opacity;
        if (fillOpacity <= 0) fill = { kind: "none" };
        if (strokeOpacity <= 0) stroke = { kind: "none" };
        if (fill.kind === "none" && stroke.kind === "none") return;

        ++stats.shapes;
        const tag = localName(e);
        stats.byElement[tag] = (stats.byElement[tag] || 0) + 1;
        if (fill.kind !== "none") ++stats.filled;
        if (stroke.kind !== "none") ++stats.stroked;
        if (fill.kind === "url") ++stats.gradientFills;
        if (stroke.kind === "url") ++stats.gradientStrokes;

        if (this.opt.comments) w.line(`// ${this.describe(e)}`);
        w.line("{");
        w.doIndent();
        this.set("transform", matIsIdentity(ctm) ? "cvs.transform(xform);" : `cvs.transform(${w.Mat(ctm)} * xform);`);

        switch (fill.kind) {
            case "none":
                this.set("fill_paint_type", "cvs.fill_paint_type(gfx::paint_type::none);");
                break;
            case "color":
                this.set("fill_paint_type", "cvs.fill_paint_type(gfx::paint_type::solid);");
                this.set("fill_color", `cvs.fill_color(${rgbaToCpp(fill.color)});`);
                stats.colors.add(rgbaToCpp(fill.color));
                break;
            case "url":
                this.emitGradient("fill", fill);
                break;
        }
        if (fill.kind !== "none") {
            this.set("fill_opacity", `cvs.fill_opacity(${w.F(fillOpacity)});`);
            this.set("fill_rule", `cvs.fill_rule(gfx::fill_rule::${s.fillRule});`);
        }

        switch (stroke.kind) {
            case "none":
                this.set("stroke_paint_type", "cvs.stroke_paint_type(gfx::paint_type::none);");
                break;
            case "color":
                this.set("stroke_paint_type", "cvs.stroke_paint_type(gfx::paint_type::solid);");
                this.set("stroke_color", `cvs.stroke_color(${rgbaToCpp(stroke.color)});`);
                stats.colors.add(rgbaToCpp(stroke.color));
                break;
            case "url":
                this.emitGradient("stroke", stroke);
                break;
        }
        if (stroke.kind !== "none") {
            this.set("stroke_opacity", `cvs.stroke_opacity(${w.F(strokeOpacity)});`);
            this.set("stroke_width", `cvs.stroke_width(${w.F(s.strokeWidth)});`);
            this.set("stroke_line_cap", `cvs.stroke_line_cap(gfx::line_cap::${s.lineCap});`);
            this.set("stroke_line_join", `cvs.stroke_line_join(gfx::line_join::${s.lineJoin});`);
            this.set("stroke_miter_limit", `cvs.stroke_miter_limit(${w.F(s.miterLimit)});`);
            if (s.dash) {
                ++stats.dashedStrokes;
                w.line(`float dash_values[] = {${s.dash.map((d) => w.F(d)).join(", ")}};`);
                w.line(`cvs.stroke_dash(gfx::dash{${w.F(s.dashOffset)}, dash_values, ${s.dash.length}});`);
                this.state.set("stroke_dash", "<dashed>");
            } else {
                this.set("stroke_dash", "cvs.stroke_dash(gfx::dash{0.f, nullptr, 0});");
            }
        }

        // Path building calls only fail when the path storage has to grow, and the routine reserves
        // enough for the largest shape up front, so only render() needs its result checked.
        let elements = 0;
        if (geo.type === "ellipse") {
            elements = ELLIPSE_ELEMENTS;
            if (geo.isCircle) w.line(`cvs.circle(${w.Pt(geo.cx, geo.cy)}, ${w.F(geo.rx)});`);
            else w.line(`cvs.ellipse(${w.Pt(geo.cx, geo.cy)}, gfx::sizef(${w.F(geo.rx)}, ${w.F(geo.ry)}));`);
        } else {
            for (const seg of geo.segs) {
                ++stats.segments[seg.kind];
                elements += SEGMENT_ELEMENTS[seg.kind];
                switch (seg.kind) {
                    case "move": w.line(`cvs.move_to(${w.Pt(seg.x, seg.y)});`); break;
                    case "line": w.line(`cvs.line_to(${w.Pt(seg.x, seg.y)});`); break;
                    case "quad": w.line(`cvs.quad_to(${w.Pt(seg.x1, seg.y1)}, ${w.Pt(seg.x, seg.y)});`); break;
                    case "cubic": w.line(`cvs.cubic_to(${w.Pt(seg.x1, seg.y1)}, ${w.Pt(seg.x2, seg.y2)}, ${w.Pt(seg.x, seg.y)});`); break;
                    case "arc":
                        w.line(`cvs.arc_to(gfx::sizef(${w.F(seg.rx)}, ${w.F(seg.ry)}), ${w.F(deg(seg.angleDeg))}, ${seg.large ? "true" : "false"}, ${seg.sweep ? "true" : "false"}, ${w.Pt(seg.x, seg.y)});`);
                        break;
                    case "close": w.line("cvs.close_path();"); break;
                }
            }
        }
        if (elements > this.maxPathElements) this.maxPathElements = elements;
        w.checked("cvs.render()");
        w.outdent();
        w.line("}");
    }
}

const viewBoxMatrix = (vbx, vby, vbw, vbh, width, height, par) => {
    const sx = width / vbw, sy = height / vbh;
    let align = "xMidYMid", slice = false;
    if (par !== null && par !== undefined) {
        const parts = par.split(/\s+/).filter((p) => p.length > 0 && p !== "defer");
        if (parts.length > 0) align = parts[0];
        if (parts.length > 1) slice = parts[1] === "slice";
    }
    if (align === "none") return matMul(matTranslate(-vbx, -vby), matScale(sx, sy));
    const scale = slice ? Math.max(sx, sy) : Math.min(sx, sy);
    let tx = -vbx * scale, ty = -vby * scale;
    const extraX = width - vbw * scale, extraY = height - vbh * scale;
    if (align.includes("xMid")) tx += extraX / 2; else if (align.includes("xMax")) tx += extraX;
    if (align.includes("YMid")) ty += extraY / 2; else if (align.includes("YMax")) ty += extraY;
    return matMul(matScale(scale, scale), matTranslate(tx, ty));
};

const rectPath = (x, y, w, h, rx, ry) => {
    const g = new PathGeometry();
    if (rx <= 0 || ry <= 0) {
        g.moveTo(x, y, x, y);
        g.lineTo(x + w, y, x, y);
        g.lineTo(x + w, y + h, x + w, y);
        g.lineTo(x, y + h, x + w, y + h);
        g.close();
        return g;
    }
    const k = 0.5522847498307936; // cubic approximation of a quarter ellipse
    const kx = rx * k, ky = ry * k, r = x + w, b = y + h;
    g.moveTo(x + rx, y, x + rx, y);
    g.lineTo(r - rx, y, x + rx, y);
    g.cubicTo(r - rx + kx, y, r, y + ry - ky, r, y + ry, r - rx, y);
    g.lineTo(r, b - ry, r, y + ry);
    g.cubicTo(r, b - ry + ky, r - rx + kx, b, r - rx, b, r, b - ry);
    g.lineTo(x + rx, b, r - rx, b);
    g.cubicTo(x + rx - kx, b, x, b - ry + ky, x, b - ry, x + rx, b);
    g.lineTo(x, y + ry, x, b - ry);
    g.cubicTo(x, y + ry - ky, x + rx - kx, y, x + rx, y, x, y + ry);
    g.close();
    return g;
};

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------
const CPP_KEYWORDS = new Set([
    "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor", "bool", "break", "case", "catch", "char",
    "char16_t", "char32_t", "class", "compl", "const", "constexpr", "const_cast", "continue", "decltype", "default",
    "delete", "do", "double", "dynamic_cast", "else", "enum", "explicit", "export", "extern", "false", "float", "for",
    "friend", "goto", "if", "inline", "int", "long", "mutable", "namespace", "new", "noexcept", "not", "not_eq",
    "nullptr", "operator", "or", "or_eq", "private", "protected", "public", "register", "reinterpret_cast", "return",
    "short", "signed", "sizeof", "static", "static_assert", "static_cast", "struct", "switch", "template", "this",
    "thread_local", "throw", "true", "try", "typedef", "typeid", "typename", "union", "unsigned", "using", "virtual",
    "void", "volatile", "wchar_t", "while", "xor", "xor_eq",
]);

/** Strips the extension from a file name ("logo.svg" -> "logo"). */
export const svgBaseName = (fileName) => {
    if (!fileName) return "";
    const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
    let n = fileName.substring(slash + 1);
    const dot = n.lastIndexOf(".");
    if (dot > 0) n = n.substring(0, dot);
    return n;
};

/** Turns a file name into a valid C++ identifier ("my-icon (2)" -> "my_icon_2"). */
export const svgMakeIdentifier = (s) => {
    let id = "";
    for (const c of s ?? "") id += isAlnum(c) ? c : "_";
    id = id.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (id.length === 0) id = "svg";
    if (isDigit(id[0])) id = "svg_" + id;
    if (CPP_KEYWORDS.has(id)) id += "_svg";
    return id;
};

/** True if the text is a valid C++ identifier that isn't a keyword. */
export const svgIsValidIdentifier = (id) => !!id && /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) && !CPP_KEYWORDS.has(id);

const toDocument = (svg) => {
    if (svg && typeof svg === "object" && svg.documentElement) return svg;
    let text = svg;
    if (svg instanceof ArrayBuffer || ArrayBuffer.isView(svg)) text = new TextDecoder("utf-8").decode(svg);
    if (typeof text !== "string") throw new Error("expected SVG text");
    if (typeof DOMParser === "undefined") throw new Error("no DOMParser available");
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const err = doc.getElementsByTagName("parsererror");
    if (err.length > 0 || !doc.documentElement || localName(doc.documentElement) === "parsererror") {
        const msg = (err.length > 0 ? err[0].textContent : "") || "invalid XML";
        throw new Error("cannot parse SVG: " + msg.trim().split("\n")[0]);
    }
    return doc;
};

const finishStats = (stats, code) => {
    const lines = code.length === 0 ? 0 : code.split("\n").length - (code.endsWith("\n") ? 1 : 0);
    const segs = stats.segments;
    return {
        shapes: stats.shapes,
        elements: stats.elements,
        groups: stats.groups,
        skippedElements: stats.skippedElements,
        byElement: { ...stats.byElement },
        segments: { ...segs },
        drawCalls: segs.move + segs.line + segs.quad + segs.cubic + segs.arc + segs.close,
        filled: stats.filled,
        stroked: stats.stroked,
        gradients: stats.gradients,
        gradientFills: stats.gradientFills,
        gradientStrokes: stats.gradientStrokes,
        dashedStrokes: stats.dashedStrokes,
        cssRules: stats.cssRules,
        uniqueColors: stats.colors.size,
        codeLines: lines,
        codeBytes: new TextEncoder().encode(code).length,
    };
};

/**
 * Generates the full C++ drawing routine for an SVG.
 * Throws an Error if the SVG can't be parsed or its root isn't <svg>.
 */
export const svgGenerate = (svg, options = {}) => {
    const doc = toDocument(svg);
    const sourceName = options.sourceName ?? "<input>";
    const functionName = options.functionName && options.functionName.length > 0
        ? options.functionName
        : svgMakeIdentifier((options.prefix ?? "") + (options.sourceName ? svgBaseName(options.sourceName) : "draw"));
    const dpi = Number.isFinite(options.dpi) && options.dpi > 0 ? options.dpi : 96;
    const gen = new Generator({
        functionName,
        sourceName,
        dpi,
        precision: Number.isInteger(options.precision) ? options.precision : undefined,
        comments: options.comments !== false,
    });
    const code = gen.generate(doc);
    return {
        code,
        functionName,
        warnings: [...gen.warnings],
        width: gen.width,
        height: gen.height,
        stats: finishStats(gen.stats, code),
    };
};

/**
 * Like svgGenerate(), but `code` is cut down to the first options.previewLines lines (default 48)
 * followed by a comment saying how much was left out. `fullCode` holds the complete output.
 */
export const svgGeneratePreview = (svg, options = {}) => {
    const result = svgGenerate(svg, options);
    const max = Number.isInteger(options.previewLines) && options.previewLines > 0 ? options.previewLines : 48;
    const lines = result.code.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    let preview = result.code;
    if (lines.length > max) {
        const omitted = lines.length - max;
        preview = lines.slice(0, max).join("\n") + `\n    // ... ${omitted} more line${omitted === 1 ? "" : "s"} ...\n`;
    }
    return { ...result, fullCode: result.code, code: preview, truncated: lines.length > max };
};
