import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {check} from './engine.mjs';

const upstream = new URL('upstream/tlatools/org.lamport.tlatools/test/tla2sany/', import.meta.url);
const read = path => readFileSync(new URL(path, upstream), 'utf8');
const header = '---- MODULE Parser ----\nVARIABLE x\nInit == x = 0\nNext == x\' = x\n';
const supported = new Set(['\\/', '/\\', '/=', '=', '<', '>', '<=', '>=', '\\in', '..', '+', '-', '*']);
const operators = new Map();
const table = read('parser/OperatorPrecedenceTests.java');
for (const m of table.matchAll(/new Operator\(FixKind\.INFIX, new String\[\] \{([^}]+)\}, (\d+), (\d+), (true|false)\)/g)) {
  for (const symbol of JSON.parse('[' + m[1] + ']')) {
    if (supported.has(symbol)) operators.set(symbol, {low:+m[2], high:+m[3], associative:m[4]==='true'});
  }
}
test('all supported infix pairs follow upstream precedence and associativity', () => {
  assert.deepEqual(new Set(operators.keys()), supported);
  for(const [a, left] of operators) for(const [b, right] of operators) {
    const overlap = left.low <= right.high && right.low <= left.high;
    const conflict = overlap && (a !== b || !left.associative);
    const expr = '1 ' + a + ' 2 ' + b + ' 3';
    const r = check(header + 'Probe == ' + expr + '\n====');
    if (conflict) assert.match(r.error ?? '', /Precedence conflict/, expr);
    else assert.equal(r.status, 'passed', expr);
  }
});

const unsupportedUnits = /Division Infix|Keyword-Unit|Empty Tuple|Empty Set|Colon-Prefixed/;
for (const file of ['conjlist','disjlist','jlist']) {
  const cases = read('corpus/' + file + '.txt').split(/^=+\|\|\|\s*$/m);
  for (let i=1; i<cases.length; i+=2) {
    const [name, directive] = cases[i].trim().split('\n');
    const source = cases[i+1].split(/^-+\|\|\|/m)[0].trim()
      .replace(/^---- MODULE Test ----/, header.trimEnd());
    test(file + ': ' + name, () => {
      const r = check(source);
      if (directive === ':error' || unsupportedUnits.test(name)) assert.equal(r.status,'error');
      else assert.equal(r.status, 'passed', r.error);
    });
  }
}
