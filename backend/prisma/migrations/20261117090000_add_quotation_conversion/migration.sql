-- Additive only: records which sale a quotation was converted into.
ALTER TABLE "quotations" ADD COLUMN "converted_sale_id" BIGINT;
CREATE UNIQUE INDEX "quotations_converted_sale_id_key" ON "quotations"("converted_sale_id");
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_converted_sale_id_fkey" FOREIGN KEY ("converted_sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER quotations_same_business_sale BEFORE INSERT OR UPDATE OF converted_sale_id, business_id ON "quotations"
  FOR EACH ROW EXECUTE FUNCTION nexa_enforce_same_business('converted_sale_id', 'sales');
