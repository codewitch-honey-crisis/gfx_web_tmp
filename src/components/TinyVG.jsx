const tvgInit = (data) => {
    return {
        data: data,
        view: new DataView(data),
        cursor: 0,
        scale: 0,
        color_encoding: 0,
        coord_range: 0,
        width: 0, height: 0,
        colors_size: 0,
        colors: [] 
    };
}
const tvgAdvCoord = (rangeOrCtx) => {   
    let range = rangeOrCtx;
    if(rangeOrCtx.coord_range) {
        range = rangeOrCtx.range;
    }
    switch(range) {
        case 0://"default"
            return 2;        
        case 1://"reduced":
            return 1;
        case 2://"extended"
            return 4;
    }
}
const tvgMapZeroToMax = (rangeOrCtx,value) => {
    let range = rangeOrCtx;
    if(rangeOrCtx.coord_range) {
        range = rangeOrCtx.range;
    }
    if(0==value) {
        switch(range) {
            case 0: //"default"
                return 0xFFFF;
            case 1: //"reduced"
                return 0xFF;
            case 2: //"extended"
                return 0xFFFFFFFF;
        }
        return undefined;
    }
    return value;
}
const tvgReadCoordBI = (range,startIndex,data) => {   
    const view = new DataView(data);
    switch(range) {
        case 0: //"default"
            return view.getUint16(startIndex,true);
        
        case 1: //"reduced"
            return view.getUint8(startIndex);
        
        case 2: //"extended"
            return view.getUint32(startIndex,true);    
    }
    return undefined;
}
const tvgReadCoord = (ctx) => {   
    let result = undefined;
    switch(range) {
        case 0: //"default"
            result = ctx.view.getUint16(ctx.cursor,true);
            ctx.cursor+=2;
            break;
        case 1: //"reduced"
            result = ctx.view.getUint8(ctx.cursor);
            ctx.cursor+=1;
        
        case 2: //"extended"
            result = ctx.view.getUint32(ctx.cursor,true);
            ctx.cursor+=4;
    }
    return result;
}
const tvgReadU32 = (ctx) => {
    let count = 0;
    let result = 0;
    let byte;
    while (true) {
        byte = ctx.view.getUint8(ctx.cursor++);
        const val = (byte & 0x7F) << (7 * count);
        result |= val;
        if ((byte & 0x80) === 0)
            break;
        ++count;
    }
    return result;
}
const tvgDownscaleCoord = (ctx,coord) => {
    const factor = (1) << ctx.scale;
    return coord / factor;
}
const tvgReadUnit = (ctx) => {
    const val = tvgReadCoord(ctx);
    return tvgDownscaleCoord(ctx, val);
}
const tvgReadPoint = (ctx) => {
    const x = tvgReadUnit(ctx, &f32);
    const y = tvgReadUnit(ctx, &f32);
    return {x: x, y: y};
}
const tvgReadColor = (ctx)=> {   
    switch(ctx.color_encoding) {
        case 2: { // TVG_COLOR_F32:
            // read four values
            const data = [];
            data.push(ctx.view.getFloat32(ctx.cursor,true)); ctx.cursor+=4;
            data.push(ctx.view.getFloat32(ctx.cursor,true)); ctx.cursor+=4;
            data.push(ctx.view.getFloat32(ctx.cursor,true)); ctx.cursor+=4;
            data.push(ctx.view.getFloat32(ctx.cursor,true)); ctx.cursor+=4;
            return {r: data[0], g: data[1], b: data[2], a: data[3]};
        }
        case 1: { // TVG_COLOR_U565: 
            const data = ctx.view.getUint16(ctx.cursor,true);
            ctx.cursor+=2;
            return {
                r: (data&0x1F)/15.0,
                g: ((data>>>5)&0x3F)/31.0,
                b: ((data>>>11)&0x1F)/15.0,
                a: 1.0
            };
        }
        case 0: { // TVG_COLOR_U8888: 
            // read four values
            const data = [];
            data.push(ctx.view.getUint8(ctx.cursor++));
            data.push(ctx.view.getUint8(ctx.cursor++));
            data.push(ctx.view.getUint8(ctx.cursor++));
            data.push(ctx.view.getUint8(ctx.cursor++));
            return {r: data[0]/255.0, g: data[1]/255.0, b: data[2]/255.0, a: data[3]/255.0};
        }
        case 3: // TVG_COLOR_CUSTOM
            throw "TinyVG: Custom color table not supported";
        default:
            throw "TinyVG: Invalid color format";
    }
}
const tvgParseGradient = (ctx) => {
    const point0 = tvgReadPoint(ctx);
    const point1 = tvgReadPoint(ctx);
    const color0 = tvgReadU32(ctx);
    const color1 = tvgReadU32(ctx);
    return {point0: point0, point1: point1, color0: color0, color1: color1};
}
const tvgParseStyle = (ctx, kind) => {
    switch(kind) {
        case 0: // TVG_STYLE_FLAT:
            return {flat: tvgReadU32(ctx)};
        case 1: // TVG_STYLE_LINEAR:
            return {linear: tvgParseGradient(ctx)};
        case 2: //TVG_STYLE_RADIAL:
            return {radial: tvgParseGradient(ctx)};
        default:
            throw "TinyVG: Invalid format parsing style";
    }
}
const tvgParseFillHeader = (ctx, kind) => {
    const u32 = tvgReadU32(ctx);
    const size = u32 + 1;
    //out_header->size = count;
    const style = tvgParseStyle(ctx, kind);
    return { size: size, style: style };
}
const tvgParseLineHeader = (ctx,kind) => {
    const u32 = tvgReadU32(ctx);
    const size = u32 + 1;
    
    const style = tvgParseStyle(ctx, kind);
    const line_width = tvgReadUnit(ctx);
    
    return { size: size, style: style, line_width: line_width };
}

