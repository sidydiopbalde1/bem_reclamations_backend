ALTER TABLE "Reclamation"
ADD COLUMN "assignedToId" TEXT;

ALTER TABLE "Reclamation"
ADD CONSTRAINT "Reclamation_assignedToId_fkey"
FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
