//! Read-side queries over `poetry.sqlite3`: browse, search, detail, authors,
//! and the deterministic discover feed.

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use super::db::PoetryDb;
use super::model::{
    AuthorBio, AuthorSummary, PoemAnnotation, PoemDetail, PoemPage, PoemSummary,
    PoetryAuthorsRequest, PoetryBrowseRequest, PoetrySearchRequest, PoetrySearchResult,
    PoetrySearchScope,
};
use crate::error::{AppError, AppResult};
use crate::poetry::text;

/// Column projection shared by list queries; rows are read back by name.
const POEM_COLS: &str =
    "p.uid AS uid, p.collection_id AS collection_id, c.name AS collection_name,
     p.title AS title, p.author AS author, p.dynasty AS dynasty, p.body AS body";

struct ListRow {
    uid: String,
    collection_id: String,
    collection_name: String,
    title: String,
    author: String,
    dynasty: String,
    first_line: String,
    rowid: i64,
}

fn excerpt(text_line: &str) -> String {
    let mut out: String = text_line.chars().take(48).collect();
    if text_line.chars().count() > 48 {
        out.push('…');
    }
    out
}

fn map_list_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ListRow> {
    let body_json: String = row.get("body")?;
    let first_line = serde_json::from_str::<Vec<String>>(&body_json)
        .ok()
        .and_then(|paragraphs| paragraphs.first().cloned())
        .unwrap_or_default();
    Ok(ListRow {
        uid: row.get("uid")?,
        collection_id: row.get("collection_id")?,
        collection_name: row.get("collection_name")?,
        title: row.get("title")?,
        author: row.get("author")?,
        dynasty: row.get("dynasty")?,
        first_line,
        rowid: row.get("rowid").unwrap_or(0),
    })
}

impl From<ListRow> for PoemSummary {
    fn from(row: ListRow) -> Self {
        PoemSummary {
            uid: row.uid,
            collection_id: row.collection_id,
            collection_name: row.collection_name,
            title: row.title,
            author: row.author,
            dynasty: row.dynasty,
            excerpt: excerpt(&row.first_line),
        }
    }
}

/// `AND p.collection_id IN (...)` fragment plus its placeholder values.
fn collection_filter(ids: &Option<Vec<String>>) -> (String, Vec<String>) {
    match ids {
        Some(ids) if !ids.is_empty() => {
            let placeholders = vec!["?"; ids.len()].join(",");
            (
                format!(" AND p.collection_id IN ({placeholders})"),
                ids.clone(),
            )
        }
        _ => (String::new(), Vec::new()),
    }
}

