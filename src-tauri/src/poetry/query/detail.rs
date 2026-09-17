//! Poem detail reads: one poem plus its author bio and annotation.

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::poetry::model::{AuthorBio, PoemAnnotation, PoemDetail};
use crate::poetry::text;

use super::PoetryDb;

impl PoetryDb {
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

        let parse_strings =
            |json: &str| -> Vec<String> { serde_json::from_str(json).unwrap_or_default() };
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
}
