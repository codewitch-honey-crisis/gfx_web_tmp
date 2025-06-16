import React, { useReducer, useMemo, useState, useRef, useEffect, Suspense } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import clang from 'react-syntax-highlighter/dist/esm/languages/hljs/c';
import cpplang from 'react-syntax-highlighter/dist/esm/languages/hljs/cpp';
import { a11yDark, a11yLight } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { generateByteArrayLiteral, toIdentifier } from './CGen';
import './IconPackGenerator.css';
const resampleToBitDepth = (buffer, bitDepth) => {
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
const rasterizeSvg = (svgElem, width, height, maxWidth, maxHeight, bitDepth) => {
    
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
const scaleIcon = (icon,clampWidth,clampHeight) => {
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
const computeBitmapsTotalBytes = (icons,iconsSel, bitDepth, clampHeight,clampWidth) => {
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
const makeSafeName = (names, name) => {
    let j = 1;
    let cmp = name;
    while(names.has(cmp)) {
        cmp = `${name}${++j}`;
    }
    names.set(cmp,cmp);
    return cmp;
}
const generateHeaderAsync = async (icons, iconsSel,fileName,bitDepth,clampHeight, clampWidth, outputType, preview) => {
    const names = new Map();
    const isGfx = (outputType != undefined && outputType.length > 0 && outputType != "C");
    const ident = toIdentifier(fileName);
    const guard = ident.toUpperCase() + ((isGfx) ? "_HPP" : "_H");
    const impl = ident.toUpperCase() + "_IMPLEMENTATION";
    let result = "// Automatically generated by https://honeythecodewitch.com/gfx/icon-pack\r\n";
    result += `// #define ${impl} in exactly one\r\n`;
    let tukind = ".c/.cpp";
    if (isGfx) {
        tukind = ".cpp";
    }
    result += `// translation unit (${tukind} file) before including this header\r\n`;
    result += `#ifndef ${guard}\r\n`;
    result += `#define ${guard}\r\n`;
    result += "#include <stdint.h>\r\n";
    if(isGfx) {
        result += "#include \"gfx_pixel.hpp\"\r\n#include \"gfx_bitmap.hpp\"\r\n";
    }
    result +="\r\n";
    result += `#define ${ident.toUpperCase()}_BIT_DEPTH ${bitDepth}\r\n`
    if(clampHeight && clampHeight>0) {
        result += `#define ${ident.toUpperCase()}_HEIGHT ${clampHeight}\r\n`
    } else if(clampWidth && clampWidth >0) {
        result += `#define ${ident.toUpperCase()}_WIDTH ${clampWidth}\r\n`
    } else {
        clampHeight=32;
        result += `#define ${ident.toUpperCase()}_HEIGHT ${clampHeight}\r\n`
    }
    result += "\r\n";
    for(let i = 0;i<iconsSel.length;++i) {
        const icon = icons[iconsSel[i]];
        const dim = scaleIcon(icon,clampWidth,clampHeight);
        const id = makeSafeName(names, toIdentifier(`${fileName}_${icon.name}`));
        if(!isGfx) {
            result+= `#define ${id.toUpperCase()}_DIMENSIONS {${dim.width}, ${dim.height}}\r\n`
            result+= "#ifdef __cplusplus\r\nextern \"C\"\r\n#else\r\nextern\r\n#endif\r\n";
        }
        result+= `/// @brief A ${dim.width}x${dim.height} alpha transparency map for ${icon.name}\r\n`;
        if(isGfx) {
            result+= `extern const gfx::const_bitmap<gfx::alpha_pixel<${bitDepth}>> ${id};\r\n`;
        } else {
            result+= `uint8_t ${id}[];\r\n`;
        }
    }
    result += `#endif // ${guard}\r\n\r\n`;
    result += `#ifdef ${impl}\r\n`;
    names.clear();
    for(let i = 0;i<iconsSel.length;++i) {
        const icon = icons[iconsSel[i]];
        const dim = scaleIcon(icon,clampWidth,clampHeight);
        const id = makeSafeName(names,toIdentifier(`${fileName}_${icon.name}`));
        const data_id = isGfx?`${id}_data`:id;
        let data;
        if(!preview) {
            data = await rasterizeSvg(icon.svg,icon.width,icon.height,dim.width,dim.height,bitDepth);
        }
        const widthFactor = bitDepth/8;
        let widthBytes = Math.ceil(dim.width*widthFactor);
        result+=generateByteArrayLiteral(data_id,preview?undefined:data.bitmap,isGfx,widthBytes);
        result+="\r\n";
        if(isGfx) {
            result+= `const gfx::const_bitmap<gfx::alpha_pixel<${bitDepth}>> ${id}\r\n    ({${dim.width}, ${dim.height}}, ${data_id});\r\n`;
        }
        if(i<iconsSel.length-1) {
            result+="\r\n";
        }
    }
    result += `#endif // ${impl}\r\n`;
    return result;
}
const generateHeader = (icons, iconsSel,fileName,bitDepth,clampHeight, clampWidth, outputType, preview) => {
    let result;
    let err;
    const promise = generateHeaderAsync(icons,iconsSel,fileName,bitDepth,clampHeight,clampWidth,outputType,preview)
        .then((response) => result=response, (error)=>{err=error;})
    return {
        read() {
            if (err) {
                throw err;
            }
            if(!result) {
                throw promise;
            }
            return result;
        },
    };
};
const wrapPromise = (promise) => {
    let status = 'pending';
    let result;
    let data;
    const suspender = promise.then(
        (r) => {
            status = 'success';
            result = r;
        },
        (e) => {
            status = 'error';
            result = e;
        }
    );

    return {
        read() {
            if (status === 'pending') {
                throw suspender;
            } else if (status === 'error') {
                throw result;
            } else if (status === 'success') {
                return result;
            }
        },
    };
}

const fetchIcons = () => {
    const promise = fetch("../icons/icons.json")
        .then((res) => {
            if (!res.ok) {
                throw new Error(`HTTP error! Status: ${res.status}`);
            }
            return res.json();
        })
        .then((data) => data)
        .catch((error) => {
            console.error('Fetch error:', error);
            throw error;
        });

    return wrapPromise(promise);
}

const isBrowserDarkTheme = () => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return true;
    }
    return false;
}
const getDownloadName = (ident, genType) => {
    if (genType === "C" || genType === undefined || genType === "") {
        return `${ident}.h`;
    }
    return `${ident}.hpp`;
}
const getGeneratedLanguage = (genType) => {
    if (genType === "C" || genType === undefined || genType === "") {
        return "c";
    }
    return "cpp";
}
const IconBox = (prop) => {
    let style = { flex: "auto 0 0" };
    let cw = prop.clampWidth;
    let ch = prop.clampHeight;
    if(!cw && !ch) {
        ch = 32;
    }
    const dim = scaleIcon(prop.node,cw,ch);
    style.width = `${dim.width}px`;
    style.height = `${dim.height}px`;
    return (<><div style={{overflow: "hidden", padding: "1% 1% 1% 1%" }}>
        <center>
            <div dangerouslySetInnerHTML={{ __html: prop.node.svg }} style={style}></div>
            <label className={"inputButtonCheckLabel"} style={{ width: "80%", overflowY: "hidden" }}>
                
                <input type="checkbox" className={"inputButtonCheck"} checked={prop.checked} onChange={prop.onChange} />
                {prop.node.label}
            </label>
        </center>
    </div>
    </>);
}
const iconData = fetchIcons();
const IconPackGenerator = () => {
    SyntaxHighlighter.registerLanguage('c', clang);
    SyntaxHighlighter.registerLanguage('cpp', cpplang);
    const [syntaxTheme, setSyntaxTheme] = useState(isBrowserDarkTheme() ? a11yDark : a11yLight);
    const [genType, setGenType] = useState("C");
    const [moduleId, setModuleId] = useState("icons");
    const [clampAxis, setClampAxis] = useState("height");
    const [clampValue, setClampValue] = useState("32");
    const [bitDepth, setBitDepth] = useState("8");
    const [iconFilter, setIconFilter] = useState(undefined);
    const downloadUrl = useRef(undefined);
    let gencache;
    
    useEffect(() => {
        const handleThemeChange = (event) => {
            setSyntaxTheme(event.matches ? a11yDark : a11yLight);
        };
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', handleThemeChange);
        return () => mediaQuery.removeEventListener('change', handleThemeChange); // clean up your event listerens
    }, []); // runs on mount
    const mapIcons = (icons) => {
        const keys = [];
        Object.keys(icons).forEach(function (key) {
            keys.push(key);
        })
        keys.sort();
        const mapdata = new Map();
        const result = [];
        var parser = new DOMParser();
        let di = 0;
        for (const k of keys) {
            if (k && k.length > 0) {
                const icon = icons[k];
                let search = "";
                if(icon.search && icon.search.terms) { 
                    for(let i = 0; i<icon.search.terms.length;++i) {
                        search += `${icon.search.terms[i]} `;
                    }
                }
                const entries = Object.entries(icon["svg"]);
                if (entries) {
                    for (const [key, value] of entries) {
                        if (value["raw"]) {
                            const svg = value["raw"];
                            let w = Math.ceil(value.width);
                            if (isNaN(w)) {
                                w = 512;
                            }
                            let h = Math.ceil(value.height);
                            if (isNaN(h)) {
                                h = 512;
                            }
                            let name = toIdentifier(k);

                            let safename = (key === "solid") ? name : `${name}_${key}`;
                            let j = 1;
                            while (mapdata.has(safename)) {
                                j++;
                                safename = name + j.toString(10);
                            }
                            name = safename;
                            const data = {
                                key: name,
                                index: di,
                                label: icon.label,
                                name: k,
                                width: w,
                                height: h,
                                svg: svg,
                                search: search
                            };
                            mapdata[name] = data;
                            result.push(data);
                            ++di;
                        }
                    };
                }
            }
        }
        return [result,[]];
    }

    const filterIcons = (icons, filter, selected) => {
        if(!filter || filter.length==0) {
            return [...icons];
        }
        const result = [];
        if(selected) {
            for(const i of selected) {
                result.push(icons[i]);
            }
        }
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
    const handleIconFilterChange = (evt) => {
        setIconFilter(evt.target.value);
    }
    const handleClampAxisChange = (evt) => {
        setClampAxis(evt.target.value);
    }
    const handleClampValueChange = (evt) => {
        setClampValue(evt.target.value);
    }
    const handleGenTypeChange = (evt) => {
        setGenType(evt.target.value);
    }
    const handleModuleChange = (evt) => {
        setModuleId(evt.target.value);
    }
    const handleBitDepthChange = (evt) => {
        setBitDepth(evt.target.value);
    }

    const iconSelReducer = (state, action) => {
        if (action.type === 'check') {
            const result = [];
            for(let i = 0;i<state.length;++i) {
                if(state[i]!==action.index) {
                    result.push(state[i])
                }
            }
            result.push(action.index);
            return result;
        } else if (action.type === 'uncheck') {
            const result = [];
            for(let i = 0;i<state.length;++i) {
                if(state[i]!==action.index) {
                    result.push(state[i])
                }
            }
            return result;
        }
        throw Error(`Unknown action: ${action} `);
    }
    const iconsAndSel = useMemo(() => mapIcons(iconData.read()));
    
    const [iconSel, dispatch] = useReducer(iconSelReducer, iconsAndSel[1]);
    const isNodeSelected = (index) => {
        return iconSel.indexOf(index)>=0;
    }
    const generateContentClip = () => {
        if (!gencache && clampValue && clampValue>0 && moduleId && moduleId.length>0) {
            console.log("generating content to clipboard");
            generateHeaderAsync(iconsAndSel[0],iconSel,moduleId,parseInt(bitDepth),clampAxis!=="width"?parseInt(clampValue):undefined,clampAxis==="width"?parseInt(clampValue):undefined,genType,false).then((result)=>{
                gencache = result;
                navigator.clipboard.writeText(gencache);
            });
            
        } else if (gencache) {
            console.log("writing content to clipboard");
            navigator.clipboard.writeText(gencache);
        }
    }
    const setGeneratedFileUrl = () => {
        // this is a hack. alink must be created outside React's normal rendering sequence
        // due to the on the fly generate+download in one click feature. It's a bit kludgy but
        // it works
        const blb = new Blob([gencache], { type: "text/plain" });
        if (downloadUrl.current != undefined && downloadUrl.current.length > 0) {
            URL.revokeObjectURL(downloadUrl.current);
            downloadUrl.current = "";
        }
        downloadUrl.current = URL.createObjectURL(blb);

        const alink = document.createElement("a");
        alink.download = getDownloadName(moduleId, genType);
        alink.href = downloadUrl.current;
        alink.click();
        setTimeout(() => { if (downloadUrl.current && downloadUrl.current.length > 0) { URL.revokeObjectURL(downloadUrl.current), downloadUrl.current = ""; } }, 500);
    }
    const generateContentFile = () => {
        if (!gencache && clampValue && clampValue>0 && moduleId && moduleId.length>0) {
            console.log("generating content to file");
            generateHeaderAsync(iconsAndSel[0],iconSel,moduleId,parseInt(bitDepth),clampAxis!=="width"?parseInt(clampValue):undefined,clampAxis==="width"?parseInt(clampValue):undefined,genType,false).then((result)=>{
                gencache=result;
                setGeneratedFileUrl();
            });
        } else if (gencache) {
            console.log("writing content to file");
            setGeneratedFileUrl();
        }
    }
    const genAsync = generateHeader(iconsAndSel[0],iconSel,moduleId,parseInt(bitDepth),clampAxis!=="width"?parseInt(clampValue):undefined,clampAxis==="width"?parseInt(clampValue):undefined,genType,true);

    const handleIconSelectedChange = (node, evt) => {
        if (evt.target.checked) {
            dispatch({ type: 'check', index: node.index });
        } else {
            dispatch({ type: 'uncheck', index: node.index });
        }
    }
    return (<>
        <table border={0}>
            <tbody>
                <tr><td><label>Type:</label></td><td><select value={genType} onChange={handleGenTypeChange}><option value="C">Raw C/++</option><option value="GFX2">GFX 2.x</option></select></td></tr>
                <tr><td>Module id:</td><td><input type="text" value={moduleId} onChange={handleModuleChange}/></td></tr>
                <tr><td><select value={clampAxis} onChange={handleClampAxisChange}><option value="width">width</option><option value="height">height</option></select></td><td><input type="text" value={clampValue} onChange={handleClampValueChange}/></td></tr>
                <tr><td><label>Bit depth:</label></td><td><select value={bitDepth} onChange={handleBitDepthChange}><option value="1">Monochrome</option><option value="2">2 bits/px</option><option value="4">4 bits/px</option><option value="8">8 bits/px</option></select></td></tr>
            </tbody>
        </table>
        {clampValue && clampValue>0 && moduleId && moduleId.length>0 && iconSel && iconSel.length>0 && (
            <>
                <button onClick={generateContentFile}
                    className="submit"
                >Download header file</button><br />
                <button
                    onClick={generateContentClip}
                    className="submit"
                >Copy to clipboard</button>
            </>)
        }
        <br />
        <label>Filter:<input type="text" style={{width: "100%"}} onChange={handleIconFilterChange} /></label><label>Selected:&nbsp;<span>{iconSel.length} ({computeBitmapsTotalBytes(iconsAndSel[0],iconSel,bitDepth,clampAxis!=="width"?parseInt(clampValue):undefined,clampAxis==="width"?parseInt(clampValue):undefined)}&nbsp;bytes)</span></label>
        <div id="iconContainer" style={{ backgroundColor: "white", display: "flex", flexFlow: "wrap", overflow: "auto", paddingLeft: "2%", width: "100%", height: "400px" }}>
            <>{filterIcons(iconsAndSel[0], iconFilter,iconSel).map((node) => (
                <IconBox key={node.key} clampHeight={clampAxis==="height"?clampValue:undefined} clampWidth={clampAxis==="width"?clampValue:undefined} node={node} checked={isNodeSelected(node.index)} onChange={(evt) => { handleIconSelectedChange(node, evt) }} />
            )
            )}</>
        </div>
        {iconSel.length>0 && moduleId && moduleId.length>0 && (<>
        <h3>Preview</h3>
        <Suspense fallback={(<center><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect fill="#FF156D" stroke="#FF156D" strokeWidth="15" width="30" height="30" x="25" y="85"><animate attributeName="opacity" calcMode="spline" dur="2" values="1;0;1;" keySplines=".5 0 .5 1;.5 0 .5 1" repeatCount="indefinite" begin="-.4"></animate></rect><rect fill="#FF156D" stroke="#FF156D" strokeWidth="15" width="30" height="30" x="85" y="85"><animate attributeName="opacity" calcMode="spline" dur="2" values="1;0;1;" keySplines=".5 0 .5 1;.5 0 .5 1" repeatCount="indefinite" begin="-.2"></animate></rect><rect fill="#FF156D" stroke="#FF156D" strokeWidth="15" width="30" height="30" x="145" y="85"><animate attributeName="opacity" calcMode="spline" dur="2" values="1;0;1;" keySplines=".5 0 .5 1;.5 0 .5 1" repeatCount="indefinite" begin="0"></animate></rect></svg></center>)}>
            <CodeBox syntaxTheme={syntaxTheme} language={getGeneratedLanguage(genType)} gen={genAsync} />
        </Suspense>
        </>)}
    </>)


}
const CodeBox = (prop) => {
    const result=prop.gen.read();
    return ( <SyntaxHighlighter style={prop.syntaxTheme} language={prop.language}>{result}</SyntaxHighlighter>);
    
}

export default IconPackGenerator;