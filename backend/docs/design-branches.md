# Design: branches with shared stock (BUILT: option B, stock per branch)

Status: approved and built. Migration `20261127090000_add_branches`. Notes on how it works:
- `branch_stock` is the truth; `products.stock_quantity` is the business total, recomputed by a database trigger, and a second trigger refuses direct edits of it (so manual SQL on that column now fails on purpose; change `branch_stock` instead).
- Legacy products with negative stock are not copied (a branch cannot hold less than nothing); the first real stock movement on them sets the total to the true sum.
- Which branch a request works in: `X-Branch-ID` for people with `branches.all`; staff assigned to a branch are kept in it; everyone else uses Main.
- Edits/voids return stock to the branch the sale was made in. Reports accept `?branchId=`.

---


Today one business = one location. "Add another business" creates a separate business with its own
products, stock and customers. A real branch is different: same business, same products and customers,
several places selling.

## What changes for existing data (why this needs approval)
- New table `branches` (id, business_id, name, address, phone, is_active). Every existing business gets
  one branch called "Main", created by the migration.
- Existing rows are tagged to that Main branch (sales, shifts, expenses, purchases, inventory
  movements) by a new nullable-then-filled `branch_id` column. Nothing is deleted or re-priced; totals
  do not change.
- Staff get an optional branch assignment; owners/managers see all branches.

## The one decision: what "shared stock" means
**Option A - one shared pool.** All branches sell from the single stock number that exists today.
Branch is only a label on sales, shifts, expenses and reports ("how did Westlands do?").
- Small, low risk, no stock data moved.
- Cannot answer "how many do I have at Westlands?" - the shop that is out of stock is invisible.

**Option B - stock per branch, products shared (recommended for real branches).**
Catalogue, prices and customers are shared; each product has a quantity per branch, and stock moves
between branches by a recorded **transfer** (out of A, into B, both in the movement history).
- Existing `products.stock_quantity` becomes the Main branch's quantity (copied, not removed, and the
  total across branches is checked against it by a test before anything else relies on it).
- Selling, purchasing, voids/refunds and stock counts happen against the branch the till is on.
- Larger: touches sale creation, void/edit, purchases, inventory screens, reports and the concurrency
  tests. Done in two steps: (1) branches + labels + branch reports, (2) per-branch stock + transfers.

## Safety rules (both options)
- Additive migration only; no drops, no resets of the development or live database.
- Test on a scratch database first, including a copy of realistic existing data.
- The live Supabase database changes only when you run the migration yourself.
- A branch with sales or stock cannot be deleted, only deactivated.
