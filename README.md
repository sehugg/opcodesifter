
OpcodeSifter
------------

This was inspired by
[Automatic Generation of Peephole Superoptimizers](https://theory.stanford.edu/~aiken/publications/papers/asplos06.pdf)
(PDF)
and this [GitHub project](https://github.com/RussellSprouts/6502-enumerator).

This program builds a database of searchable machine-language routines.

1. Scan a corpus of 6502 (future: Z80) code
2. Pick out the non-looping non-illegal fragments
3. Canonicalize the code, i.e. change memory addresses to predictable values
4. Execute the code on a series of test data vectors
5. Generate fingerprints (record the outputs)
6. Put the results in a SQLite database

You can then search the database for code fragments which meet a certain
fingerprint.


Searching
=========

For example, the Apple ][ has a strange frame buffer layout which requires a
complex calcuation:

~~~
0x2000 + (scanline&7)*0x400 + ((scanline>>3) & 7)*0x80 + (scanline>>6)*0x28
~~~

This is usually done with a lookup table, but some programs calculate this
value.

We'll look for a routine which computes this value and places the result in a 16-bit
(two-byte) zero-page address.
Our canonicalization procedure converts zero-page addresses to $20, $21,
$22, etc.
So we'll look for it in $20/$21.

After populating the database with a bunch of Apple II disk images, we run this command:

~~~
npm run main -- --db 6502c.db --query "var A=i.get(['A']); o.write16(0x20, 0x2000 + (A&7)*0x400 + ((A>>3)&7)*0x80 + (A>>6)*0x28)" -v
~~~

This finds the following routine:

~~~
0        PHA 
1        AND #$C0
3        STA $20
5        LSR 
6        LSR 
7        ORA $20
9        STA $20
b        PLA 
c        STA $21
e        ASL 
f        ASL 
10       ASL 
11       ROL $21
13       ASL 
14       ROL $21
16       ASL 
17       ROR $20
19       LDA $21
1b       AND #$1F
1d       ORA #$20
1f       STA $21
~~~



Canonicalization
================

~~~
aa       starts at $20
(aa),y   starts at $20, increments by 2
aaaa     starts at $200
aaaa,x/y starts at $300/$400/$500/$600/$700
(aa,x) and aa,x     starts at $00, only one unique address allowed
#aa      left alone
~~~

Usage
=====

Installation:
~~~
npm i
~~~

Scan a binary file:
~~~
npm run main -- --scan file.bin -v
~~~

Populate a database:
~~~
sqlite3 6502.db < create.sql
npm run main -- --db 6502.db --scan *.bin
~~~

Query the database:
~~~
npm run main -- --db 6502.db --query "out.write16(0x20, out.read16(0x20)+1)"
~~~
