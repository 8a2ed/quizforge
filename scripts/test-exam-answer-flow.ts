import assert from "node:assert/strict";
import {
  extractStudentMasterAnswers,
  mapStudentAnswersToMaster,
  type StudentExamQuestion,
} from "../lib/examConfig";

const shuffledQuestions: StudentExamQuestion[] = [
  {
    question: "Second master question",
    options: ["C", "A", "B"],
    correctOptionId: 0,
    explanation: "",
    originalQIndex: 1,
    originalOptionIndices: [2, 0, 1],
  },
  {
    question: "First master question",
    options: ["B", "A"],
    correctOptionId: 1,
    explanation: "",
    originalQIndex: 0,
    originalOptionIndices: [1, 0],
  },
];

const studentAnswers: Record<number, number> = { 0: 1, 1: 0 };
const masterAnswers = mapStudentAnswersToMaster(shuffledQuestions, studentAnswers);
assert.deepEqual(masterAnswers, { 1: 0, 0: 1 });

// JSON storage turns numeric object keys into strings; the result reader must retain them.
assert.deepEqual(extractStudentMasterAnswers(JSON.stringify(masterAnswers)), { "0": 1, "1": 0 });

// A saved in-progress session stores randomized questions and student-indexed answers.
const sessionSnapshot = JSON.stringify({ answers: studentAnswers, questions: shuffledQuestions });
assert.deepEqual(extractStudentMasterAnswers(sessionSnapshot), { "0": 1, "1": 0 });

assert.deepEqual(extractStudentMasterAnswers(JSON.stringify({})), {});
assert.deepEqual(extractStudentMasterAnswers([{ chosenOptionId: 1 }, { optionIndex: 0 }]), { "0": 1, "1": 0 });
assert.deepEqual(extractStudentMasterAnswers({ answers: { "0": "", invalid: 2 } }), {});
console.log("Exam answer mapping and JSON recovery checks passed.");
