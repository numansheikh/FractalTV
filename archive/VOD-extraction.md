# VOD Metadata Extraction Strategy Analysis

## Mission

Analyze our VOD title database to develop a comprehensive metadata extraction strategy. We have two types of content (Films and Series) from three different sources. Your task is to understand the data patterns, identify extraction rules, assess edge cases, and estimate the effort required.

**CRITICAL**: This is a DISCOVERY and ANALYSIS phase only. Do NOT look at any code or implementation. Make independent decisions based solely on the data analysis.

---

## Context

- **Content Types**: Films and Series (analyze separately)
- **Data Sources**: 3 sources have been added
- **Data Structure**: Each title has:
  - Original `title` column (raw from source)
  - Sanitized `search_title` column (cleaned for search purposes)
- **Existing Sanitization**: We have already run one pass that:
  - Removes diacritics (é → e, ñ → n, ü → u, etc.)
  - Expands ligatures (æ → ae, œ → oe, etc.)
  - Result stored in `search_title` column
- **Goal**: Extract metadata intelligently to enrich our catalog

**Note**: Since sanitization has been done, compare both columns to understand:
- What was changed during sanitization
- Whether metadata extraction should use `title` (original) or `search_title` (sanitized)
- If sanitization removed metadata that we need to preserve

---

## Phase 1: Films Analysis

### 1.1 Data Exploration

**Fetch and examine the films data:**
- Retrieve complete list of film titles from the database
- Display both `title` and `search_title` columns side by side
- Sample at least 100-200 titles to understand patterns
- Identify the range of sources and their characteristics

**Initial observations to document:**
- Total number of film titles
- Distribution across sources
- Character set diversity (Latin, non-Latin, diacritics, ligatures)
- Title format variations (with/without years, special characters, etc.)
- **Sanitization impact**: Compare `title` vs `search_title` to understand:
  - What characters/patterns were removed or changed
  - Whether important metadata was lost in sanitization
  - If we should extract from `title` (preserves original) or `search_title` (cleaner)
  - Examples of titles where sanitization affected metadata

### 1.2 Metadata Extraction Opportunities

**Analyze what metadata can be extracted from titles:**

#### Year Extraction
- Identify titles with years in parentheses: "Movie Name (2023)"
- Identify titles with years without parentheses: "Movie Name 2023"
- Document patterns that work in MOST cases
- Identify exceptions and edge cases:
  - Films with numeric titles: "300", "1984", "2012"
  - Films with years in the actual title: "1917", "2001: A Space Odyssey"
  - Multiple year patterns: "Movie (2020) (Director's Cut)"

#### Language/Region Indicators
- Identify language codes or indicators: "[Hindi]", "(French)", etc.
- Regional markers: "Bollywood", "Hollywood", geographic indicators
- Subtitle/dubbing indicators: "English Subtitles", "Dubbed"

#### Quality/Format Indicators
- Resolution markers: "720p", "1080p", "4K", "HD", "BluRay"
- Format indicators: "WEB-DL", "DVDRip", "REMUX"
- HDR/Dolby markers

#### Version/Edition Information
- "Director's Cut", "Extended Edition", "Remastered"
- "Uncut", "Theatrical", "Special Edition"

#### Series/Franchise Information
- Part numbers: "Part 1", "Part 2", "Vol. 1"
- Roman numerals: "II", "III", "IV"
- Franchise indicators

#### Character Set Challenges
- **Non-Latin Scripts**: Arabic, Cyrillic, Devanagari, Chinese, Japanese, Korean
  - Note: Check if these remain in `title` but are handled in `search_title`
- **Diacritics**: é, ñ, ü, ø, å, etc.
  - Note: Already removed in `search_title` (é → e, ñ → n)
  - Assess if original `title` needed for metadata or `search_title` is sufficient
- **Ligatures**: æ, œ, etc.
  - Note: Already expanded in `search_title` (æ → ae, œ → oe)
  - Assess impact on metadata extraction
- **Mixed scripts**: "नाम (2023)" or "الفيلم (Name)"
  - Note: Determine which column preserves necessary information
  
