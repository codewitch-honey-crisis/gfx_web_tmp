// Reads Processing VLW font files and provides facilities to enable drawing with them
// Copyright (C) 2025 by honey the codewitch
// MIT License
/* EXAMPLE
const toUtf32 = function* (str) {
    for (const character of str) {
        let cp = character.codePointAt(0);
        if (cp >= 0xD800 && cp <= 0xDBFF) { // hi surrogate
            const cpl = character.codePointAt(1);
            if (!(cpl >= 0xDC00 && cpl <= 0xDFFF)) { // not a low surrogate
                throw new Error("Unicode stream error. Unterminated high surrogate");
            }
            const highValue = cp & 1023;
            const lowValue = cpl & 1023;
            const magicAdd = 65536;
            cp = (highValue << 10) | lowValue + magicAdd;
        }
        yield cp;
    }
}
const drawVlwString = (cvsctx, vlw, str, x, y, col) => {
    let xo = 0;
    let yo = 0;
    for (const cp of toUtf32(str)) {
        if (cp === '\r'.charCodeAt(0)) {
            xo = 0;
        } else if (cp === '\n'.charCodeAt(0)) {
            yo += vlw.lineHeight;
            xo = 0;
        } else {
            const glyph = vlwMakeGlyph(vlw, cp, col);
            if (glyph && glyph.width) {
                const data = new Uint8ClampedArray(glyph.data);
                const image = new ImageData(data, glyph.width, glyph.height);
                cvsctx.putImageData(image, xo + x + glyph.offset.x, yo + y + glyph.offset.y);
                xo += glyph.advWidth;
            } else {
                xo += vlw.spaceWidth;
            }

        }
    }
}
*/

const vlwReadUint8 = (ctx) => { const result = ctx.view.getUint8(ctx.dataCursor); ctx.dataCursor += 1; return result; }
//const vlwReadUint16 = (ctx) => { const result = ctx.view.getUint16(ctx.dataCursor,true); ctx.dataCursor+=2; return result; }
const vlwReadUint32 = (ctx) => { const result = ctx.view.getUint32(ctx.dataCursor, false); ctx.dataCursor += 4; return result; }
const vlwReadInt32 = (ctx) => { const result = ctx.view.getInt32(ctx.dataCursor, false); ctx.dataCursor += 4; return result; }

// loads a VLW file from an arraybuffer and returns a handle
export const vlwLoad = (data) => {
    const result = {
        data: data,
        view: new DataView(data),
        glyphCount: 0,
        lineAdvance: 0,
        lineHeight: 0,
        ascent: 0,
        descent: 0,
        spaceWidth: 0,
        dataCursor: 0
    };
    result.glyphCount = vlwReadUint32(result);
    result.dataCursor += 4;
    result.lineAdvance = vlwReadUint32(result);
    result.dataCursor += 4;
    result.ascent = vlwReadInt32(result);
    result.descent = vlwReadInt32(result);
    result.spaceWidth = (result.ascent + result.descent) * Math.floor(2 / 7);
    result.dataCursor = 24;
    let i = 0;
    while (i++ < result.glyphCount) {
        const cp_cmp = vlwReadUint32(result);
        if (((cp_cmp > 0x20) && (cp_cmp < 0xA0) && (cp_cmp != 0x7F)) || (cp_cmp > 0xFF)) {
            const h = vlwReadUint32(result);
            result.dataCursor += 12;
            if (h > result.lineHeight) {
                result.lineHeight = h;
            }
            result.dataCursor += 8;
        } else {
            result.dataCursor += 24;
        }
    }
    return result;
}
const vlwSeekCodepoint = (vlw, codepoint) => {
    let i = 0;
    vlw.dataCursor = 24;
    while (i < vlw.glyphCount) {
        const cmp = vlwReadUint32(vlw);
        if (cmp === codepoint) {
            vlw.dataCursor -= 4;
            return i;
        }
        vlw.dataCursor += 24;
        ++i;
    }
    return -1;

}
// makes a glyph given a font handle, a Unicode codepoint, and a color
export const vlwMakeGlyph = (vlw, codepoint, color) => {
    if (((codepoint > 0x20) && (codepoint < 0xA0) && (codepoint != 0x7F)) || (codepoint > 0xFF)) {
        if (vlwSeekCodepoint(vlw, codepoint) < 0) {
            const width = vlw.spaceWidth;
            const advWidth = vlw.spaceWidth;
            const pixelCount = width * vlw.lineHeight;
            const result = new ArrayBuffer(pixelCount * 4);
            return { width: width, height: vlw.lineHeight, advWidth: advWidth, offset: { x: 0, y: 0 }, data: result };
        }
        vlw.dataCursor += 4;
        const height = vlwReadUint32(vlw);
        const width = vlwReadUint32(vlw);
        const advWidth = vlwReadUint32(vlw);
        const yOffset = vlw.lineAdvance - vlwReadInt32(vlw);
        const xOffset = vlwReadInt32(vlw);
        const pixelCount = width * height;
        const result = new ArrayBuffer(pixelCount * 4);
        const view = new DataView(result);
        let bmp_ptr = 24 + (vlw.glyphCount * 28);
        let i = 0;
        vlw.dataCursor = 24;
        let bmp_offset = 0;
        let w;
        let h;
        while (i < vlw.glyphCount) {
            const cmp = vlwReadUint32(vlw);
            const glyphOffset = 24 + (i * 28);
            vlw.dataCursor = glyphOffset + 4;
            h = vlwReadUint32(vlw);
            w = vlwReadUint32(vlw);
            if (cmp === codepoint) {
                bmp_offset = bmp_ptr;
                break;
            } else {
                bmp_offset += (w * h);
            }
            bmp_ptr += (w * h);
            vlw.dataCursor += 16;
            ++i;
        }
        if (i >= vlw.glyphCount) {
            const width = vlw.spaceWidth;
            const advWidth = vlw.spaceWidth;
            const pixelCount = width * vlw.lineHeight;
            const result = new ArrayBuffer(pixelCount * 4);
            return { width: width, height: vlw.lineHeight, advWidth: advWidth, offset: { x: 0, y: 0 }, data: result };
        }
        vlw.dataCursor = bmp_offset;
        const alphaFactor = ((color >>> 24) & 0xFF) / 255.0;
        i = 0;
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                const alpha = vlwReadUint8(vlw);
                let pixel;
                if (alpha === 0) {
                    pixel = 0;
                } else {
                    pixel = (color & 0xFFFFFF) | (Math.floor(alpha * alphaFactor) << 24);
                }
                view.setUint32(i, pixel);
                i += 4;
            }
        }
        return { width: width, height: height, xOffset: xOffset, advWidth: advWidth, offset: { x: xOffset, y: yOffset }, data: result };
    } else {
        const width = vlw.spaceWidth;
        const advWidth = vlw.spaceWidth;
        const pixelCount = width * vlw.lineHeight;
        const result = new ArrayBuffer(pixelCount * 4);
        return { width: width, height: vlw.lineHeight, advWidth: advWidth, offset: { x: 0, y: 0 }, data: result };
    }
}
