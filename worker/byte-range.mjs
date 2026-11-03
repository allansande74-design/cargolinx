// Byte-range parsing, kept pure so it can be tested without a Worker runtime.
//
// Cloudflare's static-asset router answers a Range request with the whole file
// and a 200, which leaves <video> stuck at 0:00 with no error: the player waits
// for a partial response that never comes. The worker in index.js slices the
// asset itself and answers 206.

/**
 * @param {string|null|undefined} header  the raw Range header
 * @param {number} total                  asset size in bytes
 * @returns {{start:number,end:number}|"unsatisfiable"|null}
 *   null  -> no usable range, serve the whole file with 200
 *   "unsatisfiable" -> 416 with Content-Range: bytes * /total
 */
export function parseRange(header, total) {
  if (!header || !Number.isFinite(total) || total <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;

  // Suffix form: bytes=-500 means the last 500 bytes.
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    const start = Math.max(0, total - suffix);
    return { start, end: total - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= total) return "unsatisfiable";
  const end = rawEnd === "" ? total - 1 : Math.min(Number(rawEnd), total - 1);
  if (!Number.isFinite(end) || end < start) return "unsatisfiable";
  return { start, end };
}

/** True for the media types that need range support to play smoothly. */
export function isMediaPath(pathname) {
  return /\.(mp4|m4v|webm|mov|ogv)$/i.test(pathname || "");
}
