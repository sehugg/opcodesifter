
import { MOS6502 } from "./cpu/MOS6502";
import { CPU, Bus, ClockBased, SavesState, Interruptable } from "./devices";
import { disassemble6502, OPS_6502 } from "./cpu/disasm6502";

var verbose = 0;

function debug(...args) {
  if (verbose) process.stdout.write(util.format.apply(this, arguments) + '\n');
}

class StackMachine {
    bus : Bus;
    stack = [];
    push(x:number) { this.stack.push(x|0); }
    pushb(b:boolean) { this.push(b?1:0); }
    pop():number { return this.stack.pop()|0; }
    // unop    
    u8()  { var x=this.pop(); this.push(x & 0xff); }
    u16() { var x=this.pop(); this.push(x & 0xffff); }
    sx8() { var x=this.pop(); this.push((x & 0x80) ? (x | ~0x7f) : (x & 0x7f)); }
    sx16(){ var x=this.pop(); this.push((x & 0x8000) ? (x | ~0x7fff) : (x & 0x7fff)); }
    neg() { this.push(-this.pop()); }
    not() { this.push(~this.pop()); }
    gz()  { this.pushb(this.pop() > 0); }
    lz()  { this.pushb(this.pop() < 0); }
    gez() { this.pushb(this.pop() >= 0); }
    lez() { this.pushb(this.pop() <= 0); }
    eqz() { this.pushb(this.pop() == 0); }
    nez() { this.pushb(this.pop() != 0); }
    // binop
    add() { this.push(this.pop() + this.pop()); }
    sub() { this.push(this.pop() - this.pop()); }
    mul() { this.push(this.pop() * this.pop()); }
    div() { this.push(this.pop() / this.pop()); }
    mod() { this.push(this.pop() % this.pop()); }
    and() { this.push(this.pop() & this.pop()); }
    or()  { this.push(this.pop() | this.pop()); }
    xor() { this.push(this.pop() ^ this.pop()); }
    shl() { this.push(this.pop() << this.pop()); }
    shr() { this.push(this.pop() >> this.pop()); }
    lsr() { this.push(this.pop() >>> this.pop()); }
    // triop
    cond()    { var a=this.pop(); var b=this.pop(); var c=this.pop(); this.push(a?b:c); }
    // memory
    load8()   { return this.bus.read(this.pop()); }
    store8()  { var a=this.pop(); var v=this.pop(); this.bus.write(a, v); }
    load16()  { var a=this.pop(); var l=this.bus.read(a); var h=this.bus.read(a+1); return l+h*256; }
    store16() { var a=this.pop(); var v=this.pop(); this.bus.write(a,v); this.bus.write(a+1,v>>8); }
}

const validinsns_6502 = [
  0, 2, 0, 0, 0, 2, 2, 0, 1, 2, 1, 0, 0, 3, 3, 0,
  2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0,
  0, 2, 0, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0,
  2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0,
  0, 2, 0, 0, 0, 2, 2, 0, 1, 2, 1, 0, 0, 3, 3, 0,
  2, 2, 0, 0, 0, 2, 2, 0, 0, 3, 0, 0, 0, 3, 3, 0,
  0, 2, 0, 0, 0, 2, 2, 0, 1, 2, 1, 0, 0, 3, 3, 0,
  2, 2, 0, 0, 0, 2, 2, 0, 0, 3, 0, 0, 0, 3, 3, 0,
  
  0, 2, 0, 0, 2, 2, 2, 0, 1, 0, 1, 0, 3, 3, 3, 0,
  2, 2, 0, 0, 2, 2, 2, 0, 1, 3, 1/*txs*/, 0, 0, 3, 0, 0,
  2, 2, 2, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0,
  2, 2, 0, 0, 2, 2, 2, 0, 1, 3, 1/*tsx*/, 0, 3, 3, 3, 0,
  2, 2, 0, 0, 2, 2, 2, 0, 1, 2, 1, 0, 3, 3, 3, 0,
  2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0,
  2, 2, 0, 0, 2, 2, 2, 0, 1, 2, 0/*nop*/, 0, 3, 3, 3, 0,
  2, 2, 0, 0, 0, 2, 2, 0, 1, 3, 0, 0, 0, 3, 3, 0
];


