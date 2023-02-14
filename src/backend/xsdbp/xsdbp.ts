import { Breakpoint, IBackend, Thread, Stack, Variable, VariableObject, MIError } from "../backend";
import * as ChildProcess from "child_process";
import { EventEmitter } from "events";
import { parseXSDBP, XSDBLine, XSDBMode, XSDBAnswer } from '../xsdbp_parse';
import * as linuxTerm from '../linux/console';
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { Client } from "ssh2";

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
	}

	load(cwd: string, target: string, procArgs: string, separateConsole: string, autorun: string[], targetFilter: string): Thenable<any> {
		if (!path.isAbsolute(target))
			target = path.join(cwd, target);
		return new Promise((resolve, reject) => {
			const args = this.preargs.concat(this.extraargs || []);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.mode = XSDBMode.Banner;
			this.targetFilter = targetFilter;
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			const promises = this.initCommands(target, cwd);
			if (procArgs && procArgs.length)
				promises.push(this.sendCommand("exec-arguments " + procArgs));
			if (process.platform == "win32") {
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
						promises.push(this.sendCommand("inferior-tty-set " + tty));
						promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
						Promise.all(promises).then(() => {
							this.emit("debug-ready");
							resolve(undefined);
						}, reject);
					});
				} else {
					promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
					Promise.all(promises).then(() => {
						this.emit("debug-ready");
						resolve(undefined);
					}, reject);
				}
			}
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
			this.sendCommand("connect", true),
			this.sendCommand("environment-directory \"" + escape(cwd) + "\"", true)
		];
		for (const cmd of this.extraCommands) {
			cmds.push(this.sendCommand(cmd));
		}

		return cmds;
	}

	attach(cwd: string, executable: string, target: string, autorun: string[]): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = [];
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
		});
	}

	connect(cwd: string, executable: string, target: string, autorun: string[]): Thenable<any> {
		return new Promise((resolve, reject) => {
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
		if (end != -1) {
			this.onOutput(this.buffer.substring(0, end));
			this.buffer = this.buffer.substring(end + 1);
		}
		if (this.buffer.length) {
			if (this.onOutputPartial(this.buffer)) {
				this.buffer = "";
			}
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

	onOutputPartial(line) {
		if (couldBeOutput(line)) {
			this.logNoNewLine("stdout", line);
			return true;
		}
		return false;
	}

	onOutput(lines) {
		lines = <string[]> lines.split('\n');
		lines.forEach(line => {
			switch(this.mode) {
				case XSDBMode.Banner:
					if (!xsdbMatch.exec(line))
						this.log("stdout", line);
					this.mode = XSDBMode.Waiting;
					break;
				case XSDBMode.Waiting:
					if (couldBeOutput(line)) {
						if (!xsdbMatch.exec(line))
							this.log("stdout", line);
					} else {
						const parsed = parseXSDBP(line, this.mode);
						if (this.debugOutput)
							this.log("log", "XSDB -> App: " + JSON.stringify(parsed));
						if (parsed.resultRecords && parsed.resultRecords[0].key == "Error") {
							this.log("stderr", parsed.result("msg") || line);
						}
						if (parsed.outOfBandRecord) {
							const record = parsed.outOfBandRecord;
							if (record.running) {
								if (record.status == "Disabled") this.emit("exited-normally", parsed);
								else this.emit("running", parsed);
							}
							else this.emit("breakpoint", parsed);

							/*
									if (record.type == "exec") {
										this.emit("exec-async-output", parsed);
										if (record.asyncClass == "running")
											this.emit("running", parsed);
										else if (record.asyncClass == "stopped") {
											const reason = parsed.record("reason");
											if (reason === undefined) {
												if (trace)
													this.log("stderr", "stop (no reason given)");
												// attaching to a process stops, but does not provide a reason
												// also python generated interrupt seems to only produce this
												this.emit("step-other", parsed);
											} else {
												if (trace)
													this.log("stderr", "stop: " + reason);
												switch (reason) {
													case "breakpoint-hit":
														this.emit("breakpoint", parsed);
														break;
													case "watchpoint-trigger":
													case "read-watchpoint-trigger":
													case "access-watchpoint-trigger":
														this.emit("watchpoint", parsed);
														break;
													case "function-finished":
													// identical result → send step-end
													// this.emit("step-out-end", parsed);
													// break;
													case "location-reached":
													case "end-stepping-range":
														this.emit("step-end", parsed);
														break;
													case "watchpoint-scope":
													case "solib-event":
													case "syscall-entry":
													case "syscall-return":
													// TODO: inform the user
														this.emit("step-end", parsed);
														break;
													case "fork":
													case "vfork":
													case "exec":
													// TODO: inform the user, possibly add second inferior
														this.emit("step-end", parsed);
														break;
													case "signal-received":
														this.emit("signal-stop", parsed);
														break;
													case "exited-normally":
														this.emit("exited-normally", parsed);
														break;
													case "exited": // exit with error code != 0
														this.log("stderr", "Program exited with code " + parsed.record("exit-code"));
														this.emit("exited-normally", parsed);
														break;
														// case "exited-signalled":	// consider handling that explicit possible
														// 	this.log("stderr", "Program exited because of signal " + parsed.record("signal"));
														// 	this.emit("stopped", parsed);
														// 	break;
		
													default:
														this.log("console", "Not implemented stop reason (assuming exception): " + reason);
														this.emit("stopped", parsed);
														break;
												}
											}
										} else
											this.log("log", JSON.stringify(parsed));
									} else if (record.type == "notify") {
										if (record.asyncClass == "thread-created") {
											this.emit("thread-created", parsed);
										} else if (record.asyncClass == "thread-exited") {
											this.emit("thread-exited", parsed);
										}
									}
								}
							});
							*/
						}
					}
				
					break;
				case XSDBMode.WaitingForValue:
					break;
				case XSDBMode.AddingBreakpoint:
					break;
				case XSDBMode.ListingTarget:
					break;
				case XSDBMode.ListingRegister:
					break;
				case XSDBMode.ListingBacktrace:
					break;
				case XSDBMode.ListingBreakpoints:
					break;
				case XSDBMode.ListingDisassembly:
					break;
				case XSDBMode.ListingLocals:
					break;
				case XSDBMode.ListingMemory:
					break;
			}
		});
	}

	start(runToStart: boolean): Thenable<boolean> {
		const options: string[] = [];
		if (runToStart)
			options.push("--start");
		const startCommand: string = ["exec-run"].concat(options).join(" ");
		return new Promise((resolve, reject) => {
			this.log("console", "Running executable");
			this.sendCommand(startCommand).then((info) => {
				if (info.resultRecords.resultClass == "running")
					resolve(undefined);
				else
					reject();
			}, reject);
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
		this.sendRaw("disconnect");
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
			this.sendCommand("exec-interrupt").then((info) => {
				resolve(info.resultRecords.resultClass == "done");
			}, reject);
		});
	}

	continue(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "continue");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-continue" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	next(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "next");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-next" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	step(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "step");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-step" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	stepOut(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "stepOut");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-finish" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	goto(filename: string, line: number): Thenable<Boolean> {
		if (trace)
			this.log("stderr", "goto");
		return new Promise((resolve, reject) => {
			const target: string = '"' + (filename ? escape(filename) + ":" : "") + line + '"';
			this.sendCommand("break-insert -t " + target).then(() => {
				this.sendCommand("exec-jump " + target).then((info) => {
					resolve(info.resultRecords.resultClass == "running");
				}, reject);
			}, reject);
		});
	}

	changeVariable(name: string, rawValue: string): Thenable<any> {
		if (trace)
			this.log("stderr", "changeVariable");
		return this.sendCommand("gdb-set var " + name + "=" + rawValue);
	}

	loadBreakPoints(breakpoints: Breakpoint[]): Thenable<[boolean, Breakpoint][]> {
		if (trace)
			this.log("stderr", "loadBreakPoints");
		const promisses = [];
		breakpoints.forEach(breakpoint => {
			promisses.push(this.addBreakPoint(breakpoint));
		});
		return Promise.all(promisses);
	}

	setBreakPointCondition(bkptNum, condition): Thenable<any> {
		if (trace)
			this.log("stderr", "setBreakPointCondition");
		return this.sendCommand("break-condition " + bkptNum + " " + condition);
	}

	setEntryBreakPoint(entryPoint: string): Thenable<any> {
		return this.sendCommand("break-insert -t -f " + entryPoint);
	}

	addBreakPoint(breakpoint: Breakpoint): Thenable<[boolean, Breakpoint]> {
		if (trace)
			this.log("stderr", "addBreakPoint");
		return new Promise((resolve, reject) => {
			if (this.breakpoints.has(breakpoint))
				return resolve([false, undefined]);
			let location = "";
			if (breakpoint.countCondition) {
				if (breakpoint.countCondition[0] == ">")
					location += "-i " + numRegex.exec(breakpoint.countCondition.substring(1))[0] + " ";
				else {
					const match = numRegex.exec(breakpoint.countCondition)[0];
					if (match.length != breakpoint.countCondition.length) {
						this.log("stderr", "Unsupported break count expression: '" + breakpoint.countCondition + "'. Only supports 'X' for breaking once after X times or '>X' for ignoring the first X breaks");
						location += "-t ";
					} else if (parseInt(match) != 0)
						location += "-t -i " + parseInt(match) + " ";
				}
			}
			if (breakpoint.raw)
				location += '"' + escape(breakpoint.raw) + '"';
			else
				location += '"' + escape(breakpoint.file) + ":" + breakpoint.line + '"';
			this.sendCommand("break-insert -f " + location).then((result) => {
				if (result.resultRecords.resultClass == "done") {
					const bkptNum = parseInt(result.result("bkpt.number"));
					const newBrk = {
						file: breakpoint.file ? breakpoint.file : result.result("bkpt.file"),
						raw: breakpoint.raw,
						line: parseInt(result.result("bkpt.line")),
						condition: breakpoint.condition
					};
					if (breakpoint.condition) {
						this.setBreakPointCondition(bkptNum, breakpoint.condition).then((result) => {
							if (result.resultRecords.resultClass == "done") {
								this.breakpoints.set(newBrk, bkptNum);
								resolve([true, newBrk]);
							} else {
								resolve([false, undefined]);
							}
						}, reject);
					} else {
						this.breakpoints.set(newBrk, bkptNum);
						resolve([true, newBrk]);
					}
				} else {
					reject(result);
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
			this.sendCommand("break-delete " + this.breakpoints.get(breakpoint)).then((result) => {
				if (result.resultRecords.resultClass == "done") {
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
					promises.push(this.sendCommand("bpremove " + k).then((result) => {
						if (result.resultRecords.key == "Error") resolve(false);
						else resolve(true);
					}));
				} else {
					this.breakpoints.set(index, k);
				}
			});
			Promise.all(promises).then(resolve, reject);
		});
	}

	async getThreads(): Promise<Thread[]> {
		if (trace) this.log("stderr", "getThreads");

		const result = await this.sendCommand("targets" + (this.targetFilter ? " -filter " + this.targetFilter : ""));
		const threads = result.result("threads");
		const ret: Thread[] = [];
		return threads.map(element => {
			const ret: Thread = {
				id: parseInt(XSDBLine.valueOf(element, "id")),
				targetId: XSDBLine.valueOf(element, "target-id")
			};

			ret.name = XSDBLine.valueOf(element, "details")
				|| undefined;

			return ret;
		});
	}

	async getStack(startFrame: number, maxLevels: number, thread: number): Promise<Stack[]> {
		if (trace) this.log("stderr", "getStack");

		const options: string[] = [];

		if (thread != 0)
			options.push("--thread " + thread);

		const depth: number = (await this.sendCommand(["stack-info-depth"].concat(options).join(" "))).result("depth").valueOf();
		const lowFrame: number = startFrame ? startFrame : 0;
		const highFrame: number = (maxLevels ? Math.min(depth, lowFrame + maxLevels) : depth) - 1;

		if (highFrame < lowFrame)
			return [];

		options.push(lowFrame.toString());
		options.push(highFrame.toString());

		const result = await this.sendCommand(["stack-list-frames"].concat(options).join(" "));
		const stack = result.result("stack");
		return stack.map(element => {
			const level = XSDBLine.valueOf(element, "@frame.level");
			const addr = XSDBLine.valueOf(element, "@frame.addr");
			const func = XSDBLine.valueOf(element, "@frame.func");
			const filename = XSDBLine.valueOf(element, "@frame.file");
			let file: string = XSDBLine.valueOf(element, "@frame.fullname");
			if (file) file = path.normalize(file);

			let line = 0;
			const lnstr = XSDBLine.valueOf(element, "@frame.line");
			if (lnstr)
				line = parseInt(lnstr);
			const from = parseInt(XSDBLine.valueOf(element, "@frame.from"));
			return {
				address: addr,
				fileName: filename,
				file: file,
				function: func || from,
				level: level,
				line: line
			};
		});
	}

	async getStackVariables(thread: number, frame: number): Promise<Variable[]> {
		if (trace)
			this.log("stderr", "getStackVariables");

		const result = await this.sendCommand(`stack-list-variables --thread ${thread} --frame ${frame} --simple-values`);
		const variables = result.result("variables");
		const ret: Variable[] = [];
		for (const element of variables) {
			const key = XSDBLine.valueOf(element, "name");
			const value = XSDBLine.valueOf(element, "value");
			const type = XSDBLine.valueOf(element, "type");
			ret.push({
				name: key,
				valueStr: value,
				type: type,
				raw: element
			});
		}
		return ret;
	}

	examineMemory(from: number, length: number): Thenable<any> {
		if (trace)
			this.log("stderr", "examineMemory");
		return new Promise((resolve, reject) => {
			this.sendCommand("data-read-memory-bytes 0x" + from.toString(16) + " " + length).then((result) => {
				resolve(result.result("memory[0].contents"));
			}, reject);
		});
	}

	async evalExpression(name: string, thread: number, frame: number): Promise<XSDBLine> {
		if (trace)
			this.log("stderr", "evalExpression");

		let command = "data-evaluate-expression ";
		if (thread != 0) {
			command += `--thread ${thread} --frame ${frame} `;
		}
		command += name;

		return await this.sendCommand(command);
	}

	async varCreate(expression: string, name: string = "-", frame: string = "@"): Promise<VariableObject> {
		if (trace)
			this.log("stderr", "varCreate");
		const res = await this.sendCommand(`var-create ${this.quote(name)} ${frame} "${expression}"`);
		return new VariableObject(res.result(""));
	}

	async varEvalExpression(name: string): Promise<XSDBLine> {
		if (trace)
			this.log("stderr", "varEvalExpression");
		return this.sendCommand(`var-evaluate-expression ${this.quote(name)}`);
	}

	async varListChildren(name: string): Promise<VariableObject[]> {
		if (trace)
			this.log("stderr", "varListChildren");
		//TODO: add `from` and `to` arguments
		const res = await this.sendCommand(`var-list-children --all-values ${this.quote(name)}`);
		const children = res.result("children") || [];
		const omg: VariableObject[] = children.map(child => new VariableObject(child[1]));
		return omg;
	}

	async varUpdate(name: string = "*"): Promise<XSDBLine> {
		if (trace)
			this.log("stderr", "varUpdate");
		return this.sendCommand(`var-update --all-values ${this.quote(name)}`);
	}

	async varAssign(name: string, rawValue: string): Promise<XSDBLine> {
		if (trace)
			this.log("stderr", "varAssign");
		return this.sendCommand(`var-assign ${this.quote(name)} ${rawValue}`);
	}

	logNoNewLine(type: string, msg: string) {
		this.emit("msg", type, msg);
	}

	log(type: string, msg: string) {
		this.emit("msg", type, msg[msg.length - 1] == '\n' ? msg : (msg + "\n"));
	}

	sendUserInput(command: string, threadId: number = 0, frameLevel: number = 0): Thenable<XSDBLine> {
		/* @todo Handle thread change here */
		return this.sendCommand(command);
	}

	sendRaw(raw: string) {
		if (this.printCalls)
			this.log("log", raw);
		
		this.process.stdin.write(raw + "\n");
	}

	sendCommand(command: string, suppressFailure: boolean = false): Thenable<XSDBLine> {
		const sel = this.currentToken++;
		return new Promise((resolve, reject) => {
			this.handlers[sel] = (node: XSDBLine) => {
				if (node && node.resultRecords && node.resultRecords[0].key === "Error") {
					if (suppressFailure) {
						this.log("stderr", `WARNING: Error executing command '${command}'`);
						resolve(node);
					} else
						reject(new MIError(node.result("msg") || "Internal error", command));
				} else
					resolve(node);
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
	protected handlers: { [index: number]: (info: XSDBLine) => any } = {};
	protected breakpoints: Map<Breakpoint, Number> = new Map();
	protected buffer: string;
	protected errbuf: string;
	protected process: ChildProcess.ChildProcess;
	protected stream;
	protected targetFilter: string;
}
