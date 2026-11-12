-- Parameters: result id, expected question index, answer option, next index, activity timestamp.
-- json_patch preserves the randomized question snapshot and only changes answer progress.
UPDATE exam_results
SET answers = json_patch(
  answers,
  json_object(
    'answers', json_patch(
      COALESCE(json_extract(answers, '$.answers'), '{}'),
      json_object(CAST(CAST(?2 AS INTEGER) AS TEXT), ?3)
    ),
    'currentQ', ?4,
    'lastActiveAt', ?5,
    'msgId', COALESCE(json_extract(answers, '$.msgId'), 0),
    'chatId', COALESCE(json_extract(answers, '$.chatId'), 0)
  )
)
WHERE id = ?1
  AND score = -1
  AND json_extract(answers, '$.currentQ') = ?2;
