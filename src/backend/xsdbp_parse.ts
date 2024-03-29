import { EventEmitter } from "stream";

export enum XSDBMode
{
    Waiting,
    Banner,
    ListingTarget,
    ListingRegister,
    ListingMemory,
    ListingBreakpoints,
    ListingLocals,
    ListingLocalsDef,
    ListingDisassembly,
    ListingBacktrace,
    WaitingForValue,
    AddingBreakpoint,
    Error,
    Prompt,
}

export interface XSDBLineInfo {
    mode: XSDBMode;
    outOfBandRecord: { core: string, target: number, running: boolean, pc: number, status: string } | undefined;
    outOfBandPos: { key: string, value: string, func: string, file: string, line: number } | undefined;
    resultRecords: { key: string, value: string, valueFromHex?: number, target?: number, targetName?: string, pos?:string, state?:string }[];
}

export class XSDBInterrupt
{
    core: string;
    target: number;
    running: boolean;
    pc: number;
    status: string;

    sourceLines: { key: string, value: string, func: string, file: string, line: number }[];

    constructor(line: XSDBLineInfo)
    {
        this.sourceLines = [];
        this.append(line);
    }

    append(line: XSDBLineInfo)
    {
        if (line.outOfBandRecord != undefined) {
            this.core = line.outOfBandRecord.core;
            this.target = line.outOfBandRecord.target;
            this.running = line.outOfBandRecord.running;
            this.pc = line.outOfBandRecord.pc;
            this.status = line.outOfBandRecord.status;
        } else if (line.outOfBandPos != undefined) {
            this.sourceLines.push({key: line.outOfBandPos.key, value: line.outOfBandPos.value, func: line.outOfBandPos.func, file: line.outOfBandPos.file, line: line.outOfBandPos.line });
        }
    }
}

export class XSDBRegisters
{
    constructor(public regs: {key: string, value: string, valueFromHex: number}[] = []){}

    append(line: XSDBLineInfo) {
        for (const rec of line.resultRecords) {
            this.regs.push({ key: rec.key, value: rec.value, valueFromHex: rec.valueFromHex });
        }
    }

}

export class XSDBMemory
{
    constructor(public mem: {address: number, value: number}[] = []) {}

    append(line: XSDBLineInfo) {
        if (!line.resultRecords.length) return;
        this.mem.push({ address: parseInt(line.resultRecords[0].key, 16), value: parseInt(line.resultRecords[0].value, 16)});
    }

}

export class XSDBLocals
{
    constructor(public variables: {name: string, value: string}[] = []) {}

    append(line: XSDBLineInfo) {
        if (!line.resultRecords.length) return;
        this.variables.push({ name: line.resultRecords[0].key, value: line.resultRecords[0].value });
    }
}

export class XSDBLocalsDef
{
    constructor(public variables: {name: string, type: string, address: undefined | number, size: number, flags: string}[] = []) {}

    append(line: XSDBLineInfo) {
        if (!line.resultRecords.length) return;
        this.variables.push({
            name: line.resultRecords[0].key,
            type: line.resultRecords[0].value,
            address: line.resultRecords[0].pos == "N/A" ? 0 : parseInt(line.resultRecords[0].pos),
            size: line.resultRecords[0].target,
            flags: line.resultRecords[0].state
        });
    }
}


export class XSDBTargetItem
{
    constructor(public target: number, public targetName: string = undefined, public pos:string = undefined, public state:string = undefined) {}
}

export class XSDBTargets
{
    constructor(public targets: XSDBTargetItem[] = []) {}

    append(line: XSDBLineInfo) {
        if (!line.resultRecords.length) return;
        this.targets.push({ target: line.resultRecords[0].target, targetName: line.resultRecords[0].targetName, pos: line.resultRecords[0].pos, state: line.resultRecords[0].state });
    }
}

export class XSDBBreakpoints
{
    constructor(public breakpoints: { id: number, target: number, location: string, pos: number, enabled: boolean } [] = []) {}

    append(line: XSDBLineInfo) {
        if (!line.resultRecords.length) return;
        this.breakpoints.push({ id: parseInt(line.resultRecords[0].key), target: line.resultRecords[0].target, location: line.resultRecords[0].targetName, pos: parseInt(line.resultRecords[0].pos, 16), enabled: line.resultRecords[0].state == "1"});
    }

}

export class XSDBDisassembly
{
    constructor(public mem: {address: number, program: string, value: string }[] = []) {}

