-- CreateTable
CREATE TABLE "BlueprintSectionVersion" (
    "id" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blueprintSectionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,

    CONSTRAINT "BlueprintSectionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlueprintSectionVersion_blueprintSectionId_idx" ON "BlueprintSectionVersion"("blueprintSectionId");

-- CreateIndex
CREATE INDEX "BlueprintSectionVersion_projectId_idx" ON "BlueprintSectionVersion"("projectId");

-- AddForeignKey
ALTER TABLE "BlueprintSectionVersion" ADD CONSTRAINT "BlueprintSectionVersion_blueprintSectionId_fkey" FOREIGN KEY ("blueprintSectionId") REFERENCES "BlueprintSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlueprintSectionVersion" ADD CONSTRAINT "BlueprintSectionVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlueprintSectionVersion" ADD CONSTRAINT "BlueprintSectionVersion_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
