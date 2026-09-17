//! Read-side queries over `poetry.sqlite3`: browse, authors, and the shared
//! row projection. Search, detail and discover live in sibling submodules as
//! further `impl PoetryDb` blocks.

mod detail;
mod discover;
mod search;

use rusqlite::params_from_iter;

use super::db::PoetryDb;
use super::model::{
    AuthorSummary, PoemPage, PoemSummary, PoetryAuthorsRequest, PoetryBrowseRequest,
};
use crate::error::AppResult;

/// Column projection shared by list queries; rows are read back by name.
const POEM_COLS: &str = "p.uid AS uid, p.collection_id AS collection_id, c.name AS collection_name,
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
        bind.extend(
            filter_values
                .iter()
                .map(|value| Box::new(value.clone()) as DynParam),
        );
        if author_active {
            bind.push(Box::new(req.author.clone().unwrap_or_default()));
        }
        bind.push(Box::new(limit + 1));

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(
                params_from_iter(bind.iter().map(DynParam::as_ref)),
                map_list_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let has_more = rows.len() as i64 > limit;
        let next_cursor = if has_more {
            rows.get(limit as usize - 1)
                .map(|row| row.rowid.to_string())
        } else {
            None
        };
        let items: Vec<PoemSummary> = rows
            .into_iter()
            .take(limit as usize)
            .map(PoemSummary::from)
            .collect();
        Ok(PoemPage { items, next_cursor })
    }

    // ---- authors ----

    pub fn authors(&self, req: &PoetryAuthorsRequest) -> AppResult<Vec<AuthorSummary>> {
        let conn = self.open()?;
        let limit = req.limit.clamp(1, 200) as i64;
        let offset = req.offset as i64;
        let (filter_sql, filter_values) = collection_filter(&req.collection_ids);
        let keyword_active = req.keyword.as_deref().is_some_and(|k| !k.is_empty());
        let keyword_clause = if keyword_active {
            " HAVING p.author LIKE ?"
        } else {
            ""
        };
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
}
