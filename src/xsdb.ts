import { XSDBPDebugSession, RunCommand } from './xsdbbase';
import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { XMI_XSDB, escape } from "./backend/xsdbp/xsdbp";
import { ValuesFormattingMode } from './backend/backend';

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    cwd: string;
    target: string;
    xsdbpath: string;
    env: any;
    debugger_args: string[];
    pathSubstitutions: { [index: string]: string };
    arguments: string;
    terminal: string;
    autorun: string[];
    stopAtEntry: boolean | string;
    valuesFormatting: ValuesFormattingMode;
    printCalls: boolean;
    showDevDebugOutput: boolean;
    xsdb_target_filter: string;
    symbol_mapper: string;
}

class XSDBDebugSession extends XSDBPDebugSession {
    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        this.sendEvent(new OutputEvent("Received init request: " + JSON.stringify(args), "stderr"));
        response.body.supportsGotoTargetsRequest = true;
        response.body.supportsHitConditionalBreakpoints = true;
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsConditionalBreakpoints = false;
        response.body.supportsFunctionBreakpoints = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsSetVariable = true;
        response.body.supportsStepBack = false;
        response.body.supportsReadMemoryRequest = true;
        response.body.supportsWriteMemoryRequest = false;
        response.body.supportsDisassembleRequest = true;
        this.sendResponse(response);
    }

    protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
        this.xsdbDebugger = new XMI_XSDB(args.xsdbpath || args.env["XILINX_VITIS"] + "/bin/xsdb", ["-interactive"], args.debugger_args, args.env);
        this.setPathSubstitutions(args.pathSubstitutions);
        this.initDebugger();
        this.quit = false;
        this.attached = false;
        this.initialRunCommand = RunCommand.RUN;
        this.started = false;
        this.crashed = false;
        this.setValuesFormattingMode(args.valuesFormatting);
        this.xsdbDebugger.printCalls = !!args.printCalls;
        this.xsdbDebugger.debugOutput = !!args.showDevDebugOutput;
        this.stopAtEntry = args.stopAtEntry;

        this.xsdbDebugger.load(args.cwd, args.target, args.arguments, args.terminal, args.autorun || [], args.xsdb_target_filter, args.symbol_mapper).then(() => {
            this.sendResponse(response);
        }, err => {
            this.sendErrorResponse(response, 103, `Failed to load MI Debugger: ${err.toString()}`);
        });
    }


    // Add extra commands for source file path substitution in XSDB-specific syntax
    protected setPathSubstitutions(substitutions: { [index: string]: string }): void {
        if (substitutions) {
            Object.keys(substitutions).forEach(source => {
                this.xsdbDebugger.extraCommands.push("xsdb-set substitute-path \"" + escape(source) + "\" \"" + escape(substitutions[source]) + "\"");
            });
        }
    }
}

DebugSession.run(XSDBDebugSession);
