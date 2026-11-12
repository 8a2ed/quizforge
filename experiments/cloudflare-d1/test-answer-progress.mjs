import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

db.prepare('INSERT INTO groups(id,title) VALUES (?,?)').run('g1', 'Test group');
db.prepare('INSERT INTO exams(id,group_id,title,questions) VALUES (?,?,?,?)')
  .run('e1', 'g1', 'Test exam', JSON.stringify([{ question: 'Q1' }, { question: 'Q2' }]));
const original = { questions: [{ question: 'randomized snapshot' }], answers: {}, currentQ: 0, startedAt: 10 };
db.prepare('INSERT INTO exam_results(id,exam_id,telegram_id,name,answers) VALUES (?,?,?,?,?)')
  .run('r1', 'e1', '123', 'Student', JSON.stringify(original));

const update = db.prepare(readFileSync(new URL('./answer-progress.sql', import.meta.url), 'utf8').replace(/^--.*\n/gm, ''));
const first = update.run('r1', 0, 2, 1, 1000);
assert.equal(first.changes, 1, 'first answer should advance session');
const afterFirst = JSON.parse(db.prepare('SELECT answers FROM exam_results WHERE id=?').get('r1').answers);
assert.deepEqual(afterFirst.answers, { 0: 2 });
assert.equal(afterFirst.currentQ, 1);
assert.deepEqual(afterFirst.questions, original.questions, 'question snapshot must be preserved');

const duplicate = update.run('r1', 0, 1, 1, 1001);
assert.equal(duplicate.changes, 0, 'stale duplicate must not overwrite the first accepted answer');
const afterDuplicate = JSON.parse(db.prepare('SELECT answers FROM exam_results WHERE id=?').get('r1').answers);
assert.deepEqual(afterDuplicate.answers, { 0: 2 });

console.log('D1 PoC: answer persistence, snapshot retention, and stale-update guard passed.');
db.close();
