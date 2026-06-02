import type { MemoryEvent, MemoryEventRow } from '../types';
import { eventRowToDomain } from '../utils/memory';

export class EventRepository {
  constructor(private readonly db: D1Database) {}

  async createEvent(row: MemoryEventRow): Promise<MemoryEvent> {
    await this.db
      .prepare(
        `INSERT INTO memory_events (
          id, memory_id, event_type, before_json, after_json, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(row.id, row.memory_id, row.event_type, row.before_json, row.after_json, row.source, row.created_at)
      .run();
    return eventRowToDomain(row);
  }

  async listEventsByMemoryId(memoryId: string, limit: number): Promise<MemoryEvent[]> {
    const result = await this.db
      .prepare('SELECT * FROM memory_events WHERE memory_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(memoryId, limit)
      .all<MemoryEventRow>();
    return (result.results ?? []).map(eventRowToDomain);
  }

  async findLatestIndexFailure(memoryId: string): Promise<MemoryEvent | null> {
    const row = await this.db
      .prepare(
        "SELECT * FROM memory_events WHERE memory_id = ? AND event_type = 'index_failed' ORDER BY created_at DESC LIMIT 1"
      )
      .bind(memoryId)
      .first<MemoryEventRow>();
    return row ? eventRowToDomain(row) : null;
  }
}
