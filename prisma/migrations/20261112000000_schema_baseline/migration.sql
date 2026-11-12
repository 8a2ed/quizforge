-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "QuizType" AS ENUM ('QUIZ', 'POLL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "username" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_credentials" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "instructor_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "photoUrl" TEXT,
    "isForum" BOOLEAN NOT NULL DEFAULT false,
    "memberCount" INTEGER,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "correctOptionId" INTEGER,
    "explanation" TEXT,
    "type" "QuizType" NOT NULL DEFAULT 'QUIZ',
    "isAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "allowsMultiple" BOOLEAN NOT NULL DEFAULT false,
    "openPeriod" INTEGER,
    "topicId" INTEGER,
    "topicName" TEXT,
    "mediaUrl" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "recurrence" TEXT,
    "sentAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "pollClosed" BOOLEAN NOT NULL DEFAULT false,
    "messageId" INTEGER,
    "pollId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowAddingOptions" BOOLEAN NOT NULL DEFAULT false,
    "allowRevoting" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupId" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_answers" (
    "id" TEXT NOT NULL,
    "optionIds" INTEGER[],
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quizId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "firstName" TEXT,
    "username" TEXT,

    CONSTRAINT "poll_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '📁',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_quizzes" (
    "collectionId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_quizzes_pkey" PRIMARY KEY ("collectionId","quizId")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "topicId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "iconColor" INTEGER,
    "iconCustomEmojiId" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_configs" (
    "id" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "defaultAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "defaultOpenPeriod" INTEGER NOT NULL DEFAULT 0,
    "defaultType" "QuizType" NOT NULL DEFAULT 'QUIZ',
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "bot_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "questions" JSONB NOT NULL,
    "timeLimit" INTEGER,
    "passingScore" INTEGER NOT NULL DEFAULT 60,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "launchMsgId" INTEGER,
    "topicId" INTEGER,
    "topicName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_results" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "telegramId" TEXT,
    "answers" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "duration" INTEGER,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "examId" TEXT NOT NULL,

    CONSTRAINT "exam_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_feedbacks" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "groupId" TEXT,
    "telegramId" TEXT NOT NULL,
    "name" TEXT,
    "username" TEXT,
    "rating" INTEGER NOT NULL,
    "suggestion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_credentials_username_key" ON "instructor_credentials"("username");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_credentials_userId_key" ON "instructor_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "groups_chatId_key" ON "groups"("chatId");

-- CreateIndex
CREATE INDEX "group_members_groupId_userId_idx" ON "group_members"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_userId_groupId_key" ON "group_members"("userId", "groupId");

-- CreateIndex
CREATE INDEX "quizzes_groupId_createdAt_idx" ON "quizzes"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "quizzes_groupId_sentAt_idx" ON "quizzes"("groupId", "sentAt");

-- CreateIndex
CREATE INDEX "quizzes_scheduledAt_idx" ON "quizzes"("scheduledAt");

-- CreateIndex
CREATE INDEX "quizzes_sentAt_scheduledAt_idx" ON "quizzes"("sentAt", "scheduledAt");

-- CreateIndex
CREATE INDEX "quizzes_pollId_idx" ON "quizzes"("pollId");

-- CreateIndex
CREATE UNIQUE INDEX "poll_answers_quizId_telegramUserId_key" ON "poll_answers"("quizId", "telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "topics_groupId_topicId_key" ON "topics"("groupId", "topicId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_configs_webhookSecret_key" ON "bot_configs"("webhookSecret");

-- CreateIndex
CREATE UNIQUE INDEX "bot_configs_groupId_key" ON "bot_configs"("groupId");

-- CreateIndex
CREATE INDEX "exams_groupId_idx" ON "exams"("groupId");

-- CreateIndex
CREATE INDEX "exams_createdAt_idx" ON "exams"("createdAt");

-- CreateIndex
CREATE INDEX "exams_isPublished_idx" ON "exams"("isPublished");

-- CreateIndex
CREATE INDEX "exam_results_examId_telegramId_score_idx" ON "exam_results"("examId", "telegramId", "score");

-- CreateIndex
CREATE INDEX "exam_results_score_examId_idx" ON "exam_results"("score", "examId");

-- CreateIndex
CREATE INDEX "exam_results_examId_completedAt_idx" ON "exam_results"("examId", "completedAt");

-- CreateIndex
CREATE INDEX "exam_results_telegramId_idx" ON "exam_results"("telegramId");

-- CreateIndex
CREATE INDEX "exam_feedbacks_examId_idx" ON "exam_feedbacks"("examId");

-- CreateIndex
CREATE INDEX "exam_feedbacks_telegramId_idx" ON "exam_feedbacks"("telegramId");

-- CreateIndex
CREATE INDEX "exam_feedbacks_groupId_idx" ON "exam_feedbacks"("groupId");

-- CreateIndex
CREATE INDEX "exam_feedbacks_createdAt_idx" ON "exam_feedbacks"("createdAt");

-- CreateIndex
CREATE INDEX "exam_feedbacks_rating_idx" ON "exam_feedbacks"("rating");

-- CreateIndex
CREATE UNIQUE INDEX "exam_feedbacks_examId_telegramId_key" ON "exam_feedbacks"("examId", "telegramId");

-- AddForeignKey
ALTER TABLE "instructor_credentials" ADD CONSTRAINT "instructor_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_answers" ADD CONSTRAINT "poll_answers_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_quizzes" ADD CONSTRAINT "collection_quizzes_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_quizzes" ADD CONSTRAINT "collection_quizzes_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_configs" ADD CONSTRAINT "bot_configs_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_feedbacks" ADD CONSTRAINT "exam_feedbacks_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_feedbacks" ADD CONSTRAINT "exam_feedbacks_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