**Key Question**: Should metadata extraction use:
- `title` column (preserves original characters, may have special characters affecting regex)
- `search_title` column (cleaner, easier patterns, but may have lost some metadata indicators)
- Both (extract different metadata types from each)

**Document for each metadata type:**
- Extraction pattern/rule
- Confidence level (High/Medium/Low)
- Expected success rate (%)
- Known exceptions

### 1.3 Rule Development

**For each extraction type, define:**

1. **Primary Rule**: The pattern that works in MOST cases
2. **Edge Case Handling**: Specific exceptions that need special logic
3. **Validation Strategy**: How to verify extracted data is correct
4. **Fallback Approach**: What to do when extraction fails

**Example structure:**

```
METADATA TYPE: Year Extraction
PRIMARY RULE: Extract 4-digit number in parentheses at end of title
CONFIDENCE: High (85-90% success rate expected)
EDGE CASES:
  - Numeric film titles (300, 1984, 2012, 1917)
  - Years within title text (2001: A Space Odyssey)
  - Multiple years in single title
VALIDATION: Year must be between 1888-2026 (realistic film range)
FALLBACK: Manual review queue or leave blank
```

### 1.4 Title Categorization

**Create categories based on extraction complexity:**

- **Category A (Simple)**: Standard format with clear patterns
  - Example: "The Matrix (1999)"
  - Estimated success: 90%+

- **Category B (Moderate)**: Some complexity or ambiguity
  - Example: "1984 (1984)" or "2012 (2009)"
  - Estimated success: 60-70%

- **Category C (Complex)**: Non-Latin scripts, heavy special characters
  - Example: "الفيلم الجميل (2020) [Arabic] HD"
  - Estimated success: 40-50%

- **Category D (Manual Review Needed)**: Requires human judgment
  - Example: "Film 300 (300 warriors story) (2006)"
  - Estimated success: <30% automated

**For each category:**
- Count of titles
- Percentage of total
- Extraction strategy
- Error tolerance

### 1.8 Performance & Effort Estimation

**Estimate for Films:**

Calculate per-title processing time:
- Database query time
- Regex/pattern matching operations
- Validation checks
- Database update time

**Provide estimates for:**
- Time per title (milliseconds/seconds)
- Total time for all films (sequential processing)
- Total time with parallel processing (estimate 4/8/16 concurrent workers)
- API rate limits (if external metadata services needed)
- Database load implications

**Break down by:**
- Pure extraction time (no external calls)
- With external API enrichment (if needed)
- With manual review queue building

### 1.6 Quality Assessment

**Identify titles that will break the rules:**

Create a list of problem cases:
- Exact titles that will fail
- Reason for failure
- Recommended handling approach
- Whether they're common enough to warrant special logic

### 1.7 Sanitization Impact Analysis

**Compare `title` vs `search_title` columns:**

Document how sanitization affected metadata extraction:

**Positive Impacts:**
- Cleaner patterns for regex matching
- Normalized characters easier to process
- Examples where `search_title` makes extraction easier

**Negative Impacts:**
- Metadata lost or obscured by sanitization
- Original language indicators removed
- Examples where `title` preserves necessary information

**Recommendations:**
- Which column to use for each metadata type
- Whether dual-extraction strategy is needed
- If additional sanitization rules needed
- If reverse-mapping from `search_title` to `title` required

**Examples:**
```
Original Title: "Amélie (2001) [Français]"
Search Title: "Amelie (2001) [Francais]"
Analysis: Year extraction works on both, but language indicator changed
Recommendation: Extract from `title` for language accuracy
```

---

## Phase 2: Series Analysis

### 2.1 Decision Point

**Before proceeding with Series analysis, determine:**

Should we:
- **Option A**: Analyze Series immediately with the same methodology
- **Option B**: Wait for Films strategy approval first
- **Option C**: Analyze both together and compare patterns

**Recommendation**: [Your strategic recommendation based on data patterns observed]

### 2.2 Series-Specific Considerations

**If analyzing Series now, consider:**

#### Additional Metadata for Series:
- Season numbers: "S01", "Season 1", "Series 1"
- Episode numbers: "E01", "Episode 1", "Ep 1"
- Combined format: "S01E01"
- Episode titles
- Season ranges: "Seasons 1-3"
- "Complete Series", "Full Season"

