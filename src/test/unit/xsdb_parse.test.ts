import * as assert from 'assert';
import { parseXSDBP, XSDBLine, XSDBMode } from '../../backend/xsdbp_parse';

interface TestLine {
	mode: XSDBMode;
	line: string;
};

const exampleComm : TestLine[]= [
   { mode:XSDBMode.Banner, 				line:""},
   { mode:XSDBMode.Banner, 				line:"****** Xilinx System Debugger (XSDB) v2022.2"},
   { mode:XSDBMode.Banner, 				line:"  **** Build date : Oct 14 2022-05:10:29"},
   { mode:XSDBMode.Banner, 				line:"    ** Copyright 1986-2022 Xilinx, Inc. All Rights Reserved."},
   { mode:XSDBMode.Banner, 				line:""},
   { mode:XSDBMode.Banner, 				line:""},
   { mode:XSDBMode.Banner, 				line:"xsdb% "},
   { mode:XSDBMode.WaitingForValue,		line:"tcfchan#0"},
   { mode:XSDBMode.Waiting, 				line:""},
   { mode:XSDBMode.ListingTarget, 		line:"  1  Versal xcvc1902"},
   { mode:XSDBMode.ListingTarget, 		line:"     2  RPU"},
   { mode:XSDBMode.ListingTarget, 		line:"        3  Cortex-R5 #0 (Halted)"},
   { mode:XSDBMode.ListingTarget, 		line:"        4  Cortex-R5 #1 (Lock Step Mode)"},
   { mode:XSDBMode.ListingTarget, 		line:"     5  APU"},
   { mode:XSDBMode.ListingTarget, 		line:"        6  Cortex-A72 #0 (Running)"},
   { mode:XSDBMode.ListingTarget, 		line:"        7  Cortex-A72 #1 (Running)"},
   { mode:XSDBMode.ListingTarget, 		line:"     8  PPU"},
   { mode:XSDBMode.ListingTarget, 		line:"        9  MicroBlaze PPU (Sleeping)"},
   { mode:XSDBMode.ListingTarget, 		line:"    10  PSM"},
   { mode:XSDBMode.ListingTarget, 		line:"       11  MicroBlaze PSM (Sleeping)"},
   { mode:XSDBMode.ListingTarget, 		line:"    12  PMC"},
   { mode:XSDBMode.ListingTarget, 		line:"    13  PL"},
   { mode:XSDBMode.ListingTarget, 		line:"    14  AI Engine Array 50x8 at 0x20000000000"},
   { mode:XSDBMode.ListingTarget, 		line:"       15  aie_dly_test"},
   { mode:XSDBMode.ListingTarget, 		line:"          16  core[23,0] (Disabled)"},
   { mode:XSDBMode.ListingTarget, 		line:"          17  core[24,1] (Disabled)"},
   { mode:XSDBMode.ListingTarget, 		line:"          18  core[25,0] (Disabled)"},
   { mode:XSDBMode.ListingTarget, 		line:"          19  core[26,0] (Disabled)"},
   { mode:XSDBMode.ListingTarget, 		line:" 20  DPC"},
   { mode:XSDBMode.ListingTarget,  		line:"xsdb% "},
   { mode:XSDBMode.Waiting,          	line:"Info: core[23,0] (target 16) Stopped at 0x420 (Breakpoint)"},
   { mode:XSDBMode.Waiting, 				line:"datamover_scalar() at window.h: 900"},
   { mode:XSDBMode.Waiting, 				line:"900:   SCALAR_OPS(cint16) // writes 4-bytes"},
   { mode:XSDBMode.Waiting, 				line:"Info: core[23,0] (target 16) Running (Disabled)                                                                                                                                                      "},
   { mode:XSDBMode.Waiting, 				line:"Info: core[26,0] (target 20) Running (Disabled)"},
  { mode:XSDBMode.ListingBreakpoints, 	line:"ID        Enabled   Location            Status              "},
  { mode:XSDBMode.ListingBreakpoints, 	line:"==        =======   ========            ======              "},
  { mode:XSDBMode.ListingBreakpoints, 	line:"12        1         0x4D8               target 19: {Address 0x4d8 HitCount 0}"},
  { mode:XSDBMode.ListingBreakpoints, 	line:"13        1         main                target 17: {Address 0x110 HitCount 0}"},
  { mode:XSDBMode.ListingBreakpoints, 	line:"14        1         0x420               target 17: {Address 0x420 HitCount 2}"},
  { mode:XSDBMode.ListingBacktrace, 	line:"Context core[24,1] state: Disabled"},
  { mode:XSDBMode.ListingBacktrace, 	line:"Info: core[26,0] (target 20) Stopped at 0x280 (Suspended)                                                                                                                                                  "},
  { mode:XSDBMode.ListingBacktrace, 	line:"    0  0x280 stream_datamover()+32: stream_datamover.cc, line 74"},
  { mode:XSDBMode.ListingBacktrace, 	line:"    1  0x260 stream_datamover()"},
  { mode:XSDBMode.AddingBreakpoint, 	line:"15"},
  { mode:XSDBMode.AddingBreakpoint, 	line:"xsdb% Info: Breakpoint 15 status:"},
  { mode:XSDBMode.AddingBreakpoint, 	line:"   target 18: {Address: 0x110 Type: Hardware}"},
  { mode:XSDBMode.Waiting, 				line:"invalid command name \"status\""},
  { mode:XSDBMode.Waiting, 				line:"wrong # args: should be \"break\""},
  { mode:XSDBMode.Waiting, 				line:"Core is disabled"},
  { mode:XSDBMode.Waiting, 				line:"Already stopped"},
  { mode:XSDBMode.ListingDisassembly, 	line:"00000260: 0x3e    0x00 0x00 0x00 0x10 0x00 0x00 0x04 0xcb 0x84 0x20 0x3f                      MOV.s10 r6, #0;     NOP;                NOP;                                                        MOV.u20 p6, #197664;          NOP"},
  { mode:XSDBMode.ListingDisassembly, 	line:"0000026c: 0x06    0xd1 0x81 0x68 0xd2 0x35 0x80 0x57                                          VLDA wr1, [p6];     VLDB wr0, [p6];                                                                 MOV md0[8], r6[0]"},
  { mode:XSDBMode.ListingDisassembly, 	line:"00000274: 0x4a    0xd6 0x18 0x03                                                              NOP;                                                                                                MOV md0[10], r6[0]"},
  { mode:XSDBMode.ListingDisassembly, 	line:"00000278: 0x00    0x00 0x00 0x03                                                              NOP;                                                                  NOP"},
  { mode:XSDBMode.ListingDisassembly, 	line:"0000027c: 0x00    0x00 0x00 0x03                                                              NOP;                                                                  NOP"},
  { mode:XSDBMode.ListingDisassembly, 	line:"00000280: 0x00    0x01                                                                        NOP"},
  { mode:XSDBMode.ListingDisassembly, 	line:"00000282: 0x00    0x01                                                                        NOP"},
  { mode:XSDBMode.ListingMemory, 		line:"Cannot read memory if not stopped. Context core[23,0] state: Disabled"},
  { mode:XSDBMode.ListingMemory, 		line:"       0:   4A66260B"},
  { mode:XSDBMode.ListingMemory, 		line:"       4:   4003C003"},
  { mode:XSDBMode.ListingMemory, 		line:"       8:   CA61CA21"},
  { mode:XSDBMode.ListingMemory, 		line:"       C:   BBFFC7F7"},
  { mode:XSDBMode.ListingLocals, 		line:"w         : N/A"},
  { mode:XSDBMode.ListingLocals, 		line:"count     : 4"},
];

