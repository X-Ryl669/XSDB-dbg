export enum XSDBMode
{
	Waiting,
	Banner,
	ListingTarget,
	ListingRegister,
	ListingMemory,
	ListingBreakpoints,
	ListingLocals,
	ListingDisassembly,
	ListingBacktrace,
	WaitingForValue,
	AddingBreakpoint,
};

export interface XSDBLineInfo {
	mode: XSDBMode;
	outOfBandRecord: { core: string, target: number, running: boolean, pc: number, status: string } | null;
	outOfBandPos: { key: string, value: string, func: string, file: string, line: number } | null;
	resultRecords: { key: string, value: string, valueFromHex?: number, target?: number, targetName?: string, pos?:string, state?:string }[];
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
	outOfBandRecord: { core: string, target: number, running: boolean, pc: number, status: string } | null;
	outOfBandPos: { key: string, value: string, func: string, file: string, line: number } | null;
	resultRecords: { key: string, value: string, valueFromHex?: number, target?: number, targetName?: string, pos?:string, state?:string }[];


	constructor(mode: XSDBMode, 
				info: { core: string, target: number, running: boolean, pc: number, status: string } | null, 
				pos: { key: string, value: string, func: string, file: string, line: number } | null, 
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
const prompt = /^xsdb% $/;
const targetExtract = /^ *(\d+) *((?:[-_a-zA-Z0-9] ?)+)(?:#(\d+)|\[(\d+,\d+)\]|) *(?:\(([a-z A-Z]+)\)|).*$/;

export function parseXSDBP(output: string, parsingMode: XSDBMode): XSDBLine {
	/*
		output ==>
			(
				exec-async-output     = [ token ] "*" ("stopped" | others) ( "," variable "=" (const | tuple | list) )* \n
				status-async-output   = [ token ] "+" ("stopped" | others) ( "," variable "=" (const | tuple | list) )* \n
				notify-async-output   = [ token ] "=" ("stopped" | others) ( "," variable "=" (const | tuple | list) )* \n
				console-stream-output = "~" c-string \n
				target-stream-output  = "@" c-string \n
				log-stream-output     = "&" c-string \n
			)*
			[
				[ token ] "^" ("done" | "running" | "connected" | "error" | "exit") ( "," variable "=" (const | tuple | list) )* \n
			]
			"(gdb)" \n
	*/

	let token = undefined;
	const outOfBandRecord = [];
	const outOfBandPos = [];
	let resultRecords = undefined;

	const asyncRecordType = {
		"*": "exec",
		"+": "status",
		"=": "notify"
	};
	const streamRecordType = {
		"~": "console",
		"@": "target",
		"&": "log"
	};

	const parseCString = () => {
		if (output[0] != '"')
			return "";
		let stringEnd = 1;
		let inString = true;
		let remaining = output.substring(1);
		let escaped = false;
		while (inString) {
			if (escaped)
				escaped = false;
			else if (remaining[0] == '\\')
				escaped = true;
			else if (remaining[0] == '"')
				inString = false;

			remaining = remaining.substring(1);
			stringEnd++;
		}
		let str;
		try {
			str = parseString(output.substring(0, stringEnd));
		} catch (e) {
			str = output.substring(0, stringEnd);
		}
		output = output.substring(stringEnd);
		return str;
	};

	let parseValue, parseCommaResult, parseCommaValue, parseResult;

	const parseTupleOrList = () => {
		if (output[0] != '{' && output[0] != '[')
			return undefined;
		const oldContent = output;
		const canBeValueList = output[0] == '[';
		output = output.substring(1);
		if (output[0] == '}' || output[0] == ']') {
			output = output.substring(1); // ] or }
			return [];
		}
		if (canBeValueList) {
			let value = parseValue();
			if (value !== undefined) { // is value list
				const values = [];
				values.push(value);
				const remaining = output;
				while ((value = parseCommaValue()) !== undefined)
					values.push(value);
				output = output.substring(1); // ]
				return values;
			}
		}
		let result = parseResult();
		if (result) {
			const results = [];
			results.push(result);
			while (result = parseCommaResult())
				results.push(result);
			output = output.substring(1); // }
			return results;
		}
		output = (canBeValueList ? '[' : '{') + output;
		return undefined;
	};

	parseValue = () => {
		if (output[0] == '"')
			return parseCString();
		else if (output[0] == '{' || output[0] == '[')
			return parseTupleOrList();
		else
			return undefined;
	};

	parseResult = () => {
		const variableMatch = variableRegex.exec(output);
		if (!variableMatch)
			return undefined;
		output = output.substring(variableMatch[0].length + 1);
		const variable = variableMatch[1];
		return [variable, parseValue()];
	};

	parseCommaValue = () => {
		if (output[0] != ',')
			return undefined;
		output = output.substring(1);
		return parseValue();
	};

	parseCommaResult = () => {
		if (output[0] != ',')
			return undefined;
		output = output.substring(1);
		return parseResult();
	};

	let match = undefined;


	if (parsingMode == XSDBMode.Waiting) {
		if (match = outOfBandRecordRegex.exec(output)) {
			output = output.substring(match[0].length);
			const core = match[1], target = match[2], state = match[3], stall = match[4];
			const asyncRecord = { 
				core,
				target: parseInt(target, 10),
				running: state.includes("Running"),
				pc: !state.includes("Running") ? parseInt(state.slice(state.lastIndexOf('0x') + 2), 16): 0,
				status: stall
			};
			outOfBandRecord.push(asyncRecord);
			output = output.replace(newlineRegex, "");
			return new XSDBLine(XSDBMode.Waiting, outOfBandRecord[0], null, []);
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
			return new XSDBLine(XSDBMode.Waiting, null, outOfBandPos[0], []);
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
			return new XSDBLine(XSDBMode.Waiting, null, outOfBandPos[0], []);
		}
	} else if (parsingMode == XSDBMode.Banner) {
		return new XSDBLine(prompt.exec(output) ? XSDBMode.Waiting : XSDBMode.Banner, null, null, []);
	} else if (parsingMode == XSDBMode.WaitingForValue) {
		return new XSDBLine(parsingMode, null, null, [{key: output.length ? "" : "Error", value: output.length ? output.trim() : "Unexpected empty line", valueFromHex: 0}]);
	} else if (parsingMode == XSDBMode.ListingTarget) {
		if (match = targetExtract.exec(output)) {
			const target = {
				key: match[1],
				value: match[0],
				target: parseInt(match[1]),
				targetName: match[2].trim(),
				pos: match[3] ? match[3] : (match[4] ? match[4] : null),
				state: match[5] ? match[5] : null,
			};
			return new XSDBLine(XSDBMode.ListingTarget, null, null, [target]);
		} else
		{
			
		}
	}
	if (!output.length || prompt.exec(output)) {
		return new XSDBLine(XSDBMode.Waiting, null, null, []);
	}
	return new XSDBLine(parsingMode, null, null, [{key:"Error", value:"Unexpected line: "+ output, valueFromHex:0}]);
}
