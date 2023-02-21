import { Breakpoint, IBackend, Thread, Stack, Variable, VariableObject, MIError } from "../backend";
import * as ChildProcess from "child_process";
import { EventEmitter } from "events";
import { parseXSDBP, XSDBLine, XSDBMode, XSDBAnswer, mergeLines, 
	     XSDBTargets, XSDBTargetItem, 
		 XSDBRegisters, XSDBMemory, XSDBBreakpoints, XSDBLocals, XSDBDisassembly, XSDBBackTraces, XSDBSimpleValue, 
		 XSDBAddedBreakpoint, XSDBError } from '../xsdbp_parse';
import * as linuxTerm from '../linux/console';
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

export function escape(str: string) {
	return str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

const nonOutput = /^(?:\d*|undefined)[\*\+\=]|[\~\@\&\^]/;
const xsdbMatch = /xsdb% /;
const numRegex = /\d+/;

function couldBeOutput(line: string) {
	if (nonOutput.exec(line))
		return false;
	return true;
}

const trace = false;


interface IFileSource
{
	file: string;
	line: number;
	func?: string;
}


export class XMI_XSDB extends EventEmitter implements IBackend {
	constructor(public application: string, public preargs: string[], public extraargs: string[], procEnv: any, public extraCommands: string[] = []) {
		super();

		if (procEnv) {
			const env = {};
			// Duplicate process.env so we don't override it
			for (const key in process.env)
				if (process.env.hasOwnProperty(key))
					env[key] = process.env[key];

			// Overwrite with user specified variables
			for (const key in procEnv) {
				if (procEnv.hasOwnProperty(key)) {
					if (procEnv === undefined)
						delete env[key];
					else
						env[key] = procEnv[key];
				}
			}
			this.procEnv = env;
		}
		this.protoLines = [];
		this.currentTarget = 0;
	}

	async executeCommandsSequentially(cmds : string[], userFunc: boolean) {
		for (const c of cmds) {
			if (userFunc) await this.sendUserInput(c);
			else await this.sendCommand(c);
		}
	}

	load(cwd: string, target: string, procArgs: string, separateConsole: string, autorun: string[], targetFilter: string, symbol_mapper: string): Thenable<any> {
		if (!path.isAbsolute(target))
			target = path.join(cwd, target);
		return new Promise((resolve, reject) => {
			const args = this.preargs.concat(this.extraargs || []);
			this.mode = XSDBMode.Banner;
			this.handlers[XSDBMode.ListingTarget] = this.noHandler;
			this.handlers[XSDBMode.Banner] = (prompt: any) => { 
				this.log("console", "Banner received"); this.mode = XSDBMode.Waiting;

				// Poor man solution to have sequential async function with callback hell...
				this.executeCommandsSequentially(promises, false)
				.then(_ => this.log("console", "Running autorun commands"))
				.then(_ => this.executeCommandsSequentially(autorun, true))
				.then(_ => {
						this.log("console", "Done running autorun commands");
						this.log("console", "Clearing all breakpoints");
				    })
				.then(_ => this.sendCommand("bpr -all")) // Clean all previous breakpoints so state is known
				.then(_ => this.bootstrap())
				.then(_ => {
							this.emit("debug-ready");
							resolve(undefined);
					});
			};
			this.targetDir = target;
			this.symbolMapper = symbol_mapper;
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.targetFilter = targetFilter;
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			let promises = this.initCommands(target, cwd);
/*			if (process.platform == "win32") {
				if (separateConsole !== undefined)
					promises.push(this.sendCommand("gdb-set new-console on"));
					promises.push(...autorun.map(value => { return this.sendUserInput(value); }));

				Promise.all(promises).then(() => {
					this.emit("debug-ready");
					resolve(undefined);
				}, reject);
			} else {
				if (separateConsole !== undefined) {
					linuxTerm.spawnTerminalEmulator(separateConsole).then(tty => {
//						promises.push(this.sendCommand("inferior-tty-set " + tty));
						promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
						Promise.all(promises).then(() => {
							this.emit("debug-ready");
							resolve(undefined);
						}, reject);
					});
				} else {
					*/
/*					promises.push(...autorun.map(value => { return this.sendUserInput(value); }));

					//promises.reduce((prom, fn) => prom.then(fn as Thenable<XSDBAnswer>), Promise.resolve() as unknown as Promise<XSDBAnswer>).then(
					this.executeCommands(promises).then(
						() => {
							this.emit("debug-ready");
							resolve(undefined);
						}, reject);
				
/*
					Promise.all(promises).then(() => {
						this.emit("debug-ready");
						resolve(undefined);
					}, reject);
					*/
//				}
//			}
			this.log("stdout", "Loaded");

		});
	}

	protected initCommands(target: string, cwd: string, attach: boolean = false) {
		// We need to account for the possibility of the path type used by the debugger being different
		// from the path type where the extension is running (e.g., SSH from Linux to Windows machine).
		// Since the CWD is expected to be an absolute path in the debugger's environment, we can test
		// that to determine the path type used by the debugger and use the result of that test to
		// select the correct API to check whether the target path is an absolute path.
		const debuggerPath = path.posix.isAbsolute(cwd) ? path.posix : path.win32;

		if (!debuggerPath.isAbsolute(target))
			target = debuggerPath.join(cwd, target);

		const cmds = [
			"connect",
		];
		for (const cmd of this.extraCommands) {
			cmds.push(cmd);
		}

		return cmds;
	}

	attach(cwd: string, executable: string, target: string, autorun: string[]): Thenable<any> {
		return new Promise((resolve, reject) => {
			reject("Not supported");
/*			let args = [];
			if (executable && !path.isAbsolute(executable))
				executable = path.join(cwd, executable);
			args = this.preargs.concat(this.extraargs || []);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			const promises = this.initCommands(target, cwd, true);
			if (target.startsWith("extended-remote")) {
				promises.push(this.sendCommand("target-select " + target));
				if (executable)
					promises.push(this.sendCommand("file-symbol-file \"" + escape(executable) + "\""));
			} else {
				// Attach to local process
				if (executable)
					promises.push(this.sendCommand("file-exec-and-symbols \"" + escape(executable) + "\""));
				promises.push(this.sendCommand("target-attach " + target));
			}
			promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
			Promise.all(promises).then(() => {
				this.emit("debug-ready");
				resolve(undefined);
			}, reject);
			*/
		});
	}

	connect(cwd: string, executable: string, target: string, autorun: string[]): Thenable<any> {
		return new Promise((resolve, reject) => {
			reject("Not supported");
			/*
			let args = [];
			if (executable && !path.isAbsolute(executable))
				executable = path.join(cwd, executable);
			args = this.preargs.concat(this.extraargs || []);
			if (executable)
				args = args.concat([executable]);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			const promises = this.initCommands(target, cwd, true);
			promises.push(this.sendCommand("target-select remote " + target));
			promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
			Promise.all(promises).then(() => {
				this.emit("debug-ready");
				resolve(undefined);
			}, reject);
			*/
		});
	}

	lookupSymbol(address: number) : IFileSource {
		if (!this.symbolMapper) return { file: "<unknown>", line: 0};
		const elfPath = this.getELFPath(0);

		const cmd = this.symbolMapper.replace("$1", elfPath).replace("$2", "0x"+address.toString(16));
		const args = cmd.split(" ");
		const addrLines = ChildProcess.spawnSync(args[0], args.slice(1), { cwd: this.targetDir, env: this.procEnv, stdio: ['ignore', 'pipe', 'ignore'] });
		const lines = addrLines.stdout.toString().split("\n");

		if (lines.length == 1)
			return { file: lines[0].split(':')[0], line: parseInt(lines[0].split(':')[1])}
		else return { file: lines[1].split(':')[0], line: parseInt(lines[1].split(':')[1]), func: lines[0]}
	}

	findSourceFile(basename: string, address: number = 0) : Promise<IFileSource> {
		try { if (fs.lstatSync(basename).isFile()) return Promise.resolve({file:basename, line: 0}); } catch(e) {} // Ignore missing error here
		let basePath = this.targetDir.replace("/Work", "/src");
		this.log("stdout", "Searching files in " + basePath)
		// Search directory recursively for the given filename
		return new Promise((resolve, reject) => {
			glob(basePath + '/**/' + basename, {dot: false}, (err, files) => {
				if (files.length) {
					this.log("stdout", "Found " + basename + " as " + files[0]);
					return resolve({file:files[0], line:0});
				} else // Else need to find the file via addr2line (which is a real slow function here)
					resolve(this.lookupSymbol(address));
			});
		});
	}

	stdout(data) {
		if (trace)
			this.log("stderr", "stdout: " + data);
		if (typeof data == "string")
			this.buffer += data;
		else
			this.buffer += data.toString("utf8");

		const end = this.buffer.lastIndexOf('\n');
		try {
			if (end != -1) {
				this.onOutput(this.buffer.substring(0, end));
				this.buffer = this.buffer.substring(end + 1);
			}
			if (this.buffer.length) {
				if (this.onOutputPartial(this.buffer)) {
					this.buffer = "";
				}
			}
		} catch(e) 
		{
			this.log("stderr", "Error: " + e.stack);
		}
	}

	stderr(data) {
		if (typeof data == "string")
			this.errbuf += data;
		else
			this.errbuf += data.toString("utf8");
		const end = this.errbuf.lastIndexOf('\n');
		if (end != -1) {
			this.onOutputStderr(this.errbuf.substring(0, end));
			this.errbuf = this.errbuf.substring(end + 1);
		}
		if (this.errbuf.length) {
			this.logNoNewLine("stderr", this.errbuf);
			this.errbuf = "";
		}
	}

	onOutputStderr(lines) {
		lines = <string[]> lines.split('\n');
		lines.forEach(line => {
			this.log("stderr", line);
		});
	}

	handleAnswer(answer: XSDBAnswer) {
		// Ugly hack to force waiting for a second prompt after the first one
		if (answer.mode == XSDBMode.AddingBreakpoint && answer.complete == false) 
			return false;
		if (this.debugOutput || true)
			this.log("log", "XSDB -> App: " + JSON.stringify(answer));
		if (answer.interrupt !== null) {
			if (answer.interrupt.running) {
				if (answer.interrupt.status == "Disabled") this.emit("exited-normally", answer);
				else this.emit("running", answer);
			} else {
				this.emit("breakpoint", answer);
			}
		}
		if (answer.mode == XSDBMode.Error) {
			this.log("stderr", (answer.value as XSDBError).message);
		} else {
			this.handlers[answer.mode](answer);
		}
		return true;
	}

	onOutputPartial(line) {
		const parsed = parseXSDBP(line, this.mode);
		this.protoLines.push(parsed);
		this.log("stdout", "p>" + line + "<" + this.mode + "/" + parsed.mode + "/" + this.protoLines[0].mode);
		if (parsed.mode == XSDBMode.Prompt) 
		{
			if (this.handleAnswer(mergeLines(this.protoLines, this)))
				this.protoLines = [];
			return true;
		}
		else {
			this.protoLines.pop();
			return false;
		}
/*		
		if (this.protoLines.length) {
			this.log("stdout", "Strange, there are remaining lines after receiving:\n"+JSON.stringify(this.protoLines));
		}


		if (couldBeOutput(line)) {
			this.logNoNewLine("stdout", "partial: "+ line);
			return true;
		}
		return false;
		*/
	}

	onOutput(lines) {
		lines = <string[]> lines.split('\n');
		let answer = null;
		this.log("stdout", "Current mode: " + this.mode.toString());
		lines.forEach(line => {
			if (!line) return;
			this.log("stdout", ">"+line+"<");
			const parsed = parseXSDBP(line, this.mode);
			this.protoLines.push(parsed);
			if (parsed.mode == XSDBMode.Prompt) 
			{
				if (this.handleAnswer(mergeLines(this.protoLines, this)))
					this.protoLines = [];
			}
		});
	}

	getELFName(index : number) : string {
		if (index == 0) index = this.currentTarget;
		const item = this.availableTargets.get(index);
		return item.pos.split(",")[0] + '_' + item.pos.split(",")[1];
	}

	getELFPath(index : number) : string {
		const elfName = this.getELFName(index);
		return this.targetDir + "/aie/" + elfName + "/Release/" + elfName;
	}

	async loadSymbols() {
		for (const [num, item] of this.availableTargets) {
			await this.setThread(item.target, "");
			await this.sendCommand("memmap -file " + this.getELFPath(num) );
		};
		return true;
	}

	bootstrap() {
		this.log("stdout", "Bootstrap called");
		return this.getThreads().then(thr => {
			if (thr.length) 
			{
				this.log("stdout", "Found " + thr.length + " targets (" + JSON.stringify(thr) + ")");
				if (this.availableTargets.size && fs.lstatSync(this.targetDir).isDirectory()) {
					return this.loadSymbols();
				}

				return this.setThread(thr[0].id, "Can't set the active target");
			}
			this.log("console", "Can only attach with XSDB, and no target found for this filter: " + JSON.stringify(thr));
			return false;
		});
	}


	start(runToStart: boolean): Thenable<boolean> {
		// Let's fetch the targets, if not done yet
		return this.availableTargets.size == 0 ? this.bootstrap() : new Promise((res, rej) => { 
			return res(true);
		});
	}

	stop() {
		const proc = this.process;
		const to = setTimeout(() => {
			process.kill(-proc.pid);
		}, 1000);
		this.process.on("exit", function (code) {
			clearTimeout(to);
		});
		this.sendRaw("exit");
	}

	detach() {
		const proc = this.process;
		const to = setTimeout(() => {
			process.kill(-proc.pid);
		}, 1000);
		this.process.on("exit", function (code) {
			clearTimeout(to);
		});
		this.sendRaw("-target-detach");
	}

	interrupt(): Thenable<boolean> {
		if (trace)
			this.log("stderr", "interrupt");
		return new Promise((resolve, reject) => {
			this.sendCommand("stop").then((answer) => {
				resolve(answer.complete);
			}, reject);
		});
	}

	continue(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "continue");
		return new Promise((resolve, reject) => {
			this.sendCommand("cont").then((answer) => {
				resolve(answer.complete);
			}, reject);
		});
	}

	next(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "next");
		return new Promise((resolve, reject) => {
			this.sendCommand("nxt").then((answer) => {
				resolve(answer.complete);
			}, reject);
		});
	}

	step(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "step");
		return new Promise((resolve, reject) => {
			this.sendCommand("stp").then((answer) => {
				resolve(answer.complete);
			}, reject);
		});
	}

	stepOut(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "stepOut");
		return new Promise((resolve, reject) => {
			this.sendCommand("stpout").then((answer) => {
				resolve(answer.complete);
			}, reject);
		});
	}

	goto(filename: string, line: number): Thenable<Boolean> {
		if (trace)
			this.log("stderr", "goto");
		return new Promise((resolve, reject) => {
			this.sendCommand("bpadd -file " + escape(filename) + " -line " + line).then((answer: XSDBAnswer) => {
				if (answer.mode == XSDBMode.AddingBreakpoint && (answer.value as XSDBAddedBreakpoint).address) {
					this.sendCommand("con -addr " + (answer.value as XSDBAddedBreakpoint).address).then((answer) => {
						resolve(answer.complete);
					}, reject);
				}
				else {
					reject("Invalid filename");
				}
			}, reject);
		});
	}

	changeVariable(name: string, rawValue: string): Thenable<any> {
		if (trace)
			this.log("stderr", "changeVariable");
		return this.sendCommand("locals " + name + " " + rawValue);
	}

	loadBreakPoints(breakpoints: Breakpoint[]): Thenable<[boolean, Breakpoint][]> {
		if (trace)
			this.log("stderr", "loadBreakPoints");
		const promises = [];
		breakpoints.forEach(breakpoint => {
			promises.push(this.addBreakPoint(breakpoint));
		});
		return Promise.all(promises);
	}

	setBreakPointCondition(bkptNum, condition): Thenable<any> {
		if (trace)
			this.log("stderr", "setBreakPointCondition");
		return Promise.reject("Not supported");
	}

	setEntryBreakPoint(entryPoint: string): Thenable<any> {
		return Promise.reject("Not supported");
	}

	addBreakPoint(breakpoint: Breakpoint): Thenable<[boolean, Breakpoint]> {
		if (trace)
			this.log("stderr", "addBreakPoint");
		return new Promise((resolve, reject) => {
			if (this.breakpoints.has(breakpoint))
				return resolve([false, undefined]);
			let args = "";
			if (breakpoint.countCondition) {
				return reject("Not supported");
			}
			if (breakpoint.raw)
				args += escape(breakpoint.raw);
			else
				args += "-file " + escape(breakpoint.file) + " -line " + breakpoint.line;
			this.sendCommand("bpadd " + args).then((answer) => {
				if (answer.complete) {
					let bpt = (answer.value as XSDBAddedBreakpoint);
					const bkptNum = bpt.id;
					const newBrk = {
						file: breakpoint.file ? breakpoint.file : "unknown source file",
						raw: bpt.address ? "0x"+bpt.address.toString(16) : "0",
						line: breakpoint.line,
						condition: null
					};
					this.breakpoints.set(newBrk, bkptNum);
					resolve([true, newBrk]);
				} else {
					reject(answer);
				}
			}, reject);
		});
	}

	removeBreakPoint(breakpoint: Breakpoint): Thenable<boolean> {
		if (trace)
			this.log("stderr", "removeBreakPoint");
		return new Promise((resolve, reject) => {
			if (!this.breakpoints.has(breakpoint))
				return resolve(false);
			this.sendCommand("bpremove " + this.breakpoints.get(breakpoint)).then((answer) => {
				if (answer.complete) {
					this.breakpoints.delete(breakpoint);
					resolve(true);
				} else resolve(false);
			});
		});
	}

	clearBreakPoints(source?: string): Thenable<any> {
		if (trace)
			this.log("stderr", "clearBreakPoints");
		return new Promise((resolve, reject) => {
			const promises = [];
			const breakpoints = this.breakpoints;
			this.breakpoints = new Map();
			breakpoints.forEach((k, index) => {
				if (index.file === source) {
					promises.push(this.sendCommand("bpremove " + k).then((answer) => {
						resolve(answer.complete);
					}));
				} else {
					this.breakpoints.set(index, k);
				}
			});
			Promise.all(promises).then(resolve, reject);
		});
	}

	async getThreadsHandler(answer: XSDBAnswer) : Promise<Thread[]> {
		const threads = answer.value as XSDBTargets;
		let ret: Thread[] = [];
		this.availableTargets = new Map();
		ret = threads.targets.map(element => {
			const ret: Thread = {
				id: element.target,
				targetId: element.pos
			};

			this.availableTargets.set(element.target, element);
			const name = element.targetName + (element.pos ? '[' + element.pos + ']' : '');
			ret.name = name;
			return ret;
		});
		return ret;
	}

	async getThreads(): Promise<Thread[]> {
		if (trace) this.log("stderr", "getThreads");
		this.log("stdout", "Get threads called");
		if (this.handlers[XSDBMode.ListingTarget] != this.noHandler) {
			// Something already called this function asynchronously, so let's chain the answer instead of repeating it.
			const prevHandler = this.handlers[XSDBMode.ListingTarget];
			return new Promise((resolve, reject) => {
				this.handlers[XSDBMode.ListingTarget] = (answer: XSDBAnswer) => {
					prevHandler(answer);
					return resolve(this.getThreadsHandler(answer));
				};
			});
		} else {
			const answer = await this.sendCommand("targets" + (this.targetFilter ? " -filter " + this.targetFilter : ""));
			return this.getThreadsHandler(answer);
		}
	}

	async setThread(thread: number, error: any) {
		if (thread != 0 && this.currentTarget != thread) {
			const ret = await this.sendCommand("target " + thread);
			if (!ret.complete) return error;
			this.currentTarget = thread;
		}
		return undefined;
	}

	async getStack(startFrame: number, maxLevels: number, thread: number): Promise<Stack[]> {
		if (trace) this.log("stderr", "getStack");

		const options: string[] = [];

		const threadRet = await this.setThread(thread, []);
		if (threadRet) return threadRet;

		const answer = await this.sendCommand("bt -maxframes " + (maxLevels ? maxLevels : -1));
		if (!answer.complete) return [];
		const frames = answer.value as XSDBBackTraces;
		const highBand = Math.min(frames.frame.length, maxLevels);
		if (startFrame > frames.frame.length) return [];


		let stack = [];
		for (let i = startFrame; i < highBand; i++) {
			let filepath = {file: "<unknown>", line: frames.frame[i].line, func: frames.frame[i].func};
			if (frames.frame[i].file) {
				let fp = await this.findSourceFile(path.normalize(frames.frame[i].file), frames.frame[i].address);	
				filepath.file = fp.file;
				if (fp.line) filepath.line = fp.line;
				if (fp.func) filepath.func = fp.func;
			}
			stack.push({
				address: frames.frame[i].address,
				fileName: path.basename(filepath.file),
				file: filepath.file,
				function: filepath.func,
				level: frames.frame[i].index,
				line: filepath.line
			});
		}
		this.log("stdout", "Stack: " + stack.map(v => JSON.stringify(v)).join('\n'));
		return stack;
	}

	parseLocalValue(value: string) : any {
		const isNumber = /^(:?NaN|-?((\d*\.\d+|\d+|\d+.)([Ee][+-]?\d+)?|Infinity) *)+$/gm;
		if (isNumber.exec(value))
		{
			if (value.includes(" "))
				return value.split(' ').map(v => parseFloat(v));
			else return parseFloat(value);
		} 
		else if (value == "N/A" || value.includes("'") || value.includes('"'))
			return value;
		else if (value.startsWith("0x"))
			return parseInt(value, 16);
	}

	async getStackVariables(thread: number, frame: number): Promise<Variable[]> {
		if (trace)
			this.log("stderr", "getStackVariables");

		const threadRet = await this.setThread(thread, []);
		if (threadRet) return threadRet;
	
		const answer = await this.sendCommand("locals");
		this.log("stdout", "Got result: " + JSON.stringify(answer));
		if (!answer.complete || answer.value === null) return [];

		const variables = answer.value as XSDBLocals;
		const ret: Variable[] = [];
		for (const element of variables.variables) {
			let v = this.parseLocalValue(element.value);
			ret.push({
				name: element.name,
				valueStr: JSON.stringify(v),
				type: typeof(v) == "number" ? "number" : "string",
				raw: element
			});
		}
		return ret;
	}

	examineMemory(from: number, length: number): Thenable<any> {
		if (trace)
			this.log("stderr", "examineMemory");
		return new Promise((resolve, reject) => {
			this.sendCommand("mrd 0x" + from.toString(16) + " " + length/4).then((answer) => {
				if (!answer.complete) resolve([])
				resolve((answer.value as XSDBMemory).mem);
			}, reject);
		});
	}

	async evalExpression(name: string, thread: number, frame: number): Promise<XSDBAnswer> {
		if (trace)
			this.log("stderr", "evalExpression");
		return this.sendCommand("print " + name);
	}

	async varCreate(expression: string, name: string = "-", frame: string = "@"): Promise<VariableObject> {
		if (trace)
			this.log("stderr", "varCreate");
		return Promise.reject("Not supported");
	}

	async varEvalExpression(name: string): Promise<XSDBAnswer> {
		if (trace)
			this.log("stderr", "varEvalExpression");
		return Promise.reject("Not supported");
	}

	async varListChildren(name: string): Promise<VariableObject[]> {
		if (trace)
			this.log("stderr", "varListChildren");
		return Promise.reject("Not supported");
	}

	async varUpdate(name: string = "*"): Promise<XSDBLine> {
		if (trace)
			this.log("stderr", "varUpdate");
		return Promise.reject("Not supported");
	}

	async varAssign(name: string, rawValue: string): Promise<XSDBAnswer> {
		if (trace)
			this.log("stderr", "varAssign");
		return this.sendCommand(`locals ${this.quote(name)} ${rawValue}`);
	}

	logNoNewLine(type: string, msg: string) {
		this.emit("msg", type, msg);
	}

	log(type: string, msg: string) {
		this.emit("msg", type, msg[msg.length - 1] == '\n' ? msg : (msg + "\n"));
	}

	sendUserInput(command: string, threadId: number = 0, frameLevel: number = 0): Thenable<XSDBAnswer> {
		if (this.currentTarget != threadId && this.availableTargets.size) {
			return this.sendCommand("target " + threadId).then((answer:XSDBAnswer) => {
				if (answer.mode == XSDBMode.Error) return undefined;
				this.currentTarget = threadId;
				return this.sendCommand(command, true, XSDBMode.Waiting);
			});
		} else return this.sendCommand(command, true, XSDBMode.Waiting);
	}

	sendRaw(raw: string) {
		if (this.printCalls)
			this.log("log", raw);
		
		this.process.stdin.write(raw + "\n");
	}

	noHandler(answer: XSDBAnswer) {}

	sendCommand(command: string, suppressFailure: boolean = false, forceMode: number = -1): Thenable<XSDBAnswer> {
		const cmd = command.split(' ')[0];
		switch(cmd)
		{
		case "connect": this.mode = XSDBMode.WaitingForValue; break;
		case "targets": this.mode = XSDBMode.ListingTarget; break;
		case "target" : this.mode = XSDBMode.Waiting; break;
		case "bplist" : this.mode = XSDBMode.ListingBreakpoints; break;
		case "bpadd"  : this.mode = XSDBMode.AddingBreakpoint; break;
		case "bt"     : this.mode = XSDBMode.ListingBacktrace; break;
		case "rrd"    : this.mode = XSDBMode.ListingRegister; break;
		case "mrd"    : this.mode = XSDBMode.ListingMemory; break;
		case "locals" : this.mode = command.length > cmd.length + 2 ? XSDBMode.Waiting : XSDBMode.ListingLocals; break; // Can be used to set variables too 
		case "print"  : this.mode = XSDBMode.ListingLocals; break;
		case "dis"    : this.mode = XSDBMode.ListingDisassembly; break;
		
		case "con"    : 
		case "stop"   :
		case "stp"    :
		case "stpi"   :
		case "stpout" :
		case "nxt"    :
		case "nxti"   :
		case "bpremove" : 
		default:
			this.mode = XSDBMode.Waiting; break;
		}
		if (forceMode !== -1) this.mode = forceMode;
		this.log("stdout", "Sending command ("+XSDBMode[this.mode]+") type>"+cmd+"< =>"+command);
		return new Promise((resolve, reject) => {
			this.handlers[this.mode] = (answer: XSDBAnswer) => {
				this.log("stdout", "Handler for " + this.mode + ": " + JSON.stringify(answer));
				this.handlers[this.mode] = this.noHandler;
				this.mode = XSDBMode.Waiting;
				if (answer && answer.mode == XSDBMode.Error) {
					if (suppressFailure) {
						this.log("stderr", `WARNING: Error executing command '${command}'`);
						resolve(answer);
					} else {
						this.log("stderr", "Rejecting for command >"+command+"< " + JSON.stringify(answer));
						reject(new MIError((answer.value as XSDBError).message || "Internal error", command));
					}
				} else
					resolve(answer);
			};
			this.sendRaw(command);
		});
	}

	isReady(): boolean {
		return !!this.process && this.mode != XSDBMode.Banner;
	}

	protected quote(text: string): string {
		// only escape if text contains non-word or non-path characters such as whitespace or quotes
		return /^-|[^\w\d\/_\-\.]/g.test(text) ? ('"' + escape(text) + '"') : text;
	}

	prettyPrint: boolean = true;
	printCalls: boolean;
	debugOutput: boolean;
	features: string[];
	public procEnv: any;
	protected mode: XSDBMode;
	protected currentToken: number = 1;
	protected handlers: { [type: number]: (answer: XSDBAnswer) => any } = {};
	protected breakpoints: Map<Breakpoint, Number> = new Map();
	protected buffer: string;
	protected errbuf: string;
	protected process: ChildProcess.ChildProcess;
	protected stream;
	protected targetFilter: string;
	protected protoLines: XSDBLine[];
	protected availableTargets: Map<number, XSDBTargetItem> = new Map();
	protected currentTarget: number;
	protected targetDir: string;
	protected symbolMapper: string;
}
