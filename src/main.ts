
import { CPU, Bus, ClockBased, SavesState, Interruptable } from "./devices";
import { MOS6502 } from "./cpu/MOS6502";
import { disassemble6502, OPS_6502 } from "./cpu/disasm6502";

const util = require('util');

const MAX_CYCLES = 2000;
const MAX_FINGERPRINTS = 100;

class SimError extends Error {
  isSimError = true;
}

var verbose : number = 0;
export function setVerbosity(v : number) { verbose = v; }

function debug(...args) {
  if (verbose) process.stdout.write(util.format.apply(this, arguments) + '\n');
}

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
    
    getRegisters6502() {
      return {
        A: this.mem[0xff00],
        X: this.mem[0xff01],
        Y: this.mem[0xff02],
        N: (this.mem[0xff03] & 0x80) ? 1 : 0,
        V: (this.mem[0xff03] & 0x40) ? 1 : 0,
        C: (this.mem[0xff03] & 0x01) ? 1 : 0,
        Z: (this.mem[0xff03] & 0x02) ? 1 : 0,
        SP: this.mem[0xff04],
      }
    };
    
    getDefaultValueForSymbol(sym: string) {
        var regs = this.getRegisters6502();
        if (regs[sym] != null)
          return regs[sym];
        else if (sym.length > 1)
          return this.mem[parseInt(sym.substring(1), 16)];
        else
          return null;
    }

    ensureSymbol(outputs:{}, sym: string) {
        if (outputs[sym] == null) {
            outputs[sym] = this.getDefaultValueForSymbol(sym);
        }
    }

}

const ZPSTART = 0x20;
const ABSPG = 0x02;
const INDPG = 0x03;
const ENDPG = 0x08;

class RunState implements Bus {
    insns: Uint8Array;
    base : TestVector;
    syms = {};
    outputs = {};

    constructor(insns: Uint8Array, vec: TestVector) {
      this.base = vec;
      this.insns = insns;
    }

    getSymbol(address: number, iswrite: boolean) {
        var sym = this.syms[address];
        var name;
        if (address < 0x100) name = 'z'+address.toString(16); // zeropage
        else if (address < INDPG*256) name = 'a'+address.toString(16); // absolute
        else if (address < ENDPG*256) name = 'n'+address.toString(16); // iNdexed
        else name = 'i'+address.toString(16); // Indirect
        if (!sym) sym = this.syms[address] = { sym: name, input: false, output: false, indexed: name=='$' };
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
            } else if (this.insns && (address & 0xff) <= this.insns.length) {
                return this.insns[address & 0xff] & 0xff;
            }
        }
        var sym = this.getSymbol(address, false);
        var val = this.outputs[sym.sym];
        if (val != null) debug('read',address,sym,val);
        if (val != null)
          return val & 0xff;
        else
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
}

class Inputs {
    rs: RunState;
    constructor(rs: RunState) { this.rs = rs; }

    get(a: string|number|Array<string>) : number {
        if (typeof a == 'string')
            return this.getreg(a);
        else if (typeof a == 'number')
            return this.rs.read(a);
        else if (a instanceof Array) {
            let shift = 0;
            let v = 0;
            for (var b of a) {
                v |= this.get(b) << shift;
                shift += 8;
            }
            return v;
        }
    }
    getreg(register: string) : number {
        return this.rs.base.getRegisters6502()[register] & 0xff;
    }
    read(address: number) : number {
        return this.rs.read(address);
    }
    read8(address: number) : number {
        return this.rs.read(address);
    }
    read16(address: number) : number {
        var lo = this.rs.read(address);
        var hi = this.rs.read(address+1);
        return lo + (hi<<8);
    }
    s8(x: number) : number {
        return (x & 0x80) ? x-256 : x;
    }
    s16(x: number) : number {
        return (x & 0x8000) ? x-65536 : x;
    }
}

class Outputs {
    rs: RunState;
    constructor(rs: RunState) { this.rs = rs; }
    
    set(a: string|number|Array<string>, v: number) : void {
        if (typeof a == 'string')
            this.rs.outputs[a] = v & 0xff;
        else if (typeof a == 'number')
            this.rs.write(a, v);
        else if (a instanceof Array) {
            for (var b of a) {
                this.set(b, v & 0xff);
                v >>= 8;
            }
        }
    }
    write(address: number, value : number) : void {
        this.rs.write(address, value);
    }
    write8(address: number, value : number) : void {
        this.rs.write(address, value);
    }
    write16(address: number, value : number) : void {
        this.rs.write(address, value & 0xff);
        this.rs.write(address+1, value >> 8);
    }
}

type RunResult = {};
type Fingerprints = {};