function parseExampleComm(index: number) : XSDBLine {
	console.log(exampleComm[index].line);
	return parseXSDBP(exampleComm[index].line, exampleComm[index].mode);
}

suite("XSDB Parse", () => {
	test("Banner mode", () => {
		for (let i = 0; i < 6; i++) {
			const parsed = parseExampleComm(i);
			assert.ok(parsed);
			assert.strictEqual(parsed.mode, XSDBMode.Banner);
			assert.strictEqual(parsed.outOfBandRecord, null);
			assert.strictEqual(parsed.outOfBandPos, null);
			assert.strictEqual(parsed.resultRecords.length, 0);
		}
		let parsed = parseExampleComm(6);
		assert.ok(parsed);
		assert.strictEqual(parsed.mode, XSDBMode.Waiting);
		assert.strictEqual(parsed.outOfBandRecord, null);
		assert.strictEqual(parsed.outOfBandPos, null);
		assert.strictEqual(parsed.resultRecords.length, 0);
		parsed = parseExampleComm(8);
		assert.ok(parsed);
		assert.strictEqual(parsed.mode, XSDBMode.Waiting);
		assert.strictEqual(parsed.outOfBandRecord, null);
		assert.strictEqual(parsed.outOfBandPos, null);
		assert.strictEqual(parsed.resultRecords.length, 0);
	});
	test("Simple out of band record", () => {
		let parsed = parseExampleComm(30);
		assert.ok(parsed);
		assert.strictEqual(parsed.mode, XSDBMode.Waiting);
		assert.deepStrictEqual(parsed.outOfBandRecord, {core: "core[23,0]", target:16, running: false, pc: 0x420, status: "Breakpoint"});
		assert.strictEqual(parsed.outOfBandPos, null);
		assert.strictEqual(parsed.resultRecords.length, 0);
		parsed = parseExampleComm(31);
		assert.ok(parsed);
		assert.strictEqual(parsed.mode, XSDBMode.Waiting);
		assert.strictEqual(parsed.outOfBandRecord, null);
		assert.deepStrictEqual(parsed.outOfBandPos, {key: "datamover_scalar() at window.h", value: "900", func: "datamover_scalar", file: "window.h", line: 900}); // datamover_scalar() at window.h: 900
		assert.strictEqual(parsed.resultRecords.length, 0);
		parsed = parseExampleComm(32);
		assert.ok(parsed);
		assert.strictEqual(parsed.mode, XSDBMode.Waiting);
		assert.strictEqual(parsed.outOfBandRecord, null);
		assert.deepStrictEqual(parsed.outOfBandPos, {key: "900", value: "SCALAR_OPS(cint16) // writes 4-bytes", func: "", file: "", line: 0});		// 900:   SCALAR_OPS(cint16) // writes 4-bytes
		assert.strictEqual(parsed.resultRecords.length, 0);
		parsed = parseExampleComm(33);
		assert.ok(parsed);
		assert.strictEqual(parsed.mode, XSDBMode.Waiting);
		assert.deepStrictEqual(parsed.outOfBandRecord, {core: "core[23,0]", target:16, running: true, pc: 0, status: "Disabled"}); 		// Info: core[23,0] (target 16) Running (Disabled)
		assert.strictEqual(parsed.outOfBandPos, null);
		assert.strictEqual(parsed.resultRecords.length, 0);
		parsed = parseExampleComm(34);
		assert.ok(parsed);
		assert.strictEqual(parsed.mode, XSDBMode.Waiting);
		assert.strictEqual(parsed.outOfBandPos, null);
		assert.strictEqual(parsed.resultRecords.length, 0);
	});
	test("Waiting for value", () => {
		const parsed = parseExampleComm(7);
		assert.ok(parsed);
		assert.strictEqual(parsed.mode, XSDBMode.WaitingForValue);
		assert.strictEqual(parsed.outOfBandRecord, null);
		assert.strictEqual(parsed.outOfBandPos, null);
		assert.strictEqual(parsed.resultRecords.length, 1);
		assert.deepStrictEqual(parsed.resultRecords[0], { key:"", value: "tcfchan#0", valueFromHex: 0});
	});
	test("Listing targets", () => {
		for (let i = 9; i < 29; i++) {
			const parsed = parseExampleComm(i);
			assert.ok(parsed);
			assert.strictEqual(parsed.mode, XSDBMode.ListingTarget);
			assert.strictEqual(parsed.outOfBandRecord, null);
			assert.strictEqual(parsed.outOfBandPos, null);
			assert.strictEqual(parsed.resultRecords.length, 1);
			assert.strictEqual(parsed.resultRecords[0].target, i - 8);
		}
		let parsed = parseExampleComm(9);
		assert.deepStrictEqual(parsed.resultRecords[0], { key: "1", value: "  1  Versal xcvc1902", target: 1, targetName: "Versal xcvc1902", pos: null, state: null });
		parsed = parseExampleComm(11);
		assert.deepStrictEqual(parsed.resultRecords[0], { key: "3", value: "        3  Cortex-R5 #0 (Halted)", target: 3, targetName: "Cortex-R5", pos: "0", state: "Halted" });
		parsed = parseExampleComm(22);
		assert.deepStrictEqual(parsed.resultRecords[0], { key: "14", value: "    14  AI Engine Array 50x8 at 0x20000000000", target: 14, targetName: "AI Engine Array 50x8 at 0x20000000000", pos: null, state: null });
		parsed = parseExampleComm(24);
		assert.deepStrictEqual(parsed.resultRecords[0], { key: "16", value: "          16  core[23,0] (Disabled)", target: 16, targetName: "core", pos: "23,0", state: "Disabled" });
	});	

	/*
	test("Console stream output with new line", () => {
		const parsed = parseXSDBP(`~"[Thread 0x7fffe993a700 (LWP 11002) exited]\\n"`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 1);
		assert.strictEqual(parsed.outOfBandRecord[0].isStream, true);
		assert.strictEqual(parsed.outOfBandRecord[0].content, "[Thread 0x7fffe993a700 (LWP 11002) exited]\n");
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("Unicode", () => {
		let parsed = parseXSDBP(`~"[Depuraci\\303\\263n de hilo usando libthread_db enabled]\\n"`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 1);
		assert.strictEqual(parsed.outOfBandRecord[0].isStream, true);
		assert.strictEqual(parsed.outOfBandRecord[0].content, "[Depuración de hilo usando libthread_db enabled]\n");
		assert.strictEqual(parsed.resultRecords, undefined);
		parsed = parseXSDBP(`~"4\\t  std::cout << \\"\\345\\245\\275\\345\\245\\275\\345\\255\\246\\344\\271\\240\\357\\274\\214\\345\\244\\251\\345\\244\\251\\345\\220\\221\\344\\270\\212\\" << std::endl;\\n"`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 1);
		assert.strictEqual(parsed.outOfBandRecord[0].isStream, true);
		assert.strictEqual(parsed.outOfBandRecord[0].content, `4\t  std::cout << "好好学习，天天向上" << std::endl;\n`);
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("Empty line", () => {
		const parsed = parseXSDBP(``);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 0);
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("'(gdb)' line", () => {
		const parsed = parseXSDBP(`(gdb)`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 0);
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("Simple result record", () => {
		const parsed = parseXSDBP(`1^running`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, 1);
		assert.strictEqual(parsed.outOfBandRecord.length, 0);
		assert.notStrictEqual(parsed.resultRecords, undefined);
		assert.strictEqual(parsed.resultRecords.resultClass, "running");
		assert.strictEqual(parsed.resultRecords.results.length, 0);
	});
	test("Advanced out of band record (Breakpoint hit)", () => {
		const parsed = parseXSDBP(`*stopped,reason="breakpoint-hit",disp="keep",bkptno="1",frame={addr="0x00000000004e807f",func="D main",args=[{name="args",value="..."}],file="source/app.d",fullname="/path/to/source/app.d",line="157"},thread-id="1",stopped-threads="all",core="0"`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, undefined);
		assert.strictEqual(parsed.outOfBandRecord.length, 1);
		assert.strictEqual(parsed.outOfBandRecord[0].isStream, false);
		assert.strictEqual(parsed.outOfBandRecord[0].asyncClass, "stopped");
		assert.strictEqual(parsed.outOfBandRecord[0].output.length, 7);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[0], ["reason", "breakpoint-hit"]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[1], ["disp", "keep"]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[2], ["bkptno", "1"]);
		const frame = [
			["addr", "0x00000000004e807f"],
			["func", "D main"],
			["args", [[["name", "args"], ["value", "..."]]]],
			["file", "source/app.d"],
			["fullname", "/path/to/source/app.d"],
			["line", "157"]
		];
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[3], ["frame", frame]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[4], ["thread-id", "1"]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[5], ["stopped-threads", "all"]);
		assert.deepStrictEqual(parsed.outOfBandRecord[0].output[6], ["core", "0"]);
		assert.strictEqual(parsed.resultRecords, undefined);
	});
	test("Advanced result record", () => {
		const parsed = parseXSDBP(`2^done,asm_insns=[src_and_asm_line={line="134",file="source/app.d",fullname="/path/to/source/app.d",line_asm_insn=[{address="0x00000000004e7da4",func-name="_Dmain",offset="0",inst="push   %rbp"},{address="0x00000000004e7da5",func-name="_Dmain",offset="1",inst="mov    %rsp,%rbp"}]}]`);
		assert.ok(parsed);
		assert.strictEqual(parsed.token, 2);
		assert.strictEqual(parsed.outOfBandRecord.length, 0);
		assert.notStrictEqual(parsed.resultRecords, undefined);
		assert.strictEqual(parsed.resultRecords.resultClass, "done");
		assert.strictEqual(parsed.resultRecords.results.length, 1);
		const asmInsns = [
			"asm_insns",
			[
				[
					"src_and_asm_line",
					[
						["line", "134"],
						["file", "source/app.d"],
						["fullname", "/path/to/source/app.d"],
						[
							"line_asm_insn",
							[
								[
									["address", "0x00000000004e7da4"],
									["func-name", "_Dmain"],
									["offset", "0"],
									["inst", "push   %rbp"]
								],
								[
									["address", "0x00000000004e7da5"],
									["func-name", "_Dmain"],
									["offset", "1"],
									["inst", "mov    %rsp,%rbp"]
								]
							]
						]
					]
				]
			]
		];
		assert.deepStrictEqual(parsed.resultRecords.results[0], asmInsns);
		assert.strictEqual(parsed.result("asm_insns.src_and_asm_line.line_asm_insn[1].address"), "0x00000000004e7da5");
	});
	test("valueof children", () => {
		const obj = [
			[
				"frame",
				[
					["level", "0"],
					["addr", "0x0000000000435f70"],
					["func", "D main"],
					["file", "source/app.d"],
					["fullname", "/path/to/source/app.d"],
					["line", "5"]
				]
			],
			[
				"frame",
				[
					["level", "1"],
					["addr", "0x00000000004372d3"],
					["func", "rt.dmain2._d_run_main()"]
				]
			],
			[
				"frame",
				[
					["level", "2"],
					["addr", "0x0000000000437229"],
					["func", "rt.dmain2._d_run_main()"]
				]
			]
		];

		assert.strictEqual(XSDBLine.valueOf(obj[0], "@frame.level"), "0");
		assert.strictEqual(XSDBLine.valueOf(obj[0], "@frame.addr"), "0x0000000000435f70");
		assert.strictEqual(XSDBLine.valueOf(obj[0], "@frame.func"), "D main");
		assert.strictEqual(XSDBLine.valueOf(obj[0], "@frame.file"), "source/app.d");
		assert.strictEqual(XSDBLine.valueOf(obj[0], "@frame.fullname"), "/path/to/source/app.d");
		assert.strictEqual(XSDBLine.valueOf(obj[0], "@frame.line"), "5");

		assert.strictEqual(XSDBLine.valueOf(obj[1], "@frame.level"), "1");
		assert.strictEqual(XSDBLine.valueOf(obj[1], "@frame.addr"), "0x00000000004372d3");
		assert.strictEqual(XSDBLine.valueOf(obj[1], "@frame.func"), "rt.dmain2._d_run_main()");
		assert.strictEqual(XSDBLine.valueOf(obj[1], "@frame.file"), undefined);
		assert.strictEqual(XSDBLine.valueOf(obj[1], "@frame.fullname"), undefined);
		assert.strictEqual(XSDBLine.valueOf(obj[1], "@frame.line"), undefined);
	});
	test("empty string values", () => {
		const parsed = parseXSDBP(`15^done,register-names=["r0","pc","","xpsr","","control"]`);
		const result = parsed.result('register-names');
		assert.deepStrictEqual(result, ["r0", "pc", "", "xpsr", "", "control"]);
	});
	test("empty string value first and last", () => {
		const parsed = parseXSDBP(`15^done,register-names=["","r0","pc","","xpsr","","control",""]`);
		const result = parsed.result('register-names');
		assert.deepStrictEqual(result, ["", "r0", "pc", "", "xpsr", "", "control", ""]);
	});
	test("empty array values", () => {
		const parsed = parseXSDBP(`15^done,foo={x=[],y="y"}`);
		assert.deepStrictEqual(parsed.result('foo.x'), []);
		assert.strictEqual(parsed.result('foo.y'), "y");
	});
	test("empty object values", () => {
		// GDB may send {} as empty array
		const parsed = parseXSDBP(`15^done,foo={x={},y="y"}`);
		assert.deepStrictEqual(parsed.result('foo.x'), []);
		assert.strictEqual(parsed.result('foo.y'), "y");
	});
	*/
});
