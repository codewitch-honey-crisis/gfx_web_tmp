// Reads 16-bit Windows 3.1 font files and provides facilities to enable drawing with them
// Copyright (C) 2025 by honey the codewitch
// MIT License
// To use this file, import fonLoad() and call it with an ArrayBuffer full of ".FON" file
// and also the fontSetIndex if it's something other than zero. You'll need to hang onto the return
// value, because it's passed to fonMakeGlyph, which takes it as the first argument, followed by a
// a charCode, and a color in 32-bit ARGB hex format. It produces a glyph with metrics, and a data
// field array buffer that can be used to construct an ImageData to pass to a canvas.

/* EXAMPLE
const drawFonString = (cvsctx, fon, str, x, y, col) => {
    let xo = 0;
    let yo = 0;
    for (let i = 0; i < str.length; ++i) {
        if (str.charCodeAt(i) === '\r'.charCodeAt(0)) {
            xo = 0;
        } else if (str.charCodeAt(i) === '\n'.charCodeAt(0)) {
            yo += fon.lineHeight;
            xo = 0;
        } else {
            const ch = str.charCodeAt(i);
            const glyph = fonMakeGlyph(fon, ch, col);
            if (glyph && glyph.width) {
                const data = new Uint8ClampedArray(glyph.data);
                const image = new ImageData(data, glyph.width, glyph.height);
                cvsctx.putImageData(image, xo + x, yo + y);
                xo += glyph.width;
            } else {
                xo += fon.width;
            }
        }
    }
}*/
const fonReadUint8 = (ctx)=> { const result = ctx.view.getUint8(ctx.dataCursor); ctx.dataCursor+=1; return result; }
const fonReadUint16 = (ctx) => { const result = ctx.view.getUint16(ctx.dataCursor,true); ctx.dataCursor+=2; return result; }
const fonReadUint32 = (ctx) => { const result = ctx.view.getUint32(ctx.dataCursor,true); ctx.dataCursor+=4; return result; }

const fonSeekChar = (ctx,ch) => {
    if(ctx.charTableOffset===0) {
        throw "Fon: Not initialized";
    }
    if(ch<ctx.firstCharCode||ch>ctx.lastCharCode) {
        throw "Fon: Character not found";
    }
    const offs = ctx.charTableOffset + ctx.charTableLength * (ch-ctx.firstCharCode);
    ctx.dataCursor = offs+ctx.fontOffset;
}
// loads a .FON file arraybuffer and returns a font handle
export const fonLoad = (data, fontSetIndex = 0) => {
    const result = {
        data: data,
        view: new DataView(data),
        fontIndex: fontSetIndex,
        lineHeight: 0,
        width: 0,
        fontOffset: -1,
        charTableOffset: -1,
        charTableLength: 0,
        firstCharCode: 0,
        lastCharCode: 0,
        dataCursor: 0
    };
    let isFon = false;
    if(fonReadUint8(result)==='M'.charCodeAt(0) && fonReadUint8(result)==='Z'.charCodeAt(0)) {
        isFon = true;
    }
    if(isFon) {
        result.dataCursor = 0x3C;
        const neoff = fonReadUint32(result);
        result.dataCursor = neoff;
        if(fonReadUint8(result)==='N'.charCodeAt(0) && fonReadUint8(result)==='E'.charCodeAt(0)) {
            result.dataCursor = neoff + 0x24;
            const rtable = fonReadUint16(result);
            const rtablea = rtable + neoff;
            result.dataCursor = rtablea;
            const shift = fonReadUint16(result);
            let ii = 0;
            while(result.fontOffset<0) {
                const rtype=fonReadUint16(result);
                if(0===rtype)
                    break; // end of resource table
                const count=fonReadUint16(result);
                // skip 4 bytes (reserved)
                result.dataCursor+=4;
                for(let i = 0;i < count;++i) {
                    const start=fonReadUint16(result)<<shift;
                    // skip the size, we don't need it.
                    result.dataCursor+=2;
                    if(0x8008===rtype) { // is font entry
                        if(ii===result.fontIndex) {
                            result.fontOffset = start;
                            break;
                        }
                        ++ii;
                    }
                    if(result.fontOffset>-1) {
                        break;
                    }
                    result.dataCursor+=8;
                }
            }    
            if(result.fontOffset<0) {
                throw new "Fon: Font index out of range"
            }
        } else {
            throw "Fon: Not a 16-bit Windows 3.1 Font. Might be a 32-bit font, which is not supported";
        }
    }
    result.dataCursor=result.fontOffset;
    const version = fonReadUint16(result);
    result.dataCursor=result.fontOffset+0x42;
    const ftype = fonReadUint16(result);
	if(ftype & 1) {
		// Font is a vector font
		throw "Fon: Vector fonts are not supported"
    }
    result.dataCursor=result.fontOffset+0x58;
    result.lineHeight = fonReadUint16(result);
    if(version==0x200) {
        result.charTableOffset = 0x76;
        result.charTableLength = 4;
    } else {
        result.charTableOffset = 0x94;
        result.charTableLength = 6;
    }
    result.dataCursor=result.fontOffset+0x5f;
    result.firstCharCode = fonReadUint8(result);
    result.lastCharCode = fonReadUint8(result);
    return result;
}
// create a glyph from a font handle, a charCode and a color
export const fonMakeGlyph = (fon,charCode,color) => {
    fonSeekChar(fon,charCode);
    const width = fonReadUint16(fon);
    const pixelCount = width * fon.lineHeight;
    const result = new ArrayBuffer(pixelCount*4);
    const view = new DataView(result);
    const widthBytes = Math.floor((width+7)/8);    
    
    var offs;
    if(fon.charTableLength===4){
        offs = fonReadUint16(fon)
    } else {
        offs = fonReadUint32(fon);
    }
    let cur = 0;
    for(let j=0;j<fon.lineHeight;++j) {
        let accum = 0;
        for (let i = 0; i < widthBytes; ++i) {
            const bytepos = offs+i*fon.lineHeight+j;
            fon.dataCursor=(bytepos+fon.fontOffset);
            accum<<=8;
            accum|=fonReadUint8(fon);
        }
        const shift = (widthBytes*8)-width;
        accum>>>=shift;
        const m = (1 << (width - 1));
        for(let i = 0;i<width;++i) {
            if(0!==(accum & m)) {
                view.setUint32(cur,color);
            } else {
                view.setUint32(cur,0);
            }
            cur+=4;
            accum<<=1;
        }
    }
    return { width: width, height: fon.lineHeight, data: result };
}
