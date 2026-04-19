# VOD Metadata Extraction Strategy Report
*Generated: 2026-04-16*

---

## Executive Summary

| Metric | Films | Series |
|--------|-------|--------|
| Total titles | 411,125 | 90,840 |
| Sources | 3 (Opplex, 4k+, 8k Ultra) | same |
| Has year in title | 311,434 (75.7%) | 46,216 (50.9%) |
| `md_*` columns populated | **0** (all NULL) | **0** (all NULL) |
| Titles with language prefix | ~326K (79.3%) | ~79.7K (87.8%) |
| Adult content `[X]` | 6,718 (1.6%) | — |
| Sports/misc `SOC` | 4,202 (1.0%) | — |

**All `md_*` columns are empty.** Nothing is populated at sync from the Xtream API — year, country, language, quality, runtime all NULL. This is a pure title-extraction problem.

**Recommended approach:** Title-based regex extraction for year + quality (high confidence, ~75% coverage). Language/country via prefix taxonomy (high confidence, ~80% coverage). All other fields: low coverage or too ambiguous to extract reliably.

---

## 1. Title Structure — The Prefix System

The dominant structural feature is a **language/region/platform prefix** separated by ` - `:

```
[PREFIX] - [CLEAN TITLE] [(YEAR)] [(COUNTRY)] [EXTRAS]
```

Examples:
```
EN - The Matrix (1999)
FR - Saltburn (2023)
AR-SUBS - Promising Young Woman (2020)
4K-FR - Kung Fu Panda 4 (2024)
NF - PK (2014)
SC - Wag the Dog (1997)
[X][Brazzers] Alura Jenson - Draining The Plumbers Cock
SOC - Napoli - Lazio 02.09.2023
```

**79.3% of movies** have a detectable prefix (INSTR(title, ' - ') ≤ 15). **20.7% have no prefix** — these are either clean titles or non-standard formats.

### Prefix Taxonomy (top prefixes by count)

#### Language/Region (ISO-like, 2–3 chars)
`EN`, `FR`, `DE`, `AR`, `ES`, `PL`, `IR`, `IN`, `AL`, `GR`, `NL`, `SE`, `PT`, `RU`, `IT`, `TR`, `DK`, `BG`, `LAT`, `BR`, `RO`, `TM`, `TL`, `MA`, `PB`, `BN`, `PH`, `IL`, `ML`, `KN`, `UR`

#### Compound Language/Dialect
`AR-SUBS`, `AR-IN`, `AR-AS`, `AR-EG`, `AR-SHAM`, `AR-KH`, `AR-TR-S`, `AR-ANM-S`, `AR-DE`, `AR-DUB`, `IN-EN`, `IN-TL`, `IN-MM`, `SO-IN`, `ENG` (verbose EN)

#### Platform/Service
`NF` (Netflix), `SC`, `EX`, `AMZ` (Amazon), `TOP`, `D+` (Disney+), `OSN+`, `QFR`

#### Quality-prefixed
`4K-FR`, `4K-AR`, `4K-DE`, `4K-SC`, `4K-EN`, `4K-D+`, `4K-OSN+`, `PL 4K`

#### Genre/Content
`SOC` (sports), `[X]` (adult), `STH`, `SOM`, `SPT`, `AF`, `TG`

#### Numeric series (franchise collections)
`007 - `, `001 - `, `002 - ` ... (serialized content)

---

## 2. Metadata Extraction Rules

### 2.1 Language/Region Prefix

**Rule:** Extract everything before first ` - ` if position ≤ 14 chars from start.

```
prefix = TRIM(SUBSTR(title, 1, INSTR(title,' - ')-1))  WHERE INSTR(title,' - ') BETWEEN 1 AND 15
```

**Confidence: High**
- Success rate: ~79% of all titles
- Maps directly to `md_language` (or a new `md_prefix` column)
- Non-prefix 21%: clean titles with no language tag (e.g. `The Shining (1980)`)

**Edge cases:**
- `DE: Johnny English- Man Lebt Nur Dreimal` — colon separator instead of ` - ` (~small count)
- `007 - Casino Royale` — numeric "prefix" is franchise, not language
- `[X][Brazzers]` — bracket format, not ` - ` separator
- `SOC - Napoli - Lazio 02.09.2023` — date in title breaks clean extraction
- `4K - Sijjin 7 (2024)` — quality-only prefix, no language

**Handling:** After extracting prefix, classify into: ISO-language | platform | quality | adult | sports | franchise | unknown.

