
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