var _random_state : number = 0;
export function noise() {
        let x = _random_state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        return (_random_state = x) & 0xff;
}

class TestVector {
    mem: Uint8Array;
    
    constructor(seed:number, israndom:boolean) {
        this.mem = new Uint8Array(0x10000);
        if (israndom) {
            _random_state = seed;
        }
        for (var i=0; i<this.mem.length; i++) {
            this.mem[i] = israndom ? noise() : seed;
        }
    }
}

const ZPSTART = 0x20;
const ABSPG = 0x02;
const ENDPG = 0x08;

class RunState implements Bus {
    insns: Uint8Array;
    base : TestVector;
    syms = {};
    outputs = {};
    endstate;

    getSymbol(address: number, iswrite: boolean) {
        var sym = this.syms[address];
        var name;
        if (address < 0x100) name = 'z'+address.toString(16);
        else if (address < ENDPG*256) name = 'a'+address.toString(16);
        else name = 'i';
        if (!sym) sym = this.syms[address] = { sym: name, input: false, output: false, indexed: name=='I' };
        if (iswrite) sym.output = true;
        else sym.input = true;
        return sym;
    }

    read(address: number) : number {
        address &= 0xffff;
        if (address >= 0xff00) {
            if (address >= 0xfffa) {
                switch (address) {
                    case 0xfffc: return 0x00;
                    case 0xfffd: return 0xff;
                    default: return 0x00;
                }
            } else if ((address & 0xff) <= this.insns.length) {
                return this.insns[address & 0xff] & 0xff;
            }
        }
        var sym = this.getSymbol(address, false);
        //debug('read',address,sym);
        return this.base.mem[address] & 0xff;
    }
    
    write(address: number, value: number) : void {
        address &= 0xffff;
        value &= 0xff;
        var sym = this.getSymbol(address, true);
        //debug('write',address,value,sym);
        if (sym.indexed)
            this.outputs[sym.sym] = value + (address<<8);
        else
            this.outputs[sym.sym] = value;
    }
    
    set(register: string, value: number) : void {
        this.outputs[register] = value & 0xff;
    }
    
    read16(address: number) : number {
        var lo = this.read(address);
        var hi = this.read(address+1);
        return lo + (hi<<8);
    }
    s8(x: number) : number {
        return (x & 0x80) ? x-256 : x;
    }
    s16(x: number) : number {
        return (x & 0x8000) ? x-65536 : x;
    }
}

export class TestRunner6502 {
    vecs : TestVector[];
    cpu: MOS6502;
    rs: RunState;
    
    runOne(insns: Uint8Array, vec: TestVector) {
        this.rs = new RunState();
        this.rs.base = vec;
        this.rs.insns = insns;
        this.cpu.connectMemoryBus(this.rs);
        this.cpu.reset();
        var s0 = this.cpu.saveState();
        s0.A = vec.mem[0xff00];
        s0.X = vec.mem[0xff01];
        s0.Y = vec.mem[0xff02];
        s0.N = (vec.mem[0xff03] & 0x80) ? 1 : 0;
        s0.V = (vec.mem[0xff03] & 0x40) ? 1 : 0;
        s0.C = (vec.mem[0xff03] & 0x01) ? 1 : 0;
        s0.Z = (vec.mem[0xff03] & 0x02) ? 1 : 0;
        s0.D = 0;
        s0.SP = noise();
        this.cpu.loadState(s0);
        var start = 0xff00;
        var end = start + insns.length - 1;
        do {
            this.cpu.advanceInsn();
            var pc = this.cpu.getPC();
        } while (pc >= start && pc <= end);
        var s1 = this.cpu.saveState();
        if (s1.SP != s0.SP) return {}; //"stack mismatch";
        if (s1.D) return {}; //"decimal mode set"
        // TODO: check D flag, SP = SP'
        var r = this.rs.outputs;
        for (var reg of ['A','X','Y','N','V','C','Z'])
            r[reg] = s1[reg];
        //var endregs = [s1.A, s1.X, s1.Y, s1.N, s1.V, s1.C, s1.Z];
        return r; //endregs.concat(this.rs.outputs);
    }