---

### 2.2 Year Extraction

**Rule:** Extract 4-digit number in `(YYYY)` at or near end of title, where YYYY is between 1888–2026.

```regex
\(([12][0-9]{3})\)
```

Take the **last** match when multiple years appear (e.g. `"Fritz Bauer, un héros allemand (2015)"` — only one year, straightforward; `"EN - Red Sun, Soleil Rouge (1971) ALAIN DELON (ENG FRENCH-SUB)"` — year is `1971`).

**Confidence: High**
- 311,434 movies (75.7%) have `(YYYY)` pattern
- Year distribution is realistic: peaks at 2020–2025, goes back to 1919

**Edge cases:**

| Pattern | Example | Issue | Handling |
|---------|---------|-------|----------|
| Year IS the title | `1984`, `2001: A Space Odyssey`, `300` | No parens → no false match | Safe — rule requires parens |
| Year starts title | `2020 Beautiful Naat Sharif...` | Islamic/devotional content, year = upload year | Low risk — parens rule excludes |
| Ambiguous numeric film | `1995 (2024)`, `2029 (2024)` | Parenthesized year extraction still correct | OK — takes `(2024)` |
| Multiple years | `EN - LX 2048 (2020) (4K)` | Non-year parens after year | Take first valid year match |
| `(2K)`, `(4K)`, `(HD)` | `DE - LX 2048 (2020) (4K)` | False year from quality | 4K/2K fail `[12][0-9]{3}` pattern — safe |
| No year | ~99,691 (24.3%) | Just leave `md_year` NULL | Acceptable |

---

### 2.3 Quality Extraction

**Rule:** Scan title for quality keywords.

Priority order (highest wins):
1. `4K` or `2160p` → `4K`
2. `1080p` → `1080p`
3. `720p` → `720p`
4. ` HD` or `(HD)` → `HD`
5. `BluRay` / `Blu-Ray` → `BluRay`
6. `WEB-DL` / `WEBDL` → `WEB-DL`
7. `REMUX` → `REMUX`

Also: `4K-*` prefix (e.g. `4K-FR`, `4K-DE`) implies 4K quality regardless of title body.

**Confidence: Medium-High**
- 4K: ~14,540 in title body + ~7,600 via `4K-*` prefix = ~22,140 total (~5.4%)
- HD: ~2,257
- 1080p: ~492
- Rest: minimal
- **93% have no quality marker** — leave `md_quality` NULL

**Edge cases:**
- `EN - Persepolis 4K (2007)` — 4K in clean title, not prefix → still caught by keyword scan
- `EN - The Maltese Falcon 4K (1941)` — same
- `(LQ)` — low quality flag, 750 titles. Worth capturing as `LQ`.

---

### 2.4 Country of Origin (Series)

Series titles frequently end with a 2-letter country code in parentheses:

```
EN - Kim's Convenience (2016) (CA)
NF - Baby Bandito (2024) (CL)
SC - Cocaine Cowboys: The Kings of Miami (2021) (US)
TR - Teşkilat (2021) (TR)
```

**Rule:** If title ends with `([A-Z]{2})`, extract as country code.

**Confidence: Medium**
- ~30,607 series (33.7%) have this pattern
- Most common terminal codes from data: `(U` → US, `(G` → GB, `(J` → JP, `(K` → KR, `(T` → TW/TR
- Risk: `(LQ)` is 3 chars so excluded; `(HD)` also 2 chars but not uppercase country codes

**Not applicable for movies** — movies rarely use this pattern. Country would need to come from enrichment (Wikipedia/Wikidata).

---

### 2.5 Platform/Service Tag

Some prefixes indicate the streaming platform the content is from:

| Prefix | Platform |
|--------|----------|
| `NF` | Netflix |
| `SC` | unidentified streamer |
| `AMZ` | Amazon |
| `D+` | Disney+ |
| `OSN+` | OSN+ |
| `EX` | unidentified |
| `TOP` | unidentified |

**Confidence: High** (exact prefix match)
**Value:** Low for search/filtering but useful for UI display or future filtering.

---

### 2.6 Adult Content Flag

`[X]` bracket prefix identifies adult content:
- 6,718 movies (~1.6%)
- Already handled by `is_nsfw` column and category-level NSFW flags
- **No new extraction needed** — NSFW pipeline already covers this

---

### 2.7 Sports/Non-Film Content

