const toHex = (code) => {
    let result = code.toString(16);
    if (result.length === 1) {
        return "0" + result;
    }
    return result;
}
export const generateText = (data, startSpacing = 0) => {
    let result = "\"";
    if(data) {
        const view = new DataView(data);
        let j = startSpacing;
        for (var i = 0; i < view.byteLength; i++) {
            if (i > 0 && 0 === (j % 80) && i < view.byteLength - 1) {
                result += "\"\r\n    \"";
            }
            var charcode = view.getUint8(i);
            if (charcode < 0x80) {
                const ch = String.fromCharCode(charcode);
                switch (ch) {
                    case '\r':
                        result += "\\r";
                        break;
                    case '\n':
                        result += "\\n";
                        if (i < view.byteLength - 1) {
                            result += "\"\r\n    \"";
                        }
                        j = 0;
                        break;
                    case '\t':
                        result += "\\t";
                        break;
                    case '"':
                        result += "\\\"";
                        break;
                    case '\\':
                        result += "\\\\";
                        break;
                    default:
                        result += ch;
                        break;
                }
            }
            else {
                result += `\\x${toHex(charcode)}`;
            }
            ++j;
        }
    } else {
        result += "...";
    }
    return result + "\"";
}
export const generateBinary = (data) => {
    let result = "";
    if(data) {
        const view = new DataView(data);
        for (let i = 0; i < view.byteLength; ++i) {
            if (0 === (i % (30))) {
                if (i < view.byteLength - 1) {
                    result += "\r\n    ";
                } else {
                    result += "\r\n";
                }
            }
            let append = ("0x" + toHex(view.getUint8(i)));
            if (i < view.byteLength - 1) {
                append += ", ";
            }
            result += append;
        }
    } else {
        result = "...";
    }
    return result;
}

export const generateStringLiteral = (name, data, isStatic) => {
    if (isStatic) {
        return `static const char* ${name} = ${generateText(data, 18 + name.length)};`;
    }
    return `const char* ${name} = ${generateText(data, 18 + name.length)};`;

}

export const generateByteArrayLiteral = (name, data, isStatic) => {
    if (isStatic) {
        return `static const uint8_t ${name}[] = {${generateBinary(data)}};`;
    }
    return `const uint8_t ${name}[] = {${generateBinary(data)}};`;

}
export const toIdentifier = (name) => {
    let result = "";
    if (name.length === 0) {
        return "_";
    }
    if (name[0] >= '0' && name[0] <= '9') {
        result = "_";
    }
    for (let i = 0; i < name.length; ++i) {
        if ((name[i] >= '0' && name[i] <= '9') || (name[i] >= 'A' && name[i] <= 'Z') || (name[i] >= 'a' && name[i] <= 'z')) {
            result += name[i];
        } else {
            result += "_";
        }
    }
    return result;
}