CREATE TABLE "scheduled_job_locks" (
    "name" TEXT NOT NULL,
    "ownerToken" TEXT NOT NULL,
    "leaseUntil" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "scheduled_job_locks_pkey" PRIMARY KEY ("name")
);

CREATE INDEX "scheduled_job_locks_leaseUntil_idx"
    ON "scheduled_job_locks" ("leaseUntil");
