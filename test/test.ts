
import assert from 'assert';
import { setVerbosity, getTestVectors, getFingerprints, TestRunner6502 } from '../src/main'

setVerbosity(1);

function testCanon(source, target, targlen?) {
  var vecs = getTestVectors();
  var runner = new TestRunner6502(vecs);
  var insns = new Uint8Array(source);
  var canon = runner.canonicalizeSequence(insns);
  console.log(canon);
  if (canon === false) {
    assert.equal(false, target);
    return;
  } else {
    assert.deepEqual(Array.from(insns), Array.from(target));
  }
  var len = runner.validateSequence(insns, 0, 32);
  if (targlen !== undefined) {
    assert.equal(len, targlen);
  }
}

function getPrints(source) {
  var vecs = getTestVectors();
  var runner = new TestRunner6502(vecs);
  var insns = new Uint8Array(source);
  var canon = runner.canonicalizeSequence(insns);
  var len = runner.validateSequence(insns, 0, 32);
  var results = vecs.map((vec) => runner.runOne(insns, vec));
  var prints = getFingerprints(vecs, results);
  return prints;
}

function testEquiv(insns1, insns2) {
  var prints1 = getPrints(insns1);
  var prints2 = getPrints(insns2);
  assert.deepEqual(prints1, prints2);
}

describe('6502', function() {
  
  describe('canonizer', function() {

    it('should canonize zp/absolute', function() {
      testCanon([0xa5, 0x00],
                [0xa5, 0x20]);
      
      testCanon([0xa9, 0x12],
                [0xa9, 0x12]);
      
      testCanon([0xa5, 0x12, 0xa5, 0xff], 
                [0xa5, 0x20, 0xa5, 0x21]);
                
      testCanon([0xa5, 0x12, 0x6d, 0x12, 0x13, 0x2d, 0xff, 0xff, 0x2d, 0x12, 0x13],
                [0xa5, 0x20, 0x6d, 0x00, 0x02, 0x2d, 0x01, 0x02, 0x2d, 0x00, 0x02]);
    });

    it('should canonize (aa),y', function() {

      testCanon([0x71, 0x71, 0xa5, 0x71],
                [0x71, 0x20, 0xa5, 0x20]);
                
      testCanon([0x71, 0x71, 0xa5, 0x72], 
                [0x71, 0x20, 0xa5, 0x22]);

      testCanon([0xa5, 0x72, 0x71, 0x71], 
                [0xa5, 0x20, 0x71, 0x21]); // overlap
    });

    it('should canonize (aa),x', function() {

      testCanon([0x36, 0x88, 0x36, 0x88],
                [0x36, 0x00, 0x36, 0x00]);

      testCanon([0x36, 0x88, 0x36, 0x89],
                false);
    });
    
    it('should canonize aaaa,x/y', function() {
      testCanon([0x19, 0x88, 0x20, 0xde, 0x88, 0x20],
                [0x19, 0x00, 0x03, 0xde, 0x00, 0x03]);
                
      testCanon([0x19, 0x88, 0x20, 0xde, 0x88, 0x21],
                [0x19, 0x00, 0x03, 0xde, 0x00, 0x04]);
                
      testCanon([0x19, 0x88, 0x20, 0xde, 0x89, 0x20],
                [0x19, 0x00, 0x03, 0xde, 0x00, 0x04]); // overlap
    });

    it('should branch', function() {
      testCanon([0xd0, 0x02, 0xa9, 0x01],
                [0xd0, 0x02, 0xa9, 0x01],
                4);
                
      testCanon([0xd0, 0x04, 0xa9, 0x01],
                [0xd0, 0x04, 0xa9, 0x01],
                0);

      testCanon([0xc8, 0xd0, 0xfd],
                [0xc8, 0xd0, 0xfd],
                1);
    });

    it('should be equiv', function() {
    
      testEquiv([0xc8], [0xc8]);

      testEquiv([0xe6, 0x20, 0xd0, 0x02, 0xe6, 0x21, 0xa5, 0x21, 0x18, 0xb8],
                [0xa5, 0x30, 0x18, 0x69, 0x01, 0x85, 0x30, 0xa5, 0x31, 0x69, 0x00, 0x85, 0x31, 0x18, 0xb8]);
    });

  });

});
