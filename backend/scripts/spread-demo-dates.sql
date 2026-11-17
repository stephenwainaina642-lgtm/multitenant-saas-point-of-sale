-- Spreads the sale dates of ONE demo business over the last 30 days (so month reports have something to show).
-- Safe by design: only touches the business whose id you pass AND whose name starts with 'Demo Shop'.
-- Run:  psql "$DATABASE_URL" -v biz=<business id printed by seed-demo.mjs> -f scripts/spread-demo-dates.sql
\set ON_ERROR_STOP on
begin;
-- Guard: if the business is missing or not a Demo Shop this divides by zero, the script stops and nothing changes.
select 1 / count(*) as guard_ok from businesses where id = :biz and name like 'Demo Shop%';
with spread as (
  select id, now() - (random() * interval '29 days') - (random() * interval '10 hours') as ts
  from sales where business_id = :biz
), s as (
  update sales set sale_date = spread.ts from spread where sales.id = spread.id returning sales.id, spread.ts
)
update payments p set payment_date = s.ts from s where p.sale_id = s.id and p.business_id = :biz;

select count(*) as sales_moved, min(sale_date)::date as earliest, max(sale_date)::date as latest from sales where business_id = :biz;
commit;
