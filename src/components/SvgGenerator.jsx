import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import cpplang from 'react-syntax-highlighter/dist/esm/languages/hljs/cpp';
import { a11yDark, a11yLight } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { svgGeneratePreview, svgMakeIdentifier, svgIsValidIdentifier, svgBaseName } from './Svg2Gfx';
import './SvgGenerator.css';

SyntaxHighlighter.registerLanguage('cpp', cpplang);

const PREVIEW_LINES = 48;

const isBrowserDarkTheme = () => {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
const isSvgFile = (file) => {
    return file && (file.type === "image/svg+xml" || (file.name && file.name.toLowerCase().endsWith(".svg")));
}
const formatNumber = (n) => {
    return n.toLocaleString();
}
const formatDim = (v) => {
    return String(Number(v.toFixed(3)));
}
// "path 56, rect 24"
const formatCounts = (obj, order) => {
    const keys = order ? order.filter((k) => obj[k]) : Object.keys(obj).filter((k) => obj[k]);
    return keys.map((k) => `${k} ${formatNumber(obj[k])}`).join(", ");
}
const SEGMENT_ORDER = ["move", "line", "cubic", "quad", "arc", "close"];

const SvgGenerator = () => {
    const [syntaxTheme, setSyntaxTheme] = useState(isBrowserDarkTheme() ? a11yDark : a11yLight);
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleThemeChange = (event) => setSyntaxTheme(event.matches ? a11yDark : a11yLight);
        mediaQuery.addEventListener('change', handleThemeChange);
        return () => mediaQuery.removeEventListener('change', handleThemeChange);
    }, []);

    const fileInput = useRef(null);
    const [file, setFile] = useState(undefined);
    const [svgText, setSvgText] = useState(undefined);
    const [pictureUrl, setPictureUrl] = useState("");
    const [loadError, setLoadError] = useState("");
    const [prefix, setPrefix] = useState("");
    const [ident, setIdent] = useState("");
    const [identEdited, setIdentEdited] = useState(false);
    const [dpiText, setDpiText] = useState("96");
    const [comments, setComments] = useState(true);

    // release the preview image URL when it changes or the page goes away
    useEffect(() => {
        return () => { if (pictureUrl) URL.revokeObjectURL(pictureUrl); };
    }, [pictureUrl]);

    const loadFile = (f) => {
        if (!f) return;
        setLoadError("");
        if (!isSvgFile(f)) {
            setFile(f);
            setSvgText(undefined);
            setPictureUrl("");
            setLoadError("Only SVG files are supported");
            return;
        }
        const reader = new FileReader();
        reader.onload = (evt) => {
            setFile(f);
            setSvgText(evt.target.result);
            // an <img> never runs scripts inside the SVG, unlike inlining it into the page
            setPictureUrl(URL.createObjectURL(new Blob([evt.target.result], { type: "image/svg+xml" })));
            // like the header generator, a new file gets a fresh identifier
            setIdent(svgMakeIdentifier(prefix + svgBaseName(f.name)));
            setIdentEdited(false);
        };
        reader.onerror = () => setLoadError("Could not read the file");
        reader.readAsText(f);
    }

    const handleFileChange = (e) => {
        if (e.target.files.length === 0) return;
        loadFile(e.target.files[0]);
    }
    const handleDropFiles = (e) => {
        e.preventDefault();
        if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
        if (fileInput.current) fileInput.current.files = e.dataTransfer.files;
        loadFile(e.dataTransfer.files[0]);
    }
    const handlePrefixChange = (e) => {
        const p = e.target.value;
        setPrefix(p);
        // the identifier follows the prefix until the user types their own
        if (!identEdited && file) setIdent(svgMakeIdentifier(p + svgBaseName(file.name)));
    }
    const handleIdentChange = (e) => {
        setIdent(e.target.value);
        setIdentEdited(e.target.value.length > 0);
    }

    const dpi = Number.parseFloat(dpiText);
    const dpiValid = Number.isFinite(dpi) && dpi > 0;
    const identValid = svgIsValidIdentifier(ident);

    // generation is synchronous and fast; it re-runs only when an input changes
    const result = useMemo(() => {
        if (!svgText || !file || !identValid || !dpiValid) return undefined;
        try {
            return svgGeneratePreview(svgText, {
                functionName: ident,
                sourceName: svgBaseName(file.name),
                dpi: dpi,
                comments: comments,
                previewLines: PREVIEW_LINES,
            });
        } catch (err) {
            return { error: err.message || String(err) };
        }
    }, [svgText, file, ident, identValid, dpi, dpiValid, comments]);

    const hasCode = result && !result.error;

    const downloadFile = () => {
        if (!hasCode) return;
        const url = URL.createObjectURL(new Blob([result.fullCode], { type: "text/plain" }));
        const alink = document.createElement("a");
        alink.download = `${ident}.hpp`;
        alink.href = url;
        alink.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }
    const copyToClipboard = async () => {
        if (!hasCode) return;
        await navigator.clipboard.writeText(result.fullCode);
    }

    const stats = hasCode ? result.stats : undefined;
    return (
        <>
            <div id="drop-target" onDrop={handleDropFiles} className={"border-drag"} onDragOver={(event) => event.preventDefault()}>
                {!file && (<p>Select or drag an SVG file here</p>)}
                <div className="input-group">
                    <table border="0">
                        <tbody>
                            <tr>
                                <td colSpan={2}><input id="file" ref={fileInput} type="file" accept=".svg,image/svg+xml" onChange={handleFileChange} /></td>
                            </tr>
                            {svgText && (<>
                                <tr>
                                    <td><label>Prefix: </label></td>
                                    <td><input type="text" id="prefix" value={prefix} placeholder="e.g. draw_" onChange={handlePrefixChange} /></td>
                                </tr>
                                <tr>
                                    <td><label>Identifier: </label></td>
                                    <td><input type="text" id="identifier" value={ident} onChange={handleIdentChange} /></td>
                                </tr>
                                <tr>
                                    <td><label>DPI: </label></td>
                                    <td><input type="text" id="dpi" value={dpiText} size={6} onChange={(e) => setDpiText(e.target.value)} /></td>
                                </tr>
                                <tr>
                                    <td><label>Comments: </label></td>
                                    <td><input type="checkbox" id="comments" checked={comments} onChange={(e) => setComments(e.target.checked)} /></td>
                                </tr>
                            </>)}
                        </tbody>
                    </table>
                </div>
                {loadError && (<span className="error">Error: {loadError}</span>)}
                {svgText && (
                    <section>
                        File details:
                        <ul>
                            {file.type && (<li>MIME: <span className="fileType">{file.type}</span></li>)}
                            <li>Size: <span className="fileSize">{formatNumber(file.size)} bytes</span></li>
                            {hasCode && (<>
                                <li>Dimensions: <span className="fileDim">{formatDim(result.width)}x{formatDim(result.height)}</span></li>
                                <li>Shapes: <span className="svgShapes">{formatNumber(stats.shapes)}</span>
                                    {stats.shapes > 0 && (<span className="svgDetail"> ({formatCounts(stats.byElement)})</span>)}
                                </li>
                                <li>Filled / stroked: <span className="svgShapes">{formatNumber(stats.filled)} / {formatNumber(stats.stroked)}</span></li>
                                {stats.drawCalls > 0 && (
                                    <li>Path commands: <span className="svgPath">{formatNumber(stats.drawCalls)}</span>
                                        <span className="svgDetail"> ({formatCounts(stats.segments, SEGMENT_ORDER)})</span>
                                    </li>)}
                                {stats.groups > 0 && (<li>Groups: <span className="svgPath">{formatNumber(stats.groups)}</span></li>)}
                                <li>Unique colors: <span className="svgColors">{formatNumber(stats.uniqueColors)}</span></li>
                                {stats.gradients > 0 && (
                                    <li>Gradients: <span className="svgColors">{formatNumber(stats.gradients)} defined</span>
                                        <span className="svgDetail"> ({formatNumber(stats.gradientFills)} fills, {formatNumber(stats.gradientStrokes)} strokes use one)</span>
                                    </li>)}
                                {stats.dashedStrokes > 0 && (<li>Dashed strokes: <span className="svgPath">{formatNumber(stats.dashedStrokes)}</span></li>)}
                                {stats.cssRules > 0 && (<li>CSS rules: <span className="svgPath">{formatNumber(stats.cssRules)}</span></li>)}
                                <li>Elements: <span className="svgPath">{formatNumber(stats.elements)}</span>
                                    {stats.skippedElements > 0 && (<span className="svgDetail"> ({formatNumber(stats.skippedElements)} unsupported, skipped)</span>)}
                                </li>
                                <li>Output: <span className="genType">{formatNumber(stats.codeLines)} lines, {formatNumber(stats.codeBytes)} bytes</span></li>
                                <li>Routine: <span className="genType">{result.functionName}(destination, location, transform)</span></li>
                            </>)}
                        </ul>
                    </section>
                )}
                {svgText && (<>
                    {hasCode && (<>
                        <button onClick={downloadFile} className="submit">Download header file</button><br />
                        <button onClick={copyToClipboard} className="submit">Copy to clipboard</button>
                    </>)}
                    {!identValid && (<span className="error">Error: Invalid identifier</span>)}
                    {identValid && !dpiValid && (<span className="error">Error: DPI must be a positive number</span>)}
                    {result && result.error && (<span className="error">Error: {result.error}</span>)}
                </>)}
            </div><br />
            {hasCode && result.warnings.length > 0 && (
                <section className="warnings">
                    <h4>Warnings ({result.warnings.length})</h4>
                    <ul>
                        {result.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                    </ul>
                </section>
            )}
            {pictureUrl && (
                <div id="svgContainer">
                    <img id="picture" src={pictureUrl} alt={file ? file.name : "SVG preview"}
                        width={hasCode ? Math.max(1, Math.ceil(result.width)) : undefined}
                        height={hasCode ? Math.max(1, Math.ceil(result.height)) : undefined} />
                </div>
            )}
            {hasCode && (<>
                <h4>Preview{result.truncated && (<span className="svgDetail"> (first {PREVIEW_LINES} of {formatNumber(stats.codeLines)} lines)</span>)}</h4>
                <SyntaxHighlighter style={syntaxTheme} language="cpp">{result.code}</SyntaxHighlighter>
            </>)}
        </>
    );
};

export default SvgGenerator;
