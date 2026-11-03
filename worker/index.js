// Worker entry for altovexcargolinx.
//
// Everything is served from the built bundle in ./dist. Media is the one
// exception: the asset router answers a Range request with the whole file and a
// 200, so <video> sits at 0:00 waiting for a partial response that never comes.
// Here we read the asset, slice it ourselves and answer with a real 206.
//
// The asset response carries no content-length header (its body is streamed), so
// the total size is taken from the buffer we read rather than from headers.

import { parseRange, isMediaPath } from "./byte-range.mjs";

const MEDIA_HEADERS = {
  "accept-ranges": "bytes",
  "cache-control": "public, max-age=31536000, immutable",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return env.ASSETS.fetch(request);
    }
    if (!isMediaPath(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const asset = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
    if (!asset.ok) return asset;

    const body = new Uint8Array(await asset.arrayBuffer());
    const total = body.byteLength;
    const type = asset.headers.get("content-type") ?? "application/octet-stream";
    const base = { ...MEDIA_HEADERS, "content-type": type };

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { ...base, "content-length": String(total) },
      });
    }

    const span = parseRange(request.headers.get("range"), total);

    if (span === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: { ...base, "content-range": `bytes */${total}` },
      });
    }

    if (!span) {
      return new Response(body, {
        status: 200,
        headers: { ...base, "content-length": String(total) },
      });
    }

    const slice = body.slice(span.start, span.end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        ...base,
        "content-range": `bytes ${span.start}-${span.end}/${total}`,
        "content-length": String(slice.byteLength),
      },
    });
  },
};
