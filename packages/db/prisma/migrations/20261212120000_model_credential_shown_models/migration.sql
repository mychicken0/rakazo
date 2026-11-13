ALTER TABLE "user_model_credentials" ADD COLUMN "shownModelIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
