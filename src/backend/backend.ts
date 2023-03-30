import { XSDBLine } from "./xsdbp_parse";
import { DebugProtocol } from "@vscode/debugprotocol/lib/debugProtocol";

export type ValuesFormattingMode = "disabled" | "parseText" | "prettyPrinters";

export interface Breakpoint {
    file?: string;
    line?: number;
    raw?: string;
    condition: string;
    countCondition?: string;
}

export interface Thread {
    id: number;
    targetId: string;
    name?: string;
}

export interface Stack {
    level: number;
    address: string;
    function: string;
    fileName: string;
    file: string;
    line: number;
}

export interface Variable {
    name: string;
    valueStr: string;
    type: string;
    raw?: any;
    address?: number;
    size?: number;
    flags?: string;
}

export interface IBackend {
    load(cwd: string, target: string, procArgs: string, separateConsole: string, autorun: string[], filterType: string, symbol_mapper: string): Thenable<any>;
    connect(cwd: string, executable: string, target: string, autorun: string[]): Thenable<any>;
    start(runToStart: boolean): Thenable<boolean>;
    stop();
    detach();
    interrupt(): Thenable<boolean>;
    continue(): Thenable<boolean>;
    next(): Thenable<boolean>;
    step(): Thenable<boolean>;
    stepOut(): Thenable<boolean>;
    loadBreakPoints(breakpoints: Breakpoint[]): Thenable<[boolean, Breakpoint][]>;
    addBreakPoint(breakpoint: Breakpoint): Thenable<[boolean, Breakpoint]>;
    removeBreakPoint(breakpoint: Breakpoint): Thenable<boolean>;
    clearBreakPoints(source?: string): Thenable<any>;
    getThreads(): Thenable<Thread[]>;
    getStack(startFrame: number, maxLevels: number, thread: number): Thenable<Stack[]>;
    getStackVariables(thread: number, frame: number): Thenable<Variable[]>;
    evalExpression(name: string, thread: number, frame: number): Thenable<any>;
    isReady(): boolean;
    changeVariable(name: string, rawValue: string): Thenable<any>;
    examineMemory(from: number, to: number): Thenable<any>;
}

export class VariableObject {
    name: string;
    exp: string;
    numchild: number;
    type: string;
    value: string;
    threadId: string;
    frozen: boolean;
    dynamic: boolean;
    displayhint: string;
    hasMore: boolean;
    id: number;
    constructor(node: any) {
        this.name = XSDBLine.valueOf(node, "name");
        this.exp = XSDBLine.valueOf(node, "exp");
        this.numchild = parseInt(XSDBLine.valueOf(node, "numchild"));
        this.type = XSDBLine.valueOf(node, "type");
        this.value = XSDBLine.valueOf(node, "value");
        this.threadId = XSDBLine.valueOf(node, "thread-id");
        this.frozen = !!XSDBLine.valueOf(node, "frozen");
        this.dynamic = !!XSDBLine.valueOf(node, "dynamic");
        this.displayhint = XSDBLine.valueOf(node, "displayhint");
        // TODO: use has_more when it's > 0
        this.hasMore = !!XSDBLine.valueOf(node, "has_more");
    }

    public applyChanges(node: XSDBLine) {
        this.value = XSDBLine.valueOf(node, "value");
        if (XSDBLine.valueOf(node, "type_changed")) {
            this.type = XSDBLine.valueOf(node, "new_type");
        }
        this.dynamic = !!XSDBLine.valueOf(node, "dynamic");
        this.displayhint = XSDBLine.valueOf(node, "displayhint");
        this.hasMore = !!XSDBLine.valueOf(node, "has_more");
    }

    public isCompound(): boolean {
        return this.numchild > 0 ||
            this.value === "{...}" ||
            (this.dynamic && (this.displayhint === "array" || this.displayhint === "map"));
    }

    public toProtocolVariable(): DebugProtocol.Variable {
        const res: DebugProtocol.Variable = {
            name: this.exp,
            evaluateName: this.name,
            value: (this.value === void 0) ? "<unknown>" : this.value,
            type: this.type,
            variablesReference: this.id
        };
        return res;
    }
}

// from https://gist.github.com/justmoon/15511f92e5216fa2624b#gistcomment-1928632
export interface MIError extends Error {
    readonly name: string;
    readonly message: string;
    readonly source: string;
}
export interface MIErrorConstructor {
    new (message: string, source: string): MIError;
    readonly prototype: MIError;
}

export const MIError: MIErrorConstructor = <any> class MIError {
    readonly name: string;
    readonly message: string;
    readonly source: string;
    public constructor(message: string, source: string) {
        Object.defineProperty(this, 'name', {
            get: () => (this.constructor as any).name,
        });
        Object.defineProperty(this, 'message', {
            get: () => message,
        });
        Object.defineProperty(this, 'source', {
            get: () => source,
        });
        Error.captureStackTrace(this, this.constructor);
    }

    public toString() {
        return `${this.message} (from ${this.source})`;
    }
};
Object.setPrototypeOf(MIError as any, Object.create(Error.prototype));
MIError.prototype.constructor = MIError;
