import { scaleIcon } from "./Icons";
const IconBox = (prop) => {
    let style = { flex: "auto 0 0" };
    let cw = prop.clampWidth;
    let ch = prop.clampHeight;
    if(!cw && !ch) {
        ch = 32;
    }
    const dim = scaleIcon(prop.icon,cw,ch);
    style.width = `${dim.width}px`;
    style.height = `${dim.height}px`;
    return (<><div style={{overflow: "hidden", padding: "1% 1% 1% 1%" }}>
        <center>
            <div dangerouslySetInnerHTML={{ __html: prop.icon.svg }} style={style}></div>
            <label className={"inputButtonCheckLabel"} style={{ width: "80%", overflowY: "hidden" }}>
                
                <input type="checkbox" className={"inputButtonCheck"} checked={prop.checked} onChange={prop.onChange} />
                {prop.icon.label}
            </label>
        </center>
    </div>
    </>);
}
export default IconBox;