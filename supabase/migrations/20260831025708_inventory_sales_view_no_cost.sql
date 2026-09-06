-- Layer 1 of the customer-facing AI data boundary.
--
-- The WhatsApp sales agent's `search_inventory` tool was a getAll on the whole
-- `inventory` table with NO column projection, so every reply was composed with
-- these in the model's context:
--     cost_aed                what the dealership paid
--     gross_margin, net_margin, holding_cost_accrued, recommended_commission
--     ai_recommendation       free-text staff notes, e.g. "floor is 250k, we're desperate"
--
-- On 31 Aug that context reached a customer verbatim: the model emitted its own
-- deliberation, including the line "price_aed 585,000, cost_aed 530,000", and the
-- outbound text guard did not catch it. The guard has since been rewritten, but a
-- regex is the LAST line of defence and must never be the FIRST. The durable fix
-- is that the customer-facing model should never hold this data at all.
--
-- What the agent legitimately needs to sell and to negotiate:
--   model, status, price_aed  -- the public offer
--   days_in_stock             -- ages stock, so it can lean toward value over cash
-- Its discount ceiling is a percentage of price_aed, which is public, so it can
-- still compute its own floor without ever seeing what the car cost.
--
-- Deliberately NOT exposed: vin (not needed to sell), aging_alert (derivable),
-- and every financial column above.
--
-- security_invoker matches the other v_* views on this database, so the caller's
-- RLS applies rather than the view owner's.
create or replace view public.v_inventory_sales
with (security_invoker = on) as
select
  i.id,
  i.model,
  i.status,
  i.price_aed,
  i.days_in_stock
from public.inventory i;

comment on view public.v_inventory_sales is
  'Customer-facing projection of inventory for the WhatsApp sales agent. Excludes cost_aed, all margin and commission columns, holding cost, and the ai_recommendation free-text field. Point every customer-facing AI tool at this view, never at inventory directly.';

grant select on public.v_inventory_sales to authenticated, service_role;