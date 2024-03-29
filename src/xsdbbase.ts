import * as DebugAdapter from '@vscode/debugadapter';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, ThreadEvent, OutputEvent, ContinuedEvent, MemoryEvent, Thread, StackFrame, Scope, Source, Handles } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { Breakpoint, IBackend, Variable, VariableObject, ValuesFormattingMode, MIError } from './backend/backend';
import { XSDBAnswer, XSDBTargets, XSDBLine, XSDBMode, XSDBLocals, XSDBDisassembly, XSDBMemory } from './backend/xsdbp_parse';
import { expandValue, isExpandable } from './backend/gdb_expansion';
import { XMI_XSDB } from './backend/xsdbp/xsdbp';
import * as systemPath from "path";
import * as net from "net";
import * as os from "os";
import * as fs from "fs";
import { SourceFileMap } from "./source_file_map";

class ExtendedVariable {
    constructor(public name, public options) {
    }
}

class VariableScope {
    constructor (public readonly name: string, public readonly threadId: number, public readonly level: number) {
    }

    public static variableName (handle: number, name: string): string {
        return `var_${handle}_${name}`;
    }
}

export enum RunCommand { CONTINUE, RUN, NONE }

export class XSDBPDebugSession extends DebugSession {
    protected variableHandles = new Handles<VariableScope | string | VariableObject | ExtendedVariable>();
    protected variableHandlesReverse: { [id: string]: number } = {};
    protected scopeHandlesReverse: { [key: string]: number } = {};
    protected useVarObjects: boolean;
    protected quit: boolean;
    protected attached: boolean;
    protected initialRunCommand: RunCommand;
    protected stopAtEntry: boolean | string;
    protected sourceFileMap: SourceFileMap;
    protected started: boolean;
    protected crashed: boolean;
    protected xsdbDebugger: XMI_XSDB;
    protected commandServer: net.Server;
    protected serverPath: string;

