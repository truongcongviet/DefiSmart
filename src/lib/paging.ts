/** Query-string paging and sorting shared by the leaderboard APIs. */

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PagingQuery<K extends string> {
  page: number;
  pageSize: number;
  sort: K;
  dir: "asc" | "desc";
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function readPaging<K extends string>(
  params: URLSearchParams,
  sortKeys: readonly K[],
  defaultSort: K,
): PagingQuery<K> {
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const rawSize = Math.floor(
    Number(params.get("pageSize")) || DEFAULT_PAGE_SIZE,
  );
  const pageSize = Math.max(10, Math.min(MAX_PAGE_SIZE, rawSize));
  const sortParam = params.get("sort");
  const sort = sortKeys.includes(sortParam as K)
    ? (sortParam as K)
    : defaultSort;
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  return { page, pageSize, sort, dir };
}

export function readNumber(
  params: URLSearchParams,
  name: string,
  fallback: number,
) {
  const raw = Number(params.get(name));
  return Number.isFinite(raw) ? raw : fallback;
}

export function readFlag(
  params: URLSearchParams,
  name: string,
  fallback: boolean,
) {
  const raw = params.get(name);
  if (raw == null) return fallback;
  return raw === "1" || raw === "true";
}

/** Sorts by a numeric or ISO-date field; nulls sort last. */
export function sortRows<T>(rows: T[], key: keyof T, dir: "asc" | "desc"): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const value = (row: T) => {
    const raw = row[key];
    if (raw == null) return null;
    if (typeof raw === "string") {
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return typeof raw === "number" ? raw : Number(raw);
  };
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return sign * (av - bv);
  });
}

export function paginate<T>(
  rows: T[],
  page: number,
  pageSize: number,
): { items: T[]; pagination: Pagination } {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    pagination: { page: current, pageSize, total, totalPages },
  };
}
