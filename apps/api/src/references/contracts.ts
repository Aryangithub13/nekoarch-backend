import { z } from 'zod';

export const REFERENCE_INSPECTOR_VERSION = 'reference-inspector-v1';
export const REFERENCE_DOWNLOAD_VERSION = 'reference-download-v1';
export const REFERENCE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export const REFERENCE_EXTENSIONS: Readonly<Record<ReferenceMediaType, string>> = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' });
export const REFERENCE_LIMITS = Object.freeze({
  maxBytes: 10_485_760, maxDimension: 12_000, maxPixels: 50_000_000,
  pdfInflateTotalBytes: 33_554_432, pdfInflateStreamBytes: 8_388_608, pdfMaxPages: 2_000,
  perProjectReferences: 50, perProjectBytes: 209_715_200, attemptsPerHour: 30,
  linkMinSeconds: 60, linkMaxSeconds: 900, linkDefaultSeconds: 300,
  displayName: 120, note: 500, findings: 32, removedSegments: 64,
});

export const ReferenceMediaTypeSchema = z.enum(REFERENCE_MEDIA_TYPES);
export type ReferenceMediaType = z.infer<typeof ReferenceMediaTypeSchema>;
export const ReferencePurposeSchema = z.enum(['SITE_PHOTO', 'SITE_PLAN', 'SKETCH', 'INSPIRATION', 'DOCUMENT', 'OTHER']);
export const ReferenceStatusSchema = z.enum(['ACTIVE', 'ARCHIVED', 'DELETED']);
export const REJECT_CODES = ['EMPTY_FILE', 'TYPE_MISMATCH', 'TRAILING_DATA', 'TRUNCATED', 'MALFORMED_STRUCTURE', 'DIMENSIONS_EXCEEDED', 'PNG_CRC_MISMATCH',
  'PNG_UNKNOWN_CRITICAL_CHUNK', 'PDF_ACTIVE_CONTENT', 'PDF_ENCRYPTED', 'PDF_INFLATE_LIMIT', 'PDF_PAGE_LIMIT'] as const;
export const RejectCodeSchema = z.enum(REJECT_CODES);

// Free text is trimmed, NFKC-normalized and stripped of control characters; it is data only and never reaches a header or a path.
const text = (max: number) => z.string().transform(s => s.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).pipe(z.string().min(1).max(max));
export const ReferenceUploadQuerySchema = z.object({ purpose: ReferencePurposeSchema, displayName: text(REFERENCE_LIMITS.displayName).optional(),
  note: text(REFERENCE_LIMITS.note).optional(), revisionId: z.string().uuid().optional() }).strict();
export const ReferenceValidateQuerySchema = z.object({}).strict();
export const ReferenceListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().min(1).max(512).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'DELETED', 'ALL']).default('ACTIVE'), purpose: ReferencePurposeSchema.optional(), revisionId: z.string().uuid().optional() }).strict();
export const ReferenceUpdateSchema = z.object({ displayName: text(REFERENCE_LIMITS.displayName).nullable().optional(), note: text(REFERENCE_LIMITS.note).nullable().optional(),
  purpose: ReferencePurposeSchema.optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).strict()
  .refine(value => Object.keys(value).length > 0, 'Provide at least one field');
export const DownloadLinkRequestSchema = z.object({ expiresInSeconds: z.number().int().min(REFERENCE_LIMITS.linkMinSeconds).max(REFERENCE_LIMITS.linkMaxSeconds)
  .default(REFERENCE_LIMITS.linkDefaultSeconds) }).strict();
export const ReferenceParamsSchema = z.object({ projectId: z.string().uuid(), referenceId: z.string().uuid() }).strict();
// Query string `token` = base64url(payload) "." hex HMAC-SHA256 (presigned-URL style: a path parameter is capped at 100 characters by the router).
// Any other shape is the same uniform 404 as a forged token.
export const DownloadTokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,600}\.[a-f0-9]{64}$/) }).strict();

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const digest = z.object({ sha256, bytes: z.number().int().min(0).max(REFERENCE_LIMITS.maxBytes) }).strict();
export const NOT_CLAIMED = Object.freeze({ malwareFree: 'NOT_CLAIMED', contentAccuracy: 'NOT_CLAIMED', drawingScale: 'NOT_CLAIMED', siteConditions: 'NOT_CLAIMED',
  ownershipOrLicence: 'NOT_CLAIMED' } as const);
export const InspectionFindingSchema = z.object({ code: z.union([RejectCodeSchema, z.enum(['METADATA_REMOVED', 'MPF_SECONDARY_IMAGES', 'PDF_METADATA_RETAINED'])]),
  severity: z.enum(['REJECT', 'INFO']), detail: z.string().max(200) }).strict();