    public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
        super(debuggerLinesStartAt1, isServer);
    }

    protected initDebugger() {
        this.xsdbDebugger.on("launcherror", this.launchError.bind(this));
        this.xsdbDebugger.on("quit", this.quitEvent.bind(this));
        this.xsdbDebugger.on("exited-normally", this.quitEvent.bind(this));
        this.xsdbDebugger.on("stopped", this.stopEvent.bind(this));
        this.xsdbDebugger.on("msg", this.handleMsg.bind(this));
        this.xsdbDebugger.on("breakpoint", this.handleBreakpoint.bind(this));
        this.xsdbDebugger.on("watchpoint", this.handleBreak.bind(this));    // consider to parse old/new, too (otherwise it is in the console only)
        this.xsdbDebugger.on("step-end", this.handleBreak.bind(this));
        //this.xsdbDebugger.on("step-out-end", this.handleBreak.bind(this));  // was combined into step-end
        this.xsdbDebugger.on("step-other", this.handleBreak.bind(this));
        this.xsdbDebugger.on("signal-stop", this.handlePause.bind(this));
        this.xsdbDebugger.on("thread-created", this.threadCreatedEvent.bind(this));
        this.xsdbDebugger.on("thread-exited", this.threadExitedEvent.bind(this));
        this.xsdbDebugger.once("debug-ready", (() => this.sendEvent(new InitializedEvent())));
        try {
            this.commandServer = net.createServer(c => {
                c.on("data", data => {
                    const rawCmd = data.toString();
                    const spaceIndex = rawCmd.indexOf(" ");
                    let func = rawCmd;
                    let args = [];
                    if (spaceIndex != -1) {
                        func = rawCmd.substring(0, spaceIndex);
                        args = JSON.parse(rawCmd.substring(spaceIndex + 1));
                    }
                    Promise.resolve(this.xsdbDebugger[func].apply(this.xsdbDebugger, args)).then(data => {
                        c.write(data.toString());
                    });
                });
            });
            this.commandServer.on("error", err => {
                if (process.platform != "win32")
                    this.handleMsg("stderr", "Code-Debug WARNING: Utility Command Server: Error in command socket " + err.toString() + "\nCode-Debug WARNING: The examine memory location command won't work");
            });
            if (!fs.existsSync(systemPath.join(os.tmpdir(), "code-debug-sockets")))
                fs.mkdirSync(systemPath.join(os.tmpdir(), "code-debug-sockets"));
            this.commandServer.listen(this.serverPath = systemPath.join(os.tmpdir(), "code-debug-sockets", ("Debug-Instance-" + Math.floor(Math.random() * 36 * 36 * 36 * 36).toString(36)).toLowerCase()));
        } catch (e) {
            if (process.platform != "win32")
                this.handleMsg("stderr", "Code-Debug WARNING: Utility Command Server: Failed to start " + e.toString() + "\nCode-Debug WARNING: The examine memory location command won't work");
        }
    }

    protected setValuesFormattingMode(mode: ValuesFormattingMode) {
        switch (mode) {
        case "disabled":
            this.useVarObjects = true;
            this.xsdbDebugger.prettyPrint = false;
            break;
        case "prettyPrinters":
            this.useVarObjects = true;
            this.xsdbDebugger.prettyPrint = true;
            break;
        case "parseText":
        default:
            this.useVarObjects = false;
            this.xsdbDebugger.prettyPrint = false;
        }
    }

    protected handleMsg(type: string, msg: string) {
        if (type == "target")
            type = "stdout";
        if (type == "log")
            type = "stderr";
        this.sendEvent(new OutputEvent(msg, type));
    }

    protected handleBreakpoint(answer: XSDBAnswer) {
        const event = new StoppedEvent("breakpoint", answer.interrupt.target);
        (event as DebugProtocol.StoppedEvent).body.allThreadsStopped = false;
        this.sendEvent(event);
    }

    protected handleBreak(answer?: XSDBAnswer) {
        const event = new StoppedEvent("step", answer ? answer.interrupt.target : 1);
        (event as DebugProtocol.StoppedEvent).body.allThreadsStopped = false;
        this.sendEvent(event);
    }

    protected handlePause(answer: XSDBAnswer) {
        const event = new StoppedEvent("user request", answer.interrupt.target);
        (event as DebugProtocol.StoppedEvent).body.allThreadsStopped = false;
        this.sendEvent(event);
    }

    protected stopEvent(answer: XSDBAnswer) {
        if (!this.started)
            this.crashed = true;
        if (!this.quit) {
            const event = new StoppedEvent("exception", answer.interrupt.target);
            (event as DebugProtocol.StoppedEvent).body.allThreadsStopped = false;
            this.sendEvent(event);
        }
    }

    protected threadCreatedEvent(info: XSDBAnswer) {
        this.sendEvent(new ThreadEvent("started", info.value ? (info.value as XSDBTargets).targets[0].target : 0));
    }

    protected threadExitedEvent(info: XSDBAnswer) {
        this.sendEvent(new ThreadEvent("exited", info.value ? (info.value as XSDBTargets).targets[0].target : 0));
    }

    protected quitEvent() {
        this.quit = true;
        this.sendEvent(new TerminatedEvent());

        if (this.serverPath)
            fs.unlink(this.serverPath, (err) => {
                // eslint-disable-next-line no-console
                console.error("Failed to unlink debug server");
            });
    }

    protected launchError(err: any) {
        this.handleMsg("stderr", "Could not start debugger process, does the program exist in filesystem?\n");
        this.handleMsg("stderr", err.toString() + "\n");
        this.quitEvent();
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        if (this.attached)
            this.xsdbDebugger.detach();
        else
            this.xsdbDebugger.stop();
        this.commandServer.close();
        this.commandServer = undefined;
        this.sendResponse(response);
    }

    protected async readMemoryRequest(response: DebugProtocol.ReadMemoryResponse, args: DebugProtocol.ReadMemoryArguments): Promise<void> {
        this.sendEvent(new OutputEvent("Received read memory request: " + JSON.stringify(args), "stderr"));

        let start = 0;
        if (args.memoryReference.startsWith("0x")) start = parseInt(args.memoryReference, 16);
        else if (/^\d+$/.exec(args.memoryReference)) start = parseInt(args.memoryReference);
        else {
            // Need to get the address of the given variable
            const answer = await this.xsdbDebugger.sendCommand("&" + args.memoryReference);
            if (answer.complete) start = parseInt((answer.value as XSDBLocals).variables[0].value);
        }

        if (args.count == 0) {
            response.body = {
                address: (start + args.offset).toString(),
                data: "",
            };

            return this.sendResponse(response);
        }


        this.xsdbDebugger.examineMemory(start + args.offset, args.count).then(mem => {
            const data = new Uint8Array(mem.length * 4);
            for (let i = 0; i < mem.length; i++) {
                const m = mem[i];
                data[i * 4 + 0] = m.value >> 24;
                data[i * 4 + 1] = (m.value >> 16) & 0xFF;
                data[i * 4 + 2] = (m.value >> 8) & 0xFF;
                data[i * 4 + 3] = (m.value & 0xFF);
            }

            response.body = {
                address: mem[0].address,
                data: Buffer.from(data).toString('base64'),
            };
            this.sendResponse(response);
        }, err => {
            this.sendErrorResponse(response, 12, `Failed to read memory: ${err.toString()}`);
        });

    }

    protected async disassembleRequest(response: DebugProtocol.DisassembleResponse, args: DebugProtocol.DisassembleArguments): Promise<void> {
        this.sendEvent(new OutputEvent("Received disassemble request: " + JSON.stringify(args), "stderr"));

        try {
            let start = 0;
            if (typeof(args.memoryReference) == "number") start = args.memoryReference;
            else if (args.memoryReference.substring(0, 2) == "0x") start = parseInt(args.memoryReference, 16);
            else if (/^\d+$/.exec(args.memoryReference)) start = parseInt(args.memoryReference);
            else {
                // Need to get the address of the given variable
                const answer = await this.xsdbDebugger.sendCommand("&" + args.memoryReference);
                if (answer.complete) start = parseInt((answer.value as XSDBLocals).variables[0].value);
            }

            this.sendEvent(new OutputEvent("start position: " + start, "stderr"));
            this.xsdbDebugger.getDisassembly(start).then(answer => {
                if (!answer.complete) return this.sendResponse(response);
                // We need to format the output, since VSCode doesn't do that and we can't just use the terminal output from XSDB here
                // it's way too large.
                const disas = (answer.value as XSDBDisassembly).mem;
                const shrinkDump = /0x([A-Fa-f0-9]{2}) */g;
                const maxLength = disas.reduce((l, v) => { return Math.max(v.program.replace(shrinkDump, "$1 ").trim().length, l); }, 0);
                const maxCols = disas.reduce((l, v) => { return Math.max(v.value.split(';').length, l); }, 0);
                const colsSize = new Array(maxCols).fill(0);
                for (const lines of disas) {
                    const cols = lines.value.split(';').map(v => v.trim().length);
                    for(let i = 0; i < cols.length; i++) {
                        if (colsSize[i] < cols[i]) colsSize[i] = cols[i];
                    }
                }

                const instructions = disas.map(v => {
                    return {
                        address : '0x' + v.address.toString(16),
                        instructionBytes: v.program.replace(shrinkDump, "$1 ").trim().padEnd(maxLength),
                        instruction: v.value.split(';').map((v, i) => v.trim().padEnd(colsSize[i])).join(' | ')
                    }; });

                response.body = {
                    instructions: instructions
                };
                this.sendResponse(response);
            }, err => {
                this.sendErrorResponse(response, 12, `Failed to disassemble memory: ${err.toString()}`);
            });
        } catch(e) {
            this.xsdbDebugger.log("stderr", e.stack);
        }

    }


    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
        try {
            if (this.useVarObjects) {
                let name = args.name;
                const parent = this.variableHandles.get(args.variablesReference);
                if (parent instanceof VariableScope) {
                    name = VariableScope.variableName(args.variablesReference, name);
                } else if (parent instanceof VariableObject) {
                    name = `${parent.name}.${name}`;
                }

                const res = await this.xsdbDebugger.varAssign(name, args.value);
                response.body = {
                    value: res.complete ? args.value : "error"
                };
            } else {
                await this.xsdbDebugger.changeVariable(args.name, args.value);
                response.body = {
                    value: args.value
                };
            }
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, 11, `Could not continue: ${err}`);
        }
    }

    protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): void {
        const all = [];
        args.breakpoints.forEach(brk => {
            all.push(this.xsdbDebugger.addBreakPoint({ raw: brk.name, condition: brk.condition, countCondition: brk.hitCondition }));
        });
        Promise.all(all).then(brkpoints => {
            const finalBrks = [];
            brkpoints.forEach(brkp => {
                if (brkp[0])
                    finalBrks.push({ line: brkp[1].line });
            });
            response.body = {
                breakpoints: finalBrks
            };
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 10, msg.toString());
        });
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        const path = args.source.path;
        this.xsdbDebugger.clearBreakPoints(path).then(() => {
            const all = args.breakpoints.map(brk => {
                return this.xsdbDebugger.addBreakPoint({ file: path, line: brk.line, condition: brk.condition, countCondition: brk.hitCondition });
            });
            Promise.all(all).then(brkpoints => {
                const finalBrks = [];
                brkpoints.forEach(brkp => {
                    // TODO: Currently all breakpoints returned are marked as verified,
                    // which leads to verified breakpoints on a broken lldb.
                    if (brkp[0])
                        finalBrks.push(new DebugAdapter.Breakpoint(true, brkp[1].line));
                });
                response.body = {
                    breakpoints: finalBrks
                };
                this.sendResponse(response);
            }, msg => {
                this.sendErrorResponse(response, 9, msg.toString());
            });
        }, msg => {
            this.sendErrorResponse(response, 9, msg.toString());
        });
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        if (!this.xsdbDebugger) {
            this.sendResponse(response);
            return;
        }
        this.xsdbDebugger.getThreads().then(threads => {
            response.body = {
                threads: []
            };
            for (const thread of threads) {
                const threadName = thread.name || thread.targetId || "<unnamed>";
                response.body.threads.push(new Thread(thread.id, thread.id + ":" + threadName));
            }
            this.sendResponse(response);
        }).catch(error => {
            this.sendErrorResponse(response, 17, `Could not get threads: ${error}`);
        });
    }

    // Supports 65535 threads.
    protected threadAndLevelToFrameId(threadId: number, level: number) {
        return level << 16 | threadId;
    }
    protected frameIdToThreadAndLevel(frameId: number) {
        return [frameId & 0xffff, frameId >> 16];
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        this.xsdbDebugger.getStack(args.startFrame, args.levels, args.threadId).then(stack => {
            const ret: StackFrame[] = [];
            stack.forEach(element => {
                let source = undefined;
                let path = element.file;
                if (path) {
                    if (process.platform === "win32") {
                        if (path.startsWith("\\cygdrive\\") || path.startsWith("/cygdrive/")) {
                            path = path[10] + ":" + path.substring(11); // replaces /cygdrive/c/foo/bar.txt with c:/foo/bar.txt
                        }
                    }
                    source = new Source(element.fileName, path);
                }

                const sf = new StackFrame(
                    this.threadAndLevelToFrameId(args.threadId, element.level),
                    element.function + "@" + element.address,
                    source,
                    element.line,
                    0);
                sf.instructionPointerReference = element.address;
                ret.push(sf);
            });
            response.body = {
                stackFrames: ret
            };
            this.sendResponse(response);
        }, err => {
            this.sendErrorResponse(response, 12, `Failed to get Stack Trace: ${err.toString()}`);
        });
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        const promises: Thenable<any>[] = [];
        let entryPoint: string | undefined = undefined;
        let runToStart: boolean = false;
        // Setup temporary breakpoint for the entry point if needed.
        switch (this.initialRunCommand) {
        case RunCommand.CONTINUE:
        case RunCommand.NONE:
            if (typeof this.stopAtEntry == 'boolean' && this.stopAtEntry)
                entryPoint = "main"; // sensible default
            else if (typeof this.stopAtEntry == 'string')
                entryPoint = this.stopAtEntry;
            break;
        case RunCommand.RUN:
            if (typeof this.stopAtEntry == 'boolean' && this.stopAtEntry) {
                if (this.xsdbDebugger.features.includes("exec-run-start-option"))
                    runToStart = true;
                else
                    entryPoint = "main"; // sensible fallback
            } else if (typeof this.stopAtEntry == 'string')
                entryPoint = this.stopAtEntry;
            break;
        default:
            throw new Error('Unhandled run command: ' + RunCommand[this.initialRunCommand]);
        }
        if (entryPoint)
            promises.push(this.xsdbDebugger.setEntryBreakPoint(entryPoint));
        switch (this.initialRunCommand) {
        case RunCommand.CONTINUE:
            promises.push(this.xsdbDebugger.continue().then(() => {
                // Some debuggers will provide an out-of-band status that they are stopped
                // when attaching (e.g., gdb), so the client assumes we are stopped and gets
                // confused if we start running again on our own.
                //
                // If we don't send this event, the client may start requesting data (such as
                // stack frames, local variables, etc.) since they believe the target is
                // stopped.  Furthermore, the client may not be indicating the proper status
                // to the user (may indicate stopped when the target is actually running).
                this.sendEvent(new ContinuedEvent(1, true));
            }));
            break;
        case RunCommand.RUN:
            promises.push(this.xsdbDebugger.start(runToStart).then(() => {
                this.started = true;
                if (this.crashed)
                    this.handlePause(undefined);
            }));
            break;
        case RunCommand.NONE: {
            // Not all debuggers seem to provide an out-of-band status that they are stopped
            // when attaching (e.g., lldb), so the client assumes we are running and gets
            // confused when we don't actually run or continue.  Therefore, we'll force a
            // stopped event to be sent to the client (just in case) to synchronize the state.
            const event: DebugProtocol.StoppedEvent = new StoppedEvent("pause", 1);
            event.body.description = "paused on attach";
            event.body.allThreadsStopped = true;
            this.sendEvent(event);
            break;
        }
        default:
            throw new Error('Unhandled run command: ' + RunCommand[this.initialRunCommand]);
        }
        Promise.all(promises).then(() => {
            this.sendResponse(response);
        }).catch(err => {
            this.sendErrorResponse(response, 18, `Could not run/continue: ${err.toString()}`);
        });
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        const scopes = new Array<Scope>();
        const [threadId, level] = this.frameIdToThreadAndLevel(args.frameId);

        const createScope = (scopeName: string, expensive: boolean): Scope => {
            const key: string = scopeName + ":" + threadId + ":" + level;
            let handle: number;

            if (this.scopeHandlesReverse.hasOwnProperty(key)) {
                handle = this.scopeHandlesReverse[key];
            } else {
                handle = this.variableHandles.create(new VariableScope(scopeName, threadId, level));
                this.scopeHandlesReverse[key] = handle;
            }

            return new Scope(scopeName, handle, expensive);
        };

        scopes.push(createScope("Local", false));

        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        const variables: DebugProtocol.Variable[] = [];
        const id: VariableScope | string | VariableObject | ExtendedVariable = this.variableHandles.get(args.variablesReference);

        const createVariable = (arg, options?) => {
            if (options)
                return this.variableHandles.create(new ExtendedVariable(arg, options));
            else
                return this.variableHandles.create(arg);
        };

        const findOrCreateVariable = (varObj: VariableObject): number => {
            let id: number;
            if (this.variableHandlesReverse.hasOwnProperty(varObj.name)) {
                id = this.variableHandlesReverse[varObj.name];
            } else {
                id = createVariable(varObj);
                this.variableHandlesReverse[varObj.name] = id;
            }
            return varObj.isCompound() ? id : 0;
        };

        if (id instanceof VariableScope) {
            let stack: Variable[];
            try {
                stack = await this.xsdbDebugger.getStackVariables(id.threadId, id.level);
                this.sendEvent(new OutputEvent("Variable list: " + JSON.stringify(stack), "stderr"));
                for (const variable of stack) {
                    if (this.useVarObjects) {
                        try {
                            const varObjName = VariableScope.variableName(args.variablesReference, variable.name);
                            let varObj: VariableObject;
                            try {
                                const changes = await this.xsdbDebugger.varUpdate(varObjName);
                                const changelist = changes.result("changelist");
                                changelist.forEach((change) => {
                                    const name = XSDBLine.valueOf(change, "name");
                                    const vId = this.variableHandlesReverse[name];
                                    const v = this.variableHandles.get(vId) as any;
                                    v.applyChanges(change);
                                });
                                const varId = this.variableHandlesReverse[varObjName];
                                varObj = this.variableHandles.get(varId) as any;
                            } catch (err) {
                                if (err instanceof MIError && err.message == "Variable object not found") {
                                    varObj = await this.xsdbDebugger.varCreate(variable.name, varObjName);
                                    const varId = findOrCreateVariable(varObj);
                                    varObj.exp = variable.name;
                                    varObj.id = varId;
                                } else {
                                    throw err;
                                }
                            }
                            variables.push(varObj.toProtocolVariable());
                        } catch (err) {
                            variables.push({
                                name: variable.name,
                                value: `<${err}>`,
                                variablesReference: 0
                            });
                        }
                    } else {
                        if (variable.valueStr !== undefined) {
                            let expanded = expandValue(createVariable, `{${variable.name}=${variable.valueStr}`, "", variable.raw);
                            if (expanded) {
                                if (typeof expanded[0] == "string")
                                    expanded = [
                                        {
                                            name: "<value>",
                                            value: prettyStringArray(expanded),
                                            variablesReference: 0,
                                        }
                                    ];
                                if (variable.address != undefined) {
                                    expanded[0].memoryReference = variable.address != 0 ? '0x' + variable.address.toString(16) : undefined;
                                    expanded[0].type = variable.type;
                                }
                                variables.push(expanded[0]);
                            } else if (variable.name[0] == '@') // Registers
                            {
                                variables.push({
                                    name: variable.name,
                                    value: variable.valueStr,
                                    variablesReference: 0,
                                    memoryReference: '0x' + variable.address.toString(16),
                                    type: variable.type,
                                });
                            }
                        } else
                            variables.push({
                                name: variable.name,
                                type: variable.type,
                                value: "<unknown>",
                                variablesReference: createVariable(variable.name),
                            });
                    }
                }
                response.body = {
                    variables: variables
                };
                this.sendResponse(response);
            } catch (err) {
                this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
            }
        } else if (typeof id == "string") {
            // Variable members
            let variable;
            try {
                // TODO: this evaluates on an (effectively) unknown thread for multithreaded programs.
                variable = await this.xsdbDebugger.evalExpression(JSON.stringify(id), 0, 0);
                try {
                    let expanded = expandValue(createVariable, variable.result("value"), id, variable);
                    if (!expanded) {
                        this.sendErrorResponse(response, 2, `Could not expand variable`);
                    } else {
                        if (typeof expanded[0] == "string")
                            expanded = [
                                {
                                    name: "<value>",
                                    value: prettyStringArray(expanded),
                                    variablesReference: 0
                                }
                            ];
                        response.body = {
                            variables: expanded
                        };
                        this.sendResponse(response);
                    }
                } catch (e) {
                    this.sendErrorResponse(response, 2, `Could not expand variable: ${e}`);
                }
            } catch (err) {
                this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
            }
        } else if (typeof id == "object") {
            if (id instanceof VariableObject) {
                // Variable members
                let children: VariableObject[];
                try {
                    children = await this.xsdbDebugger.varListChildren(id.name);
                    const vars = children.map(child => {
                        const varId = findOrCreateVariable(child);
                        child.id = varId;
                        return child.toProtocolVariable();
                    });

                    response.body = {
                        variables: vars
                    };
                    this.sendResponse(response);
                } catch (err) {
                    this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
                }
            } else if (id instanceof ExtendedVariable) {
                const varReq = id;
                if (varReq.options.arg) {
                    const strArr = [];
                    const submit = () => {
                        response.body = {
                            variables: strArr
                        };
                        this.sendResponse(response);
                    };
                    const addOne = async () => {
                        // TODO: this evaluates on an (effectively) unknown thread for multithreaded programs.
                        this.sendErrorResponse(response, 14, `Could not expand variable: ${id.name}`);
                    };
                    addOne();
                } else
                    this.sendErrorResponse(response, 13, `Unimplemented variable request options: ${JSON.stringify(varReq.options)}`);
            } else {
                response.body = {
                    variables: id
                };
                this.sendResponse(response);
            }
        } else {
            response.body = {
                variables: variables
            };
            this.sendResponse(response);
        }
    }

    protected pauseRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.xsdbDebugger.interrupt().then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 3, `Could not pause: ${msg}`);
        });
    }

    protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments): void {
        this.xsdbDebugger.continue(true).then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
        });
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.xsdbDebugger.continue().then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
        });
    }

    protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
        this.xsdbDebugger.step(true).then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 4, `Could not step back: ${msg} - Try running 'target record-full' before stepping back`);
        });
    }

    protected stepInRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.xsdbDebugger.step().then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 4, `Could not step in: ${msg}`);
        });
    }

    protected stepOutRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.xsdbDebugger.stepOut().then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 5, `Could not step out: ${msg}`);
        });
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.xsdbDebugger.next().then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 6, `Could not step over: ${msg}`);
        });
    }

    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
        const [threadId, level] = this.frameIdToThreadAndLevel(args.frameId);
        if (args.context == "watch" || args.context == "hover") {
            this.xsdbDebugger.evalExpression(args.expression, threadId, level).then(output => {
                const v = output.mode == XSDBMode.ListingLocals ? this.xsdbDebugger.parseLocalValue((output.value as XSDBLocals).variables[0].value) : "";
                response.body = {
                    result: JSON.stringify(v),
                    variablesReference: 0
                };
                this.sendResponse(response);
            }, msg => {
                this.sendErrorResponse(response, 7, "Unsupported feature");
            });
        } else {
            this.xsdbDebugger.sendUserInput(args.expression, threadId, level).then(output => {
                if (typeof output == "undefined")
                    response.body = {
                        result: "",
                        variablesReference: 0
                    };
                else
                    response.body = {
                        result: JSON.stringify(output),
                        variablesReference: 0
                    };
                this.sendResponse(response);
            }, msg => {
                this.sendErrorResponse(response, 8, msg.toString());
            });
        }
    }

    protected gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, args: DebugProtocol.GotoTargetsArguments): void {
        const path: string = args.source.path;
        this.xsdbDebugger.goto(path, args.line).then(done => {
            response.body = {
                targets: [{
                    id: 1,
                    label: args.source.name,
                    column: args.column,
                    line : args.line
                }]
            };
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 16, `Could not jump: ${msg}`);
        });
    }

    protected gotoRequest(response: DebugProtocol.GotoResponse, args: DebugProtocol.GotoArguments): void {
        this.sendResponse(response);
    }

    protected setSourceFileMap(configMap: { [index: string]: string }, fallbackGDB: string, fallbackIDE: string): void {
        if (configMap === undefined) {
            this.sourceFileMap = new SourceFileMap({[fallbackGDB]: fallbackIDE});
        } else {
            this.sourceFileMap = new SourceFileMap(configMap, fallbackGDB);
        }
    }

}

function prettyStringArray(strings) {
    if (typeof strings == "object") {
        if (strings.length !== undefined)
            return strings.join(", ");
        else
            return JSON.stringify(strings);
    } else return strings;
}