    append(line: XSDBLineInfo) {
        if (!line.resultRecords.length) return;
        this.mem.push({ address: parseInt(line.resultRecords[0].key, 16), program: line.resultRecords[0].targetName, value: line.resultRecords[0].state});
    }

}

export class XSDBBackTraces
{
    core: string;
    target: number;
    targetName?: string;
    state: string;

    frame: { index: number, line: number, file: string, address: number, func: string }[];

    constructor() { this.frame = []; }
    append(line: XSDBLineInfo)
    {
        if (!line.resultRecords.length) return;
        if (line.resultRecords[0].pos == undefined) {
            this.core = line.resultRecords[0].key;
            this.target = line.resultRecords[0].target;
            this.targetName = line.resultRecords[0].targetName;
            this.state = line.resultRecords[0].state;
        } else {
            this.frame.push({index: parseInt(line.resultRecords[0].key), line: line.resultRecords[0].target, func: line.resultRecords[0].state, file: line.resultRecords[0].targetName, address: parseInt(line.resultRecords[0].pos, 16) });
        }
    }
}

export class XSDBSimpleValue
{
    constructor(public value: string = "") {}

    append(line: XSDBLineInfo)
    {
        if (line.resultRecords.length)
            this.value = line.resultRecords[0].value;
    }
}

export class XSDBAddedBreakpoint
{
    constructor(public id: number = 0, public target: number = 0, public address:number = undefined) {}

    append(line: XSDBLineInfo)
    {
        if (!line.resultRecords.length) return;
        if (line.resultRecords[0].target == undefined)
            this.id = parseInt(line.resultRecords[0].value);
        else
        {
            this.target = line.resultRecords[0].target;
            if (line.resultRecords[0].pos != undefined)
                this.address = parseInt(line.resultRecords[0].pos, 16);
        }
    }
}

export class XSDBError
{
    constructor(public message: string = "") {}
}

export class XSDBAnswer
{
    mode: XSDBMode;
    value: undefined | XSDBTargets | XSDBRegisters | XSDBMemory | XSDBBreakpoints | XSDBLocals | XSDBLocalsDef | XSDBDisassembly | XSDBBackTraces | XSDBSimpleValue | XSDBAddedBreakpoint | XSDBError;
    interrupt: XSDBInterrupt | undefined;
    complete: boolean;

    constructor(mode : XSDBMode, value: undefined | XSDBTargets | XSDBRegisters | XSDBMemory | XSDBBreakpoints | XSDBLocals | XSDBLocalsDef | XSDBDisassembly | XSDBBackTraces | XSDBSimpleValue | XSDBAddedBreakpoint | XSDBError)
    {
        this.mode = mode;
        this.value = value;
        this.interrupt = undefined;
        this.complete = true;
    }
}



const octalMatch = /^[0-7]{3}/;
function parseString(str: string): string {
    const ret = Buffer.alloc(str.length * 4);
    let bufIndex = 0;

    if (str[0] != '"' || str[str.length - 1] != '"')
        throw new Error("Not a valid string");
    str = str.slice(1, -1);
    let escaped = false;
    for (let i = 0; i < str.length; i++) {
        if (escaped) {
            let m;
            if (str[i] == '\\')
                bufIndex += ret.write('\\', bufIndex);
            else if (str[i] == '"')
                bufIndex += ret.write('"', bufIndex);
            else if (str[i] == '\'')
                bufIndex += ret.write('\'', bufIndex);
            else if (str[i] == 'n')
                bufIndex += ret.write('\n', bufIndex);
            else if (str[i] == 'r')
                bufIndex += ret.write('\r', bufIndex);
            else if (str[i] == 't')
                bufIndex += ret.write('\t', bufIndex);
            else if (str[i] == 'b')
                bufIndex += ret.write('\b', bufIndex);
            else if (str[i] == 'f')
                bufIndex += ret.write('\f', bufIndex);
            else if (str[i] == 'v')
                bufIndex += ret.write('\v', bufIndex);
            else if (str[i] == '0')
                bufIndex += ret.write('\0', bufIndex);
            else if (m = octalMatch.exec(str.substring(i))) {
                ret.writeUInt8(parseInt(m[0], 8), bufIndex++);
                i += 2;
            } else
                bufIndex += ret.write(str[i], bufIndex);
            escaped = false;
        } else {
            if (str[i] == '\\')
                escaped = true;
            else if (str[i] == '"')
                throw new Error("Not a valid string");
            else
                bufIndex += ret.write(str[i], bufIndex);
        }
    }
    return ret.slice(0, bufIndex).toString("utf8");
}