export const InspectionReportSchema = z.object({
  inspectorVersion: z.literal(REFERENCE_INSPECTOR_VERSION),
  verdict: z.enum(['ACCEPTED', 'REJECTED']),
  declaredMediaType: z.string().max(100),
  detectedMediaType: ReferenceMediaTypeSchema.nullable(),
  original: digest,
  stored: digest.nullable(),
  checks: z.array(z.string().regex(/^[A-Z0-9_]{1,40}$/)).max(32),
  findings: z.array(InspectionFindingSchema).max(REFERENCE_LIMITS.findings),
  media: z.discriminatedUnion('kind', [z.object({ kind: z.literal('IMAGE'), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal('DOCUMENT'), pageCount: z.number().int().positive() }).strict()]).nullable(),
  metadata: z.object({ removed: z.array(z.object({ segment: z.string().regex(/^[A-Za-z0-9_ ]{1,24}$/), bytes: z.number().int().positive() }).strict()).max(REFERENCE_LIMITS.removedSegments),
    retained: z.array(z.string().regex(/^[A-Za-z0-9_ ]{1,24}$/)).max(32) }).strict(),
  malwareScan: z.object({ status: z.literal('NOT_PERFORMED'), reason: z.literal('NO_SCANNER_CONFIGURED') }).strict(),
  claims: z.object(Object.fromEntries(Object.keys(NOT_CLAIMED).map(k => [k, z.literal('NOT_CLAIMED')])) as Record<keyof typeof NOT_CLAIMED, z.ZodLiteral<'NOT_CLAIMED'>>).strict(),
}).strict().superRefine((r, ctx) => {
  const rejects = r.findings.filter(f => f.severity === 'REJECT').length;
  if ((r.verdict === 'ACCEPTED') !== (rejects === 0 && r.stored !== null && r.detectedMediaType !== null && r.media !== null))
    ctx.addIssue({ code: 'custom', message: 'Verdict is inconsistent with findings' });
});
export type InspectionReport = z.infer<typeof InspectionReportSchema>;
export type InspectionFinding = z.infer<typeof InspectionFindingSchema>;
export const ReferenceProvenanceSchema = z.object({ sourceKind: z.literal('USER_UPLOAD'), uploadedBy: z.string().uuid(), original: digest, stored: digest,
  transformations: z.array(z.enum(['METADATA_REMOVED', 'MPF_SECONDARY_IMAGES'])).max(2), inspection: InspectionReportSchema }).strict();

export const ReferenceSummarySchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), status: ReferenceStatusSchema, purpose: ReferencePurposeSchema,
  displayName: z.string().nullable(), note: z.string().nullable(), mediaType: ReferenceMediaTypeSchema,
  originalSha256: sha256, originalBytes: z.number().int().positive(), storedSha256: sha256, storedBytes: z.number().int().positive(),
  storageLocator: z.literal('postgres-bytea'), inspectorVersion: z.literal(REFERENCE_INSPECTOR_VERSION),
  boundRevisionId: z.string().uuid().nullable(), uploadedBy: z.string().uuid(), createdAt: z.string(), updatedAt: z.string(), deletedAt: z.string().nullable(),
}).strict();
export type ReferenceSummary = z.infer<typeof ReferenceSummarySchema>;
export const ReferenceEventSchema = z.object({ id: z.string().uuid(), eventType: z.enum(['UPLOADED', 'DEDUPLICATED', 'REJECTED', 'ARCHIVED', 'RESTORED', 'DELETED',
  'DOWNLOAD_LINK_ISSUED', 'METADATA_UPDATED']), actor: z.string().uuid().nullable(), detail: z.record(z.unknown()), createdAt: z.string() }).strict();
export const ReferenceCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict();
export const ReferenceCurrencySchema = z.object({ status: z.enum(['CURRENT', 'STALE', 'PROJECT_SCOPED']), boundRevisionId: z.string().uuid().nullable(),
  projectCurrentRevisionId: z.string().uuid().nullable() }).strict();
export const ReferenceItemSchema = ReferenceSummarySchema.extend({ currency: ReferenceCurrencySchema }).strict();
export const ReferenceDetailSchema = ReferenceItemSchema.extend({ provenance: ReferenceProvenanceSchema, events: z.array(ReferenceEventSchema).max(50),
  deduplicated: z.boolean().optional() }).strict();
export const ReferenceListSchema = z.object({ items: z.array(ReferenceItemSchema).max(100), nextCursor: z.string().nullable() }).strict();
export const ReferenceUsageSchema = z.object({ projectId: z.string().uuid(), references: z.number().int().min(0), storedBytes: z.number().int().min(0),
  attemptsLastHour: z.number().int().min(0), limits: z.object({ references: z.number().int(), storedBytes: z.number().int(), attemptsPerHour: z.number().int(),
    maxFileBytes: z.number().int() }).strict(), supportedMediaTypes: z.array(ReferenceMediaTypeSchema), malwareScan: z.literal('NOT_PERFORMED') }).strict();
export const DownloadLinkSchema = z.object({ url: z.string().startsWith('/api/reference-downloads?token='), expiresAt: z.string(), referenceId: z.string().uuid(),
  storedSha256: sha256 }).strict();
export const ValidateResponseSchema = z.object({ report: InspectionReportSchema, stored: z.literal(false) }).strict();