#### Series-Specific Challenges:
- Inconsistent season/episode formatting
- Multi-season packs
- Single episodes vs full seasons
- Miniseries vs ongoing series
- Anthology series naming

### 2.3 Series Data Exploration

**If proceeding:**
- Fetch complete list of series titles
- Analyze both `title` and `search_title` columns
- Identify season/episode patterns
- Document series-specific extraction opportunities
- Apply same methodology as Films (sections 1.2-1.6)

---

## Deliverable: Metadata Extraction Strategy Report

**Save your complete analysis to: `metadata-extraction-strategy.md`**

### Report Structure:

```markdown
# VOD Metadata Extraction Strategy Report
*Generated: [Date]*

---

## Executive Summary

- Total Films Analyzed: X
- Total Series Analyzed: X (if applicable)
- Extraction Categories Identified: X
- Estimated Overall Success Rate: X%
- Estimated Total Processing Time: X hours/days
- Recommended Approach: [Sequential/Parallel/Hybrid]

---

## 1. Films Analysis

### 1.1 Dataset Overview
[Statistics and patterns]

### 1.2 Metadata Extraction Rules

#### Year Extraction
- **Rule**: [Detailed rule]
- **Success Rate**: X%
- **Edge Cases**: [List]
- **Examples**: 
  - Success: "Title (2023)" → 2023
  - Failure: "1984 (1984)" → Ambiguous

#### [Other Metadata Types]
[Repeat structure]

### 1.3 Title Categories

**Category A (Simple): X titles (Y%)**
- Characteristics: [Details]
- Extraction Confidence: X%
- Examples: [List 10-20 examples]

**Category B (Moderate): X titles (Y%)**
[Similar structure]

**Category C (Complex): X titles (Y%)**
[Similar structure]

**Category D (Manual Review): X titles (Y%)**
[Similar structure]

### 1.4 Problem Cases

**Titles That Will Break Rules:**
1. "300" - Reason: Numeric title conflicts with year
2. "1984" - Reason: Year ambiguity
3. [More examples with explanations]

**Character Set Issues:**
- Non-Latin titles: X count, Y%
- Diacritics/Ligatures: X count, Y%
- Mixed scripts: X count, Y%
- Strategy: [Approach for each]

### 1.5 Performance Estimates

**Per-Title Processing:**
- Simple extraction: X ms
- With validation: X ms
- With external API: X seconds
- Database update: X ms
**Average**: X ms per title

**Total Films Processing:**
- Sequential: X hours
- Parallel (4 workers): X hours
- Parallel (8 workers): X hours
- Parallel (16 workers): X hours
**Recommended**: X workers = X hours total

**Resource Requirements:**
- Database connections: X
- Memory: X MB
- API rate limits: X calls/minute
- Estimated cost (if applicable): $X

### 1.6 Sanitization Impact Analysis

**Title vs Search_Title Comparison:**

**Where sanitization helps:**
- [Examples and analysis]

**Where sanitization hurts:**
- [Examples and analysis]

**Column Selection Strategy:**
- Year extraction: Use [title/search_title] because [reason]
- Language extraction: Use [title/search_title] because [reason]
- Quality extraction: Use [title/search_title] because [reason]
- [Other metadata types]

**Dual-Extraction Opportunities:**
- Cases where both columns needed
- Merge strategy recommendations

---

## 2. Series Analysis

[If analyzed, use same structure as Films]
[If deferred, explain recommendation]

---

## 3. Comparative Analysis

[If both analyzed]
- Similarities between Films and Series
- Key differences
- Shared extraction logic opportunities
- Separate logic requirements

---

## 4. Recommended Extraction Pipeline

### Stage 1: Preprocessing
[Steps and logic]

### Stage 2: Primary Extraction
[Rules and sequence]

### Stage 3: Validation
[Validation checks]

### Stage 4: Manual Review Queue
[Criteria for manual review]

### Stage 5: Database Update
[Update strategy]

---

## 5. Risk Assessment

### High Risk Areas:
1. [Risk] - Impact: [Level] - Mitigation: [Strategy]

### Medium Risk Areas:
[Similar structure]

### Low Risk Areas:
[Similar structure]

---

## 6. Implementation Recommendations

### Phase 1: Pilot (Recommended)
- Test on X titles from each category
- Validate extraction accuracy
- Measure actual performance
- Estimated time: X days

### Phase 2: Full Rollout
- Process all titles
- Monitor error rates
- Build manual review queue
- Estimated time: X days/weeks

### Phase 3: Continuous Improvement
- Address manual review queue
- Refine rules based on errors
- Add special cases handling

---

## 7. Open Questions & Decisions Needed

1. [Question requiring decision]
2. [Another question]
3. [etc.]

---

## 8. Sample Data Analysis

### Representative Examples (Films)

**Category A - Simple (Success Expected):**
| Original Title | Search Title | Expected Extraction |
|---------------|--------------|---------------------|
| Example 1     | example_1    | Year: 2023, Quality: HD |
[20+ examples]

**Category B - Moderate:**
[Similar table]

**Category C - Complex:**
[Similar table]

**Category D - Manual Review:**
[Similar table]

### Edge Cases & Exceptions
[Detailed list with analysis]

---

## 9. Appendix

### A. Full Title Samples
[Representative samples from each category]

### B. Regex Patterns Identified
[Patterns that could work]

### C. Character Set Analysis
[Detailed breakdown]

### D. Source-Specific Patterns
[If sources have different patterns]

```

