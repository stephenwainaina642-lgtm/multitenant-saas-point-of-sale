-- Additive: lets a confirmed M-PESA request be tied to the sale it paid for. Existing rows get NULL.
ALTER TABLE "mpesa_payment_requests" ADD COLUMN "sale_id" BIGINT;
CREATE UNIQUE INDEX "mpesa_payment_requests_sale_id_key" ON "mpesa_payment_requests"("sale_id");
ALTER TABLE "mpesa_payment_requests" ADD CONSTRAINT "mpesa_payment_requests_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only a PAID request can be linked, and only to a sale of the same business.
CREATE OR REPLACE FUNCTION nexa_mpesa_request_sale_link() RETURNS trigger AS $$
BEGIN
  IF NEW.sale_id IS NOT NULL THEN
    IF NEW.status <> 'paid' THEN
      RAISE EXCEPTION 'only a paid M-PESA request can be linked to a sale';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = NEW.sale_id AND s.business_id = NEW.business_id) THEN
      RAISE EXCEPTION 'M-PESA request and sale belong to different businesses';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER mpesa_payment_requests_sale_link BEFORE INSERT OR UPDATE OF sale_id, status ON "mpesa_payment_requests"
  FOR EACH ROW EXECUTE FUNCTION nexa_mpesa_request_sale_link();