export class XSDBLine implements XSDBLineInfo {
    mode : XSDBMode;
    outOfBandRecord: { core: string, target: number, running: boolean, pc: number, status: string } | undefined;
    outOfBandPos: { key: string, value: string, func: string, file: string, line: number } | undefined;
    resultRecords: { key: string, value: string, valueFromHex?: number, target?: number, targetName?: string, pos?:string, state?:string }[];


    constructor(mode: XSDBMode,
                info: { core: string, target: number, running: boolean, pc: number, status: string } | undefined,
                pos: { key: string, value: string, func: string, file: string, line: number } | undefined,
                result: { key: string, value: string, valueFromHex?: number, target?: number, targetName?: string, pos?:string, state?:string }[]) {
        this.mode = mode;
        this.outOfBandRecord = info;
        this.outOfBandPos = pos;
        this.resultRecords = result;
    }

    record(path: string): any {
        if (!this.outOfBandRecord)
            return undefined;
        return XSDBLine.valueOf(this.outOfBandRecord[0].output, path);
    }

    result(path: string): any {
        if (!this.resultRecords)
            return undefined;
        return XSDBLine.valueOf(this.resultRecords[0].value, path);
    }

    static valueOf(start: any, path: string): any {
        if (!start)
            return undefined;
        const pathRegex = /^\.?([a-zA-Z_\-][a-zA-Z0-9_\-]*)/;
        const indexRegex = /^\[(\d+)\](?:$|\.)/;
        path = path.trim();
        if (!path)
            return start;
        let current = start;
        do {
            let target = pathRegex.exec(path);
            if (target) {
                path = path.substring(target[0].length);
                if (current.length && typeof current != "string") {
                    const found = [];
                    for (const element of current) {
                        if (element[0] == target[1]) {
                            found.push(element[1]);
                        }
                    }
                    if (found.length > 1) {
                        current = found;
                    } else if (found.length == 1) {
                        current = found[0];
                    } else return undefined;
                } else return undefined;
            } else if (path[0] == '@') {
                current = [current];
                path = path.substring(1);
            } else {
                target = indexRegex.exec(path);
                if (target) {
                    path = path.substring(target[0].length);
                    const i = parseInt(target[1]);
                    if (current.length && typeof current != "string" && i >= 0 && i < current.length) {
                        current = current[i];
                    } else if (i == 0) {
                        // empty
                    } else return undefined;
                } else return undefined;
            }
            path = path.trim();
        } while (path);
        return current;
    }
}