---

## Critical Requirements

### ✋ ANALYSIS ONLY - NO IMPLEMENTATION

- ❌ **DO NOT** write any extraction code
- ❌ **DO NOT** write any SQL update statements
- ❌ **DO NOT** create any scripts or functions
- ❌ **DO NOT** modify any database records
- ❌ **DO NOT** install any libraries or dependencies

### ✅ ONLY ANALYZE AND DOCUMENT

- ✅ **ONLY** query and read existing data
- ✅ **ONLY** analyze patterns and create rules
- ✅ **ONLY** document findings and recommendations
- ✅ **ONLY** estimate effort and time
- ✅ Save complete report to `metadata-extraction-strategy.md`

---

## Data Access Instructions

**To fetch Films data, run:**
```sql
SELECT title, search_title 
FROM vod_films 
ORDER BY title 
LIMIT 1000;
-- Adjust LIMIT as needed for comprehensive analysis
```

**To fetch Series data (if analyzing):**
```sql
SELECT title, search_title 
FROM vod_series 
ORDER BY title 
LIMIT 1000;
```

**To get counts and distributions:**
```sql
SELECT source, COUNT(*) as count 
FROM vod_films 
GROUP BY source;
```

---

## Analysis Approach

1. **Start with data queries** - Understand what you're working with
2. **Look for patterns** - Manual inspection of titles
3. **Categorize systematically** - Group by complexity
4. **Define rules** - Clear, testable extraction logic
5. **Identify exceptions** - Document what breaks
6. **Estimate realistically** - Base on data size and complexity
7. **Document thoroughly** - Enable informed decision-making

---

## Deliverable Checklist

Before completing, ensure:

- [ ] Films data fetched and analyzed (title + search_title)
- [ ] Series data analyzed (if proceeding with both)
- [ ] All metadata extraction opportunities identified
- [ ] Extraction rules defined with success rate estimates
- [ ] Titles categorized by complexity (A/B/C/D)
- [ ] Edge cases and problem titles documented with examples
- [ ] Character set challenges analyzed (non-Latin, diacritics, etc.)
- [ ] Per-title processing time estimated
- [ ] Total effort calculated (sequential and parallel)
- [ ] Risk assessment completed
- [ ] Implementation recommendations provided
- [ ] Sample data tables included in report
- [ ] Report saved to `metadata-extraction-strategy.md`
- [ ] **NO code written**
- [ ] **NO database modifications made**

---

## After Analysis

**STOP and WAIT.** After completing this analysis, I will:
1. Review your findings and recommendations
2. Validate your assumptions
3. Approve or adjust the strategy
4. **Then and only then** proceed to implementation planning

Do not write any extraction code until the strategy is approved.

---

**Ready to begin? Start the metadata extraction strategy analysis now.**
