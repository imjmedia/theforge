import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeAriadneHandoffItemsRaw } from './ariadne-handoff-normalize.util.js';
import {
  buildAriadneHandoffGovernanceCorpus,
  readHandoffItemBody,
} from './ariadne-handoff-artifacts.util.js';
import type { IntegrationHandoffItem } from './project-integration.js';

describe('normalizeAriadneHandoffItemsRaw content mapping', () => {
  it('maps Ariadne content field to description and payload', () => {
    const { items } = normalizeAriadneHandoffItemsRaw([
      {
        id: 'NEW-LEG-1',
        title: 'Tasks JSON seed',
        kind: 'tasks_json_seed',
        description: 'Tasks JSON seed',
        content: JSON.stringify({ schemaVersion: '2', source: 'ariadne', tasks: [] }),
      },
    ]);
    assert.equal(items.length, 1);
    assert.ok(String(items[0]!.description).includes('schemaVersion'));
    assert.equal((items[0] as { content?: string }).content, undefined);
  });
});

describe('ariadne-handoff-artifacts', () => {
  it('readHandoffItemBody prefers content then payload', () => {
    const item = {
      id: 'NEW-LEG-01',
      title: 'T',
      description: 'fallback',
      kind: 'change_work_description',
      content: '# Hello',
    } as IntegrationHandoffItem & { content: string };
    assert.equal(readHandoffItemBody(item), '# Hello');
  });

  it('buildAriadneHandoffGovernanceCorpus includes markdown sections', () => {
    const items: IntegrationHandoffItem[] = [
      {
        id: 'NEW-LEG-02',
        title: 'Work',
        description: '# Trabajo\nDetalle',
        kind: 'change_work_description',
      },
    ];
    const corpus = buildAriadneHandoffGovernanceCorpus(items, 'Cambio X');
    assert.match(corpus, /Cambio \(Ariadne\)/);
    assert.match(corpus, /# Trabajo/);
  });
});