    validateSequence(insns: Uint8Array, start: number, maxlen: number) : number {
        var i = start;
        var n = 0;
        var branches = new Set();
        do {
            var op = insns[i];
            var ilen = validinsns_6502[op];
            if (!ilen) break;
            branches.delete(i);
            // check branch target
            if ((op & 0x1f) == 0x10) {
                var rel = insns[i+1];
                if (rel >= 0x80) break; // don't allow backwards
                var bofs = i+2+rel;
                branches.add(bofs);
            }
            //debug(i.toString(16), disassemble6502(i, insns[i], insns[i+1], insns[i+2]));
            i += ilen;
        } while (i < insns.length && i < start+maxlen);
        branches.delete(start+maxlen);
        if (branches.size) return 0;
        return i - start;
    }

    canonicalizeSequence(insns: Uint8Array) {
        var i = 0;
        var _zp = ZPSTART;
        var _abs = ABSPG << 8;
        var map = {};
        var result = { constants: [], offsets: [], map: map };
        do {
            result.offsets.push(i);
            var op = insns[i];
            var op1 = insns[i+1];
            var op2 = insns[i+2];
            var opc = OPS_6502[op];
            var a;
            switch (opc.am) {
              case "aa":
              case "(aa),y":
                if (_zp >= 0x100) return false;
                if (map[op1] >= 0) {
                    a = map[op1];
                } else {
                    a = map[op1] = _zp;
                }
                insns[i+1] = a;
                _zp += 1;
                if (opc.am == "(aa),y") _zp += 1;
                break;
              case "AAAA":
              case "AAAA,x":
              case "AAAA,y":
                if (_abs >= ENDPG*256) return false;
                a = op1 + op2*256;
                if (map[a] >= 0) {
                    a = map[a];
                } else {
                    a = map[a] = _abs;
                }
                insns[i+1] = a & 0xff;
                insns[i+2] = a >> 8;
                _abs += (opc.am == "AAAA") ? 1 : 256;
                break;
              case "aa,x":
              case "(aa,x)":
                if (map[op1] >= 0) {
                    a = map[op1];
                } else {
                    if (_zp > ZPSTART) return false;
                    a = map[op1] = 0;
                    _zp = 0x100;
                }
                insns[i+1] = a;
                break;
              case "#aa":
                result.constants.push(i+1);
                break;
            }
            debug(i.toString(16), '\t', disassemble6502(i, insns[i], insns[i+1], insns[i+2]).line);
            i += opc.nb;
        } while (i < insns.length);
        return result;
    }

    process(bindata: Uint8Array, binpath: string) {
      for (var i=0; i<bindata.length; i++) {
        var maxlen = maxseqlen;
        while (maxlen >= minseqlen) {
          var seqlen = this.validateSequence(bindata, i, maxlen);
          if (seqlen < minseqlen)
            break;
          var insns = bindata.slice(i, i+seqlen);
          var canon = this.canonicalizeSequence(insns);
          if (canon) {
            var results = this.vecs.map((vec) => this.runOne(insns, vec));
            if (results.length) {
              if (this.addFragment) this.addFragment(insns, i);
              var prints = getFingerprints(results);
              for (var sym in prints) {
                debug('+', prints[sym], sym, i, seqlen, binpath);
                if (this.addFingerprint) this.addFingerprint(insns, prints[sym], sym);
              }
            }
            maxlen = canon.offsets.pop();
          } else {
            break; // TODO? maxlen--;
          }
        }
      }
    }
    
    addFragment : (insns:Uint8Array, offset:number) => void;
    addFingerprint : (insns:Uint8Array, print:string, sym:string) => void;

}

///

const fs = require('fs');
const util = require('util');
const sqlite3 = require('better-sqlite3');
const getopts = require("getopts")

