// Only known exception types and application-relative source coordinates survive.
// Error messages, function names, locals, URL queries, and source snippets do not.
export function safeError(error: unknown) {
  const types = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'ApiError', 'ZodError'];
  const type = error instanceof Error && types.includes(error.name) ? error.name : 'Error';
  const frames = error instanceof Error ? (error.stack ?? '').split('\n').slice(1).flatMap(line => {
    const match = /(?:\/|^)((?:apps\/api|packages\/(?:shared|generator|blueprint-qa|quantity-takeoff|construction-calculations|boq-cost))\/(?:src|dist)\/[A-Za-z0-9_./-]+\.[cm]?[jt]s):(\d+):(\d+)\)?$/.exec(line.trim());
    return match ? [{ filename: match[1]!, lineno: Number(match[2]), colno: Number(match[3]) }] : [];
  }).slice(0, 30) : [];
  return { type, frames };
}
