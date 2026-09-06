-- Same gap that hid audit_log: RLS is on but no policy names `authenticated`,
-- so a signed-in dashboard user reads zero rows and the screen looks "empty"
-- rather than "forbidden". Grant read to signed-in users only.
--
-- anon is deliberately NOT granted on any of these: communication_logs holds
-- message bodies, purchase_history holds customer names/emails/amounts.

CREATE POLICY communication_logs_authenticated_read
  ON public.communication_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY communication_logs_service_role_all
  ON public.communication_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY purchase_history_authenticated_read
  ON public.purchase_history FOR SELECT TO authenticated USING (true);
CREATE POLICY purchase_history_service_role_all
  ON public.purchase_history FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY customer_360_authenticated_read
  ON public.customer_360_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY customer_360_service_role_all
  ON public.customer_360_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);