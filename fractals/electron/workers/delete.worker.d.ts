/**
 * Delete worker — removes a source and all its content off the main thread.
 * Deletes per-type rows (`channels`, `movies`, `series` — episodes CASCADE from
 * series), per-type categories, epg, and the source row. User_data rows CASCADE
 * off the per-type content rows (g1c hard cut — no source-independent survivors).
 */
export {};
