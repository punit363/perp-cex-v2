-- Resolve duplicate market symbols before applying this constraint.
CREATE UNIQUE INDEX "Market_slug_key" ON "Market"("slug");