`SOC - ` prefix = live sports recordings (4,202 movies, ~1%).
Other non-film patterns: devotional/religious content (`Naat`, `Manqabat`, `Kalam`), YouTube compilations, TV episodes mis-filed under movies (e.g. `KALP YARASI BOLUM 14`).

**No extraction value** — these aren't films. They pollute the catalog. Worth noting for a future "content type correction" pass but out of scope for metadata extraction.

---

### 2.8 Subtitle/Dub Indicators

| Pattern | Count | Example |
|---------|-------|---------|
| `(ENG-SUB)` / `(ENG SUB)` | ~1,346 | `EN - Red Sun (1971) (ENG FRENCH-SUB)` |
| `(MULTI SUB)` | ~150 | `EN - Thrash (2026) (MULTI SUB)` |
| Other `SUB` variants | ~12,063 | mixed |
| `Dubbed` / `(DUB)` | ~1,016 | `IN - Shylock (2020) Dubbed` |

**Confidence: Medium** — patterns inconsistent. Useful for UI but not worth complex parsing. Simple keyword scan sufficient.

---

## 3. Title Categorization

### Category A — Standard (Clean Extraction)
**Format:** `[PREFIX] - [Title] (YEAR)` or `[Title] (YEAR)`
**Estimated count:** ~250,000 movies (60.8%), ~55,000 series (60.5%)
**Extraction success:** Year 95%+, Prefix 98%+, Quality where present 90%+

Examples:
- `EN - The Matrix (1999)` → prefix=EN, year=1999
- `FR - Saltburn (2023)` → prefix=FR, year=2023
- `The Shining (1980)` → no prefix, year=1980
- `4K-DE - Halo (2022) (US)` → prefix=4K-DE (quality+lang), year=2022

### Category B — Moderate Complexity
**Format:** Multiple parenthetical groups, compound prefixes, extra annotations
**Estimated count:** ~80,000 movies (19.5%), ~20,000 series (22%)
**Extraction success:** Year 80%, Prefix 85%

Examples:
- `EN - Red Sun, Soleil Rouge (1971) ALAIN DELON, CHARLES BRONSON (ENG FRENCH-SUB)` → year=1971 ✓, has actor names in title
- `DE - LX 2048 (2020) (4K)` → year=2020 ✓, quality=4K ✓
- `GR - Surviving Black Hawk Down (2025) (GB)` → year=2025 ✓, country=GB ✓
- `PL 4K - Pokój 203 (2022)` → prefix=PL 4K (space before 4K), year=2022

### Category C — Complex / Non-Latin
**Format:** Arabic, Persian, Greek, Cyrillic, Indian scripts — either in title or mixed
**Estimated count:** ~50,000 movies (12.2%), ~10,000 series (11%)
**Extraction success:** Year 60% (if present in Latin digits), Prefix 70%

Examples:
- `GR - Νοκ άουτ (1986)` → search_title=`gr - nok aoyt (1986)` — Greek title transliterated, year=1986 ✓
- `AR-LI - المسلسل الليبي القديم صور اجتماعية` → Arabic title, no year
- `IR - Chehel Salegi چهل سالگی` → Persian suffix, no year in parens
- `RU - Зверогонщики (2023)` → search_title has Latin equiv, year=2023 ✓

**Key insight:** For non-Latin titles, `search_title` has transliterated the script but year digits remain unchanged (digits are universal). Year extraction works on either column. Prefix extraction also works on both since prefixes are always Latin.

### Category D — Non-Film / Structural Problems
**Format:** Sports scores, devotional content, YouTube dumps, TV episodes, numeric series
**Estimated count:** ~30,000 movies (7.3%), ~5,000 series (5.5%)
**Extraction success:** <30% meaningful extraction

Examples:
- `SOC - Napoli - Lazio 02.09.2023` — sports fixture, date not year
- `2020 Beautiful Naat Sharif...` — starts with year, no film
- `Motu Patlu in Hindi_ The Jungle King _ S09 _ Hindi Cartoons_` — YouTube dump
- `KALP YARASI BOLUM 14` — Turkish TV episode filed under movies
- `007 - Noreen mohammad sadiq sourat al-fatiha` — Quran recitation using 007 series prefix

---

## 4. Sanitization Impact Analysis

### What `search_title` changes vs `title`
1. **Diacritics removed:** `Śnieżny` → `sniezny`, `héros` → `heros`, `Teşkilat` → `teskilat`
2. **Non-Latin transliterated:** `Νοκ άουτ` → `nok aoyt`, `Зверогонщики` → `zverogonshchiki`, Persian/Arabic → romanized approximation
3. **Lowercased:** always