export abstract class TestRunner {
  vecs : TestVector[];
  rs : RunState;
  nooprints : {};

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
          let exists = false;
          if (this.addFragment) {
            exists = this.addFragment(insns, i);
          }
          if (!exists) {
            try {
              var results = this.vecs.map((vec) => this.runOne(insns, vec));
              var prints = getFingerprints(this.vecs, results);
              if (this.isTooMuch(prints)) {
                debug('TOOMUCH', prints);
              } else if (this.isBoring(prints)) {
                debug('BORING', prints);
              } else {
                for (var sym in prints) {
                  debug('+', prints[sym], sym, i, seqlen, binpath);
                  if (this.addFingerprint) this.addFingerprint(insns, prints[sym], sym);
                }
              }
            } catch (e) {
              if (!e['isSimError']) throw e;
            }
          }
          maxlen = canon.offsets.pop();
        } else {
          break; // TODO? maxlen--;
        }
      }
    }
  }

  isBoring(prints : Fingerprints) : boolean {
    for (var k in prints) {
      if (prints[k] != this.nooprints[k] && !/^(..)\1+$/.test(prints[k]) ) // ex: 0101010101
        return false;
    }
    return true;
  }

  isTooMuch(prints : Fingerprints) : boolean {
    return Object.keys(prints).length > MAX_FINGERPRINTS;
  }

  abstract runOne(insns: Uint8Array, vec: TestVector) : {};
  abstract validateSequence(insns: Uint8Array, start: number, maxlen: number) : number;
  abstract canonicalizeSequence(insns: Uint8Array) : false | CanonicalizeResult;

  addFragment : (insns:Uint8Array, offset:number) => boolean;
  addFingerprint : (insns:Uint8Array, print:string, sym:string) => void;
}

interface CanonicalizeResult {
  constants : number[];
  offsets : number[];
  map : {};
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

export class TestRunner6502 extends TestRunner {
    cpu: MOS6502;
    
    constructor(vecs) {
      super();
      this.cpu = new MOS6502();
      this.vecs = vecs;
      this.nooprints = getFingerprints(vecs, vecs.map((vec) => this.runOne(new Uint8Array(0), vec)));
    }
    
    runOne(insns: Uint8Array, vec: TestVector) : RunResult {
        this.rs = new RunState(insns, vec);
        this.cpu.connectMemoryBus(this.rs);
        this.cpu.reset();
        var s0 = this.cpu.saveState();
        Object.assign(s0, vec.getRegisters6502());
        s0.D = 0;
        this.cpu.loadState(s0);
        var start = 0xff00;
        var end = start + insns.length;
        var count = 0;
        do {
            this.cpu.advanceClock();
            count += 1;
            /*
            var opc = this.rs.read(pc);
            if (opc == 0x60) { // RTS
              break;
            }
            */
            if (count > MAX_CYCLES) {
                debug("exceeded insn limit", start, pc, end);
                throw new SimError();
            }
            var pc = this.cpu.getPC();
            if (pc < start) {
              debug("ran before the start");
              throw new SimError();
            }
            if (pc > end) {	
              debug("ran after the end");
              throw new SimError();
            }
        } while (pc != end);
        var s1 = this.cpu.saveState();
        if (s1.SP != s0.SP) {
            debug("stack mismatch");
            throw new SimError();
        }
        if (s1.D) {
            debug("decimal mode");
            throw new SimError();
        }
        if (count > 100) debug("simulated", count, "cycles");
        // TODO: check D flag, SP = SP'
        var r = this.rs.outputs;
        for (var reg of ['A','X','Y','N','V','C','Z']) {
            r[reg] = s1[reg];
        }
        return r;
    }

    validateSequence(insns: Uint8Array, start: number, maxlen: number) : number {
        var i = start;
        var n = 0;
        do {
            var op = insns[i];
            var ilen = validinsns_6502[op];
            if (!ilen) break;
            // check branch target
            if ((op & 0x1f) == 0x10) {
                var rel = insns[i+1];
                if (rel == 0) return 0;
                var bofs = rel < 128 ? i+2+rel : i+2-(256-rel);
                if (bofs < 0 || bofs > insns.length) return 0;
            }
            if (verbose) debug(i.toString(16), disassemble6502(i, insns[i], insns[i+1], insns[i+2]));
            i += ilen;
        } while (i < insns.length && i < start+maxlen);
        return i - start;
    }

    canonicalizeSequence(insns: Uint8Array) : false | CanonicalizeResult {
        var i = 0;
        var _zp = ZPSTART;
        var _abs = ABSPG << 8;
        var _ind = INDPG << 8;
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
                   _zp += 1;
                   if (opc.am == "(aa),y") _zp += 1;
                }
                insns[i+1] = a;
                break;
              case "AAAA":
                if (_abs >= ABSPG*256+256) return false;
                a = op1 + op2*256;
                if (map[a] >= 0) {
                    a = map[a];
                } else {
                    a = map[a] = _abs;
                    _abs += 1;
                }
                insns[i+1] = a & 0xff;
                insns[i+2] = a >> 8;
                break;
              case "AAAA,x":
              case "AAAA,y":
                if (_ind >= ENDPG*256) return false;
                a = op1 + op2*256;
                if (map[a] >= 0) {
                    a = map[a];
                } else {
                    a = map[a] = _ind;
                    _ind += 256;
                }
                insns[i+1] = a & 0xff;
                insns[i+2] = a >> 8;
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
            if (verbose) debug(i.toString(16), '\t', disassemble6502(i, insns[i], insns[i+1], insns[i+2]).line);
            i += opc.nb;
        } while (i < insns.length);
        return result;
    }

}

