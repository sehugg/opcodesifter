var assert = require('assert');
describe('Array', function() {
  describe('#indexOf()', function() {
    it('should return -1 when the value is not present', function() {
      assert.equal([1, 2, 3].indexOf(4), -1);
    });
  });
});

import { getTestVectors, TestRunner6502 } from '../src/main'

var runner;

function testCanon(source, target) {
  var vecs = getTestVectors();
  var insns = new Uint8Array(source);
  var canon = runner.canonicalizeSequence(insns);
  assert.ok(canon);
  assert.deepEqual(target, insns);
}

describe('6502', function() {
  var vecs = getTestVectors();
  runner = new TestRunner6502(vecs);
  describe('canonizer', function() {
    it('should canonize absolute', function() {
      testCanon([0xa5, 0x00],
                [0xa5, 0x20]);
      
      testCanon([0xa9, 0x12],
                [0xa9, 0x12]);
      
      testCanon([0xa5, 0x12, 0xa5, 0xff], 
                [0xa5, 0x20, 0xa5, 0x21]);
                
      testCanon([0xa5, 0x12, 0x6d, 0x12, 0x13, 0x2d, 0xff, 0xff, 0x2d, 0x12, 0x13],
                [0xa5, 0x20, 0x6d, 0x00, 0x02, 0x2d, 0x01, 0x02, 0x2d, 0x00, 0x02]);
    });
    it('should canonize indirect', function() {
      testCanon([0x71, 0x71, 0xa5, 0x71],
                [0x71, 0x20, 0xa5, 0x20]);
                
      testCanon([0x71, 0x71, 0xa5, 0x72], 
                [0x71, 0x20, 0xa5, 0x21]);
                
      testCanon([0xa5, 0x72, 0x71, 0x71], 
                [0xa5, 0x21, 0x71, 0x20]);
    });
  });
});
