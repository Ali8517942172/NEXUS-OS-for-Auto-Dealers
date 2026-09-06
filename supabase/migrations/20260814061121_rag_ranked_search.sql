-- Ask AI retrieval: ranked full-text search with a trigram fallback.
-- Replaces the PostgREST `fts` filter, which returned matches in physical
-- table order with no ranking at all.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS rag_documents_search_vector_idx
  ON public.rag_documents USING gin (search_vector);

CREATE INDEX IF NOT EXISTS rag_documents_trgm_idx
  ON public.rag_documents USING gin ((coalesce(doc_title,'') || ' ' || coalesce(section,'') || ' ' || coalesce(content,'')) gin_trgm_ops);

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

  -- Too short to mean anything. Return nothing rather than a random match.
  IF length(cleaned) < 3 THEN
    RETURN;
  END IF;

  -- Tier 1 — all terms must match. Highest precision.
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

  -- Tier 2 — any term may match, but ranking decides the order.
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

  -- Tier 3 — fuzzy. Catches typos and words the english dictionary stems away.
  RETURN QUERY
    SELECT d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
           similarity(coalesce(d.doc_title,'') || ' ' || coalesce(d.section,'') || ' ' || coalesce(d.content,''), cleaned)::real,
           'trigram'::text
      FROM public.rag_documents d
     WHERE similarity(coalesce(d.doc_title,'') || ' ' || coalesce(d.section,'') || ' ' || coalesce(d.content,''), cleaned) > 0.12
     ORDER BY 7 DESC, d.id
     LIMIT match_limit;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.search_rag_documents(text, int) TO anon, authenticated, service_role;