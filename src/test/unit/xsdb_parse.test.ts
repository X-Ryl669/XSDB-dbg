import * as assert from 'assert';
import { parseXSDBP, XSDBLine, XSDBMode } from '../../backend/xsdbp_parse';

interface TestLine {
    mode: XSDBMode;
    line: string;
}

const exampleComm : TestLine[] = [
    { mode:XSDBMode.Banner,              line:""},
    { mode:XSDBMode.Banner,              line:"****** Xilinx System Debugger (XSDB) v2022.2"},
    { mode:XSDBMode.Banner,              line:"  **** Build date : Oct 14 2022-05:10:29"},
    { mode:XSDBMode.Banner,              line:"    ** Copyright 1986-2022 Xilinx, Inc. All Rights Reserved."},
    { mode:XSDBMode.Banner,              line:""},
    { mode:XSDBMode.Banner,              line:""},
    { mode:XSDBMode.Banner,              line:"xsdb% "},
    { mode:XSDBMode.WaitingForValue,     line:"tcfchan#0"},
    { mode:XSDBMode.Waiting,             line:""},
    { mode:XSDBMode.ListingTarget,       line:"  1  Versal xcvc1902"},
    { mode:XSDBMode.ListingTarget,       line:"     2  RPU"},
    { mode:XSDBMode.ListingTarget,       line:"        3  Cortex-R5 #0 (Halted)"},
    { mode:XSDBMode.ListingTarget,       line:"        4  Cortex-R5 #1 (Lock Step Mode)"},
    { mode:XSDBMode.ListingTarget,       line:"     5  APU"},
    { mode:XSDBMode.ListingTarget,       line:"        6  Cortex-A72 #0 (Running)"},
    { mode:XSDBMode.ListingTarget,       line:"        7  Cortex-A72 #1 (Running)"},
    { mode:XSDBMode.ListingTarget,       line:"     8  PPU"},
    { mode:XSDBMode.ListingTarget,       line:"        9  MicroBlaze PPU (Sleeping)"},
    { mode:XSDBMode.ListingTarget,       line:"    10  PSM"},
    { mode:XSDBMode.ListingTarget,       line:"       11  MicroBlaze PSM (Sleeping)"},
    { mode:XSDBMode.ListingTarget,       line:"    12  PMC"},
    { mode:XSDBMode.ListingTarget,       line:"    13  PL"},
    { mode:XSDBMode.ListingTarget,       line:"    14  AI Engine Array 50x8 at 0x20000000000"},
    { mode:XSDBMode.ListingTarget,       line:"       15  aie_dly_test"},
    { mode:XSDBMode.ListingTarget,       line:"          16  core[23,0] (Disabled)"},
    { mode:XSDBMode.ListingTarget,       line:"          17  core[24,1] (Disabled)"},
    { mode:XSDBMode.ListingTarget,       line:"          18  core[25,0] (Disabled)"},
    { mode:XSDBMode.ListingTarget,       line:"          19  core[26,0] (Disabled)"},
    { mode:XSDBMode.ListingTarget,       line:" 20  DPC"},
    { mode:XSDBMode.ListingTarget,       line:"xsdb% "},
    { mode:XSDBMode.Waiting,             line:"Info: core[23,0] (target 16) Stopped at 0x420 (Breakpoint)"},
    { mode:XSDBMode.Waiting,             line:"datamover_scalar() at window.h: 900"},
    { mode:XSDBMode.Waiting,             line:"900:   SCALAR_OPS(cint16) // writes 4-bytes"},
    { mode:XSDBMode.Waiting,             line:"Info: core[23,0] (target 16) Running (Disabled)                                                                                                                                                      "},
    { mode:XSDBMode.Waiting,             line:"Info: core[26,0] (target 20) Running (Disabled)"},
    { mode:XSDBMode.ListingBreakpoints,  line:"ID        Enabled   Location            Status              "},
    { mode:XSDBMode.ListingBreakpoints,  line:"==        =======   ========            ======              "},
    { mode:XSDBMode.ListingBreakpoints,  line:"12        1         0x4D8               target 17: {Address 0x4d8 HitCount 0}"},
    { mode:XSDBMode.ListingBreakpoints,  line:"13        0         main                target 17: {Address 0x110 HitCount 2}"},
    { mode:XSDBMode.ListingBacktrace,    line:"Context core[24,1] state: Disabled"},
    { mode:XSDBMode.ListingBacktrace,    line:"Info: core[26,0] (target 20) Stopped at 0x280 (Suspended)"},
    { mode:XSDBMode.ListingBacktrace,    line:"    0  0x280 stream_datamover()+32: stream_datamover.cc, line 74"},
    { mode:XSDBMode.ListingBacktrace,    line:"    1  0x260 stream_datamover()"},
    { mode:XSDBMode.AddingBreakpoint,    line:"15"},
    { mode:XSDBMode.AddingBreakpoint,    line:"Info: Breakpoint 15 status:"},
    { mode:XSDBMode.AddingBreakpoint,    line:"   target 18: {Address: 0x110 Type: Hardware}"},
    { mode:XSDBMode.AddingBreakpoint,    line:"   target 17: {Unresolved source line information}"},
    { mode:XSDBMode.Waiting,                 line:"invalid command name \"status\""},
    { mode:XSDBMode.Waiting,                 line:"Core is disabled"},
    { mode:XSDBMode.Waiting,                 line:"Already stopped"},
    { mode:XSDBMode.ListingDisassembly,  line:"00000260: 0x3e    0x00 0x00 0x00 0x10 0x00 0x00 0x04 0xcb 0x84 0x20 0x3f                      MOV.s10 r6, #0;     NOP;                NOP;                                                        MOV.u20 p6, #197664;          NOP"},
    { mode:XSDBMode.ListingDisassembly,  line:"0000026c: 0x06    0xd1 0x81 0x68 0xd2 0x35 0x80 0x57                                          VLDA wr1, [p6];     VLDB wr0, [p6];                                                                 MOV md0[8], r6[0]"},
    { mode:XSDBMode.ListingDisassembly,  line:"00000274: 0x4a    0xd6 0x18 0x03                                                              NOP;                                                                                                MOV md0[10], r6[0]"},
    { mode:XSDBMode.ListingDisassembly,  line:"00000278: 0x00    0x00 0x00 0x03                                                              NOP;                                                                  NOP"},
    { mode:XSDBMode.ListingDisassembly,  line:"0000027c: 0x00    0x00 0x00 0x03                                                              NOP;                                                                  NOP"},
    { mode:XSDBMode.ListingDisassembly,  line:"00000280: 0x00    0x01                                                                        NOP"},
    { mode:XSDBMode.ListingDisassembly,  line:"00000282: 0x00    0x01                                                                        NOP"},
    { mode:XSDBMode.ListingMemory,       line:"Cannot read memory if not stopped. Context core[23,0] state: Disabled"},
    { mode:XSDBMode.ListingMemory,       line:"       0:   4A66260B"},
    { mode:XSDBMode.ListingMemory,       line:"       4:   4003C003"},
    { mode:XSDBMode.ListingMemory,       line:"       8:   CA61CA21"},
    { mode:XSDBMode.ListingMemory,       line:"       C:   BBFFC7F7"},
    { mode:XSDBMode.ListingLocals,       line:"w         : N/A"},
    { mode:XSDBMode.ListingLocals,       line:"count     : 4"},
    { mode:XSDBMode.ListingRegister,     line:"                r0: N/A                  r1: N/A                  r2: N/A"},
    { mode:XSDBMode.ListingRegister,     line:"                r3: N/A                  r4: N/A                  r5: N/A"},
    { mode:XSDBMode.ListingRegister,     line:"                r6: N/A                  r7: N/A                  r8: N/A"},
    { mode:XSDBMode.ListingRegister,     line:"                r9: N/A                 r10: N/A                 r11: N/A"},
    { mode:XSDBMode.ListingRegister,     line:"               r12: N/A                 r13: N/A                 r14: N/A"},
    { mode:XSDBMode.ListingRegister,     line:"               r15: N/A                  pc: N/A                  fc: N/A"},
    { mode:XSDBMode.ListingRegister,     line:"                sp: 00030020                  lr: 00000260 "},
    { mode:XSDBMode.ListingRegister,     line:"               md1: N/A                 mc0: N/A                 mc1: N/A"},
    { mode:XSDBMode.ListingRegister,     line:"      core_control: N/A         core_status: N/A                  ls: N/A"},
    { mode:XSDBMode.ListingRegister,     line:"                le: N/A                  lc: N/A             pointer     "},
    { mode:XSDBMode.ListingRegister,     line:"            config                        s                 modifier     "},
    { mode:XSDBMode.ListingRegister,     line:"                cb                       cs                   vector     "},
    { mode:XSDBMode.ListingRegister,     line:"               acc       cm_event_broadcast                 cm_trace     "},
    { mode:XSDBMode.ListingRegister,     line:"   cm_event_status           cm_event_group       mm_event_broadcast     "},
    { mode:XSDBMode.ListingRegister,     line:"          mm_trace          mm_event_status           mm_event_group     "},
    { mode:XSDBMode.ListingRegister,     line:"               dma                     lock     "},
    { mode:XSDBMode.ListingLocalsDef,    line:"Name        Type                Address             Size      Flags"},
    { mode:XSDBMode.ListingLocalsDef,    line:"========    ========            ===========         ====      ====="},
    { mode:XSDBMode.ListingLocalsDef,    line:"stream_in: At col 118: Cannot get symbol location information. No object location info found in DWARF data"},
    { mode:XSDBMode.ListingLocalsDef,    line:"stream_out: At col 118: Cannot get symbol location information. No object location info found in DWARF data"},
    { mode:XSDBMode.ListingLocalsDef,    line:"inp         v16cint16           N/A                 64        RW"},
];