const tvgParseLineFillHeader = (ctx, kind) => {
    
    var d=ctx.view.getUint8(ctx.cursor++);
    const size = (d&0x3F)+1;
    const fill_style = tvgParseStyle(ctx, kind);
    const line_style = tvgParseStyle(ctx, (d>>>6)&0x03);
    const line_width = tvgReadUnit(ctx);
    return { size: size, fill_style: fill_style, line_style: line_style, line_width: line_width };
}

export const tvgReadDimensions = (data) => {
    const view = new DataView(data);
    if(view.byteLength>5) {
        // check for TVG v 1.0 header
        if(view.getUint8(0)==0x72 && view.getUint8(1)==0x56 && view.getUint8(2)==1) {
            const flags = view.getUint8(3);
            const range = (flags>>>6)&0x03;
            const w = tvgReadCoordBI(range,4,data);
            const h = tvgReadCoordBI(range,4+tvgAdvCoord(range),data);
            const dim = {
                width: tvgMapZeroToMax(range,w),
                height:tvgMapZeroToMax(range,h)
            };
            return dim;
        }
    }
    return undefined;
}
/*export*/ const tvgRender = (data) => {
    const view = new DataView(data);
    if(view.byteLength>5) {
        if(view.getUint8(0)==0x72 && view.getUint8(1)==0x56 && view.getUint8(2)==1) {
            const ctx = tvgInit(data);
            const flags = view.getUint8(3);
            ctx.coord_range = (flags>>>6)&0x03;
            ctx.cursor = 4;
            const w = tvgReadCoord(ctx);
            const h = tvgReadCoord(ctx);
            ctx.width =  tvgMapZeroToMax(ctx,w);
            ctx.height = tvgMapZeroToMax(ctx,h);
            const colcount = tvgReadU32(ctx);
            if(!colcount || colcount===0) throw "TinyVG: invalid format - color table contains nothing";
            for(let i = 0; i<colcount; ++i) {
                ctx.colors.push(tvgReadColor(ctx));
            }
        }
    }
    return undefined;   
}