-- INV-002: a recorded sale could not be joined to the lead it came from.
-- purchase_history was anchored only on a contact key (email/phone), and for
-- two of three live leads that key is a synthesised '<number>@whatsapp.lead'
-- address, not a real email. This adds the missing join.
--
-- BUSINESS RULE: purchase_history.lead_id is the leads row this sale was
-- closed from, when the operator recorded it against a specific lead. It is
-- NULLABLE and has NO DEFAULT on purpose:
--   * a sale may legitimately have no originating lead (walk-in, or a deal
--     typed in by hand rather than picked from the lead list), and
--   * nothing that writes purchase_history today sends a lead_id, so no
--     existing writer breaks and no historical link is invented.
-- NULL therefore means "not known / not recorded", never "no lead exists".
-- ON DELETE SET NULL: deleting a lead must not delete the revenue record;
-- the sale survives and loses only its provenance.
-- Type is integer to match leads.id (integer, nextval('leads_id_seq')), NOT
-- bigint.

alter table public.purchase_history
  add column lead_id integer;

alter table public.purchase_history
  add constraint purchase_history_lead_id_fkey
  foreign key (lead_id) references public.leads (id) on delete set null;

create index purchase_history_lead_id_idx
  on public.purchase_history (lead_id);

comment on column public.purchase_history.lead_id is
  'Originating leads.id for this sale (INV-002). NULL = provenance not recorded (walk-in or hand-typed deal), never "no lead exists". ON DELETE SET NULL so removing a lead never removes the sale.';