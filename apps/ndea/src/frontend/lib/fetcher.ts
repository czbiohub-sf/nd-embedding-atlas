/** SWR-compatible JSON fetcher. Throws on non-ok HTTP responses so SWR surfaces errors correctly. */
export const jsonFetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
};