const outOfBandRecordRegex = /^Info: ([a-zA-Z]+\[\d+,\d+\]) \(target (\d+)\) ([^\(]+)\(([a-zA-Z]+)\) *$/;
const resultRecordRegex = /^(\d*)\^(done|running|connected|error|exit)/;
const newlineRegex = /^\r\n?/;
const endRegex = /^\(gdb\)\r\n?/;
const variableRegex = /^([a-zA-Z_\-][a-zA-Z0-9_\-]*)/;
const asyncClassRegex = /^[^,\r\n]+/;
const keyValuePair = /^ *([^:]+) *: *(.+) *$/;
const funcFileLine = /^([_a-zA-Z][_a-zA-Z0-9]*)\(\) at ([^:]+): *(\d+) *$/;
const prompt = /^(xsdb% )+$/;
const targetExtract = /^ *(\d+)\*? *((?:[-_a-zA-Z0-9] ?)+)(?:#(\d+)|\[(\d+,\d+)\]|) *(?:\(([a-z A-Z]+)\)|).*$/;
const extractBreakpoint = /(\d+) *(\d+) *([_a-zA-Z0-9]+) *target (\d+): \{Address ([xA-Fa-f0-9]+) HitCount (\d+)\}/;
const extractContext = /Context ((?:[-_a-zA-Z0-9] ?)+)(?:#(\d+)|\[(\d+,\d+)\]|) state: ([A-Za-z ]+)/;
const extractBacktraceLine = /^\s+(\d+)\s+([xa-fA-F0-9]+) ([_a-zA-Z0-9]+)\(\)(?:[+0-9]+: ([\/_.a-zA-Z0-9]+), line (\d+)|)/;
const breakpointIndex = /^(\d+)$/;
const breakpointDesc = /^ *target (\d+): \{Address: ([x0-9a-fA-F]+) Type: ([a-zA-Z]+)\}$/;
const breakpointNotFound = /^ *target (\d+): \{Unresolved source line information\}$/;
const disassemblyLine = /^([0-9A-Fa-f]+): ((?:0x[0-9a-fA-F]{2} *)+)(.*)$/;
const memoryLine = /^ *([0-9A-Fa-f]+): *([0-9A-Fa-f]+)/;
const registerMatch = / *([_a-z0-9]+): (N\/A|[0-9A-Fa-f]+)/;
const localDefs = /^([_a-zA-Z][_a-zA-Z0-9]*) +([_a-zA-Z][_a-zA-Z0-9]*|\*) +(N\/A|0x[0-9A-Fa-f]+) +(\d+) +([RWO]*) *$/;


export function parseXSDBP(output: string, parsingMode: XSDBMode): XSDBLine {
    const outOfBandRecord = [];
    const outOfBandPos = [];
    let resultRecords = undefined;

    let match = undefined;

    if (prompt.exec(output)) {
        return new XSDBLine(XSDBMode.Prompt, undefined, undefined, []);
    }

    if (parsingMode == XSDBMode.Waiting) {
        if (match = outOfBandRecordRegex.exec(output)) {
            output = output.substring(match[0].length);
            const core = match[1], target = match[2], state = match[3], stall = match[4];
            const asyncRecord = {
                core,
                target: parseInt(target, 10),
                running: state.includes("Running"),
                pc: !state.includes("Running") ? parseInt(state.slice(state.lastIndexOf('0x') + 2), 16) : 0,
                status: stall
            };
            outOfBandRecord.push(asyncRecord);
            output = output.replace(newlineRegex, "");
            return new XSDBLine(XSDBMode.Waiting, outOfBandRecord[0], undefined, []);
        }
        if (match = funcFileLine.exec(output)) {
            const kvp = keyValuePair.exec(output);
            output = output.substring(match[0].length);
            const func = match[1], target = match[2], state = match[3], stall = match[4];
            const asyncPos = {
                func: match[1],
                file: match[2],
                line: parseInt(match[3]),
                key: kvp[1],
                value: kvp[2],
            };
            outOfBandPos.push(asyncPos);
            output = output.replace(newlineRegex, "");
            return new XSDBLine(XSDBMode.Waiting, undefined, outOfBandPos[0], []);
        }
        if (match = keyValuePair.exec(output)) {
            const asyncPos = {
                key: match[1],
                value: match[2],
                func: "",
                file: "",
                line: 0,
            };
            outOfBandPos.push(asyncPos);
            output = output.replace(newlineRegex, "");
            return new XSDBLine(XSDBMode.Waiting, undefined, outOfBandPos[0], []);
        }
    } else if (parsingMode == XSDBMode.Banner) {
        return new XSDBLine(prompt.exec(output) ? XSDBMode.Waiting : XSDBMode.Banner, undefined, undefined, []);
    } else if (parsingMode == XSDBMode.WaitingForValue) {
        return new XSDBLine(parsingMode, undefined, undefined, [{key: output.length ? "" : "Error", value: output.length ? output.trim() : "Unexpected empty line", valueFromHex: 0}]);
    } else if (parsingMode == XSDBMode.ListingTarget) {
        if (match = targetExtract.exec(output)) {
            const target = {
                key: match[1], // Target ID
                value: match[0],
                target: parseInt(match[1]), // Target ID
                targetName: match[2].trim(), // Core name
                pos: match[3] ? match[3] : (match[4] ? match[4] : undefined), // Core complex address or number
                state: match[5] ? match[5] : undefined, // Status
            };
            return new XSDBLine(XSDBMode.ListingTarget, undefined, undefined, [target]);
        }
    } else if (parsingMode == XSDBMode.ListingBreakpoints) {
        if (match = extractBreakpoint.exec(output)) {
            const breakpoint = {
                key: match[1], // ID
                value: match[0],
                target: parseInt(match[4]), // Target number
                targetName: match[3], // Location (address or function name)
                pos: match[5], // Address
                state: match[2], // Enabled = 1 or not
            };
            return new XSDBLine(XSDBMode.ListingBreakpoints, undefined, undefined, [breakpoint]);
        } else return new XSDBLine(XSDBMode.ListingBreakpoints, undefined, undefined, []);
    } else if (parsingMode == XSDBMode.ListingBacktrace) {
        if (match = extractContext.exec(output)) {
            const backtrace = {
                key: match[1], // Core base name
                value: match[0],
                target: match[2] ? parseInt(match[2]) : 0, // Core number if simple
                targetName: match[3] ? match[3] : undefined, // Core number if complex
                pos: undefined,
                state: match[4], // Status
            };
            return new XSDBLine(XSDBMode.ListingBacktrace, undefined, undefined, [backtrace]);
        } else if (match = extractBacktraceLine.exec(output)) {
            const backtrace = {
                key: match[1],
                value: match[0],
                target: match[5] ? parseInt(match[5]) : 0, // Line number
                targetName: match[4] ? match[4] : undefined, // File name
                pos: match[2], // Address in hex
                state: match[3], // Function name
            };
            return new XSDBLine(XSDBMode.ListingBacktrace, undefined, undefined, [backtrace]);
        } else return new XSDBLine(XSDBMode.ListingBacktrace, undefined, undefined, []);
    } else if (parsingMode == XSDBMode.AddingBreakpoint) {
        if (match = breakpointIndex.exec(output)) {
            return new XSDBLine(XSDBMode.AddingBreakpoint, undefined, undefined, [{key: match[1], value: match[0]}]);
        } else if (match = breakpointDesc.exec(output)) {
            const breakpoint = {
                key: "",
                value: match[0],
                target: parseInt(match[1]), // Target number
                targetName: undefined,
                pos: match[2], // Address in hex
                state: match[3], // Function name
            };
            return new XSDBLine(XSDBMode.AddingBreakpoint, undefined, undefined, [breakpoint]);
        } else if (match = breakpointNotFound.exec(output)) {
            const breakpoint = {
                key: "",
                value: match[0],
                target: parseInt(match[1]), // Target number
                targetName: undefined,
                pos: undefined, // Address in hex
                state: undefined, // Function name
            };
            return new XSDBLine(XSDBMode.AddingBreakpoint, undefined, undefined, [breakpoint]);
        } else return new XSDBLine(XSDBMode.AddingBreakpoint, undefined, undefined, []);
    } else if (parsingMode == XSDBMode.ListingDisassembly) {
        if (match = disassemblyLine.exec(output)) {
            const disassembly = {
                key: match[1], // Address
                value: match[0],
                target: undefined,
                targetName: match[2], // Hexdump of program memory (variable)
                pos: match[1], // Address
                state: match[3], // Disassembly
            };
            return new XSDBLine(XSDBMode.ListingDisassembly, undefined, undefined, [disassembly]);
        } else return new XSDBLine(XSDBMode.ListingDisassembly, undefined, undefined, []);
    } else if (parsingMode == XSDBMode.ListingMemory) {
        if (match = memoryLine.exec(output)) {
            const memory = {
                key: match[1], // Address
                value: match[2],
                target: undefined,
                targetName: undefined,
                pos: match[1], // Address
                state: undefined,
            };
            return new XSDBLine(XSDBMode.ListingMemory, undefined, undefined, [memory]);
        } else return new XSDBLine(XSDBMode.ListingMemory, undefined, undefined, []);
    } else if (parsingMode == XSDBMode.ListingLocals) {
        if (match = keyValuePair.exec(output)) {
            const local = {
                key: match[1], // Address
                value: match[2],
                target: undefined,
                targetName: undefined,
                pos: undefined, // Address
                state: undefined,
            };
            return new XSDBLine(XSDBMode.ListingLocals, undefined, undefined, [local]);
        }
    } else if (parsingMode == XSDBMode.ListingLocalsDef) {
        if (match = localDefs.exec(output)) {
            const local = {
                key: match[1], // Address
                value: match[2], // Type
                target: parseInt(match[4]), // Size
                targetName: undefined, //
                pos: match[3], // Address
                state: match[5], // Flags
            };
            return new XSDBLine(XSDBMode.ListingLocalsDef, undefined, undefined, [local]);
        } else return new XSDBLine(XSDBMode.ListingLocalsDef, undefined, undefined, []);
    } else if (parsingMode == XSDBMode.ListingRegister) {
        resultRecords = [];
        while (match = registerMatch.exec(output)) {
            const reg = {
                key: match[1],
                value: match[2],
                valueFromHex: match[2] == 'N/A' ? undefined : parseInt(match[2], 16),
            };
            resultRecords.push(reg);
            output = output.substring(match[0].length);
        }
        return new XSDBLine(XSDBMode.ListingRegister, undefined, undefined, resultRecords);
    }
    if (!output.length || prompt.exec(output)) {
        return new XSDBLine(XSDBMode.Waiting, undefined, undefined, []);
    }
    return new XSDBLine(parsingMode, undefined, undefined, [{key:"Error", value:"Unexpected line: " + output, valueFromHex:0}]);
}

function isInterrupt(answer: XSDBAnswer, line: XSDBLineInfo, mode: XSDBMode) : number {
    if (line.mode == XSDBMode.Prompt) {
        answer.complete = true;
        return 0; // We're done
    }
    // Error, this shouldn't happen unless it's an interrupt
    if (line.mode == XSDBMode.Waiting && (line.outOfBandRecord != undefined || line.outOfBandPos != undefined)) {
        if (answer.interrupt != undefined) answer.interrupt.append(line);
        else answer.interrupt = new XSDBInterrupt(line);
        return 1;
    }
    if (line.mode != mode) {
        answer.mode = XSDBMode.Error;
        answer.value = new XSDBError("Wrong answer line: " + JSON.stringify(line) + " for mode:" + mode);
        return -1;
    }
    return 2;
}

export function mergeLines(lines: XSDBLine[], ee: EventEmitter = undefined) : XSDBAnswer {
    if (!lines.length) return new XSDBAnswer(XSDBMode.Error, new XSDBError("Empty answer"));
    const mode = lines[0].mode;
    const answer = new XSDBAnswer(mode, undefined);
    switch(mode)
    {
    case XSDBMode.Waiting:
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (ee) ee.emit("msg", "stdout", "T:" + type + "/" + mode + " " + JSON.stringify(line));
            if (type < 0) break;
            if (type == 1) continue;
            answer.value = new XSDBError("Unexpected prompt from XSDB");
        }
        break;
    case XSDBMode.Banner:
        for (const line of lines) {
            if (line.mode == XSDBMode.Prompt)
                return answer;
        }
        answer.value = new XSDBError("Unended banner");
        break;
    case XSDBMode.ListingTarget:
        answer.value = new XSDBTargets;
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (type < 0) break;
            if (type == 1) continue;
            answer.value.append(line);
        }
        break;
    case XSDBMode.ListingRegister:
        answer.value = new XSDBRegisters;
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (type < 0) break;
            if (type == 1) continue;
            answer.value.append(line);
        }
        break;
    case XSDBMode.ListingMemory:
        answer.value = new XSDBMemory;
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (type < 0) break;
            if (type == 1) continue;
            answer.value.append(line);
        }
        break;
    case XSDBMode.ListingBreakpoints:
        answer.value = new XSDBBreakpoints;
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (type < 0) break;
            if (type == 1) continue;
            answer.value.append(line);
        }
        break;
    case XSDBMode.ListingLocals:
        answer.value = new XSDBLocals;
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (type < 0) break;
            if (type == 1) continue;
            answer.value.append(line);
        }
        break;
    case XSDBMode.ListingLocalsDef:
        answer.value = new XSDBLocalsDef;
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (type < 0) break;
            if (type == 1) continue;
            answer.value.append(line);
        }
        break;
    case XSDBMode.ListingDisassembly:
        answer.value = new XSDBDisassembly;
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (type < 0) break;
            if (type == 1) continue;
            answer.value.append(line);
        }
        break;
    case XSDBMode.ListingBacktrace:
        answer.value = new XSDBBackTraces;
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (type < 0) break;
            if (type == 1) continue;
            answer.value.append(line);
        }
        break;
    case XSDBMode.WaitingForValue:
        answer.value = new XSDBSimpleValue;
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (type < 0) break;
            if (type == 1) continue;
            answer.value.append(line);
        }
        break;
    case XSDBMode.AddingBreakpoint: {
        answer.value = new XSDBAddedBreakpoint;
        let counter = 0;
        for (const line of lines) {
            const type = isInterrupt(answer, line, mode);
            if (type < 0) break;
            if (type == 0 && counter <= 1) { answer.complete = false; continue; } // Ignore first prompt
            counter++;
            answer.value.append(line);
        }
        break;
    }
    case XSDBMode.Error:
        answer.value = new XSDBError(lines[0].resultRecords[0].value);
        break;
    case XSDBMode.Prompt: // Should never happen
        answer.mode = XSDBMode.Waiting;
        break;
    }
    return answer;
}