///


var minseqlen = 2;
var maxseqlen = 32;

var fingerprints = new Map();

function allSameValues(arr) : boolean {
    return arr.every((x) => x === arr[0]);
}

var symsum = 0;
var symcnt = 0;

export function getFingerprints(vecs:TestVector[], results:RunResult[]) : Fingerprints {
  var symbols = new Set<string>();
  results.forEach((vec) => {
      for (var k of Object.keys(vec)) symbols.add(k)
  });
  symsum += symbols.size;
  symcnt += 1;
  for (var i=0; i<vecs.length; i++) {
      var vec = vecs[i];
      var res = results[i];
      symbols.forEach((k) => vec.ensureSymbol(res, k));
  }
  var prints = {};
  for (var sym of Array.from(symbols)) {
      var testv = results.map((vec) => vec[sym]);
      if (true) { // || !allSameValues(testv)) { // skip constant results?
        testv = testv.map((v) => v == null ? 'x' : v.toString(16).padStart(2,'0'));
        prints[sym] = testv.join('');
      }
  }
  return prints;
}

export function getTestVectors() : TestVector[] {
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

function scanFiles(db, paths) {
  const fs = require('fs');
  var runner = new TestRunner6502(getTestVectors());
  var fragid = 0;
  if (db) {
    console.log('#', db);
    db.pragma('journal_mode = MEMORY');
    db.pragma('synchronous = OFF');
    var selectFragment = db.prepare("SELECT id FROM fragments WHERE insns = ?");
    var insertFragment = db.prepare("INSERT INTO fragments (insns) VALUES (?)");
    var insertSource = db.prepare("INSERT OR IGNORE INTO sources (fragid, filename, offset) VALUES (?,?,?)");
    var insert = db.prepare("INSERT OR IGNORE INTO prints (vec, fragid, sym) VALUES (?,?,?)");
    runner.addFingerprint = (insns:Uint8Array, print:string, sym:string) => {
      insert.run(print, fragid, sym);
    }
  }
  var nextfile = () => {
    var binpath = paths.shift();
    if (binpath) {
      var binfilename = binpath.split('/').slice(-1)[0];
      console.log("#file", binpath, symsum/symcnt);
      var bindata = fs.readFileSync(binpath, null);
      if (db) {
        runner.addFragment = (insns:Uint8Array, offset:number) => {
          var exists = false;
          var info = selectFragment.get(insns);
          if (info == null) {
            info = insertFragment.run(insns);
            fragid = info.lastInsertRowid;
          } else {
            fragid = info.id;
            exists = true;
          }
          if (!fragid) console.log("zero row id",offset);
          insertSource.run(fragid, binfilename, offset);
          return exists;
        }
      }
      runner.process(bindata, binfilename);
    } else {
      process.exit(0);
    }
    setImmediate(nextfile);
  };
  nextfile();
}

function runQuery(vec, func) {
    var rs = new RunState(null, vec);
    var rtn = func.call(rs, new Inputs(rs), new Outputs(rs));
    return rs.outputs;
}

function doQuery(db, funcbody:string) {
    var vecs = getTestVectors();
    var func = new Function('i', 'o', '"use strict";\n' + funcbody);
    var results = vecs.map((vec) => runQuery(vec, func));
    var prints = getFingerprints(vecs, results);
    console.log(prints);
    if (db) {
        var args = [];
        var sql = "SELECT DISTINCT insns,filename FROM fragments f INNER JOIN sources s WHERE s.fragid=f.rowid ";
        for (var sym in prints) {
            sql += " AND f.id IN (SELECT fragid FROM prints WHERE sym=? AND vec=?)";
            args.push(sym);
            args.push(prints[sym]);
        }
        sql += " ORDER BY LENGTH(f.insns) DESC";
        if (args.length == 0) {
            console.log("No fingerprints generated.");
        } else {
            var q = db.prepare(sql);
            var res = q.all(args);
            for (var r of res) console.log(r);
            if (r && r.insns) {
              new TestRunner6502(vecs).canonicalizeSequence(r.insns);
            }
        }
    }
}

//

if (require.main === module) {

const sqlite3 = require('better-sqlite3');
const getopts = require("getopts")

const options = getopts(process.argv.slice(2), {
    alias: {
        help: "h",
        scan: "s",
        db: "d",
        verbose: "v",
        create: "C",
    },
    default: {
        db: null,
        query: null,
        scan: false,
        verbose: false,
        create: false,
    },
    boolean: ["scan","verbose","create"],
});
if (options.help) {
    console.log("Usage: program --db [.db] --scan [files] | --query query | --create");
    process.exit(1);
}

verbose = options.verbose;
debug(options);
var db;
if (options.db) {
  db = new sqlite3(options.db); //, { verbose: console.log });
}
if (options.create) {
    console.log('creating database', options.db);
    db.exec(require('fs').readFileSync('create.sql', 'utf8'));
}
if (options.scan) {
    scanFiles(db, options._);
}
if (options.query) {
    doQuery(db, options.query);
}

process.on('exit', () => db.close());

} // end main
