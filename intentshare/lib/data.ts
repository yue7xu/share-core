import taxonomy from './data/taxonomy.json';
import fixtures from './data/fixtures.json';

export type TypeInfo = { cls: string; src: string; label: string; def: string; cues: string; action: string; guide: string };
export const TYPES = taxonomy.types as Record<string, TypeInfo>;
export const TYPE_ORDER = taxonomy.order as string[];
export const REQUIRED = taxonomy.required as Record<string, string[]>;

export type Unit = { unitId: string; text: string; start?: number; end?: number; paragraphIndex?: number; itemType?: string };
export type ContentObject = {
  id: string; kind: string; sourceUrl: string; title: string; author?: string; durationSec?: number;
  units: Unit[]; metadata: Record<string, any>; isMock: boolean; containerOnly?: boolean; adapter?: string;
};
export const FIXTURES = fixtures.content as unknown as Record<string, ContentObject>;
export const SCENARIOS = fixtures.scenarios as { id: string; exp: string; sec?: string; note?: string; msg: string; url?: string; photo?: string }[];
export const SLOTS = fixtures.slots;
