create or replace function public.nexus_model_tokens(txt text)
returns text[]
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $fn$
  select coalesce(array(
    select w
      from unnest(string_to_array(regexp_replace(lower(coalesce(txt, '')), '[^a-z0-9]+', ' ', 'g'), ' ')) w
     where length(w) >= 2
       and w !~ '^(19|20)[0-9]{2}$'
       and w not in ('the','and','aed','edition','model','used','new','car','suv','for','sale','with','your','our','this','that','are','was','has','have','you','can','please','hello','thanks')
  ), '{}'::text[]);
$fn$;

comment on function public.nexus_model_tokens(text) is
  'Significant words of a free-text vehicle description, for the >=2-shared-token matcher that screens/inventory.js already uses to tie a sale to a unit (saleCandidates). Two deliberate divergences from that JS helper, both to stop false positives over 108 free-text messages rather than 1 sale row: four-digit years are dropped ("2024" alone matched half the lot) and single characters are dropped ("2.7" became "2" and "7"). Model numbers of two characters or more are kept, which preserves "600" in "Lexus LX 600".';