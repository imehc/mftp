//! Search reads: unigram FTS over title/author, and the trigram or LIKE
//! fallbacks used for body search when no body index is installed.

use rusqlite::params_from_iter;

use crate::error::AppResult;
use crate::poetry::model::{
    PoemSummary, PoetrySearchRequest, PoetrySearchResult, PoetrySearchScope,
};
use crate::poetry::text;

use super::{collection_filter, like_escape, map_list_row, DynParam, PoetryDb, POEM_COLS};

impl PoetryDb {
    // ---- search ----

    pub fn search(&self, req: &PoetrySearchRequest) -> AppResult<PoetrySearchResult> {
        let normalized = text::normalize(&req.query);
        if normalized.is_empty() {
            return Ok(empty_search_result());
        }
        let body_indexed = self
            .meta_get(crate::poetry::db::META_BODY_INDEX_ENABLED)?
            .as_deref()
            == Some("1");

        match req.scope {
            PoetrySearchScope::Title | PoetrySearchScope::Author => {
                let column = if req.scope == PoetrySearchScope::Title {
                    "title"
                } else {
                    "author"
                };
                let limit = req.limit.clamp(1, 100) as usize;
                let items = self.search_fts_column(req, &normalized, column, req.offset)?;
                let has_more = items.len() == limit;
                Ok(PoetrySearchResult {
                    items,
                    has_more,
                    body_indexed,
                })
            }
            PoetrySearchScope::Body => self.search_body(req, &normalized, body_indexed, req.offset),
            PoetrySearchScope::All => {
                // Merge bounded slices: title hits first, then author, body.
                let page = req.limit.clamp(1, 100) as usize;
                let mut merged: Vec<PoemSummary> = Vec::new();
                merged.extend(self.search_fts_column(req, &normalized, "title", 0)?);
                merged.extend(self.search_fts_column(req, &normalized, "author", 0)?);
                merged.dedup_by(|a, b| a.uid == b.uid);
                if merged.len() < page * 2 {
                    if let Some(body_page) =
                        self.search_body_slice(req, &normalized, body_indexed)?
                    {
                        merged.extend(body_page);
                        merged.dedup_by(|a, b| a.uid == b.uid);
                    }
                }
                let has_more = merged.len() > page;
                let items = merged.into_iter().take(page).collect();
                Ok(PoetrySearchResult {
                    items,
                    has_more,
                    body_indexed,
                })
            }
        }
    }

    /// FTS search scoped to one normalized column (`title` or `author`) via
    /// FTS5's `<column> : <phrase>` filter syntax.
    fn search_fts_column(
        &self,
        req: &PoetrySearchRequest,
        normalized: &str,
        column: &str,
        offset: u32,
    ) -> AppResult<Vec<PoemSummary>> {
        let tokens = text::char_tokens(normalized);
        let Some(phrase) = text::phrase_query(&tokens) else {
            return Ok(Vec::new());
        };
        let match_expr = format!("{column} : {phrase}");
        let limit = req.limit.clamp(1, 100) as i64;
        let (filter_sql, filter_values) = collection_filter(&req.collection_ids);
        let sql = format!(
            r#"
            SELECT {POEM_COLS}
            FROM poems_fts f
            JOIN poems p ON p.rowid = f.rowid
            JOIN collections c ON c.id = p.collection_id
            WHERE poems_fts MATCH ?{filter_sql}
            ORDER BY bm25(poems_fts), p.rowid
            LIMIT ? OFFSET ?
            "#
        );
        let conn = self.open()?;
        let mut stmt = conn.prepare(&sql)?;
        let mut bind: Vec<DynParam> = vec![Box::new(match_expr)];
        bind.extend(
            filter_values
                .iter()
                .map(|value| Box::new(value.clone()) as DynParam),
        );
        bind.push(Box::new(limit));
        bind.push(Box::new(offset as i64));
        let rows = stmt
            .query_map(
                params_from_iter(bind.iter().map(DynParam::as_ref)),
                map_list_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows.into_iter().map(PoemSummary::from).collect())
    }

