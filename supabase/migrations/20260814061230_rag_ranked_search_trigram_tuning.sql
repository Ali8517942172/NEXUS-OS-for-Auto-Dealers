-- Tier 3 was scoring similarity() across the whole chunk, so a typo inside a
-- 200-character paragraph scored near zero and never fired. word_similarity()
-- scores the best-matching span instead, which is what a typo actually needs.

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

  -- Tier 3 — fuzzy, for typos. Gibberish scores ~0.18, real typos 0.53-0.75,
  -- so 0.45 is the line. Needs 4+ characters so "hey" cannot reach it.
  IF length(cleaned) >= 4 THEN
    RETURN QUERY
      SELECT d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
             word_similarity(cleaned, coalesce(d.doc_title,'')||' '||coalesce(d.section,'')||' '||coalesce(d.content,''))::real,
             'trigram'::text
        FROM public.rag_documents d
       WHERE word_similarity(cleaned, coalesce(d.doc_title,'')||' '||coalesce(d.section,'')||' '||coalesce(d.content,'')) > 0.45
       ORDER BY 7 DESC, d.id
       LIMIT match_limit;
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.search_rag_documents(text, int) TO anon, authenticated, service_role;