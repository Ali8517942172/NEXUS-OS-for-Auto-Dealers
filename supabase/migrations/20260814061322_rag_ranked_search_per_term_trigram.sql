-- Tier 3 scored the whole question as one span, so a multi-word typo
-- ("anual leve for staff") matched nothing. Score each term separately and
-- add the hits up instead.

CREATE OR REPLACE FUNCTION public.search_rag_documents(q text, match_limit int DEFAULT 6)
RETURNS TABLE (
  id integer,
  doc_title text,
  section text,
  content text,
  source_file text,
  page_number integer,
  rank real,
  match_type text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  cleaned text;
  terms   text[];
  tq      tsquery;
BEGIN
  cleaned := btrim(regexp_replace(lower(coalesce(q, '')), '[^a-z0-9\s]', ' ', 'g'));
  cleaned := btrim(regexp_replace(cleaned, '\s+', ' ', 'g'));

  IF length(cleaned) < 3 THEN
    RETURN;
  END IF;

  -- Tier 1 — every term must match. Highest precision.
  tq := websearch_to_tsquery('english', cleaned);
  IF tq IS NOT NULL AND numnode(tq) > 0 THEN
    RETURN QUERY
      SELECT d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
             ts_rank_cd(d.search_vector, tq)::real, 'fts_all'::text
        FROM public.rag_documents d
       WHERE d.search_vector @@ tq
       ORDER BY ts_rank_cd(d.search_vector, tq) DESC, d.id
       LIMIT match_limit;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Tier 2 — any term may match; ts_rank_cd decides the order.
  SELECT array_agg(DISTINCT t)
    INTO terms
    FROM unnest(string_to_array(cleaned, ' ')) AS t
   WHERE length(t) > 2;

  IF terms IS NOT NULL AND array_length(terms, 1) > 0 THEN
    tq := to_tsquery('english', array_to_string(terms, ' | '));
    IF tq IS NOT NULL AND numnode(tq) > 0 THEN
      RETURN QUERY
        SELECT d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
               ts_rank_cd(d.search_vector, tq)::real, 'fts_any'::text
          FROM public.rag_documents d
         WHERE d.search_vector @@ tq
         ORDER BY ts_rank_cd(d.search_vector, tq) DESC, d.id
         LIMIT match_limit;
      IF FOUND THEN RETURN; END IF;
    END IF;
  END IF;

  -- Tier 3 — fuzzy, per term. A term scoring above 0.5 against the best
  -- matching span counts as a hit; scores are summed so a two-word typo
  -- outranks a one-word coincidence. Gibberish peaks near 0.18 and is dropped.
  IF terms IS NULL OR array_length(terms, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    WITH scored AS (
      SELECT d.id AS did,
             sum(s.sim) AS total,
             count(*)   AS matched_terms
        FROM public.rag_documents d
        CROSS JOIN LATERAL (
          SELECT word_similarity(t, coalesce(d.doc_title,'')||' '||coalesce(d.section,'')||' '||coalesce(d.content,'')) AS sim
            FROM unnest(terms) AS t
           WHERE length(t) >= 4
        ) s
       WHERE s.sim > 0.5
       GROUP BY d.id
    )
    SELECT d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
           (sc.total / greatest(array_length(terms,1),1))::real, 'trigram'::text
      FROM scored sc
      JOIN public.rag_documents d ON d.id = sc.did
     ORDER BY sc.matched_terms DESC, sc.total DESC, d.id
     LIMIT match_limit;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.search_rag_documents(text, int) TO anon, authenticated, service_role;