### Impact on extraction

| Metadata Type | Use `title` or `search_title`? | Reason |
|---------------|-------------------------------|--------|
| Year | Either (both identical for digits) | Digits unaffected by sanitization |
| Prefix/language | Either (prefixes are always ASCII) | No sanitization effect on `EN`, `FR`, etc. |
| Quality keywords | Either | `4K`, `HD`, `1080p` unaffected |
| Country codes in parens | Either | `(US)`, `(GB)` unaffected |
| Non-Latin original text | `title` only | `search_title` loses the original script |

**Recommendation:** Use `title` for all extractions. The only reason to prefer `search_title` is diacritic normalization, but our regex patterns don't care about diacritics. Using `title` preserves optionality (original language details intact).

---

## 5. Recommended Extraction Pipeline

### Fields to extract and populate

| Field | Column | Source | Confidence | Coverage |
|-------|--------|--------|------------|---------|
| Year | `md_year` | `(YYYY)` from title | High | ~75% movies, ~51% series |
| Language prefix | new `md_prefix` or `md_language` | prefix before ` - ` | High | ~79% movies, ~88% series |
| Quality | `md_quality` | keyword scan + `4K-*` prefix | High | ~5.4% (only where present) |
| Country (series) | `md_country` | trailing `(XX)` | Medium | ~34% series |
| Subtitle/dub | new flag or `md_origin` | keyword scan | Medium | ~3% |

### Pipeline stages

**Stage 1 — Prefix extraction**
```
IF INSTR(title, ' - ') BETWEEN 1 AND 15:
  prefix = TRIM(SUBSTR(title, 1, INSTR(title,' - ')-1))
  clean_title = TRIM(SUBSTR(title, INSTR(title,' - ')+3))
ELSE:
  prefix = NULL
  clean_title = title
```

**Stage 2 — Year extraction (on clean_title)**
```
regex: \(([12][0-9]{3})\)
take last valid match where year BETWEEN 1888 AND 2026
```

**Stage 3 — Quality extraction (on title)**
```
IF prefix starts with '4K' OR title contains '4K' OR '2160p' → '4K'
ELIF title contains '1080p' → '1080p'
ELIF title contains '720p' → '720p'
ELIF title contains ' HD' OR '(HD)' → 'HD'
ELIF title contains 'BluRay' → 'BluRay'
ELIF title contains 'WEB-DL' → 'WEB-DL'
ELIF title contains '(LQ)' → 'LQ'
```

**Stage 4 — Country extraction (series only)**
```
IF title ends with '([A-Z]{2})':
  country = match[1]
```

**Stage 5 — Write to DB**
```sql
UPDATE movies SET 
  md_year = ?,
  md_quality = ?
WHERE id = ?;
-- md_language / md_prefix pending column decision
```

---

## 6. Performance Estimates

**Dataset:** 411,125 movies + 90,840 series = 501,965 total rows

**Per-row operations:** 3 regex matches + 1 keyword scan + 1 UPDATE = ~0.5–2ms in SQLite with WAL

| Approach | Estimated time |
|----------|---------------|
| Sequential (single pass SQL UPDATE) | 2–8 minutes |
| Batch UPDATE (100 rows at a time) | 3–10 minutes |
| Single SQL statement per field | < 1 minute |

**Recommended:** Single SQL `UPDATE movies SET md_year = ..., md_quality = ... WHERE ...` using SQLite's built-in string functions. No need for row-by-row processing or worker threads. SQLite can do this in one transaction in under 2 minutes.

No external API calls needed for this extraction phase.

---

## 7. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Year false-positives on quality like `(2K)` | Low — pattern `[12][0-9]{3}` excludes 2K/4K | Safe by design |
| Numeric franchise prefix (`007 -`) parsed as language | Low — doesn't map to valid ISO code | Classify as "franchise" not "language" |
| Sports dates `02.09.2023` extracted as year | None — no parens around it | Safe |
| Non-film content gets year populated | Low impact | Acceptable — user sees data |
| `md_language` semantics unclear | Medium — prefix ≠ language | Consider new `md_prefix` column instead of repurposing `md_language` |

---

## 8. Open Questions / Decisions Needed

1. **Column for prefix:** Repurpose `md_language` for the language/region prefix, or add a new `md_prefix` column? `md_language` implies the language of the content, but the prefix is more accurately "what language variant this is from the provider". These are often the same (EN prefix = English content) but not always (platform prefixes like NF, SC are not language codes).

