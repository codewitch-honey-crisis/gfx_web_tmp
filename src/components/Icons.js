export const filteredIcons = (icons, filter, selected) => {
    const result = [];
    if (!filter || filter.length === 0) {
        for (const icon of icons) {
            if(!selected || (!selected.includes(icon.index))) {
                result.push(icon);
            }
        }    
        return result;
    }
    for (const icon of icons) {
        if (icon.name && (icon.name.includes(filter) || icon.search.includes(`${filter} `)) ) {
            if(!selected || (!selected.includes(icon.index))) {
                result.push(icon);
            }
        }
    }
    return result;
}
export const selectedIcons = (icons, selected) => {
    const result = [];
    if(selected) {
        for(const i of selected) {
            result.push(icons[i]);
        }
    }
    return result;
}
export const resampleToBitDepth = (buffer, bitDepth) => {
    const max = Math.pow(2,bitDepth)-1;
    const view = new DataView(buffer);
    const widthFactor = bitDepth/8;
    let bytes = Math.ceil((view.byteLength/4)*widthFactor);
        
    const result = new Uint8ClampedArray(bytes);
    let j = 0;
    let accum = 0;
    let bit = 0;
    for(let i = 0;i<view.byteLength;i+=4) {
        // we can cheat with these svgs.
        // they are always black on transparent
        // so we don't need the RGB vals,
        // just the alpha
        // const r = view.getUint8(i+0);
        // const g = view.getUint8(i+1);
        // const b = view.getUint8(i+2);
        const a = view.getUint8(i+3);
        if(bitDepth===8) {
            result[j++]=a;
            continue;
        }
        const alpha = a/255.0;
        const val = Math.round(max*alpha);
        switch(bitDepth) {
            case 1: {
                accum<<=1;
                accum|=val;
                if(++bit===8) {
                    bit = 0;
                    result[j++]=accum;
                    accum=0;
                }
                continue;
            }
            case 2: {
                accum<<=2;
                accum|=val;
                if((bit+=2)===8) {
                    bit = 0;
                    result[j++]=accum;
                    accum=0;
                }
                continue;
            }
            case 4: {
                accum<<=4;
                accum|=val;
                if((bit+=4)===8) {
                    bit = 0;
                    result[j++]=accum;
                    accum=0;
                }
                continue;
            }
        }
        
        throw new Error("Unsupported bit depth");
    }
    if(j<result.length-1) {
        result[j]=accum;
    }
    return result.buffer;
}
export const rasterizeSvg = (svgElem, width, height, maxWidth, maxHeight, bitDepth) => {
    
    return new Promise((resolve, reject) => {
        const aspect = width/height;
        let scale = 1;
        if(maxWidth && maxWidth>0 && width>maxWidth) {
            scale = maxWidth/width;
        }
        if(maxHeight && maxHeight>0 && (height*scale)>maxHeight) {
            scale = maxHeight/height;
        }
        const encoder = new TextEncoder();
        const array = encoder.encode(svgElem);
        const blb = new Blob([array.buffer],{type: "image/svg+xml"});
        const srcurl = URL.createObjectURL(blb);
        const imgtag = new Image(Math.ceil(width*scale),Math.ceil(height*scale));
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(width*scale);
        canvas.height = Math.ceil(height*scale);
        const ctx = canvas.getContext("2d");
        imgtag.onload = ()=> {
            ctx.drawImage(imgtag, 0, 0);
            const imgdata = ctx.getImageData(0,0,Math.ceil(width*scale),Math.ceil(height*scale));
            URL.revokeObjectURL(srcurl);
            resolve({width: Math.ceil(width*scale), height: Math.ceil(height*scale), bitmap: resampleToBitDepth(imgdata.data.buffer,bitDepth)});
        }
        imgtag.onerror = ()=> {
            URL.revokeObjectURL(srcurl);
            reject("Unable to load image");
        }
        imgtag.src = srcurl;
    });
}
export const scaleIcon = (icon,clampWidth,clampHeight) => {
    if(clampHeight && clampHeight>0) {
        const scale = clampHeight/icon.height;
        return {width: Math.ceil(icon.width*scale), height: clampHeight };
    } else if(clampWidth && clampWidth >0) {
        const scale = clampWidth/icon.width;
        return {width: clampWidth, height: Math.ceil(icon.height*scale) };
    } else {
        throw new Error("clampWidth or clampHeight must be specified");
    }
}
export const computeBitmapsTotalBytes = (icons,iconsSel, bitDepth, clampHeight,clampWidth) => {
    let result = 0;
    for(let i = 0; i<iconsSel.length;++i) {
        const icon = icons[iconsSel[i]];
        if(!clampWidth && !clampHeight) {
            clampHeight = 32;
        }
        const dim = scaleIcon(icon,clampWidth,clampHeight);
        result+= Math.ceil(((dim.width*dim.height)*bitDepth)/8);
    }
    return result;
}