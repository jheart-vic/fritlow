import { describe, expect, it } from 'vitest';
import { createSectionTracker, type SectionEvent } from './blueprint.service';
import { blueprintSectionDefs } from './blueprint.sections';

// Unit tests for the SSE section-progress tracker. Pure logic — feeds the
// tracker a simulated streaming JSON blob and checks the emitted events. No AI,
// no DB (the global beforeEach still runs, but nothing here touches the tables).

// Build the JSON object the model is asked to produce, keys in section order.
function fullBlueprintJson(): string {
  const obj: Record<string, string> = {};
  for (const def of blueprintSectionDefs) obj[def.key] = `content for ${def.title}`;
  return JSON.stringify(obj);
}

// Feed a string to the tracker one character at a time (mirrors token streaming),
// calling scan() on the growing buffer after each char.
function streamCharByChar(raw: string, onSection: (e: SectionEvent) => void, finish = true) {
  const tracker = createSectionTracker(onSection);
  let buffer = '';
  for (const ch of raw) {
    buffer += ch;
    tracker.scan(buffer);
  }
  if (finish) tracker.finish();
}

describe('blueprint SSE section tracker', () => {
  it('emits writing→complete for every section, in order', () => {
    const events: SectionEvent[] = [];
    streamCharByChar(fullBlueprintJson(), (e) => events.push(e));

    // Expected: for each section in order, a writing then a complete.
    const expected = blueprintSectionDefs.flatMap((d) => [
      { key: d.key, title: d.title, status: 'writing' },
      { key: d.key, title: d.title, status: 'complete' },
    ]);
    expect(events).toEqual(expected);
  });

  it('never emits the same status twice for a section (only real transitions)', () => {
    const events: SectionEvent[] = [];
    streamCharByChar(fullBlueprintJson(), (e) => events.push(e));

    const seen = new Set<string>();
    for (const e of events) {
      const tag = `${e.key}:${e.status}`;
      expect(seen.has(tag)).toBe(false);
      seen.add(tag);
    }
  });

  it('marks every section complete on finish even if the stream is cut off mid-write', () => {
    // Only the first two sections were streamed before the connection dropped.
    const partial =
      `{"${blueprintSectionDefs[0]!.key}": "done", ` +
      `"${blueprintSectionDefs[1]!.key}": "half-writ`;
    const events: SectionEvent[] = [];
    streamCharByChar(partial, (e) => events.push(e));

    // finish() should have driven all 8 to complete.
    const completed = events.filter((e) => e.status === 'complete').map((e) => e.key);
    expect(new Set(completed)).toEqual(new Set(blueprintSectionDefs.map((d) => d.key)));
  });

  it('does not treat a section key mentioned inside prose as a real key', () => {
    // A value that literally contains "business_model" as words (no JSON colon)
    // must not flip business_model to writing prematurely.
    const raw = JSON.stringify({
      [blueprintSectionDefs[0]!.key]: 'we discuss the business_model here in passing',
      [blueprintSectionDefs[1]!.key]: 'more text',
    });
    const events: SectionEvent[] = [];
    // Don't finish — we only care about what real JSON keys triggered.
    streamCharByChar(raw, (e) => events.push(e), false);

    const businessWriting = events.find(
      (e) => e.key === 'business_model' && e.status === 'writing',
    );
    // business_model appears only as prose, never as a JSON key, so no event.
    expect(businessWriting).toBeUndefined();
  });
});