fn like_escape(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

type DynParam = Box<dyn rusqlite::types::ToSql>;

impl PoetryDb {
    // ---- browse ----

    pub fn browse(&self, req: &PoetryBrowseRequest) -> AppResult<PoemPage> {
        let conn = self.open()?;
        let limit = req.limit.clamp(1, 200) as i64;
        let cursor: i64 = req
            .cursor
            .as_deref()
            .and_then(|cursor| cursor.parse().ok())
            .unwrap_or(0);
        let (filter_sql, filter_values) = collection_filter(&req.collection_ids);
        let author_active = req.author.as_deref().is_some_and(|a| !a.is_empty());
        let mut sql = format!(
            r#"
            SELECT {POEM_COLS}, p.rowid AS rowid
            FROM poems p JOIN collections c ON c.id = p.collection_id
            WHERE p.rowid > ?{filter_sql}
            "#
        );
        if author_active {
            sql.push_str(" AND p.author = ?");
        }
        sql.push_str(" ORDER BY p.rowid ASC LIMIT ?");

        let mut bind: Vec<DynParam> = vec![Box::new(cursor)];
        bind.extend(filter_values.iter().map(|value| Box::new(value.clone()) as DynParam));
        if author_active {
            bind.push(Box::new(req.author.clone().unwrap_or_default()));
        }
        bind.push(Box::new(limit + 1));

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params_from_iter(bind.iter().map(DynParam::as_ref)), map_list_row)?
            .collect::<Result<Vec<_>, _>>()?;
        let has_more = rows.len() as i64 > limit;
        let next_cursor = if has_more {
            rows.get(limit as usize - 1).map(|row| row.rowid.to_string())
        } else {
            None
        };
        let items: Vec<PoemSummary> = rows
            .into_iter()
            .take(limit as usize)
            .map(PoemSummary::from)
            .collect();
        Ok(PoemPage {
            items,
            next_cursor,
        })
    }

    // ---- detail ----

    pub fn poem_detail(&self, uid: &str) -> AppResult<PoemDetail> {
        let conn = self.open()?;
        let row = conn
            .query_row(
                r#"
                SELECT p.uid AS uid, p.collection_id AS collection_id, c.name AS collection_name,
                       p.title AS title, p.author AS author, p.dynasty AS dynasty,
                       p.rhythmic AS rhythmic, p.chapter AS chapter,
                       p.body AS body, p.notes AS notes, p.strains AS strains
                FROM poems p JOIN collections c ON c.id = p.collection_id
                WHERE p.uid = ?1
                "#,
                params![uid],
                |row| {
                    Ok((
                        row.get::<_, String>("uid")?,
                        row.get::<_, String>("collection_id")?,
                        row.get::<_, String>("collection_name")?,
                        row.get::<_, String>("title")?,
                        row.get::<_, String>("author")?,
                        row.get::<_, String>("dynasty")?,
                        row.get::<_, String>("rhythmic")?,
                        row.get::<_, String>("chapter")?,
                        row.get::<_, String>("body")?,
                        row.get::<_, String>("notes")?,
                        row.get::<_, String>("strains")?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| AppError(format!("poem not found: {uid}")))?;
        let (
            uid,
            collection_id,
            collection_name,
            title,
            author,
            dynasty,
            rhythmic,
            chapter,
            body_json,
            notes_json,
            strains_json,
        ) = row;

        let parse_strings = |json: &str| -> Vec<String> {
            serde_json::from_str(json).unwrap_or_default()
        };
        let author_bio = self.author_bio_for(&conn, &author);
        let annotation = self.annotation_for(&conn, &title, &author);

        Ok(PoemDetail {
            uid,
            collection_id,
            collection_name,
            title,
            author,
            dynasty,
            rhythmic,
            chapter,
            body: parse_strings(&body_json),
            notes: parse_strings(&notes_json),
            strains: parse_strings(&strains_json),
            author_bio,
            annotation,
        })
    }

    fn author_bio_for(&self, conn: &Connection, author: &str) -> Option<AuthorBio> {
        if author.is_empty() {
            return None;
        }
        conn.query_row(
            r#"
            SELECT name, dynasty, desc FROM authors
            WHERE name = ?1 AND desc != ''
            ORDER BY LENGTH(desc) DESC LIMIT 1
            "#,
            params![author],
            |row| {
                Ok(AuthorBio {
                    name: row.get(0)?,
                    dynasty: row.get(1)?,
                    desc: row.get(2)?,
                })
            },
        )
        .optional()
        .unwrap_or(None)
    }

    fn annotation_for(
        &self,
        conn: &Connection,
        title: &str,
        author: &str,
    ) -> Option<PoemAnnotation> {
        let key = text::annotation_key(&text::normalize(title), &text::normalize(author));
        conn.query_row(
            "SELECT remark, translation, appreciation, audio_url
             FROM annotations WHERE match_key = ?1",
            params![key],
            |row| {
                let audio_url: String = row.get(3)?;
                Ok(PoemAnnotation {
                    remark: row.get(0)?,
                    translation: row.get(1)?,
                    appreciation: row.get(2)?,
                    has_audio: !audio_url.trim().is_empty(),
                })
            },
        )
        .optional()
        .unwrap_or(None)
    }

    // ---- search ----

    pub fn search(&self, req: &PoetrySearchRequest) -> AppResult<PoetrySearchResult> {
        let normalized = text::normalize(&req.query);
        if normalized.is_empty() {
            return Ok(empty_search_result());
        }
        let body_indexed = self.meta_get(super::db::META_BODY_INDEX_ENABLED)?.as_deref()
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
        bind.extend(filter_values.iter().map(|value| Box::new(value.clone()) as DynParam));
        bind.push(Box::new(limit));
        bind.push(Box::new(offset as i64));
        let rows = stmt
            .query_map(params_from_iter(bind.iter().map(DynParam::as_ref)), map_list_row)?
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
            let bigrams: Vec<String> = chars
                .windows(2)
                .map(|pair| pair.iter().collect())
                .collect();
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
        bind.extend(filter_values.iter().map(|value| Box::new(value.clone()) as DynParam));
        bind.push(Box::new(limit));
        bind.push(Box::new(offset as i64));
        let rows = stmt
            .query_map(params_from_iter(bind.iter().map(DynParam::as_ref)), map_list_row)?
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
        bind.extend(filter_values.iter().map(|value| Box::new(value.clone()) as DynParam));
        bind.push(Box::new(limit));
        bind.push(Box::new(offset as i64));
        let rows = stmt
            .query_map(params_from_iter(bind.iter().map(DynParam::as_ref)), map_list_row)?
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
        let page = self.search_body(
            req,
            normalized,
            body_indexed,
            0,
        )?;
        Ok(Some(page.items))
    }

    // ---- authors ----

    pub fn authors(&self, req: &PoetryAuthorsRequest) -> AppResult<Vec<AuthorSummary>> {
        let conn = self.open()?;
        let limit = req.limit.clamp(1, 200) as i64;
        let offset = req.offset as i64;
        let (filter_sql, filter_values) = collection_filter(&req.collection_ids);
        let keyword_active = req.keyword.as_deref().is_some_and(|k| !k.is_empty());
        let keyword_clause = if keyword_active { " HAVING p.author LIKE ?" } else { "" };
        let sql = format!(
            r#"
            SELECT p.author AS author,
                   COALESCE(NULLIF(MIN(a.dynasty), ''), MIN(p.dynasty), '') AS dynasty,
                   COALESCE(MAX(a.desc), '') AS bio,
                   COUNT(*) AS poem_count
            FROM poems p
            LEFT JOIN authors a
              ON a.collection_id = p.collection_id AND a.name = p.author
            WHERE p.author != ''{filter_sql}
            GROUP BY p.author{keyword_clause}
            ORDER BY poem_count DESC, p.author ASC
            LIMIT ? OFFSET ?
            "#
        );
        let mut stmt = conn.prepare(&sql)?;
        let mut bind: Vec<DynParam> = filter_values
            .iter()
            .map(|value| Box::new(value.clone()) as DynParam)
            .collect();
        if let Some(keyword) = req.keyword.as_deref().filter(|k| !k.is_empty()) {
            bind.push(Box::new(format!("%{}%", like_escape(keyword))));
        }
        bind.push(Box::new(limit));
        bind.push(Box::new(offset));
        let rows = stmt
            .query_map(params_from_iter(bind.iter().map(DynParam::as_ref)), |row| {
                Ok(AuthorSummary {
                    name: row.get("author")?,
                    dynasty: row.get("dynasty")?,
                    desc: row.get("bio")?,
                    poem_count: row.get("poem_count")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ---- discover ----

    /// Deterministic daily pick: same date ⇒ same poem while the installed
    /// set does not change.
    pub fn discover_daily(&self) -> AppResult<Option<PoemDetail>> {
        let days = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs() / 86_400)
            .unwrap_or(0);
        self.discover_pick(&format!("day:{days}"))
    }

    pub fn discover_random(&self, seed: &str) -> AppResult<Option<PoemDetail>> {
        self.discover_pick(seed)
    }

    fn discover_pick(&self, seed: &str) -> AppResult<Option<PoemDetail>> {
        let conn = self.open()?;
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM poems", [], |r| r.get(0))?;
        if total == 0 {
            return Ok(None);
        }
        let digest = seed_offset(seed);
        let uid: Option<String> = conn
            .query_row(
                "SELECT uid FROM poems ORDER BY uid LIMIT 1 OFFSET ?",
                params![digest % total],
                |row| row.get(0),
            )
            .optional()?;
        drop(conn);
        match uid {
            Some(uid) => Ok(Some(self.poem_detail(&uid)?)),
            None => Ok(None),
        }
    }
}

fn empty_search_result() -> PoetrySearchResult {
    PoetrySearchResult {
        items: Vec::new(),
        has_more: false,
        body_indexed: false,
    }
}

fn seed_offset(seed: &str) -> i64 {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(seed.as_bytes());
    let mut value: u64 = 0;
    for byte in digest.iter().take(8) {
        value = (value << 8) | u64::from(*byte);
    }
    (value % i64::MAX as u64) as i64
}
