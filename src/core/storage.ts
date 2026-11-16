// Local library of captured sections, stored with chrome.storage.local
// (the "unlimitedStorage" permission lifts the 10 MB quota).
// We store the raw zyBooks response and normalize on read, so parser
// improvements apply to sections captured earlier without refetching.

export interface SavedSectionMeta {
  book: string;
  chapter: number;
  section: number;
  title: string;
  fetchedAt: string;
}

interface SavedSection extends SavedSectionMeta {
  raw: unknown;
}

const INDEX_KEY = 'library:index';
const sectionKey = (m: Pick<SavedSectionMeta, 'book' | 'chapter' | 'section'>) =>
  `library:section:${m.book}:${m.chapter}.${m.section}`;

export function compareSections(a: SavedSectionMeta, b: SavedSectionMeta) {
  return a.book.localeCompare(b.book) || a.chapter - b.chapter || a.section - b.section;
}

export async function listSections(): Promise<SavedSectionMeta[]> {
  const got = await chrome.storage.local.get(INDEX_KEY);
  const index = (got[INDEX_KEY] ?? []) as SavedSectionMeta[];
  return [...index].sort(compareSections);
}

export async function saveSection(meta: SavedSectionMeta, raw: unknown): Promise<void> {
  const record: SavedSection = { ...meta, raw };
  const index = (await listSections()).filter((m) => sectionKey(m) !== sectionKey(meta));
  index.push(meta);
  await chrome.storage.local.set({ [sectionKey(meta)]: record, [INDEX_KEY]: index });
}

export async function loadSectionRaw(meta: Pick<SavedSectionMeta, 'book' | 'chapter' | 'section'>): Promise<unknown | null> {
  const key = sectionKey(meta);
  const got = await chrome.storage.local.get(key);
  return (got[key] as SavedSection | undefined)?.raw ?? null;
}

export async function deleteSection(meta: Pick<SavedSectionMeta, 'book' | 'chapter' | 'section'>): Promise<void> {
  const index = (await listSections()).filter((m) => sectionKey(m) !== sectionKey(meta));
  await chrome.storage.local.remove(sectionKey(meta));
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}