const options = getopts(process.argv.slice(2), {
    alias: {
        help: "h",
        scan: "s",
        db: "d",
        verbose: "v",
    },
    default: {
        db: null,
        query: null,
        scan: false,
        verbose: false,
    },
    boolean: ["scan","verbose"],
});
if (options.help) {
    console.log("Usage: program --db [.db] --scan [files] | --query query");
    process.exit(1);
}


var minseqlen = 2;
var maxseqlen = 32;

var fingerprints = new Map();

function getFingerprints(results) {
  var symbols = new Set<string>();
  results.forEach((vec) => { for (var k of Object.keys(vec)) symbols.add(k) });
  var prints = {};
  for (var sym of Array.from(symbols)) {
      var testv = results.map((vec) => vec[sym]);
      testv = testv.map((v) => (v>=0) ? v.toString(16).padStart(2,'0') : 'x');
      prints[sym] = testv.join('');
  }
  return prints;
}

function getTestVectors() {
  var vecs = [];
  vecs.push(new TestVector(0x00, false));
  vecs.push(new TestVector(0x01, false));
  vecs.push(new TestVector(0x80, false));
  vecs.push(new TestVector(0xfe, false));
  vecs.push(new TestVector(0xff, false));
  for (var i=1; i<=16-5; i++) {
    vecs.push(new TestVector(i, true));
  }
  return vecs;
}

function scanFiles(db) {
  var runner = new TestRunner6502();
  runner.cpu = new MOS6502();
  runner.vecs = getTestVectors();
  var fragid = 0;
  if (db) {
    console.log('#', db);
    db.pragma('journal_mode = MEMORY'); // TODO?
    var insertSource = db.prepare("INSERT OR IGNORE INTO sources (fragid, filename, offset) VALUES (?,?,?)");
    var insertFragment = db.prepare("INSERT OR IGNORE INTO fragments (insns) VALUES (?)");
    var insert = db.prepare("INSERT OR IGNORE INTO prints (vec,fragid,sym) VALUES (?,?,?)");
    runner.addFingerprint = (insns:Uint8Array, print:string, sym:string) => {
      insert.run(print, fragid, sym);
    }
  }
  var paths = options._;
  var nextfile = () => {
    var binpath = paths.shift();
    if (binpath) {
      var binfilename = binpath.split('/').slice(-1)[0];
      if (db) {
        runner.addFragment = (insns:Uint8Array, offset:number) => {
          var info = insertFragment.run(insns);
          fragid = info.lastInsertRowid;
          insertSource.run(fragid, binfilename, offset);
        }
      }
      console.log("#file", binpath);
      var bindata = fs.readFileSync(binpath, null);
      runner.process(bindata, binfilename);
    } else {
      process.exit(0);
    }
    setImmediate(nextfile);
  };
  nextfile();
}

function runQuery(vec, func) {
    var rs = new RunState();
    rs.base = vec;
    var rtn = func.call(rs, rs);
    return rs.outputs;
}

function doQuery(db, funcbody:string) {
    var vecs = getTestVectors();
    var func = new Function('$', '"use strict";' + funcbody);
    var results = vecs.map((vec) => runQuery(vec, func));
    //console.log(results);
    var prints = getFingerprints(results);
    console.log(prints);
    if (db) {
        var qp = db.prepare("SELECT fragid FROM prints WHERE vec=? AND sym=?");
        var qf = db.prepare("SELECT * FROM fragments f INNER JOIN sources s WHERE s.fragid=f.rowid AND s.fragid=?");
        for (var sym in prints) {
            var res = qp.all(prints[sym], sym);
            for (var row of res) {
                var frag = qf.get(row.fragid);
                console.log(row.fragid,frag);
            }
        }
    }
}

verbose = options.verbose;
if (verbose) console.log(options)
var db;
if (options.db) {
  db = new sqlite3(options.db); //, { verbose: console.log });
}
if (options.scan) {
    scanFiles(db);
}
if (options.query) {
    doQuery(db, options.query);
}