2. **Prefix classification table:** Do we want a lookup table mapping prefixes to ISO language codes? E.g. `EN → en`, `FR → fr`, `AR → ar`, `IR → fa`, `IN → hi` (approximate). Or store raw prefix as-is and classify later?

3. **Category D cleanup:** 7.3% of movies are non-film content (sports, devotional, YouTube). Do we want a flag or category for these, or leave them as-is?

4. **Series `md_year`:** Series often have year in title (51%), but for a series the year is more ambiguous — it could be the premiere year or just a tagging artifact. Should we populate it, or wait for enrichment?

5. **Run as one-time migration vs. sync-time extraction:** Extract now from existing data (one-time UPDATE), re-extract at each sync, or both?

---

## 9. Sample Data Tables

### Category A — Standard format (clean extraction expected)
| Title | Extracted Year | Prefix | Quality |
|-------|---------------|--------|---------|
| EN - The Matrix (1999) | 1999 | EN | — |
| FR - Saltburn (2023) | 2023 | FR | — |
| The Shining (1980) | 1980 | — | — |
| 4K-DE - Halo (2022) | 2022 | 4K-DE | 4K |
| EN - Persepolis 4K (2007) | 2007 | EN | 4K |
| NF - PK (2014) | 2014 | NF | — |
| SC - Wag the Dog (1997) | 1997 | SC | — |

### Category B — Moderate complexity
| Title | Notes |
|-------|-------|
| EN - Red Sun, Soleil Rouge (1971) ALAIN DELON (ENG FRENCH-SUB) | Year=1971 ✓, actor names in body |
| DE - LX 2048 (2020) (4K) | Year=2020 ✓, Quality=4K via parens |
| PL 4K - Pokój 203 (2022) | Prefix has space before 4K |
| 1995 (2024) | Numeric title, year still correct |
| GR - Surviving Black Hawk Down (2025) (GB) | Year + country both present |

### Category C — Non-Latin
| Title | search_title | Year Extractable? |
|-------|-------------|-------------------|
| GR - Νοκ άουτ (1986) | gr - nok aoyt (1986) | Yes (1986) |
| RU - Зверогонщики (2023) | ru - zverogonshchiki (2023) | Yes (2023) |
| IR - Chehel Salegi چهل سالگی | ir - chehel salegi chhl slgy | No (no parens) |
| AR-LI - المسلسل الليبي القديم | ar-li - lmslsl llyby lqdym... | No |

### Category D — Non-extractable
| Title | Issue |
|-------|-------|
| SOC - Napoli - Lazio 02.09.2023 | Sports fixture, date not year |
| KALP YARASI BOLUM 14 | TV episode, no year |
| 2020 Beautiful Naat Sharif... | Devotional, year = upload year |
| Motu Patlu in Hindi_ The Jungle King _ S09... | YouTube dump |

---

## 10. Appendix: Prefix Classification Map (partial)

### ISO Language codes
`EN`=English, `FR`=French, `DE`=German, `AR`=Arabic, `ES`=Spanish, `PL`=Polish, `IR`=Persian/Farsi, `IN`=Hindi/Indian, `AL`=Albanian, `GR`=Greek, `NL`=Dutch, `SE`=Swedish, `PT`=Portuguese, `RU`=Russian, `IT`=Italian, `TR`=Turkish, `DK`=Danish, `BG`=Bulgarian, `RO`=Romanian, `TM`=Tamil, `TL`=Telugu, `MA`=Malayalam, `PB`=Punjabi, `BN`=Bengali, `ML`=Malayalam, `KN`=Kannada, `UR`=Urdu

### Platform codes
`NF`=Netflix, `SC`=unknown streamer, `EX`=unknown, `AMZ`=Amazon, `TOP`=unknown, `D+`=Disney+, `OSN+`=OSN+, `QFR`=unknown

### Quality prefixes
`4K-*`=4K content (4K-FR, 4K-DE, 4K-SC, 4K-EN, 4K-AR, 4K-D+, etc.)

### Compound/dialect
`AR-SUBS`=Arabic subtitled, `AR-DUB`=Arabic dubbed, `AR-EG`=Egyptian Arabic, `AR-SHAM`=Levantine Arabic, `AR-AS-S`=Arabic with Asian subtitles, `AR-TR-S`=Arabic+Turkish subtitled, `IN-EN`=Indian English, `IN-TL`=Indian Telugu, `IN-MM`=Indian Malayalam