    /// Body-scope search: bigram FTS when enabled and the query has ≥2 chars,
    /// otherwise LIKE with script-variant expansion.
    fn search_body(
        &self,
        req: &PoetrySearchRequest,
        normalized: &str,
        body_indexed: bool,
        offset: u32,
    ) -> AppResult<PoetrySearchResult> {
        let chars: Vec<char> = normalized
            .chars()
            .filter(|ch| ch.is_alphanumeric())
            .collect();
        if body_indexed && chars.len() >= 2 {
            let bigrams: Vec<String> = chars.windows(2).map(|pair| pair.iter().collect()).collect();
            if let Some(result) = self.search_body_fts(req, &bigrams, offset)? {
                return Ok(result);
            }
            return self.search_body_like(req, normalized, offset);
        }
        // Single-char (or unindexed) queries cannot form bigrams.
        self.search_body_like(req, normalized, offset)
    }

    fn search_body_fts(
        &self,
        req: &PoetrySearchRequest,
        bigrams: &[String],
        offset: u32,
    ) -> AppResult<Option<PoetrySearchResult>> {
        if bigrams.is_empty() {
            return Ok(None);
        }
        let match_expr = format!("\"{}\"", bigrams.join(" "));
        let limit = req.limit.clamp(1, 100) as i64;
        let (filter_sql, filter_values) = collection_filter(&req.collection_ids);
        let sql = format!(
            r#"
            SELECT {POEM_COLS}
            FROM poems_body_fts bf
            JOIN poems p ON p.rowid = bf.rowid
            JOIN collections c ON c.id = p.collection_id
            WHERE poems_body_fts MATCH ?{filter_sql}
            ORDER BY bm25(poems_body_fts), p.rowid
            LIMIT ? OFFSET ?
            "#
        );
        let conn = self.open()?;
        let mut stmt = conn.prepare(&sql)?;
        let mut bind: Vec<DynParam> = vec![Box::new(match_expr)];
        bind.extend(
            filter_values
                .iter()
                .map(|value| Box::new(value.clone()) as DynParam),
        );
        bind.push(Box::new(limit));
        bind.push(Box::new(offset as i64));
        let rows = stmt
            .query_map(
                params_from_iter(bind.iter().map(DynParam::as_ref)),
                map_list_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let items: Vec<PoemSummary> = rows.into_iter().map(PoemSummary::from).collect();
        Ok(Some(PoetrySearchResult {
            has_more: items.len() == limit as usize,
            items,
            body_indexed: true,
        }))
    }

    fn search_body_like(
        &self,
        req: &PoetrySearchRequest,
        normalized: &str,
        offset: u32,
    ) -> AppResult<PoetrySearchResult> {
        let variants = text::expand_query_variants(normalized);
        if variants.is_empty() {
            return Ok(empty_search_result());
        }
        let limit = req.limit.clamp(1, 100) as i64;
        let clauses: Vec<String> = (0..variants.len())
            .map(|index| format!("p.body LIKE ?{} ESCAPE '\\'", index + 1))
            .collect();
        let (filter_sql, filter_values) = collection_filter(&req.collection_ids);
        let sql = format!(
            r#"
            SELECT {POEM_COLS}
            FROM poems p JOIN collections c ON c.id = p.collection_id
            WHERE ({}){filter_sql}
            ORDER BY p.rowid
            LIMIT ? OFFSET ?
            "#,
            clauses.join(" OR ")
        );
        let conn = self.open()?;
        let mut stmt = conn.prepare(&sql)?;
        let mut bind: Vec<DynParam> = variants
            .into_iter()
            .map(|variant| Box::new(format!("%{}%", like_escape(&variant))) as DynParam)
            .collect();
        bind.extend(
            filter_values
                .iter()
                .map(|value| Box::new(value.clone()) as DynParam),
        );
        bind.push(Box::new(limit));
        bind.push(Box::new(offset as i64));
        let rows = stmt
            .query_map(
                params_from_iter(bind.iter().map(DynParam::as_ref)),
                map_list_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let items: Vec<PoemSummary> = rows.into_iter().map(PoemSummary::from).collect();
        Ok(PoetrySearchResult {
            has_more: items.len() == limit as usize,
            items,
            body_indexed: false,
        })
    }

    /// Bounded body slice for the merged All view.
    fn search_body_slice(
        &self,
        req: &PoetrySearchRequest,
        normalized: &str,
        body_indexed: bool,
    ) -> AppResult<Option<Vec<PoemSummary>>> {
        let page = self.search_body(req, normalized, body_indexed, 0)?;
        Ok(Some(page.items))
    }
}

fn empty_search_result() -> PoetrySearchResult {
    PoetrySearchResult {
        items: Vec::new(),
        has_more: false,
        body_indexed: false,
    }
}