function parseExampleComm(index: number) : XSDBLine {
//  console.log(exampleComm[index].line);
    return parseXSDBP(exampleComm[index].line, exampleComm[index].mode);
}

suite("XSDB Parse", () => {
    test("Banner mode", () => {
        for (let i = 0; i < 6; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.Banner);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, 0);
        }
        let parsed = parseExampleComm(6);
        assert.ok(parsed);
        assert.strictEqual(parsed.mode, XSDBMode.Prompt);
        assert.strictEqual(parsed.outOfBandRecord, undefined);
        assert.strictEqual(parsed.outOfBandPos, undefined);
        assert.strictEqual(parsed.resultRecords.length, 0);
        parsed = parseExampleComm(8);
        assert.ok(parsed);
        assert.strictEqual(parsed.mode, XSDBMode.Waiting);
        assert.strictEqual(parsed.outOfBandRecord, undefined);
        assert.strictEqual(parsed.outOfBandPos, undefined);
        assert.strictEqual(parsed.resultRecords.length, 0);
    });
    test("Simple out of band record", () => {
        let parsed = parseExampleComm(30);
        assert.ok(parsed);
        assert.strictEqual(parsed.mode, XSDBMode.Waiting);
        assert.deepStrictEqual(parsed.outOfBandRecord, {core: "core[23,0]", target:16, running: false, pc: 0x420, status: "Breakpoint"});
        assert.strictEqual(parsed.outOfBandPos, undefined);
        assert.strictEqual(parsed.resultRecords.length, 0);
        parsed = parseExampleComm(31);
        assert.ok(parsed);
        assert.strictEqual(parsed.mode, XSDBMode.Waiting);
        assert.strictEqual(parsed.outOfBandRecord, undefined);
        assert.deepStrictEqual(parsed.outOfBandPos, {key: "datamover_scalar() at window.h", value: "900", func: "datamover_scalar", file: "window.h", line: 900}); // datamover_scalar() at window.h: 900
        assert.strictEqual(parsed.resultRecords.length, 0);
        parsed = parseExampleComm(32);
        assert.ok(parsed);
        assert.strictEqual(parsed.mode, XSDBMode.Waiting);
        assert.strictEqual(parsed.outOfBandRecord, undefined);
        assert.deepStrictEqual(parsed.outOfBandPos, {key: "900", value: "SCALAR_OPS(cint16) // writes 4-bytes", func: "", file: "", line: 0});      // 900:   SCALAR_OPS(cint16) // writes 4-bytes
        assert.strictEqual(parsed.resultRecords.length, 0);
        parsed = parseExampleComm(33);
        assert.ok(parsed);
        assert.strictEqual(parsed.mode, XSDBMode.Waiting);
        assert.deepStrictEqual(parsed.outOfBandRecord, {core: "core[23,0]", target:16, running: true, pc: 0, status: "Disabled"});      // Info: core[23,0] (target 16) Running (Disabled)
        assert.strictEqual(parsed.outOfBandPos, undefined);
        assert.strictEqual(parsed.resultRecords.length, 0);
        parsed = parseExampleComm(34);
        assert.ok(parsed);
        assert.strictEqual(parsed.mode, XSDBMode.Waiting);
        assert.strictEqual(parsed.outOfBandPos, undefined);
        assert.strictEqual(parsed.resultRecords.length, 0);
    });
    test("Waiting for value", () => {
        const parsed = parseExampleComm(7);
        assert.ok(parsed);
        assert.strictEqual(parsed.mode, XSDBMode.WaitingForValue);
        assert.strictEqual(parsed.outOfBandRecord, undefined);
        assert.strictEqual(parsed.outOfBandPos, undefined);
        assert.strictEqual(parsed.resultRecords.length, 1);
        assert.deepStrictEqual(parsed.resultRecords[0], { key:"", value: "tcfchan#0", valueFromHex: 0});
    });
    test("Listing targets", () => {
        for (let i = 9; i < 29; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.ListingTarget);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, 1);
            assert.strictEqual(parsed.resultRecords[0].target, i - 8);
        }
        let parsed = parseExampleComm(9);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "1", value: "  1  Versal xcvc1902", target: 1, targetName: "Versal xcvc1902", pos: undefined, state: undefined });
        parsed = parseExampleComm(11);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "3", value: "        3  Cortex-R5 #0 (Halted)", target: 3, targetName: "Cortex-R5", pos: "0", state: "Halted" });
        parsed = parseExampleComm(22);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "14", value: "    14  AI Engine Array 50x8 at 0x20000000000", target: 14, targetName: "AI Engine Array 50x8 at 0x20000000000", pos: undefined, state: undefined });
        parsed = parseExampleComm(24);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "16", value: "          16  core[23,0] (Disabled)", target: 16, targetName: "core", pos: "23,0", state: "Disabled" });
    });
    test("Listing breakpoints", () => {
        for (let i = 35; i < 39; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.ListingBreakpoints);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, i < 37 ? 0 : 1);
            if (i > 36) assert.strictEqual(parsed.resultRecords[0].target, 17);
        }
        let parsed = parseExampleComm(37);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "12", value: "12        1         0x4D8               target 17: {Address 0x4d8 HitCount 0}", target: 17, targetName: "0x4D8", pos: "0x4d8", state: "1" });
        parsed = parseExampleComm(38);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "13", value: "13        0         main                target 17: {Address 0x110 HitCount 2}", target: 17, targetName: "main", pos: "0x110", state: "0" });
    });
    test("Listing backtrace", () => {
        for (let i = 39; i < 42; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.ListingBacktrace);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, i == 40 ? 0 : 1);
        }
        let parsed = parseExampleComm(39);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "core", value: "Context core[24,1] state: Disabled", target: 0, targetName: "24,1", pos: undefined, state: "Disabled" });
        parsed = parseExampleComm(41);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "0", value: "    0  0x280 stream_datamover()+32: stream_datamover.cc, line 74", target: 74, targetName: "stream_datamover.cc", pos: "0x280", state: "stream_datamover" });
        parsed = parseExampleComm(42);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "1", value: "    1  0x260 stream_datamover()", target: 0, targetName: undefined, pos: "0x260", state: "stream_datamover" });
    });
    test("Adding breakpoint", () => {
        for (let i = 43; i < 47; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.AddingBreakpoint);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, i == 44 ? 0 : 1);
        }
        let parsed = parseExampleComm(43);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "15", value: "15" });
        parsed = parseExampleComm(45);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "", value: "   target 18: {Address: 0x110 Type: Hardware}", target: 18, targetName: undefined, pos: "0x110", state: "Hardware" });
    });
    test("Errors", () => {
        for (let i = 47; i < 50; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.Waiting);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, 1);
            assert.strictEqual(parsed.resultRecords[0].key, "Error");
        }
    });
    test("Disassembly", () => {
        for (let i = 50; i < 57; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.ListingDisassembly);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, 1);
            assert.strictEqual(parsed.resultRecords[0].key, parsed.resultRecords[0].pos);
        }
    });
    test("Memory", () => {
        for (let i = 58; i < 62; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.ListingMemory);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, 1);
            assert.strictEqual(parsed.resultRecords[0].key, parsed.resultRecords[0].pos);
        }
    });
    test("Locals", () => {
        for (let i = 62; i < 64; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.ListingLocals);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, 1);
        }
    });
    test("Registers", () => {
        for (let i = 64; i < 79; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.ListingRegister);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, i == 70 || i == 73 ? 2 : i < 73 ? 3 : 0);
            if (i == 70) {
                assert.strictEqual(parsed.resultRecords[0].key, "sp");
                assert.strictEqual(parsed.resultRecords[0].value, "00030020");
                assert.strictEqual(parsed.resultRecords[0].valueFromHex, 0x00030020);

                assert.strictEqual(parsed.resultRecords[1].key, "lr");
                assert.strictEqual(parsed.resultRecords[1].value, "00000260");
                assert.strictEqual(parsed.resultRecords[1].valueFromHex, 0x00000260);
            } else if (i < 73) assert.strictEqual(parsed.resultRecords[0].value, "N/A");
        }
    });
    test("Locals definition", () => {
        for (let i = 80; i < 83; i++) {
            const parsed = parseExampleComm(i);
            assert.ok(parsed);
            assert.strictEqual(parsed.mode, XSDBMode.ListingLocalsDef);
            assert.strictEqual(parsed.outOfBandRecord, undefined);
            assert.strictEqual(parsed.outOfBandPos, undefined);
            assert.strictEqual(parsed.resultRecords.length, 0);
        }
        const parsed = parseExampleComm(84);
        assert.deepStrictEqual(parsed.resultRecords[0], { key: "inp", value: "v16cint16", pos: "N/A", target: 64, targetName: undefined, state: "RW" });
    });

});
