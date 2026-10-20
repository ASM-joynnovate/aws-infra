var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../plugin-core/dist/contentAddressedAssets.mjs
var SHA256_FILE_HASH_RE = /^[0-9a-f]{64}$/;
var isContentAddressedAssetFileHash = /* @__PURE__ */ __name((value) => {
  return typeof value === "string" && SHA256_FILE_HASH_RE.test(value);
}, "isContentAddressedAssetFileHash");
var getContentAddressedAssetStoragePath = /* @__PURE__ */ __name(({ assetPath, fileHash }) => {
  const extension = assetPath.endsWith(".br") ? ".br" : assetPath.includes(".") ? `.${assetPath.split(".").pop()}` : "";
  return `sha256/${fileHash.slice(0, 2)}/${fileHash}${extension}`;
}, "getContentAddressedAssetStoragePath");

// ../plugin-core/dist/createStorageKeyBuilder.mjs
var normalizeStorageKeyParts = /* @__PURE__ */ __name((values) => {
  if (values.some((value) => value.includes("\\"))) throw new Error("Storage keys must use '/' as the hierarchy separator.");
  const segments = values.flatMap((value) => value.split("/").filter(Boolean));
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error("Storage key segments must not be '.' or '..'.");
  return segments;
}, "normalizeStorageKeyParts");
var createStorageKeyBuilder = /* @__PURE__ */ __name((basePath) => {
  const baseSegments = normalizeStorageKeyParts([basePath ?? ""]);
  return (...args) => [...baseSegments, ...normalizeStorageKeyParts(args)].join("/");
}, "createStorageKeyBuilder");

// ../plugin-core/dist/parseStorageUri.mjs
var PROTOCOL_PATTERN = /^[a-z][a-z\d+.-]*$/;
var INVALID_BUCKET_CHARACTER_PATTERN = /[\s/?#%@:\\]/;
var assertProtocol = /* @__PURE__ */ __name((protocol) => {
  if (!PROTOCOL_PATTERN.test(protocol)) throw new Error(`Invalid storage URI protocol: ${protocol}`);
}, "assertProtocol");
var assertBucket = /* @__PURE__ */ __name((bucket) => {
  if (bucket.length === 0 || INVALID_BUCKET_CHARACTER_PATTERN.test(bucket)) throw new Error(`Invalid storage URI bucket: ${bucket}`);
}, "assertBucket");
var getKeySegments = /* @__PURE__ */ __name((key) => {
  if (key.length === 0) throw new Error("Invalid storage URI key: key must not be empty");
  const segments = key.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment.includes("\\"))) throw new Error("Invalid storage URI key: segments must not be empty, '.', '..' or contain '\\'");
  return segments;
}, "getKeySegments");
var createStorageUri = /* @__PURE__ */ __name(({ protocol, bucket, key }) => {
  assertProtocol(protocol);
  assertBucket(bucket);
  return `${protocol}://${bucket}/${getKeySegments(key).map(encodeURIComponent).join("/")}`;
}, "createStorageUri");
function parseStorageUri(storageUri, expectedProtocol) {
  assertProtocol(expectedProtocol);
  if (storageUri.includes("?") || storageUri.includes("#")) throw new Error(`Invalid storage URI format: ${storageUri}`);
  const match2 = /^([a-z][a-z\d+.-]*):\/\/([^/]+)\/(.*)$/.exec(storageUri);
  if (!match2) throw new Error(`Invalid storage URI format: ${storageUri}`);
  const [, protocol, bucket, encodedKey] = match2;
  if (protocol !== expectedProtocol) throw new Error(`Invalid storage URI protocol. Expected ${expectedProtocol}, got ${protocol}`);
  assertBucket(bucket);
  let segments;
  try {
    segments = getKeySegments(encodedKey).map((segment) => {
      const decoded = decodeURIComponent(segment);
      if (decoded.includes("/") || decoded.includes("\\")) throw new Error("encoded hierarchy separator");
      if (encodeURIComponent(decoded) !== segment) throw new Error("non-canonical segment");
      return decoded;
    });
  } catch {
    throw new Error(`Invalid storage URI format: ${storageUri}`);
  }
  return {
    protocol,
    bucket,
    key: segments.join("/")
  };
}
__name(parseStorageUri, "parseStorageUri");

// ../plugin-core/dist/assetStorageLayout.mjs
var isBrotliManifestAssetPath = /* @__PURE__ */ __name((assetPath) => /(^|\/)index\.[^/]+\.bundle$/.test(assetPath.replace(/\\/g, "/")), "isBrotliManifestAssetPath");
var getManifestAssetDownloadPath = /* @__PURE__ */ __name((assetPath) => isBrotliManifestAssetPath(assetPath) ? `${assetPath}.br` : assetPath, "getManifestAssetDownloadPath");
var createStorageUriWithRelativePath = /* @__PURE__ */ __name(({ baseStorageUri, relativePath }) => {
  const protocol = new URL(baseStorageUri).protocol.replace(":", "");
  const parsed = parseStorageUri(baseStorageUri, protocol);
  const childKey = createStorageKeyBuilder(void 0)(relativePath);
  if (!childKey) throw new Error("Relative storage key must not be empty.");
  return createStorageUri({
    protocol: parsed.protocol,
    bucket: parsed.bucket,
    key: createStorageKeyBuilder(parsed.key)(childKey)
  });
}, "createStorageUriWithRelativePath");
var replaceStorageUriKeySuffix = /* @__PURE__ */ __name(({ storageUri, keySuffix, replacement }) => {
  const protocol = new URL(storageUri).protocol.replace(":", "");
  const parsed = parseStorageUri(storageUri, protocol);
  const normalizedSuffix = createStorageKeyBuilder(void 0)(keySuffix);
  const normalizedReplacement = createStorageKeyBuilder(void 0)(replacement);
  if (!normalizedSuffix || !normalizedReplacement) throw new Error("Storage URI key suffix and replacement must not be empty.");
  const keySegments = parsed.key.split("/");
  const suffixSegments = normalizedSuffix.split("/");
  const suffixOffset = keySegments.length - suffixSegments.length;
  if (suffixOffset < 0 || suffixSegments.some((segment, index) => keySegments[suffixOffset + index] !== segment)) throw new Error("Storage URI key does not end with the expected suffix.");
  const prefix = keySegments.slice(0, suffixOffset).join("/");
  return createStorageUri({
    protocol: parsed.protocol,
    bucket: parsed.bucket,
    key: createStorageKeyBuilder(prefix)(normalizedReplacement)
  });
}, "replaceStorageUriKeySuffix");
var resolveManifestAssetStorageFileHash = /* @__PURE__ */ __name(({ downloadFileHash, fileHash }) => isContentAddressedAssetFileHash(downloadFileHash) ? downloadFileHash : fileHash, "resolveManifestAssetStorageFileHash");
var getManifestAssetStoragePath = /* @__PURE__ */ __name(({ assetPath, downloadFileHash, fileHash }) => getContentAddressedAssetStoragePath({
  assetPath,
  fileHash: resolveManifestAssetStorageFileHash({
    downloadFileHash,
    fileHash
  })
}), "getManifestAssetStoragePath");
var resolveManifestAssetStorageUri = /* @__PURE__ */ __name(({ assetBaseStorageUri, assetPath, downloadFileHash, fileHash }) => createStorageUriWithRelativePath({
  baseStorageUri: assetBaseStorageUri,
  relativePath: getManifestAssetStoragePath({
    assetPath,
    downloadFileHash,
    fileHash
  })
}), "resolveManifestAssetStorageUri");

// ../plugin-core/dist/bundleStorageLayout.mjs
var BUNDLE_STORAGE_PREFIX = "bundles";
var createBundleStorageKey = /* @__PURE__ */ __name((bundleId, ...relativePaths) => [
  BUNDLE_STORAGE_PREFIX,
  bundleId,
  ...relativePaths
].filter(Boolean).join("/"), "createBundleStorageKey");
var getBundleArchiveStorageUri = /* @__PURE__ */ __name(({ manifestStorageUri, bundleId }) => replaceStorageUriKeySuffix({
  storageUri: manifestStorageUri,
  keySuffix: createBundleStorageKey(bundleId, "manifest.json"),
  replacement: createBundleStorageKey(bundleId, "bundle.tar.br")
}), "getBundleArchiveStorageUri");

// ../plugin-core/dist/databaseErrors.mjs
var DatabaseBundleNotFoundError = class extends Error {
  static {
    __name(this, "DatabaseBundleNotFoundError");
  }
  bundleId;
  name = "DatabaseBundleNotFoundError";
  constructor(bundleId) {
    super(`Bundle "${bundleId}" was not found.`);
    this.bundleId = bundleId;
  }
};
var DatabaseRowReferencedError = class extends Error {
  static {
    __name(this, "DatabaseRowReferencedError");
  }
  name = "DatabaseRowReferencedError";
  constructor() {
    super("The database row is still referenced.");
  }
};
var DatabaseAdapterInputError = class extends Error {
  static {
    __name(this, "DatabaseAdapterInputError");
  }
  code;
  name = "DatabaseAdapterInputError";
  constructor(code) {
    super(`Invalid database adapter input: ${code}`);
    this.code = code;
  }
};

// ../plugin-core/dist/createStorageAdapter.mjs
var createStorageAdapter = /* @__PURE__ */ __name((options) => ({ ...options }), "createStorageAdapter");
function assertStorageOperations(adapter, operations) {
  for (const operation of operations) if (typeof adapter[operation] !== "function") throw new Error(`Storage adapter "${adapter.name}" does not implement ${operation}.`);
}
__name(assertStorageOperations, "assertStorageOperations");

// ../plugin-core/dist/databaseJsonValue.mjs
var isDatabaseJsonValue = /* @__PURE__ */ __name((value) => {
  const ancestors = /* @__PURE__ */ new WeakSet();
  const validate = /* @__PURE__ */ __name((input) => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return true;
    if (typeof input === "number") return Number.isFinite(input);
    if (typeof input !== "object") return false;
    if (ancestors.has(input)) return false;
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype) return false;
        if (Reflect.ownKeys(input).length !== input.length + 1) return false;
        for (let index = 0; index < input.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
          if (descriptor === void 0 || !descriptor.enumerable || !("value" in descriptor) || !validate(descriptor.value)) return false;
        }
        return true;
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) return false;
      for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || key === "__proto__") return false;
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (descriptor === void 0 || !descriptor.enumerable || !("value" in descriptor) || !validate(descriptor.value)) return false;
      }
      return true;
    } finally {
      ancestors.delete(input);
    }
  }, "validate");
  return validate(value);
}, "isDatabaseJsonValue");
var isDatabaseJsonObject = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null && !Array.isArray(value) && isDatabaseJsonValue(value), "isDatabaseJsonObject");
var isDatabaseMetadataObject = /* @__PURE__ */ __name((value) => isDatabaseJsonObject(value) && (!Object.hasOwn(value, "app_version") || typeof value["app_version"] === "string"), "isDatabaseMetadataObject");

// ../plugin-core/dist/databaseMetadata.mjs
var bundleMetadataToRow = /* @__PURE__ */ __name((metadata) => {
  if (metadata === void 0) return {};
  if (!isDatabaseMetadataObject(metadata)) throw new DatabaseAdapterInputError("invalid-data");
  return metadata;
}, "bundleMetadataToRow");

// ../../packages/protocol/dist/index.mjs
var LETTER_DASH_NUMBER = "[a-zA-Z0-9-]";
var NUMERIC_IDENTIFIER = String.raw`0|[1-9]\d*`;
var NUMERIC_IDENTIFIER_LOOSE = String.raw`\d+`;
var NON_NUMERIC_IDENTIFIER = String.raw`\d*[a-zA-Z-]${LETTER_DASH_NUMBER}*`;
var MAIN_VERSION = String.raw`(${NUMERIC_IDENTIFIER})\.(${NUMERIC_IDENTIFIER})\.(${NUMERIC_IDENTIFIER})`;
var MAIN_VERSION_LOOSE = String.raw`(${NUMERIC_IDENTIFIER_LOOSE})\.(${NUMERIC_IDENTIFIER_LOOSE})\.(${NUMERIC_IDENTIFIER_LOOSE})`;
var PRERELEASE_IDENTIFIER = `(?:${NON_NUMERIC_IDENTIFIER}|${NUMERIC_IDENTIFIER})`;
var PRERELEASE_IDENTIFIER_LOOSE = `(?:${NON_NUMERIC_IDENTIFIER}|${NUMERIC_IDENTIFIER_LOOSE})`;
var PRERELEASE = String.raw`(?:-(${PRERELEASE_IDENTIFIER}(?:\.${PRERELEASE_IDENTIFIER})*))`;
var PRERELEASE_LOOSE = String.raw`(?:-?(${PRERELEASE_IDENTIFIER_LOOSE}(?:\.${PRERELEASE_IDENTIFIER_LOOSE})*))`;
var BUILD_IDENTIFIER = `${LETTER_DASH_NUMBER}+`;
var BUILD = String.raw`(?:\+(${BUILD_IDENTIFIER}(?:\.${BUILD_IDENTIFIER})*))`;
var FULL_PLAIN = `v?${MAIN_VERSION}${PRERELEASE}?${BUILD}?`;
var LOOSE_PLAIN = String.raw`[v=\s]*${MAIN_VERSION_LOOSE}${PRERELEASE_LOOSE}?${BUILD}?`;
var XRANGE_IDENTIFIER = String.raw`${NUMERIC_IDENTIFIER}|x|X|\*`;
var XRANGE_IDENTIFIER_LOOSE = String.raw`${NUMERIC_IDENTIFIER_LOOSE}|x|X|\*`;
String.raw`[v=\s]*(${XRANGE_IDENTIFIER})(?:\.(${XRANGE_IDENTIFIER})(?:\.(${XRANGE_IDENTIFIER})(?:${PRERELEASE})?${BUILD}?)?)?`;
String.raw`[v=\s]*(${XRANGE_IDENTIFIER_LOOSE})(?:\.(${XRANGE_IDENTIFIER_LOOSE})(?:\.(${XRANGE_IDENTIFIER_LOOSE})(?:${PRERELEASE_LOOSE})?${BUILD}?)?)?`;
String.raw`(?:\^)`;
var COERCE_PLAIN = String.raw`(^|[^\d])(\d{1,${16}})(?:\.(\d{1,${16}}))?(?:\.(\d{1,${16}}))?`;
var COERCE = String.raw`${COERCE_PLAIN}(?:$|[^\d])`;
var COERCE_FULL = String.raw`${COERCE_PLAIN}(?:${PRERELEASE})?(?:${BUILD})?(?:$|[^\d])`;
function makeSafeRegexSource(source) {
  const replacements = [
    [String.raw`\s`, 1],
    [String.raw`\d`, 256],
    [LETTER_DASH_NUMBER, 250]
  ];
  for (const [token, maximum] of replacements) source = source.split(`${token}*`).join(`${token}{0,${maximum}}`).split(`${token}+`).join(`${token}{1,${maximum}}`);
  return source;
}
__name(makeSafeRegexSource, "makeSafeRegexSource");
function safeRegex(source, flags) {
  return new RegExp(makeSafeRegexSource(source), flags);
}
__name(safeRegex, "safeRegex");
var FULL = safeRegex(`^${FULL_PLAIN}$`);
var LOOSE = safeRegex(`^${LOOSE_PLAIN}$`);
var NUMERIC$1 = /^\d+$/;
function formatComparableVersion(version2) {
  const base = `${version2.major}.${version2.minor}.${version2.patch}`;
  return version2.prerelease?.length ? `${base}-${version2.prerelease.join(".")}` : base;
}
__name(formatComparableVersion, "formatComparableVersion");
function formatFullVersion(version2) {
  const comparable = formatComparableVersion(version2);
  return version2.build?.length ? `${comparable}+${version2.build.join(".")}` : comparable;
}
__name(formatFullVersion, "formatFullVersion");
function parse(version2, options = {}) {
  if (typeof version2 !== "string") return version2;
  if (version2.length > 256) throw new TypeError(`Version exceeds the maximum length of 256 characters`);
  const match2 = version2.trim().match(options.loose ? LOOSE : FULL);
  if (!match2) throw new TypeError(`Invalid version syntax: ${version2}`);
  const major = Number(match2[1]);
  const minor = Number(match2[2]);
  const patch = Number(match2[3]);
  if (major > Number.MAX_SAFE_INTEGER || major < 0) throw new TypeError(`Invalid major version: ${match2[1]}`);
  if (minor > Number.MAX_SAFE_INTEGER || minor < 0) throw new TypeError(`Invalid minor version: ${match2[2]}`);
  if (patch > Number.MAX_SAFE_INTEGER || patch < 0) throw new TypeError(`Invalid patch version: ${match2[3]}`);
  const prerelease = match2[4] ? match2[4].split(".").map((identifier) => {
    if (NUMERIC$1.test(identifier)) {
      const numeric = Number(identifier);
      if (numeric >= 0 && numeric < Number.MAX_SAFE_INTEGER) return numeric;
    }
    return identifier;
  }) : void 0;
  return {
    build: match2[5]?.split("."),
    major,
    minor,
    patch,
    prerelease
  };
}
__name(parse, "parse");
function tryParse(version2, options = {}) {
  try {
    return parse(version2, options);
  } catch {
    return null;
  }
}
__name(tryParse, "tryParse");
var COERCE_EXACT = safeRegex(COERCE);
var COERCE_FULL_EXACT = safeRegex(COERCE_FULL);
safeRegex(`^${PRERELEASE}$`);
safeRegex(`^${PRERELEASE_LOOSE}$`);
function normalizeFull(version2, options = {}) {
  const parsed = tryParse(version2, options);
  return parsed ? formatFullVersion(parsed) : null;
}
__name(normalizeFull, "normalizeFull");
function coerce(value, options = {}) {
  if (typeof value === "object") return value;
  const input = typeof value === "number" ? String(value) : value;
  let match2 = null;
  if (options.rtl) {
    const expression = safeRegex(options.includePrerelease ? COERCE_FULL : COERCE, "g");
    let next;
    while ((next = expression.exec(input)) && (!match2 || match2.index + match2[0].length !== input.length)) {
      if (!match2 || next.index + next[0].length !== match2.index + match2[0].length) match2 = next;
      expression.lastIndex = next.index + next[1].length + next[2].length;
    }
  } else match2 = (options.includePrerelease ? COERCE_FULL_EXACT : COERCE_EXACT).exec(input);
  if (!match2) return null;
  const major = match2[2];
  return tryParse(`${major}.${match2[3] || "0"}.${match2[4] || "0"}${options.includePrerelease && match2[5] ? `-${match2[5]}` : ""}${options.includePrerelease && match2[6] ? `+${match2[6]}` : ""}`, options);
}
__name(coerce, "coerce");
function canonicalizeAppVersion(appVersion) {
  const version2 = coerce(appVersion);
  return version2 ? normalizeFull(version2) : null;
}
__name(canonicalizeAppVersion, "canonicalizeAppVersion");
var getManifestStorageUri = /* @__PURE__ */ __name((bundle) => bundle.manifestStorageUri, "getManifestStorageUri");
var getManifestFileHash = /* @__PURE__ */ __name((bundle) => bundle.manifestFileHash, "getManifestFileHash");
var getAssetBaseStorageUri = /* @__PURE__ */ __name((bundle) => bundle.assetBaseStorageUri, "getAssetBaseStorageUri");
var isBundlePatchArtifact = /* @__PURE__ */ __name((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value;
  return typeof candidate.baseBundleId === "string" && typeof candidate.baseFileHash === "string" && typeof candidate.patchFileHash === "string" && typeof candidate.patchStorageUri === "string";
}, "isBundlePatchArtifact");
var readBundlePatchArray = /* @__PURE__ */ __name((patches) => {
  if (!Array.isArray(patches)) return [];
  return patches.filter(isBundlePatchArtifact);
}, "readBundlePatchArray");
var getBundlePatches = /* @__PURE__ */ __name((bundle) => {
  const patches = readBundlePatchArray(bundle.patches);
  const seenBaseBundleIds = /* @__PURE__ */ new Set();
  return patches.filter((patch) => {
    if (seenBaseBundleIds.has(patch.baseBundleId)) return false;
    seenBaseBundleIds.add(patch.baseBundleId);
    return true;
  });
}, "getBundlePatches");
var getBundlePatch = /* @__PURE__ */ __name((bundle, baseBundleId) => {
  return getBundlePatches(bundle).find((patch) => patch.baseBundleId === baseBundleId) ?? null;
}, "getBundlePatch");
var NUMERIC_COHORT_SIZE = 1e3;
var DEFAULT_ROLLOUT_COHORT_COUNT = NUMERIC_COHORT_SIZE;
var CUSTOM_COHORT_PATTERN = /^[a-z0-9-]+$/;
function parseNumericCohortValue(cohort) {
  if (!/^\d+$/.test(cohort)) return null;
  const parsed = Number.parseInt(cohort, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 1e3) return null;
  return parsed;
}
__name(parseNumericCohortValue, "parseNumericCohortValue");
function positiveMod(value, modulus) {
  return (value % modulus + modulus) % modulus;
}
__name(positiveMod, "positiveMod");
function hashString(value) {
  let hash2 = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash2 = (hash2 << 5) - hash2 + char;
    hash2 |= 0;
  }
  return hash2;
}
__name(hashString, "hashString");
function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}
__name(gcd, "gcd");
function modularInverse(value, modulus) {
  let t = 0;
  let newT = 1;
  let r = modulus;
  let newR = positiveMod(value, modulus);
  while (newR !== 0) {
    const quotient = Math.floor(r / newR);
    [t, newT] = [newT, t - quotient * newT];
    [r, newR] = [newR, r - quotient * newR];
  }
  if (r > 1) throw new Error(`No modular inverse for ${value} mod ${modulus}`);
  return positiveMod(t, modulus);
}
__name(modularInverse, "modularInverse");
function getRolloutShuffleParameters(bundleId) {
  let multiplier = positiveMod(hashString(`${bundleId}:multiplier`), 997);
  if (multiplier === 0) multiplier = 1;
  while (gcd(multiplier, NUMERIC_COHORT_SIZE) !== 1) {
    multiplier = positiveMod(multiplier + 1, NUMERIC_COHORT_SIZE);
    if (multiplier === 0) multiplier = 1;
  }
  const offset = positiveMod(hashString(`${bundleId}:offset`), NUMERIC_COHORT_SIZE);
  return {
    multiplier,
    offset,
    inverseMultiplier: modularInverse(multiplier, NUMERIC_COHORT_SIZE)
  };
}
__name(getRolloutShuffleParameters, "getRolloutShuffleParameters");
function normalizeRolloutCohortCount(rolloutCohortCount) {
  if (rolloutCohortCount === null || rolloutCohortCount === void 0) return DEFAULT_ROLLOUT_COHORT_COUNT;
  if (rolloutCohortCount <= 0) return 0;
  if (rolloutCohortCount >= 1e3) return NUMERIC_COHORT_SIZE;
  return Math.floor(rolloutCohortCount);
}
__name(normalizeRolloutCohortCount, "normalizeRolloutCohortCount");
function normalizeCohortValue(cohort) {
  const normalized = cohort.trim().toLowerCase();
  const numericCohort = parseNumericCohortValue(normalized);
  if (numericCohort !== null) return String(numericCohort);
  return normalized;
}
__name(normalizeCohortValue, "normalizeCohortValue");
function getNumericCohortValue(cohort) {
  return parseNumericCohortValue(normalizeCohortValue(cohort));
}
__name(getNumericCohortValue, "getNumericCohortValue");
function isNumericCohort(cohort) {
  return getNumericCohortValue(cohort) !== null;
}
__name(isNumericCohort, "isNumericCohort");
function isCustomCohort(cohort) {
  const normalized = normalizeCohortValue(cohort);
  return normalized.length > 0 && normalized.length <= 64 && !/^\d+$/.test(normalized) && CUSTOM_COHORT_PATTERN.test(normalized);
}
__name(isCustomCohort, "isCustomCohort");
function isValidCohort(cohort) {
  const normalized = normalizeCohortValue(cohort);
  return isNumericCohort(normalized) || isCustomCohort(normalized);
}
__name(isValidCohort, "isValidCohort");
function getNumericCohortRolloutPosition(bundleId, cohortValue) {
  if (cohortValue < 1 || cohortValue > 1e3) throw new Error(`Invalid numeric cohort: ${cohortValue}`);
  const { offset, inverseMultiplier } = getRolloutShuffleParameters(bundleId);
  return positiveMod(inverseMultiplier * (cohortValue - 1 - offset), NUMERIC_COHORT_SIZE);
}
__name(getNumericCohortRolloutPosition, "getNumericCohortRolloutPosition");
function getRolledOutNumericCohorts(bundleId, rolloutCohortCount) {
  const normalizedRolloutCount = normalizeRolloutCohortCount(rolloutCohortCount);
  if (normalizedRolloutCount <= 0) return [];
  if (normalizedRolloutCount >= 1e3) return Array.from({ length: NUMERIC_COHORT_SIZE }, (_, index) => index + 1);
  const { multiplier, offset } = getRolloutShuffleParameters(bundleId);
  return Array.from({ length: normalizedRolloutCount }, (_, position) => positiveMod(multiplier * position + offset, NUMERIC_COHORT_SIZE)).map((zeroBasedCohort) => zeroBasedCohort + 1).sort((left, right) => left - right);
}
__name(getRolledOutNumericCohorts, "getRolledOutNumericCohorts");
var RELEASE_CATALOG_SCHEMA_VERSION = 1;
var RELEASE_CATALOG_FALLBACK_POLICY = "BUILTIN_IF_ACTIVE_INELIGIBLE";
var MAX_TARGET_COHORTS_PER_RELEASE = 100;
var MAX_DISTINCT_TARGET_COHORTS_PER_SCOPE = 512;
var MAX_COMPILED_CATALOG_BYTES = 262144;
var BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
var MAX_CATALOG_SEGMENT_LENGTH = 255;
function assertCatalogSegment(value, name) {
  if (value.length === 0 || value.length > MAX_CATALOG_SEGMENT_LENGTH || !/^[A-Za-z0-9._~-]+$/.test(value)) throw new Error(`${name} must be 1-${MAX_CATALOG_SEGMENT_LENGTH} URL-safe ASCII characters`);
}
__name(assertCatalogSegment, "assertCatalogSegment");
function encodeUtf8(value) {
  const bytes = [];
  for (const codePointText of value) {
    const codePoint = codePointText.codePointAt(0);
    if (codePoint <= 127) bytes.push(codePoint);
    else if (codePoint <= 2047) bytes.push(192 | codePoint >> 6, 128 | codePoint & 63);
    else if (codePoint <= 65535) bytes.push(224 | codePoint >> 12, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
    else bytes.push(240 | codePoint >> 18, 128 | codePoint >> 12 & 63, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
  }
  return bytes;
}
__name(encodeUtf8, "encodeUtf8");
function decodeUtf8(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index++];
    let codePoint;
    let continuationCount;
    if (first <= 127) {
      codePoint = first;
      continuationCount = 0;
    } else if ((first & 224) === 192) {
      codePoint = first & 31;
      continuationCount = 1;
    } else if ((first & 240) === 224) {
      codePoint = first & 15;
      continuationCount = 2;
    } else if ((first & 248) === 240) {
      codePoint = first & 7;
      continuationCount = 3;
    } else throw new Error("Invalid UTF-8 channel key");
    for (let offset = 0; offset < continuationCount; offset += 1) {
      const continuation = bytes[index++];
      if (continuation === void 0 || (continuation & 192) !== 128) throw new Error("Invalid UTF-8 channel key");
      codePoint = codePoint << 6 | continuation & 63;
    }
    if (codePoint > 1114111 || codePoint >= 55296 && codePoint <= 57343 || continuationCount === 1 && codePoint < 128 || continuationCount === 2 && codePoint < 2048 || continuationCount === 3 && codePoint < 65536) throw new Error("Invalid UTF-8 channel key");
    result += String.fromCodePoint(codePoint);
  }
  return result;
}
__name(decodeUtf8, "decodeUtf8");
function base64UrlEncode(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value = first << 16 | (second ?? 0) << 8 | (third ?? 0);
    result += BASE64URL_ALPHABET[value >> 18 & 63];
    result += BASE64URL_ALPHABET[value >> 12 & 63];
    if (second !== void 0) result += BASE64URL_ALPHABET[value >> 6 & 63];
    if (third !== void 0) result += BASE64URL_ALPHABET[value & 63];
  }
  return result;
}
__name(base64UrlEncode, "base64UrlEncode");
function base64UrlDecode(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new Error("Invalid channel key");
  const bytes = [];
  for (let index = 0; index < value.length; index += 4) {
    const chunk = value.slice(index, index + 4);
    const encoded = [...chunk].map((character) => BASE64URL_ALPHABET.indexOf(character));
    if (encoded.some((part) => part < 0)) throw new Error("Invalid channel key");
    const bits = encoded[0] << 18 | encoded[1] << 12 | (encoded[2] ?? 0) << 6 | (encoded[3] ?? 0);
    bytes.push(bits >> 16 & 255);
    if (chunk.length >= 3) bytes.push(bits >> 8 & 255);
    if (chunk.length === 4) bytes.push(bits & 255);
  }
  return bytes;
}
__name(base64UrlDecode, "base64UrlDecode");
function normalizeChannelName(channel) {
  return channel.trim().normalize("NFC");
}
__name(normalizeChannelName, "normalizeChannelName");
function assertCanonicalChannelName(channel) {
  const normalized = normalizeChannelName(channel);
  if (normalized.length === 0 || normalized !== channel) throw new Error("Channel name must be non-empty, trimmed, and NFC-normalized");
  let codePointCount = 0;
  for (const _codePoint of normalized) {
    codePointCount += 1;
    if (codePointCount > 255) throw new Error("Channel name must not exceed 255 characters");
  }
}
__name(assertCanonicalChannelName, "assertCanonicalChannelName");
function encodeChannelKey(channel) {
  assertCanonicalChannelName(channel);
  return base64UrlEncode(encodeUtf8(channel));
}
__name(encodeChannelKey, "encodeChannelKey");
function decodeChannelKey(channelKey) {
  const channel = decodeUtf8(base64UrlDecode(channelKey));
  assertCanonicalChannelName(channel);
  if (encodeChannelKey(channel) !== channelKey) throw new Error("Channel key is not canonically encoded");
  return channel;
}
__name(decodeChannelKey, "decodeChannelKey");
function createReleaseCatalogScopeKey(input) {
  decodeChannelKey(input.channelKey);
  if (input.strategy === "APP_VERSION") return `v1:app-version:${input.platform}:${input.channelKey}`;
  assertCatalogSegment(input.fingerprintHash, "Fingerprint hash");
  return `v1:fingerprint:${input.platform}:${input.channelKey}:${input.fingerprintHash}`;
}
__name(createReleaseCatalogScopeKey, "createReleaseCatalogScopeKey");
function parseReleaseCatalogScopeKey(scopeKey) {
  const segments = scopeKey.split(":");
  const [version2, strategy, platform, channelKey] = segments;
  if (version2 !== "v1" || platform !== "ios" && platform !== "android" || channelKey === void 0) throw new Error("Invalid release catalog scope key");
  const input = strategy === "app-version" && segments.length === 4 ? {
    channelKey,
    platform,
    strategy: "APP_VERSION"
  } : strategy === "fingerprint" && segments.length === 5 && segments[4] !== void 0 ? {
    channelKey,
    fingerprintHash: segments[4],
    platform,
    strategy: "FINGERPRINT"
  } : (() => {
    throw new Error("Invalid release catalog scope key");
  })();
  if (createReleaseCatalogScopeKey(input) !== scopeKey) throw new Error("Release catalog scope key is not canonical");
  return input;
}
__name(parseReleaseCatalogScopeKey, "parseReleaseCatalogScopeKey");
var NIL_UUID = "00000000-0000-0000-0000-000000000000";
var UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
var isUUIDv7 = /* @__PURE__ */ __name((value) => typeof value === "string" && UUID_V7_PATTERN.test(value), "isUUIDv7");
var ARTIFACT_PROTOCOL_VERSION = 1;
var ARTIFACT_FILES_PROTOCOL_VERSION = 2;
var ARTIFACT_FILES_REQUEST_LIMIT = 100;

// ../plugin-core/dist/databaseRows.mjs
var releaseRowToRelease = /* @__PURE__ */ __name((row) => ({
  id: row.id,
  revision: row.revision,
  channelId: row.channel_id,
  platform: row.platform,
  kind: row.kind,
  bundleId: row.bundle_id,
  strategy: row.strategy,
  targetAppVersion: row.target_app_version,
  fingerprintHash: row.fingerprint_hash,
  enabled: row.enabled,
  shouldForceUpdate: row.should_force_update,
  message: row.message,
  rolloutCohortCount: row.rollout_cohort_count,
  targetCohorts: row.target_cohorts,
  operation: row.operation,
  sourceReleaseId: row.source_release_id,
  createdAtMs: row.created_at_ms,
  updatedAtMs: row.updated_at_ms
}), "releaseRowToRelease");
var bundleToRow = /* @__PURE__ */ __name((bundle) => {
  const metadata = bundleMetadataToRow(bundle.metadata);
  return {
    id: bundle.id,
    platform: bundle.platform,
    git_commit_hash: bundle.gitCommitHash,
    metadata,
    manifest_storage_uri: getManifestStorageUri(bundle),
    manifest_file_hash: getManifestFileHash(bundle),
    asset_base_storage_uri: getAssetBaseStorageUri(bundle)
  };
}, "bundleToRow");
var bundleToPatchRows = /* @__PURE__ */ __name((bundle) => getBundlePatches(bundle).map((patch, orderIndex) => ({
  id: `${bundle.id}:${patch.baseBundleId}`,
  bundle_id: bundle.id,
  base_bundle_id: patch.baseBundleId,
  base_file_hash: patch.baseFileHash,
  patch_file_hash: patch.patchFileHash,
  patch_storage_uri: patch.patchStorageUri,
  byte_size: patch.byteSize,
  order_index: orderIndex
})), "bundleToPatchRows");
var comparePatchRows = /* @__PURE__ */ __name((left, right) => left.order_index - right.order_index || left.id.localeCompare(right.id), "comparePatchRows");
var patchRowToArtifact = /* @__PURE__ */ __name((row) => ({
  baseBundleId: row.base_bundle_id,
  baseFileHash: row.base_file_hash,
  byteSize: row.byte_size,
  patchFileHash: row.patch_file_hash,
  patchStorageUri: row.patch_storage_uri
}), "patchRowToArtifact");
var rowToBundle = /* @__PURE__ */ __name((row, patchRows = []) => {
  const patches = patchRows.slice().sort(comparePatchRows).map(patchRowToArtifact);
  return {
    id: row.id,
    platform: row.platform,
    gitCommitHash: row.git_commit_hash,
    metadata: row.metadata,
    manifestStorageUri: row.manifest_storage_uri,
    manifestFileHash: row.manifest_file_hash,
    assetBaseStorageUri: row.asset_base_storage_uri,
    patches
  };
}, "rowToBundle");

// ../plugin-core/dist/uuidv7.mjs
var extractTimestampFromUUIDv7 = /* @__PURE__ */ __name((uuid) => {
  if (!isUUIDv7(uuid)) throw new TypeError("Expected a canonical lowercase UUIDv7");
  const timestampHex = uuid.split("-").join("").slice(0, 12);
  return Number.parseInt(timestampHex, 16);
}, "extractTimestampFromUUIDv7");
function createUUIDv7FromTimestampHex(timestampHex) {
  const randomBytes = /* @__PURE__ */ new Uint8Array(10);
  crypto.getRandomValues(randomBytes);
  const randomHex = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const randA = randomHex.slice(0, 3);
  const randBHex = randomHex.slice(3, 19);
  const versionAndRandA = `7${randA}`;
  const variantAndFirstRandB = (128 | parseInt(randBHex.slice(0, 2), 16) & 63).toString(16).padStart(2, "0");
  return [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    versionAndRandA,
    variantAndFirstRandB + randBHex.slice(2, 4),
    randBHex.slice(4, 16)
  ].join("-");
}
__name(createUUIDv7FromTimestampHex, "createUUIDv7FromTimestampHex");
var createUUIDv7 = /* @__PURE__ */ __name(() => createUUIDv7FromTimestampHex(Date.now().toString(16).padStart(12, "0")), "createUUIDv7");
var createUUIDv7After = /* @__PURE__ */ __name((floor, nowMs = Date.now()) => {
  const timestamp = Math.max(nowMs, floor === null ? 0 : extractTimestampFromUUIDv7(floor) + 1);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp >= 2 ** 48) throw new RangeError("UUIDv7 timestamp is out of range");
  return createUUIDv7FromTimestampHex(timestamp.toString(16).padStart(12, "0"));
}, "createUUIDv7After");

// ../plugin-core/dist/node_modules/.pnpm/verkit@0.4.0/node_modules/verkit/dist/comparison-DenM3wCn.mjs
var LETTER_DASH_NUMBER2 = "[a-zA-Z0-9-]";
var NUMERIC_IDENTIFIER2 = String.raw`0|[1-9]\d*`;
var NUMERIC_IDENTIFIER_LOOSE2 = String.raw`\d+`;
var NON_NUMERIC_IDENTIFIER2 = String.raw`\d*[a-zA-Z-]${LETTER_DASH_NUMBER2}*`;
var MAIN_VERSION2 = String.raw`(${NUMERIC_IDENTIFIER2})\.(${NUMERIC_IDENTIFIER2})\.(${NUMERIC_IDENTIFIER2})`;
var MAIN_VERSION_LOOSE2 = String.raw`(${NUMERIC_IDENTIFIER_LOOSE2})\.(${NUMERIC_IDENTIFIER_LOOSE2})\.(${NUMERIC_IDENTIFIER_LOOSE2})`;
var PRERELEASE_IDENTIFIER2 = `(?:${NON_NUMERIC_IDENTIFIER2}|${NUMERIC_IDENTIFIER2})`;
var PRERELEASE_IDENTIFIER_LOOSE2 = `(?:${NON_NUMERIC_IDENTIFIER2}|${NUMERIC_IDENTIFIER_LOOSE2})`;
var PRERELEASE2 = String.raw`(?:-(${PRERELEASE_IDENTIFIER2}(?:\.${PRERELEASE_IDENTIFIER2})*))`;
var PRERELEASE_LOOSE2 = String.raw`(?:-?(${PRERELEASE_IDENTIFIER_LOOSE2}(?:\.${PRERELEASE_IDENTIFIER_LOOSE2})*))`;
var BUILD_IDENTIFIER2 = `${LETTER_DASH_NUMBER2}+`;
var BUILD2 = String.raw`(?:\+(${BUILD_IDENTIFIER2}(?:\.${BUILD_IDENTIFIER2})*))`;
var FULL_PLAIN2 = `v?${MAIN_VERSION2}${PRERELEASE2}?${BUILD2}?`;
var LOOSE_PLAIN2 = String.raw`[v=\s]*${MAIN_VERSION_LOOSE2}${PRERELEASE_LOOSE2}?${BUILD2}?`;
var GREATER_LESS_THAN = "((?:<|>)?=?)";
var XRANGE_IDENTIFIER2 = String.raw`${NUMERIC_IDENTIFIER2}|x|X|\*`;
var XRANGE_IDENTIFIER_LOOSE2 = String.raw`${NUMERIC_IDENTIFIER_LOOSE2}|x|X|\*`;
var XRANGE_PLAIN = String.raw`[v=\s]*(${XRANGE_IDENTIFIER2})(?:\.(${XRANGE_IDENTIFIER2})(?:\.(${XRANGE_IDENTIFIER2})(?:${PRERELEASE2})?${BUILD2}?)?)?`;
var XRANGE_PLAIN_LOOSE = String.raw`[v=\s]*(${XRANGE_IDENTIFIER_LOOSE2})(?:\.(${XRANGE_IDENTIFIER_LOOSE2})(?:\.(${XRANGE_IDENTIFIER_LOOSE2})(?:${PRERELEASE_LOOSE2})?${BUILD2}?)?)?`;
var LONE_TILDE = "(?:~>?)";
var LONE_CARET = String.raw`(?:\^)`;
var COERCE_PLAIN2 = String.raw`(^|[^\d])(\d{1,${16}})(?:\.(\d{1,${16}}))?(?:\.(\d{1,${16}}))?`;
var COERCE2 = String.raw`${COERCE_PLAIN2}(?:$|[^\d])`;
var COERCE_FULL2 = String.raw`${COERCE_PLAIN2}(?:${PRERELEASE2})?(?:${BUILD2})?(?:$|[^\d])`;
function makeSafeRegexSource2(source) {
  const replacements = [
    [String.raw`\s`, 1],
    [String.raw`\d`, 256],
    [LETTER_DASH_NUMBER2, 250]
  ];
  for (const [token, maximum] of replacements) source = source.split(`${token}*`).join(`${token}{0,${maximum}}`).split(`${token}+`).join(`${token}{1,${maximum}}`);
  return source;
}
__name(makeSafeRegexSource2, "makeSafeRegexSource");
function safeRegex2(source, flags) {
  return new RegExp(makeSafeRegexSource2(source), flags);
}
__name(safeRegex2, "safeRegex");
var FULL2 = safeRegex2(`^${FULL_PLAIN2}$`);
var LOOSE2 = safeRegex2(`^${LOOSE_PLAIN2}$`);
var NUMERIC$12 = /^\d+$/;
function formatComparableVersion2(version2) {
  const base = `${version2.major}.${version2.minor}.${version2.patch}`;
  return version2.prerelease?.length ? `${base}-${version2.prerelease.join(".")}` : base;
}
__name(formatComparableVersion2, "formatComparableVersion");
function parse2(version2, options = {}) {
  if (typeof version2 !== "string") return version2;
  if (version2.length > 256) throw new TypeError(`Version exceeds the maximum length of 256 characters`);
  const match2 = version2.trim().match(options.loose ? LOOSE2 : FULL2);
  if (!match2) throw new TypeError(`Invalid version syntax: ${version2}`);
  const major = Number(match2[1]);
  const minor = Number(match2[2]);
  const patch = Number(match2[3]);
  if (major > Number.MAX_SAFE_INTEGER || major < 0) throw new TypeError(`Invalid major version: ${match2[1]}`);
  if (minor > Number.MAX_SAFE_INTEGER || minor < 0) throw new TypeError(`Invalid minor version: ${match2[2]}`);
  if (patch > Number.MAX_SAFE_INTEGER || patch < 0) throw new TypeError(`Invalid patch version: ${match2[3]}`);
  const prerelease = match2[4] ? match2[4].split(".").map((identifier) => {
    if (NUMERIC$12.test(identifier)) {
      const numeric = Number(identifier);
      if (numeric >= 0 && numeric < Number.MAX_SAFE_INTEGER) return numeric;
    }
    return identifier;
  }) : void 0;
  return {
    build: match2[5]?.split("."),
    major,
    minor,
    patch,
    prerelease
  };
}
__name(parse2, "parse");
function tryParse2(version2, options = {}) {
  try {
    return parse2(version2, options);
  } catch {
    return null;
  }
}
__name(tryParse2, "tryParse");
var NUMERIC = /^\d+$/;
function compareIdentifiers(left, right) {
  if (typeof left === "number" && typeof right === "number") return left === right ? 0 : left < right ? -1 : 1;
  const leftNumeric = NUMERIC.test(String(left));
  const rightNumeric = NUMERIC.test(String(right));
  const normalizedLeft = leftNumeric ? Number(left) : left;
  const normalizedRight = rightNumeric ? Number(right) : right;
  return normalizedLeft === normalizedRight ? 0 : leftNumeric && !rightNumeric ? -1 : rightNumeric && !leftNumeric ? 1 : normalizedLeft < normalizedRight ? -1 : 1;
}
__name(compareIdentifiers, "compareIdentifiers");
function compareMainParsed(left, right) {
  return left.major === right.major ? left.minor === right.minor ? left.patch === right.patch ? 0 : left.patch < right.patch ? -1 : 1 : left.minor < right.minor ? -1 : 1 : left.major < right.major ? -1 : 1;
}
__name(compareMainParsed, "compareMainParsed");
function comparePrereleaseParsed(left, right) {
  const leftPrerelease = left.prerelease;
  const rightPrerelease = right.prerelease;
  if (leftPrerelease?.length && !rightPrerelease?.length) return -1;
  if (!leftPrerelease?.length && rightPrerelease?.length) return 1;
  if (!leftPrerelease?.length && !rightPrerelease?.length) return 0;
  for (let index = 0; ; index++) {
    const leftIdentifier = leftPrerelease?.[index];
    const rightIdentifier = rightPrerelease?.[index];
    if (leftIdentifier === void 0 && rightIdentifier === void 0) return 0;
    if (rightIdentifier === void 0) return 1;
    if (leftIdentifier === void 0) return -1;
    if (leftIdentifier !== rightIdentifier) return compareIdentifiers(leftIdentifier, rightIdentifier);
  }
}
__name(comparePrereleaseParsed, "comparePrereleaseParsed");
function compareParsed(left, right) {
  return compareMainParsed(left, right) || comparePrereleaseParsed(left, right);
}
__name(compareParsed, "compareParsed");
function compare(left, right, options = {}) {
  return compareParsed(parse2(left, options), parse2(right, options));
}
__name(compare, "compare");

// ../plugin-core/dist/node_modules/.pnpm/verkit@0.4.0/node_modules/verkit/dist/set-CC5YeoYX.mjs
var STRICT_COMPARATOR = safeRegex2(String.raw`^${GREATER_LESS_THAN}\s*(${FULL_PLAIN2})$|^$`);
var LOOSE_COMPARATOR = safeRegex2(String.raw`^${GREATER_LESS_THAN}\s*(${LOOSE_PLAIN2})$|^$`);
function formatComparator(comparator) {
  return comparator.version ? `${comparator.operator}${formatComparableVersion2(comparator.version)}` : "";
}
__name(formatComparator, "formatComparator");
function parseComparator(comparator, options = {}) {
  if (typeof comparator !== "string") return comparator;
  const normalized = comparator.trim().replaceAll(/\s+/g, " ");
  const match2 = normalized.match(options.loose ? LOOSE_COMPARATOR : STRICT_COMPARATOR);
  if (!match2) throw new TypeError(`Invalid comparator: ${normalized}`);
  const operator = match2[1] === "=" ? "" : match2[1] || "";
  const version2 = match2[2] ? parse2(match2[2], options) : null;
  return {
    operator,
    options,
    value: version2 ? `${operator}${formatComparableVersion2(version2)}` : "",
    version: version2
  };
}
__name(parseComparator, "parseComparator");
function testParsedComparator(comparator, version2) {
  if (!comparator.version) return true;
  const comparison = compareParsed(version2, comparator.version);
  switch (comparator.operator) {
    case "":
      return comparison === 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
  }
}
__name(testParsedComparator, "testParsedComparator");
function comparatorAllowsPrerelease(comparator, version2) {
  const allowed = comparator.version;
  return allowed !== null && !!allowed.prerelease?.length && allowed.major === version2.major && allowed.minor === version2.minor && allowed.patch === version2.patch;
}
__name(comparatorAllowsPrerelease, "comparatorAllowsPrerelease");
function testComparatorSet(set, version2, options) {
  if (set.some((comparator) => !testParsedComparator(comparator, version2))) return false;
  return !version2.prerelease?.length || !!options.includePrerelease || set.some((comparator) => comparatorAllowsPrerelease(comparator, version2));
}
__name(testComparatorSet, "testComparatorSet");

// ../plugin-core/dist/node_modules/.pnpm/verkit@0.4.0/node_modules/verkit/dist/range-DvX-Y6iv.mjs
function formatRange(range) {
  return range.sets.map((set) => set.map(formatComparator).join(" ")).join("||");
}
__name(formatRange, "formatRange");
var BUILD_STRIP = new RegExp(BUILD2, "g");
var BUILD_SAFE = safeRegex2(BUILD2);
var STRICT_HYPHEN = safeRegex2(String.raw`^\s*(${XRANGE_PLAIN})\s+-\s+(${XRANGE_PLAIN})\s*$`);
var LOOSE_HYPHEN = safeRegex2(String.raw`^\s*(${XRANGE_PLAIN_LOOSE})\s+-\s+(${XRANGE_PLAIN_LOOSE})\s*$`);
var COMPARATOR_TRIM = safeRegex2(String.raw`(\s*)${GREATER_LESS_THAN}\s*(${LOOSE_PLAIN2}|${XRANGE_PLAIN})`, "g");
var TILDE_TRIM = safeRegex2(String.raw`(\s*)${LONE_TILDE}\s+`, "g");
var CARET_TRIM = safeRegex2(String.raw`(\s*)${LONE_CARET}\s+`, "g");
var STRICT_TILDE = safeRegex2(`^${LONE_TILDE}${XRANGE_PLAIN}$`);
var LOOSE_TILDE = safeRegex2(`^${LONE_TILDE}${XRANGE_PLAIN_LOOSE}$`);
var STRICT_CARET = safeRegex2(`^${LONE_CARET}${XRANGE_PLAIN}$`);
var LOOSE_CARET = safeRegex2(`^${LONE_CARET}${XRANGE_PLAIN_LOOSE}$`);
var STRICT_XRANGE = safeRegex2(String.raw`^${GREATER_LESS_THAN}\s*${XRANGE_PLAIN}$`);
var LOOSE_XRANGE = safeRegex2(String.raw`^${GREATER_LESS_THAN}\s*${XRANGE_PLAIN_LOOSE}$`);
var STAR = safeRegex2(String.raw`(<|>)?=?\s*\*`);
var GTE_ZERO = /^\s*>=\s*0\.0\.0\s*$/;
var GTE_ZERO_PRERELEASE = /^\s*>=\s*0\.0\.0-0\s*$/;
var LOOSE_COMPARATOR2 = safeRegex2(String.raw`^${GREATER_LESS_THAN}\s*(${LOOSE_PLAIN2})$|^$`);
function isWildcard(value) {
  return !value || String(value).toLowerCase() === "x" || String(value) === "*";
}
__name(isWildcard, "isWildcard");
function hasInvalidWildcardOrder(major, minor, patch) {
  return isWildcard(major) && !isWildcard(minor) || isWildcard(minor) && Boolean(patch) && !isWildcard(patch);
}
__name(hasInvalidWildcardOrder, "hasInvalidWildcardOrder");
function replaceTilde(comparator, options) {
  const expression = options.loose ? LOOSE_TILDE : STRICT_TILDE;
  const lowerPrerelease = options.includePrerelease ? "-0" : "";
  return comparator.replace(expression, (_match, major, minor, patch, prerelease) => {
    if (isWildcard(major)) return "";
    if (isWildcard(minor)) return `>=${major}.0.0${lowerPrerelease} <${Number(major) + 1}.0.0-0`;
    if (isWildcard(patch)) return `>=${major}.${minor}.0${lowerPrerelease} <${major}.${Number(minor) + 1}.0-0`;
    return prerelease ? `>=${major}.${minor}.${patch}-${prerelease} <${major}.${Number(minor) + 1}.0-0` : `>=${major}.${minor}.${patch} <${major}.${Number(minor) + 1}.0-0`;
  });
}
__name(replaceTilde, "replaceTilde");
function replaceTildes(comparator, options) {
  return comparator.trim().split(/\s+/).map((part) => replaceTilde(part, options)).join(" ");
}
__name(replaceTildes, "replaceTildes");
function replaceCaret(comparator, options) {
  const expression = options.loose ? LOOSE_CARET : STRICT_CARET;
  const lowerPrerelease = options.includePrerelease ? "-0" : "";
  return comparator.replace(expression, (_match, major, minor, patch, prerelease) => {
    if (isWildcard(major)) return "";
    if (isWildcard(minor)) return `>=${major}.0.0${lowerPrerelease} <${Number(major) + 1}.0.0-0`;
    if (isWildcard(patch)) return major === "0" ? `>=${major}.${minor}.0${lowerPrerelease} <${major}.${Number(minor) + 1}.0-0` : `>=${major}.${minor}.0${lowerPrerelease} <${Number(major) + 1}.0.0-0`;
    if (prerelease) return major === "0" ? minor === "0" ? `>=${major}.${minor}.${patch}-${prerelease} <${major}.${minor}.${Number(patch) + 1}-0` : `>=${major}.${minor}.${patch}-${prerelease} <${major}.${Number(minor) + 1}.0-0` : `>=${major}.${minor}.${patch}-${prerelease} <${Number(major) + 1}.0.0-0`;
    return major === "0" ? minor === "0" ? `>=${major}.${minor}.${patch} <${major}.${minor}.${Number(patch) + 1}-0` : `>=${major}.${minor}.${patch} <${major}.${Number(minor) + 1}.0-0` : `>=${major}.${minor}.${patch} <${Number(major) + 1}.0.0-0`;
  });
}
__name(replaceCaret, "replaceCaret");
function replaceCarets(comparator, options) {
  return comparator.trim().split(/\s+/).map((part) => replaceCaret(part, options)).join(" ");
}
__name(replaceCarets, "replaceCarets");
function replaceXRange(comparator, options) {
  const expression = options.loose ? LOOSE_XRANGE : STRICT_XRANGE;
  return comparator.trim().replace(expression, (match2, rawOperator, rawMajor, rawMinor, rawPatch) => {
    let operator = rawOperator;
    let major = rawMajor;
    let minor = rawMinor;
    let patch = rawPatch;
    if (hasInvalidWildcardOrder(String(major), minor === void 0 ? void 0 : String(minor), patch === void 0 ? void 0 : String(patch))) return comparator;
    const wildcardMajor = isWildcard(major);
    const wildcardMinor = wildcardMajor || isWildcard(minor);
    const wildcardPatch = wildcardMinor || isWildcard(patch);
    if (operator === "=" && wildcardPatch) operator = "";
    if (wildcardMajor) return operator === ">" || operator === "<" ? "<0.0.0-0" : "*";
    let prerelease = options.includePrerelease ? "-0" : "";
    if (operator && wildcardPatch) {
      if (wildcardMinor) minor = 0;
      patch = 0;
      if (operator === ">") {
        operator = ">=";
        if (wildcardMinor) {
          major = Number(major) + 1;
          minor = 0;
        } else minor = Number(minor) + 1;
      } else if (operator === "<=") {
        operator = "<";
        if (wildcardMinor) major = Number(major) + 1;
        else minor = Number(minor) + 1;
      }
      if (operator === "<") prerelease = "-0";
      return `${operator}${major}.${minor}.${patch}${prerelease}`;
    }
    if (wildcardMinor) return `>=${major}.0.0${prerelease} <${Number(major) + 1}.0.0-0`;
    if (wildcardPatch) return `>=${major}.${minor}.0${prerelease} <${major}.${Number(minor) + 1}.0-0`;
    return match2;
  });
}
__name(replaceXRange, "replaceXRange");
function replaceXRanges(comparator, options) {
  return comparator.split(/\s+/).map((part) => replaceXRange(part, options)).join(" ");
}
__name(replaceXRanges, "replaceXRanges");
function replaceHyphenRange(range, options) {
  const expression = options.loose ? LOOSE_HYPHEN : STRICT_HYPHEN;
  return range.replace(expression, (_match, rawFrom, fromMajor, fromMinor, fromPatch, fromPrerelease, _fromBuild, rawTo, toMajor, toMinor, toPatch, toPrerelease) => {
    let from = rawFrom;
    let to = rawTo;
    if (isWildcard(fromMajor)) from = "";
    else if (isWildcard(fromMinor)) from = `>=${fromMajor}.0.0${options.includePrerelease ? "-0" : ""}`;
    else if (isWildcard(fromPatch)) from = `>=${fromMajor}.${fromMinor}.0${options.includePrerelease ? "-0" : ""}`;
    else if (fromPrerelease) from = `>=${from}`;
    else from = `>=${from}${options.includePrerelease ? "-0" : ""}`;
    if (isWildcard(toMajor)) to = "";
    else if (isWildcard(toMinor)) to = `<${Number(toMajor) + 1}.0.0-0`;
    else if (isWildcard(toPatch)) to = `<${toMajor}.${Number(toMinor) + 1}.0-0`;
    else if (toPrerelease) to = `<=${toMajor}.${toMinor}.${toPatch}-${toPrerelease}`;
    else if (options.includePrerelease) to = `<${toMajor}.${toMinor}.${Number(toPatch) + 1}-0`;
    else to = `<=${to}`;
    return `${from} ${to}`.trim();
  });
}
__name(replaceHyphenRange, "replaceHyphenRange");
function expandComparator(comparator, options) {
  return replaceXRanges(replaceTildes(replaceCarets(comparator.replace(BUILD_SAFE, ""), options), options), options).trim().replace(STAR, "");
}
__name(expandComparator, "expandComparator");
function parseSimpleRange(input, options) {
  let parts = replaceHyphenRange(input.replace(BUILD_STRIP, ""), options).replace(COMPARATOR_TRIM, "$1$2$3").replace(TILDE_TRIM, "$1~").replace(CARET_TRIM, "$1^").split(" ").map((part) => expandComparator(part, options)).join(" ").split(/\s+/).map((part) => part.trim().replace(options.includePrerelease ? GTE_ZERO_PRERELEASE : GTE_ZERO, ""));
  if (options.loose) parts = parts.filter((part) => LOOSE_COMPARATOR2.test(part));
  const unique = /* @__PURE__ */ new Map();
  for (const comparator of parts.map((part) => parseComparator(part, options))) {
    if (comparator.value === "<0.0.0-0") return [comparator];
    unique.set(comparator.value, comparator);
  }
  if (unique.size > 1) unique.delete("");
  return [...unique.values()];
}
__name(parseSimpleRange, "parseSimpleRange");
function parseRange(range, options = {}) {
  if (typeof range !== "string") return range;
  const parsedOptions = { ...options };
  const normalizedRange = range.trim().replaceAll(/\s+/g, " ");
  let sets = normalizedRange.split("||").map((part) => parseSimpleRange(part.trim(), parsedOptions)).filter((set) => set.length);
  if (!sets.length) throw new TypeError(`Range contains no valid comparator sets: ${normalizedRange}`);
  if (sets.length > 1) {
    const first = sets[0];
    sets = sets.filter((set) => set[0]?.value !== "<0.0.0-0");
    if (!sets.length) sets = [first];
    else if (sets.length > 1) {
      const any = sets.find((set) => set.length === 1 && set[0]?.value === "");
      if (any) sets = [any];
    }
  }
  return {
    options: parsedOptions,
    sets
  };
}
__name(parseRange, "parseRange");
function tryParseRange(range, options = {}) {
  try {
    return parseRange(range, options);
  } catch {
    return null;
  }
}
__name(tryParseRange, "tryParseRange");
function testParsedRange(range, version2) {
  return range.sets.some((set) => testComparatorSet(set, version2, range.options));
}
__name(testParsedRange, "testParsedRange");
function testRangeVersion(range, version2) {
  const parsed = tryParse2(version2, range.options);
  return parsed ? testParsedRange(range, parsed) : false;
}
__name(testRangeVersion, "testRangeVersion");
function normalizeRange(range, options = {}) {
  const parsed = tryParseRange(range, options);
  return parsed ? formatRange(parsed) || "*" : null;
}
__name(normalizeRange, "normalizeRange");
function satisfies(version2, range, options = {}) {
  const parsed = tryParseRange(range, options);
  return parsed ? testRangeVersion(parsed, version2) : false;
}
__name(satisfies, "satisfies");

// ../plugin-core/dist/node_modules/.pnpm/verkit@0.4.0/node_modules/verkit/dist/version-CQ98ZBpL.mjs
var COERCE_EXACT2 = safeRegex2(COERCE2);
var COERCE_FULL_EXACT2 = safeRegex2(COERCE_FULL2);
safeRegex2(`^${PRERELEASE2}$`);
safeRegex2(`^${PRERELEASE_LOOSE2}$`);
function normalize(version2, options = {}) {
  const parsed = tryParse2(version2, options);
  return parsed ? formatComparableVersion2(parsed) : null;
}
__name(normalize, "normalize");
function coerce2(value, options = {}) {
  if (typeof value === "object") return value;
  const input = typeof value === "number" ? String(value) : value;
  let match2 = null;
  if (options.rtl) {
    const source = options.includePrerelease ? COERCE_FULL2 : COERCE2;
    const expression = safeRegex2(source, "g");
    let next;
    while ((next = expression.exec(input)) && (!match2 || match2.index + match2[0].length !== input.length)) {
      if (!match2 || next.index + next[0].length !== match2.index + match2[0].length) match2 = next;
      expression.lastIndex = next.index + next[1].length + next[2].length;
    }
  } else match2 = (options.includePrerelease ? COERCE_FULL_EXACT2 : COERCE_EXACT2).exec(input);
  if (!match2) return null;
  const major = match2[2];
  const minor = match2[3] || "0";
  const patch = match2[4] || "0";
  const prerelease = options.includePrerelease && match2[5] ? `-${match2[5]}` : "";
  const build = options.includePrerelease && match2[6] ? `+${match2[6]}` : "";
  return tryParse2(`${major}.${minor}.${patch}${prerelease}${build}`, options);
}
__name(coerce2, "coerce");

// ../plugin-core/dist/releaseCatalogCompiler.mjs
var ReleaseCatalogCompilationError = class extends Error {
  static {
    __name(this, "ReleaseCatalogCompilationError");
  }
  code;
  constructor(code, message) {
    super(message);
    this.name = "ReleaseCatalogCompilationError";
    this.code = code;
  }
};
function compareBounds(left, right) {
  return compare(left, right);
}
__name(compareBounds, "compareBounds");
function strongerLower(current, candidate) {
  if (current === null) return candidate;
  const compared = compareBounds(candidate.version, current.version);
  if (compared > 0) return candidate;
  if (compared < 0) return current;
  return {
    version: current.version,
    inclusive: current.inclusive && candidate.inclusive
  };
}
__name(strongerLower, "strongerLower");
function strongerUpper(current, candidate) {
  if (current === null) return candidate;
  const compared = compareBounds(candidate.version, current.version);
  if (compared < 0) return candidate;
  if (compared > 0) return current;
  return {
    version: current.version,
    inclusive: current.inclusive && candidate.inclusive
  };
}
__name(strongerUpper, "strongerUpper");
function comparatorVersion(comparator) {
  const version2 = comparator.version && normalize(comparator.version);
  if (version2 === null) throw new ReleaseCatalogCompilationError("INVALID_TARGET_RANGE", `Invalid comparator: ${comparator.value}`);
  return version2;
}
__name(comparatorVersion, "comparatorVersion");
function comparatorSetToInterval(comparators) {
  let lower = null;
  let upper = null;
  for (const comparator of comparators) {
    if (comparator.version === null) continue;
    const version2 = comparatorVersion(comparator);
    if (comparator.operator === "") {
      lower = strongerLower(lower, {
        inclusive: true,
        version: version2
      });
      upper = strongerUpper(upper, {
        inclusive: true,
        version: version2
      });
    } else if (comparator.operator === ">") lower = strongerLower(lower, {
      inclusive: false,
      version: version2
    });
    else if (comparator.operator === ">=") lower = strongerLower(lower, {
      inclusive: true,
      version: version2
    });
    else if (comparator.operator === "<") upper = strongerUpper(upper, {
      inclusive: false,
      version: version2
    });
    else if (comparator.operator === "<=") upper = strongerUpper(upper, {
      inclusive: true,
      version: version2
    });
  }
  if (lower !== null && upper !== null) {
    const compared = compareBounds(lower.version, upper.version);
    if (compared > 0 || compared === 0 && (!lower.inclusive || !upper.inclusive)) return null;
  }
  return {
    lower,
    upper
  };
}
__name(comparatorSetToInterval, "comparatorSetToInterval");
function rangeToIntervals(range) {
  try {
    return parseRange(range).sets.flatMap((comparators) => {
      const interval = comparatorSetToInterval(comparators);
      return interval === null ? [] : [interval];
    });
  } catch {
    throw new ReleaseCatalogCompilationError("INVALID_TARGET_RANGE", `Invalid target app-version range: ${range}`);
  }
}
__name(rangeToIntervals, "rangeToIntervals");
function releaseDescriptor(release) {
  return {
    releaseId: release.id,
    kind: release.kind,
    bundleId: release.bundleId,
    rolloutCohortCount: release.rolloutCohortCount,
    targetCohorts: [...new Set(release.targetCohorts)].sort(),
    shouldForceUpdate: release.shouldForceUpdate,
    message: release.message
  };
}
__name(releaseDescriptor, "releaseDescriptor");
function validateReleases(releases, strategy) {
  const enabled = releases.filter((release) => release.enabled).sort((left, right) => right.id.localeCompare(left.id));
  const seenIds = /* @__PURE__ */ new Set();
  for (const release of enabled) {
    if (!isUUIDv7(release.id)) throw new ReleaseCatalogCompilationError("INVALID_RELEASE", `Release ${release.id} must use a canonical lowercase UUIDv7 ID`);
    if (seenIds.has(release.id)) throw new ReleaseCatalogCompilationError("INVALID_RELEASE", `Duplicate Release ID: ${release.id}`);
    seenIds.add(release.id);
    if (release.strategy !== strategy) throw new ReleaseCatalogCompilationError("INVALID_RELEASE", `Release ${release.id} has the wrong strategy`);
    if (release.bundleId === null) throw new ReleaseCatalogCompilationError("INVALID_RELEASE", `Release ${release.id} has no Bundle`);
    if (release.targetCohorts.length > MAX_TARGET_COHORTS_PER_RELEASE) throw new ReleaseCatalogCompilationError("TARGET_COHORT_LIMIT", `Release ${release.id} exceeds ${MAX_TARGET_COHORTS_PER_RELEASE} target cohorts`);
    if (strategy === "APP_VERSION" && (release.targetAppVersion === null || release.fingerprintHash !== null)) throw new ReleaseCatalogCompilationError("INVALID_RELEASE", `Release ${release.id} has an invalid app-version target`);
    if (strategy === "FINGERPRINT" && (release.fingerprintHash === null || release.targetAppVersion !== null)) throw new ReleaseCatalogCompilationError("INVALID_RELEASE", `Release ${release.id} has an invalid fingerprint target`);
  }
  return enabled;
}
__name(validateReleases, "validateReleases");
function collectFrontierReleaseIds(releases) {
  if (releases.every((release) => normalizeRolloutCohortCount(release.rolloutCohortCount) >= NUMERIC_COHORT_SIZE)) {
    const retained3 = /* @__PURE__ */ new Set();
    const bundleIds = /* @__PURE__ */ new Set();
    for (const release of releases) {
      if (release.bundleId !== null && !bundleIds.has(release.bundleId)) {
        bundleIds.add(release.bundleId);
        retained3.add(release.id);
      }
      if (bundleIds.size >= 11) break;
    }
    return retained3;
  }
  const explicitTargetCohorts = new Set(releases.flatMap((release) => release.targetCohorts));
  const cohortStates = [
    void 0,
    ...Array.from({ length: 1e3 }, (_, index) => String(index + 1)),
    ...[...explicitTargetCohorts].sort(),
    "release-catalog-non-targeted-cohort"
  ].map((cohort) => {
    const normalized = cohort === void 0 ? void 0 : normalizeCohortValue(cohort);
    return {
      isCustom: normalized !== void 0 && isCustomCohort(normalized),
      normalized,
      numeric: normalized === void 0 ? null : getNumericCohortValue(normalized),
      bundleIds: /* @__PURE__ */ new Set(),
      complete: false
    };
  });
  const stateIndexesByCohort = /* @__PURE__ */ new Map();
  const fullRolloutStateIndexes = [];
  for (const [index, state] of cohortStates.entries()) {
    if (state.normalized !== void 0) {
      const indexes = stateIndexesByCohort.get(state.normalized) ?? [];
      indexes.push(index);
      stateIndexesByCohort.set(state.normalized, indexes);
    }
    if (state.normalized === void 0 || state.numeric !== null || state.isCustom) fullRolloutStateIndexes.push(index);
  }
  const retained2 = /* @__PURE__ */ new Set();
  let incompleteStateCount = cohortStates.length;
  for (const release of releases) {
    const rolloutCohortCount = normalizeRolloutCohortCount(release.rolloutCohortCount);
    const eligibleStateIndexes = /* @__PURE__ */ new Set();
    if (rolloutCohortCount >= NUMERIC_COHORT_SIZE) for (const index of fullRolloutStateIndexes) eligibleStateIndexes.add(index);
    else if (rolloutCohortCount > 0) for (const numericCohort of getRolledOutNumericCohorts(release.id, rolloutCohortCount)) for (const index of stateIndexesByCohort.get(String(numericCohort)) ?? []) eligibleStateIndexes.add(index);
    for (const targetCohort of new Set(release.targetCohorts.map(normalizeCohortValue))) for (const index of stateIndexesByCohort.get(targetCohort) ?? []) eligibleStateIndexes.add(index);
    for (const index of eligibleStateIndexes) {
      const state = cohortStates[index];
      if (state.complete) continue;
      if (release.bundleId !== null && !state.bundleIds.has(release.bundleId)) {
        state.bundleIds.add(release.bundleId);
        retained2.add(release.id);
      }
      if (state.bundleIds.size >= 11) {
        state.complete = true;
        incompleteStateCount -= 1;
      }
    }
    if (incompleteStateCount === 0) break;
  }
  return retained2;
}
__name(collectFrontierReleaseIds, "collectFrontierReleaseIds");
function intervalContainsSegment(interval, segment) {
  if (interval.lower !== null) {
    if (segment.lower === null) return false;
    const compared = compareBounds(segment.lower.version, interval.lower.version);
    if (compared < 0 || compared === 0 && segment.lower.inclusive && !interval.lower.inclusive) return false;
  }
  if (interval.upper !== null) {
    if (segment.upper === null) return false;
    const compared = compareBounds(segment.upper.version, interval.upper.version);
    if (compared > 0 || compared === 0 && segment.upper.inclusive && !interval.upper.inclusive) return false;
  }
  return true;
}
__name(intervalContainsSegment, "intervalContainsSegment");
function atomicVersionSegments(intervals) {
  const endpoints = [...new Set(intervals.flatMap((interval) => [interval.lower?.version, interval.upper?.version].filter((version2) => version2 !== void 0)))].sort(compareBounds);
  if (endpoints.length === 0) return [{
    lower: null,
    upper: null
  }];
  const segments = [{
    lower: null,
    upper: {
      inclusive: false,
      version: endpoints[0]
    }
  }];
  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    segments.push({
      lower: {
        inclusive: true,
        version: endpoint
      },
      upper: {
        inclusive: true,
        version: endpoint
      }
    });
    const next = endpoints[index + 1];
    if (next !== void 0) segments.push({
      lower: {
        inclusive: false,
        version: endpoint
      },
      upper: {
        inclusive: false,
        version: next
      }
    });
  }
  segments.push({
    lower: {
      inclusive: false,
      version: endpoints.at(-1)
    },
    upper: null
  });
  return segments;
}
__name(atomicVersionSegments, "atomicVersionSegments");
function sameIndexes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
__name(sameIndexes, "sameIndexes");
function mergeSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && sameIndexes(previous.releaseIndexes, segment.releaseIndexes) && sameIndexes(previous.rollbackReleaseIndexes, segment.rollbackReleaseIndexes)) merged[merged.length - 1] = {
      ...previous,
      upper: segment.upper
    };
    else merged.push(segment);
  }
  return merged;
}
__name(mergeSegments, "mergeSegments");
function compileAppVersion(releases) {
  const ranges = /* @__PURE__ */ new Map();
  for (const release of releases) ranges.set(release.id, rangeToIntervals(release.targetAppVersion));
  const segmentReleases = atomicVersionSegments([...ranges.values()].flat()).map((segment) => {
    const applicable = releases.filter((release) => ranges.get(release.id).some((range) => intervalContainsSegment(range, segment)));
    return {
      rollbackIds: new Set(applicable.map(({ id }) => id)),
      segment,
      retainedIds: collectFrontierReleaseIds(applicable)
    };
  });
  const retainedIds = new Set(segmentReleases.flatMap(({ retainedIds: retainedIds2, rollbackIds }) => [...retainedIds2, ...rollbackIds]));
  const retainedReleases = releases.filter((release) => retainedIds.has(release.id));
  const descriptorIndex = new Map(retainedReleases.map((release, index) => [release.id, index]));
  const segments = mergeSegments(segmentReleases.map(({ segment, retainedIds: retainedIds2, rollbackIds }) => ({
    ...segment,
    releaseIndexes: releases.filter((release) => retainedIds2.has(release.id)).map((release) => descriptorIndex.get(release.id)).filter((index) => index !== void 0),
    rollbackReleaseIndexes: releases.filter((release) => rollbackIds.has(release.id)).map((release) => descriptorIndex.get(release.id)).filter((index) => index !== void 0)
  }))).filter((segment) => segment.releaseIndexes.length > 0 || segment.rollbackReleaseIndexes.length > 0);
  return {
    envelope: {
      fallbackPolicy: RELEASE_CATALOG_FALLBACK_POLICY,
      schemaVersion: RELEASE_CATALOG_SCHEMA_VERSION,
      segments,
      strategy: "APP_VERSION"
    },
    retainedReleases
  };
}
__name(compileAppVersion, "compileAppVersion");
function compileFingerprint(releases) {
  const retainedIds = collectFrontierReleaseIds(releases);
  const retainedReleases = releases;
  return {
    envelope: {
      fallbackPolicy: RELEASE_CATALOG_FALLBACK_POLICY,
      releaseIndexes: retainedReleases.map((release, index) => retainedIds.has(release.id) ? index : -1).filter((index) => index >= 0),
      rollbackReleaseIndexes: retainedReleases.map((_, index) => index),
      schemaVersion: RELEASE_CATALOG_SCHEMA_VERSION,
      strategy: "FINGERPRINT"
    },
    retainedReleases
  };
}
__name(compileFingerprint, "compileFingerprint");
async function sha256(value) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
__name(sha256, "sha256");
function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(",")}}`;
}
__name(canonicalStringify, "canonicalStringify");
async function compileReleaseCatalog(input) {
  const releases = validateReleases(input.releases, input.strategy);
  const targetCohorts = new Set(releases.flatMap((release) => release.targetCohorts));
  if (targetCohorts.size > MAX_DISTINCT_TARGET_COHORTS_PER_SCOPE) throw new ReleaseCatalogCompilationError("DISTINCT_TARGET_COHORT_LIMIT", `Scope exceeds ${MAX_DISTINCT_TARGET_COHORTS_PER_SCOPE} distinct target cohorts`);
  const { envelope, retainedReleases } = input.strategy === "APP_VERSION" ? compileAppVersion(releases) : compileFingerprint(releases);
  const payload = {
    ...envelope,
    releaseDescriptors: retainedReleases.map(releaseDescriptor)
  };
  const canonicalPayload = canonicalStringify(payload);
  const byteSize = new TextEncoder().encode(canonicalPayload).byteLength;
  if (byteSize > MAX_COMPILED_CATALOG_BYTES) throw new ReleaseCatalogCompilationError("CATALOG_OVERSIZE", `Compiled Release catalog is ${byteSize} bytes; maximum is ${MAX_COMPILED_CATALOG_BYTES}`);
  return {
    byteSize,
    canonicalPayload,
    catalogHash: await sha256(canonicalPayload),
    diagnostics: {
      byteSize,
      descriptorCount: payload.releaseDescriptors.length,
      distinctTargetCohortCount: targetCohorts.size,
      releaseCount: releases.length,
      segmentCount: payload.strategy === "APP_VERSION" ? payload.segments.length : 1
    },
    payload
  };
}
__name(compileReleaseCatalog, "compileReleaseCatalog");
function versionInSegment(version2, segment) {
  if (segment.lower !== null) {
    const compared = compareBounds(version2, segment.lower.version);
    if (compared < 0 || compared === 0 && !segment.lower.inclusive) return false;
  }
  if (segment.upper !== null) {
    const compared = compareBounds(version2, segment.upper.version);
    if (compared > 0 || compared === 0 && !segment.upper.inclusive) return false;
  }
  return true;
}
__name(versionInSegment, "versionInSegment");
function projectCompiledCatalog(catalog, appVersion) {
  let indexes;
  if (catalog.strategy === "FINGERPRINT") indexes = catalog.releaseIndexes;
  else {
    const canonicalVersion = appVersion && canonicalizeAppVersion(appVersion);
    if (!canonicalVersion) return [];
    indexes = catalog.segments.find((segment) => versionInSegment(canonicalVersion, segment))?.releaseIndexes ?? [];
  }
  return indexes.map((index) => catalog.releaseDescriptors[index]);
}
__name(projectCompiledCatalog, "projectCompiledCatalog");
function projectCompiledRollbackCatalog(catalog, appVersion) {
  let indexes;
  if (catalog.strategy === "FINGERPRINT") indexes = catalog.rollbackReleaseIndexes;
  else {
    const canonicalVersion = appVersion && canonicalizeAppVersion(appVersion);
    if (!canonicalVersion) return [];
    indexes = catalog.segments.find((segment) => versionInSegment(canonicalVersion, segment))?.rollbackReleaseIndexes ?? [];
  }
  return indexes.map((index) => catalog.releaseDescriptors[index]);
}
__name(projectCompiledRollbackCatalog, "projectCompiledRollbackCatalog");

// ../plugin-core/dist/releaseManagement.mjs
var ReleaseManagementError = class extends Error {
  static {
    __name(this, "ReleaseManagementError");
  }
  code;
  name = "ReleaseManagementError";
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};

// ../plugin-core/dist/releaseCatalogMutation.mjs
var ReleaseCatalogMutationError = class extends Error {
  static {
    __name(this, "ReleaseCatalogMutationError");
  }
  code;
  name = "ReleaseCatalogMutationError";
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};

// ../plugin-core/dist/semverSatisfies.mjs
var semverSatisfies = /* @__PURE__ */ __name((targetAppVersion, currentVersion) => {
  const currentCoerce = coerce2(currentVersion);
  if (!currentCoerce) return false;
  return satisfies(currentCoerce, targetAppVersion);
}, "semverSatisfies");

// ../plugin-core/dist/serverPlugin/definePlugin.mjs
var definePlugin = /* @__PURE__ */ __name((plugin) => plugin, "definePlugin");

// ../plugin-core/dist/serverPlugin/schema.mjs
var defineTable = /* @__PURE__ */ __name((fields, options) => ({
  kind: "table",
  fields,
  key: options.key,
  derived: options.derived ?? {},
  indexes: options.indexes ?? {},
  ...options.retention === void 0 ? {} : { retention: options.retention }
}), "defineTable");
var defineAggregate = /* @__PURE__ */ __name((fields, options) => ({
  kind: "aggregate",
  fields,
  key: options.key,
  counters: options.counters ?? [],
  gauges: options.gauges ?? [],
  distinct: options.distinct ?? [],
  shards: options.shards ?? 1,
  indexes: options.indexes ?? {},
  ...options.batched ? { batched: true } : {},
  ...options.retention === void 0 ? {} : { retention: options.retention }
}), "defineAggregate");

// ../plugin-core/dist/serverPlugin/errors.mjs
var DatabaseConstraintError = class extends Error {
  static {
    __name(this, "DatabaseConstraintError");
  }
  reason;
  model;
  name = "DatabaseConstraintError";
  constructor(reason, model) {
    super(`${model}: ${reason}`);
    this.reason = reason;
    this.model = model;
  }
};
var DatabaseConflictError = class extends Error {
  static {
    __name(this, "DatabaseConflictError");
  }
  name = "DatabaseConflictError";
};
var DatabaseAmbiguousCommitError = class extends Error {
  static {
    __name(this, "DatabaseAmbiguousCommitError");
  }
  name = "DatabaseAmbiguousCommitError";
};
var DatabaseTransactionError = class extends Error {
  static {
    __name(this, "DatabaseTransactionError");
  }
  name = "DatabaseTransactionError";
};
var DatabaseQueryError = class extends Error {
  static {
    __name(this, "DatabaseQueryError");
  }
  name = "DatabaseQueryError";
};
var DatabaseCursorError = class extends Error {
  static {
    __name(this, "DatabaseCursorError");
  }
  name = "DatabaseCursorError";
};

// ../plugin-core/dist/serverPlugin/busy.mjs
var THROTTLING_NAMES = /* @__PURE__ */ new Set([
  "ProvisionedThroughputExceededException",
  "RequestLimitExceeded",
  "RequestThrottled",
  "RequestThrottledException",
  "SlowDown",
  "ThrottledException",
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException"
]);
var RESOURCE_EXHAUSTED = 8;
var isDatabaseBusyError = /* @__PURE__ */ __name((error) => {
  if (error instanceof DatabaseConflictError) return true;
  if (typeof error !== "object" || error === null) return false;
  const { name, code, message, status, statusCode, $metadata } = error;
  return typeof name === "string" && THROTTLING_NAMES.has(name) || [
    status,
    statusCode,
    $metadata?.httpStatusCode
  ].includes(429) || code === RESOURCE_EXHAUSTED && typeof message === "string" && message.includes("RESOURCE_EXHAUSTED");
}, "isDatabaseBusyError");

// ../plugin-core/dist/database/distinct.mjs
var PRECISION = 10;
var REGISTER_COUNT = 1024;
var MAX_RANK = 55;
var hash = /* @__PURE__ */ __name((value) => {
  let result = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(value)) {
    result ^= BigInt(byte);
    result = BigInt.asUintN(64, result * 1099511628211n);
  }
  return result;
}, "hash");
var OFFSET = 33;
var decode = /* @__PURE__ */ __name((summary) => {
  if (!summary) return new Uint8Array(REGISTER_COUNT);
  if (summary.length !== REGISTER_COUNT) throw new Error("Invalid distinct sketch");
  const registers = new Uint8Array(REGISTER_COUNT);
  for (let index = 0; index < REGISTER_COUNT; index += 1) {
    const value = summary.charCodeAt(index) - OFFSET;
    if (!Number.isInteger(value) || value < 0 || value > MAX_RANK) throw new Error("Invalid distinct sketch");
    registers[index] = value;
  }
  return registers;
}, "decode");
var encode = /* @__PURE__ */ __name((registers) => Array.from(registers, (value) => String.fromCharCode(value + OFFSET)).join(""), "encode");
var distinctRegister = /* @__PURE__ */ __name((identity) => {
  const value = hash(identity);
  const index = Number(value & BigInt(1023));
  let remainder = value >> BigInt(PRECISION);
  let rank = 1;
  while ((remainder & 1n) === 0n && rank < MAX_RANK) {
    rank += 1;
    remainder >>= 1n;
  }
  return {
    index,
    rank,
    character: String.fromCharCode(rank + OFFSET)
  };
}, "distinctRegister");
var addDistinct = /* @__PURE__ */ __name((summary, identity) => {
  const registers = decode(summary);
  const { index, rank } = distinctRegister(identity);
  registers[index] = Math.max(registers[index], rank);
  return encode(registers);
}, "addDistinct");
var mergeDistinct = /* @__PURE__ */ __name((summaries) => {
  const merged = new Uint8Array(REGISTER_COUNT);
  for (const summary of summaries) {
    const registers = decode(summary);
    for (let index = 0; index < REGISTER_COUNT; index += 1) merged[index] = Math.max(merged[index], registers[index]);
  }
  return encode(merged);
}, "mergeDistinct");
var countDistinct = /* @__PURE__ */ __name((summary) => {
  const registers = decode(summary);
  let inverseSum = 0;
  let empty = 0;
  for (const register of registers) {
    inverseSum += 2 ** -register;
    if (register === 0) empty += 1;
  }
  const raw2 = 0.7213 / 1.0010537109375 * REGISTER_COUNT ** 2 / inverseSum;
  const estimate = raw2 <= 2.5 * REGISTER_COUNT && empty > 0 ? REGISTER_COUNT * Math.log(REGISTER_COUNT / empty) : raw2;
  return Math.max(0, Math.round(estimate));
}, "countDistinct");

// ../plugin-core/dist/serverPlugin/configError.mjs
var HotUpdaterConfigError = class extends Error {
  static {
    __name(this, "HotUpdaterConfigError");
  }
  name = "HotUpdaterConfigError";
};

// ../plugin-core/dist/baseCandidateKey.mjs
var parseBaseCandidateKey = /* @__PURE__ */ __name((key) => {
  try {
    const parsed = JSON.parse(key);
    if (!Array.isArray(parsed) || typeof parsed[0] !== "string") return null;
    const [scopeKey, text] = parsed;
    const { strategy } = parseReleaseCatalogScopeKey(scopeKey);
    if (strategy === "FINGERPRINT") return parsed.length === 1 ? {
      scopeKey,
      range: null
    } : null;
    const range = parsed.length === 2 && typeof text === "string" ? normalizeRange(text) : null;
    return range === null ? null : {
      scopeKey,
      range
    };
  } catch {
    return null;
  }
}, "parseBaseCandidateKey");

// ../plugin-core/dist/database/adapter.mjs
var DatabaseSchemaError = class extends Error {
  static {
    __name(this, "DatabaseSchemaError");
  }
  name = "DatabaseSchemaError";
};
var findPhysicalColumn = /* @__PURE__ */ __name((table, name) => {
  const column = table.columns.find((candidate) => candidate.name === name);
  if (column === void 0) throw new DatabaseSchemaError(`${table.name} has no column ${name}.`);
  return column;
}, "findPhysicalColumn");
var findPhysicalIndex = /* @__PURE__ */ __name((table, name) => {
  const index = table.indexes.find((candidate) => candidate.name === name);
  if (index === void 0) throw new DatabaseSchemaError(`${table.name} has no index ${name}.`);
  return index;
}, "findPhysicalIndex");
var indexOrderColumns = /* @__PURE__ */ __name((table, index) => [...index.sort, ...table.key.filter((column) => !index.sort.includes(column) && !index.eq.includes(column))], "indexOrderColumns");
var rowKey = /* @__PURE__ */ __name((table, row) => table.key.map((column) => {
  const value = row[column];
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new DatabaseSchemaError(`${table.name}.${column} is a key column and must be a string, number, or boolean.`);
  return value;
}), "rowKey");

// ../plugin-core/dist/database/values.mjs
var DatabaseValueError = class extends Error {
  static {
    __name(this, "DatabaseValueError");
  }
  name = "DatabaseValueError";
};
var compareUtf8 = /* @__PURE__ */ __name((left, right) => {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex);
    const rightPoint = right.codePointAt(rightIndex);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 65535 ? 2 : 1;
    rightIndex += rightPoint > 65535 ? 2 : 1;
  }
  const leftDone = leftIndex >= left.length;
  return leftDone === rightIndex >= right.length ? 0 : leftDone ? -1 : 1;
}, "compareUtf8");
var compareKeyValues = /* @__PURE__ */ __name((left, right) => {
  if (typeof left === "string" && typeof right === "string") return compareUtf8(left, right);
  if (typeof left === "number" && typeof right === "number") return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  throw new DatabaseValueError(`Cannot compare ${typeof left} with ${typeof right}.`);
}, "compareKeyValues");
var compareTuples = /* @__PURE__ */ __name((left, right) => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const result = compareKeyValues(left[index], right[index]);
    if (result !== 0) return result;
  }
  return left.length - right.length;
}, "compareTuples");
var canonicalJson = /* @__PURE__ */ __name((value) => JSON.stringify(value ?? null, (_, inner) => inner !== null && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([left], [right]) => compareUtf8(left, right))) : inner), "canonicalJson");
var isKeyValue = /* @__PURE__ */ __name((value) => typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value), "isKeyValue");
var indexEntries = /* @__PURE__ */ __name((table, index, row) => {
  if (index.sort.some((column) => !isKeyValue(row[column]))) return [];
  let entries = [[]];
  for (const column of index.eq) {
    const value = row[column];
    const values = findPhysicalColumn(table, column).multi ? Array.isArray(value) ? value.filter(isKeyValue) : [] : isKeyValue(value) ? [value] : [];
    if (values.length === 0) return [];
    entries = entries.flatMap((entry) => [...new Set(values)].map((item) => [...entry, item]));
  }
  return entries;
}, "indexEntries");
var indexOrderTuple = /* @__PURE__ */ __name((table, index, row) => indexOrderColumns(table, index).map((column) => {
  const value = row[column];
  if (!isKeyValue(value)) throw new DatabaseValueError(`${table.name}.${column} is not orderable for index ${index.name}.`);
  return value;
}), "indexOrderTuple");
var satisfiesBound = /* @__PURE__ */ __name((tuple, bound2, side) => {
  if (bound2 === void 0) return true;
  const result = compareTuples(tuple.slice(0, bound2.values.length), bound2.values);
  if (result === 0) return bound2.inclusive;
  return side === "lower" ? result > 0 : result < 0;
}, "satisfiesBound");
var matchesQuery = /* @__PURE__ */ __name((table, index, request, row) => indexEntries(table, index, row).some((entry) => compareTuples(entry, request.eq) === 0) && satisfiesBound(indexOrderTuple(table, index, row), request.lower, "lower") && satisfiesBound(indexOrderTuple(table, index, row), request.upper, "upper"), "matchesQuery");
var INTEGER_TEXT = /^-?\d+$/u;
var NUMBER_TEXT = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/iu;
var toNumber = /* @__PURE__ */ __name((raw2, integer2) => {
  const text = typeof raw2 === "bigint" ? raw2.toString() : typeof raw2 === "string" ? raw2 : typeof raw2 === "object" && raw2 !== null && "toString" in raw2 ? String(raw2) : void 0;
  const value = typeof raw2 === "number" ? raw2 : text !== void 0 && (integer2 ? INTEGER_TEXT : NUMBER_TEXT).test(text) ? Number(text) : NaN;
  if (integer2 ? !Number.isSafeInteger(value) : !Number.isFinite(value)) throw new DatabaseValueError(`Expected a ${integer2 ? "safe integer" : "finite number"}.`);
  return value;
}, "toNumber");
var toBoolean = /* @__PURE__ */ __name((raw2) => {
  if (raw2 === true || raw2 === 1 || raw2 === 1n || raw2 === "1" || raw2 === "t") return true;
  if (raw2 === false || raw2 === 0 || raw2 === 0n || raw2 === "0" || raw2 === "f") return false;
  if (raw2 === "true" || raw2 === "false") return raw2 === "true";
  throw new DatabaseValueError("Expected a boolean.");
}, "toBoolean");
var toScalar = /* @__PURE__ */ __name((column, raw2) => {
  switch (column.type) {
    case "string":
      if (typeof raw2 !== "string") throw new DatabaseValueError(`Expected a string in ${column.name}.`);
      return raw2;
    case "integer":
    case "number":
      return toNumber(raw2, column.type === "integer");
    case "boolean":
      return toBoolean(raw2);
    case "json":
      return raw2;
  }
}, "toScalar");
var normalizeStoredValue = /* @__PURE__ */ __name((column, raw2, options) => {
  if (raw2 === null || raw2 === void 0) return null;
  const parsed = options.jsonText && (column.multi || column.type === "json") && typeof raw2 === "string" ? JSON.parse(raw2) : raw2;
  if (!column.multi) return toScalar(column, parsed);
  if (!Array.isArray(parsed) || parsed.length > 16) throw new DatabaseValueError(`Expected at most 16 values in ${column.name}.`);
  return parsed.map((item) => toScalar(column, item));
}, "normalizeStoredValue");
var normalizeStoredRow = /* @__PURE__ */ __name((table, raw2, options) => Object.fromEntries(table.columns.map((column) => [column.name, normalizeStoredValue(column, raw2[column.name], options)])), "normalizeStoredRow");

// ../plugin-core/dist/database/verifyAdapter.mjs
var DatabaseAdapterContractError = class extends Error {
  static {
    __name(this, "DatabaseAdapterContractError");
  }
  name = "DatabaseAdapterContractError";
};
var EMPTY = {
  gets: 0,
  keys: 0,
  queries: 0,
  rows: 0
};
var createReadMeter = /* @__PURE__ */ __name(() => {
  const tables = /* @__PURE__ */ new Map();
  const add = /* @__PURE__ */ __name((table, count) => {
    const current = tables.get(table) ?? EMPTY;
    tables.set(table, {
      gets: current.gets + (count.gets ?? 0),
      keys: current.keys + (count.keys ?? 0),
      queries: current.queries + (count.queries ?? 0),
      rows: current.rows + (count.rows ?? 0)
    });
  }, "add");
  return {
    add,
    meter: {
      total: /* @__PURE__ */ __name(() => [...tables.values()].reduce((sum, count) => ({
        gets: sum.gets + count.gets,
        keys: sum.keys + count.keys,
        queries: sum.queries + count.queries,
        rows: sum.rows + count.rows
      }), EMPTY), "total"),
      byTable: /* @__PURE__ */ __name((table) => tables.get(table) ?? EMPTY, "byTable"),
      reset: /* @__PURE__ */ __name(() => tables.clear(), "reset")
    }
  };
}, "createReadMeter");
var fail = /* @__PURE__ */ __name((message) => {
  throw new DatabaseAdapterContractError(message);
}, "fail");
var sameKey = /* @__PURE__ */ __name((left, right) => left.length === right.length && compareTuples(left, right) === 0, "sameKey");
var verifyRequest = /* @__PURE__ */ __name((table, request) => {
  const index = findPhysicalIndex(table, request.index);
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 500) fail(`query limit must be 1\u2013500.`);
  if (request.eq.length !== index.eq.length || !request.eq.every(isKeyValue)) fail(`query on ${table.name}.${index.name} must bind every eq column.`);
  return index;
}, "verifyRequest");
var verifyRows = /* @__PURE__ */ __name((table, request, rows) => {
  const index = findPhysicalIndex(table, request.index);
  if (rows.length > request.limit) fail(`${table.name}.${index.name} returned more than ${request.limit} rows.`);
  let previous;
  for (const row of rows) {
    if (!matchesQuery(table, index, request, row)) fail(`${table.name}.${index.name} returned a row outside the request.`);
    const tuple = indexOrderTuple(table, index, row);
    if (previous !== void 0) {
      const order = compareTuples(previous, tuple);
      if (request.order === "asc" ? order >= 0 : order <= 0) fail(`${table.name}.${index.name} returned rows out of order.`);
    }
    previous = tuple;
  }
  return previous;
}, "verifyRows");
var verifyWrite = /* @__PURE__ */ __name((adapter, ops) => {
  if (ops.length === 0) fail("write needs at least one op.");
  const seen = /* @__PURE__ */ new Set();
  for (const op of ops) {
    const key = op.type === "insert" ? rowKey(op.table, op.row) : op.key;
    const id = JSON.stringify([op.table.name, key]);
    if (seen.has(id)) fail(`write touches ${op.table.name} ${id} twice.`);
    seen.add(id);
    if (op.type === "insert" && typeof op.row["_v"] !== "number") fail(`insert into ${op.table.name} must set _v.`);
    if (op.type === "patch" && Object.keys(op.set).some((column) => column === "_v" || op.table.key.includes(column))) fail(`patch of ${op.table.name} may not set key columns or _v.`);
  }
  if (!adapter.fits(ops)) fail("write does not fit in one atomic write.");
}, "verifyWrite");
var verifyAdapter = /* @__PURE__ */ __name((adapter, options = {}) => {
  const { add, meter } = createReadMeter();
  return {
    ...adapter,
    id: adapter.id,
    reads: meter,
    fits: /* @__PURE__ */ __name((ops) => adapter.fits(ops), "fits"),
    async get(table, keys) {
      const rows = await adapter.get(table, keys);
      add(table.name, {
        gets: 1,
        keys: keys.length
      });
      if (rows.length !== keys.length) fail(`${table.name} get returned ${rows.length} rows for ${keys.length} keys.`);
      rows.forEach((row, position) => {
        if (row !== null && !sameKey(rowKey(table, row), keys[position])) fail(`${table.name} get returned a row for another key.`);
      });
      return rows;
    },
    async query(table, request) {
      const index = verifyRequest(table, request);
      const rows = await adapter.query(table, request);
      add(table.name, {
        queries: 1,
        rows: rows.length
      });
      const last = verifyRows(table, request, rows);
      if (options.probeShortPages && last !== void 0 && rows.length < request.limit) {
        const bound2 = {
          values: last,
          inclusive: false
        };
        if ((await adapter.query(table, {
          ...request,
          limit: 1,
          ...request.order === "asc" ? { lower: bound2 } : { upper: bound2 }
        })).length > 0) fail(`${table.name}.${index.name} returned a short page before the range ended.`);
      }
      return rows;
    },
    ...adapter.prune && { async prune(table, before, limit) {
      if (table.retention === void 0) fail(`${table.name} has no retention to prune by.`);
      if (!Number.isSafeInteger(limit) || limit < 1) fail("prune limit must be a positive integer.");
      const deleted = await adapter.prune(table, before, limit);
      if (!Number.isSafeInteger(deleted) || deleted < 0 || deleted > limit) fail(`${table.name} prune reported ${deleted} rows for ${limit}.`);
      return deleted;
    } },
    async write(ops) {
      verifyWrite(adapter, ops);
      const result = await adapter.write(ops);
      if (!result.ok && "failedOp" in result) {
        if (!Number.isSafeInteger(result.failedOp) || result.failedOp < 0 || result.failedOp >= ops.length) fail(`write reported failedOp ${result.failedOp} for ${ops.length} ops.`);
      }
      return result;
    }
  };
}, "verifyAdapter");

// ../plugin-core/dist/engine/database/fence.mjs
var SETTINGS_TABLE = {
  name: "private_hot_updater_settings",
  columns: [
    {
      name: "key",
      type: "string",
      nullable: false,
      maxLength: 255
    },
    {
      name: "value",
      type: "string",
      nullable: false,
      maxLength: 255
    },
    {
      name: "_v",
      type: "integer",
      nullable: false,
      default: 0
    }
  ],
  key: ["key"],
  indexes: []
};
var ENGINE_SCHEMA_KEY = "schema.engine";
var CORE_SCHEMA_KEY = "schema.core";
var stored = /* @__PURE__ */ __name(({ key, expected, found }) => `"${key}" is ${found === null ? "missing" : `"${found}"`}; expected "${expected}"`, "stored");
var settingMessage = /* @__PURE__ */ __name((adapterName, { key, expected, found }) => `Hot Updater schema setting "${key}" for ${adapterName} is ${found === null ? "missing" : `"${found}"`}; expected "${expected}". Run \`hot-updater db migrate\`.`, "settingMessage");
var pluginOf = /* @__PURE__ */ __name(({ key }) => key.startsWith("schema.") && key !== "schema.engine" && key !== CORE_SCHEMA_KEY ? key.slice(7) : void 0, "pluginOf");
var listed = /* @__PURE__ */ __name((items) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`, "listed");
var PLUGIN_TABLES_FIX = "Run `hot-updater db migrate`. A managed server runs only its provider's plugins, and rerunning `hot-updater init --provider <provider>` applies the provider's migrations. Run `hot-updater db` commands in the server's project: they load the server file named on the command line, or src/hotUpdater.* or src/db.*, and don't read hot-updater.config.ts.";
var pluginsMessage = /* @__PURE__ */ __name((adapterName, plugins, settings, fix) => `The tables of ${plugins.length === 1 ? "plugin" : "plugins"} ${listed(plugins.map((id) => `"${id}"`))} are not migrated on ${adapterName}: schema ${settings.length === 1 ? "setting" : "settings"} ${settings.map(stored).join(", and ")}. ${fix}`, "pluginsMessage");
var HotUpdaterSchemaMigrationRequiredError = class extends Error {
  static {
    __name(this, "HotUpdaterSchemaMigrationRequiredError");
  }
  adapterName;
  currentVersion;
  setting;
  /** Every setting the fence found missing or different; `setting` is the first. */
  settings;
  /**
  * The ids of the plugins whose `schema.<id>` setting is among them: the
  * plugins whose tables a migration has yet to create or change.
  */
  plugins;
  constructor(adapterName, currentVersion, setting, options) {
    const settings = options?.settings ?? (setting === void 0 ? [] : [setting]);
    const plugins = settings.flatMap((mismatch) => pluginOf(mismatch) ?? []);
    super(setting === void 0 ? currentVersion === void 0 ? `Hot Updater database schema is not initialized for ${adapterName}. Run \`hot-updater db migrate\` before using this adapter.` : `Hot Updater v1 cannot migrate schema ${currentVersion} in place. Create a new empty database and run \`hot-updater db migrate\`.` : plugins.length > 0 && plugins.length === settings.length ? pluginsMessage(adapterName, plugins, settings, options?.fix ?? PLUGIN_TABLES_FIX) : settingMessage(adapterName, setting), options?.cause === void 0 ? void 0 : { cause: options.cause });
    this.adapterName = adapterName;
    this.currentVersion = currentVersion;
    this.setting = setting;
    this.name = "HotUpdaterSchemaMigrationRequiredError";
    this.settings = settings;
    this.plugins = plugins;
  }
};
var MISSING_SCHEMA_CODES = /* @__PURE__ */ new Set([
  "42P01",
  "42703",
  "ER_NO_SUCH_TABLE",
  "ER_BAD_FIELD_ERROR"
]);
var MISSING_SCHEMA_MESSAGE = /no such (?:table|column)|(?:relation|column) .+ does not exist|table .+ doesn't exist|unknown column/iu;
var isMissingSchemaError = /* @__PURE__ */ __name((error) => {
  for (let depth = 0; error instanceof Object && depth < 8; depth += 1) {
    const { code, message, cause } = error;
    if (MISSING_SCHEMA_CODES.has(String(code)) || typeof message === "string" && MISSING_SCHEMA_MESSAGE.test(message)) return true;
    error = cause;
  }
  return false;
}, "isMissingSchemaError");
var readSettings = /* @__PURE__ */ __name((adapter, keys) => adapter.get(SETTINGS_TABLE, keys.map((key) => [key])), "readSettings");
var checkSchemaFence = /* @__PURE__ */ __name(async (adapter, adapterName, expected, fix) => {
  const keys = Object.keys(expected);
  let rows;
  try {
    rows = await readSettings(adapter, keys);
  } catch (cause) {
    if (!isMissingSchemaError(cause)) throw cause;
    throw new HotUpdaterSchemaMigrationRequiredError(adapterName, void 0, {
      key: ENGINE_SCHEMA_KEY,
      expected: "1",
      found: null
    }, { cause });
  }
  const settings = keys.flatMap((key, position) => {
    const found = rows[position]?.value;
    return found === expected[key] ? [] : [{
      key,
      expected: expected[key],
      found: typeof found === "string" ? found : null
    }];
  });
  const [first] = settings;
  if (first !== void 0) throw new HotUpdaterSchemaMigrationRequiredError(adapterName, void 0, first, {
    settings,
    ...fix === void 0 ? {} : { fix }
  });
}, "checkSchemaFence");
var FENCED = /* @__PURE__ */ Symbol.for("@hot-updater/server/schema-fence");
var fencedName = /* @__PURE__ */ __name((adapter) => adapter[FENCED], "fencedName");
var withSchemaFence = /* @__PURE__ */ __name((adapter, adapterName, expected, fix) => {
  let ready;
  const fence = /* @__PURE__ */ __name(() => {
    ready ??= checkSchemaFence(adapter, adapterName, expected, fix).catch((error) => {
      ready = void 0;
      throw error;
    });
    return ready;
  }, "fence");
  return {
    ...adapter,
    [FENCED]: adapterName,
    get: /* @__PURE__ */ __name((table, keys) => fence().then(() => adapter.get(table, keys)), "get"),
    query: /* @__PURE__ */ __name((table, request) => fence().then(() => adapter.query(table, request)), "query"),
    write: /* @__PURE__ */ __name((ops) => fence().then(() => adapter.write(ops)), "write"),
    ...adapter.prune && { prune: /* @__PURE__ */ __name((table, before, limit) => fence().then(() => adapter.prune(table, before, limit)), "prune") }
  };
}, "withSchemaFence");

// ../plugin-core/dist/engine/database/readMeter.mjs
var METER = /* @__PURE__ */ Symbol.for("@hot-updater/plugin-core/read-meter");
var readMeterOf = /* @__PURE__ */ __name((database) => typeof database === "object" && database !== null ? database[METER] : void 0, "readMeterOf");

// ../plugin-core/dist/engine/db/schemaSettings.mjs
var storedSettings = /* @__PURE__ */ __name(async (adapter, keys) => {
  const rows = await readSettings(adapter, keys);
  return new Map(keys.map((key, position) => [key, rows[position] ?? null]));
}, "storedSettings");
var writeSchemaSettings = /* @__PURE__ */ __name(async (adapter, adapterName, settings) => {
  const stored2 = await storedSettings(adapter, Object.keys(settings));
  const ops = Object.entries(settings).flatMap(([key, value]) => {
    const row = stored2.get(key);
    if (row === null || row === void 0) return [{
      type: "insert",
      table: SETTINGS_TABLE,
      row: {
        key,
        value,
        _v: 0
      }
    }];
    if (row.value === value) return [];
    return [{
      type: "patch",
      table: SETTINGS_TABLE,
      key: [key],
      set: { value },
      guard: { v: Number(row._v) },
      previous: row
    }];
  });
  if (ops.length === 0) return;
  if (!(await adapter.write(ops)).ok) throw new Error(`${adapterName}: the schema settings changed during the migration; run it again.`);
}, "writeSchemaSettings");
var migrateSchema = /* @__PURE__ */ __name(async (adapter, adapterName, tables, settings) => {
  if (adapter.migrations === void 0) throw new Error(`${adapterName} creates its tables with its own tooling; write only the settings rows.`);
  await adapter.migrations.apply([...tables, SETTINGS_TABLE]);
  await writeSchemaSettings(adapter, adapterName, settings);
}, "migrateSchema");

// ../plugin-core/dist/engine/database/sql/sqlSchema.mjs
var quoteSql = /* @__PURE__ */ __name((dialect, name) => dialect === "mysql" ? `\`${name.replaceAll("`", "``")}\`` : `"${name.replaceAll('"', '""')}"`, "quoteSql");
var isMultiIndex = /* @__PURE__ */ __name((table, index) => index.eq.some((column) => findPhysicalColumn(table, column).multi), "isMultiIndex");
var shortSqlName = /* @__PURE__ */ __name((name) => {
  if (name.length <= 60) return name;
  let hash2 = 2166136261;
  for (const char of name) hash2 = Math.imul(hash2 ^ char.charCodeAt(0), 16777619) >>> 0;
  return `${name.slice(0, 51)}_${hash2.toString(36)}`;
}, "shortSqlName");
var columnType = /* @__PURE__ */ __name((dialect, column, indexed, entry = false) => {
  if (column.multi && !entry || column.type === "json") return {
    postgresql: "jsonb",
    mysql: "json",
    sqlite: "TEXT"
  }[dialect];
  if (column.type === "string") {
    const length = column.maxLength ?? (indexed ? 255 : void 0);
    if (dialect === "sqlite") return "TEXT";
    if (dialect === "postgresql") return `${column.maxLength ? `varchar(${column.maxLength})` : "text"} COLLATE "C"`;
    const charset = column.ascii ? "ascii COLLATE ascii_bin" : "utf8mb4 COLLATE utf8mb4_0900_bin";
    return `${length ? `varchar(${length})` : "longtext"} CHARACTER SET ${charset}`;
  }
  if (column.type === "integer") return dialect === "sqlite" ? "INTEGER" : "bigint";
  if (column.type === "number") return {
    postgresql: "double precision",
    mysql: "double",
    sqlite: "REAL"
  }[dialect];
  return dialect === "sqlite" ? "INTEGER" : "boolean";
}, "columnType");
var MYSQL_KEY_BYTES = 3072;
var checkMysqlKey = /* @__PURE__ */ __name((table, name, columns) => {
  const bytes = columns.reduce((sum, column) => {
    const { type, maxLength, ascii } = findPhysicalColumn(table, column);
    if (type === "string") return sum + (maxLength ?? 255) * (ascii ? 1 : 4);
    return sum + (type === "boolean" ? 1 : 8);
  }, 0);
  if (bytes > MYSQL_KEY_BYTES) throw new DatabaseSchemaError(`${table.name} ${name} needs ${bytes} bytes on MySQL, over its ${MYSQL_KEY_BYTES}; shorten its strings or mark ASCII ones ascii.`);
}, "checkMysqlKey");
var sqlTableShapes = /* @__PURE__ */ __name((dialect, tables, tablePrefix = "") => tables.map((table) => {
  const name = tablePrefix + table.name;
  const indexed = /* @__PURE__ */ new Set([...table.key, ...table.indexes.flatMap(({ eq, sort: sort2 }) => [...eq, ...sort2])]);
  if (dialect === "mysql") checkMysqlKey(table, "key", table.key);
  const indexes = table.indexes.flatMap((index) => {
    const columns = [...index.eq, ...indexOrderColumns(table, index)];
    if (dialect === "mysql") checkMysqlKey(table, `index ${index.name}`, columns);
    if (isMultiIndex(table, index)) {
      const entries = columns.map((column) => ({
        name: column,
        type: columnType(dialect, findPhysicalColumn(table, column), true, true),
        notNull: true
      }));
      return [{
        kind: "table",
        table: {
          name: `${name}__${index.name}`,
          columns: entries,
          key: columns,
          indexes: []
        }
      }];
    }
    if (!index.unique && columns.join() === table.key.join()) return [];
    return [{
      kind: "index",
      name: shortSqlName(`${name}_${index.name}`),
      unique: index.unique === true,
      columns: index.unique ? index.eq : columns
    }];
  });
  const retention = table.retention && retentionOrder(table);
  if (retention && !retention.indexed) indexes.push({
    kind: "index",
    name: shortSqlName(`${name}__retention`),
    unique: false,
    columns: retention.columns
  });
  return {
    name,
    columns: table.columns.map((column) => ({
      name: column.name,
      type: columnType(dialect, column, indexed.has(column.name)),
      notNull: !column.nullable,
      ...column.default === void 0 ? {} : { default: column.default }
    })),
    key: table.key,
    indexes
  };
}), "sqlTableShapes");
var createTableStatements = /* @__PURE__ */ __name((dialect, tables, tablePrefix = "") => {
  const quote = /* @__PURE__ */ __name((name) => quoteSql(dialect, name), "quote");
  const list = /* @__PURE__ */ __name((columns) => columns.map(quote).join(", "), "list");
  const render = /* @__PURE__ */ __name((shape) => {
    const definitions = shape.columns.map((column) => `${quote(column.name)} ${column.type}${column.notNull ? " NOT NULL" : ""}${column.default === void 0 ? "" : ` DEFAULT ${column.default}`}`);
    definitions.push(`PRIMARY KEY (${list(shape.key)})`);
    const after = [];
    for (const index of shape.indexes) if (index.kind === "table") after.push(...render(index.table));
    else if (dialect === "mysql") definitions.push(`${index.unique ? "UNIQUE " : ""}INDEX ${quote(index.name)} (${list(index.columns)})`);
    else after.push(`CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quote(index.name)} ON ${quote(shape.name)} (${list(index.columns)})`);
    return [`CREATE TABLE IF NOT EXISTS ${quote(shape.name)} (${definitions.join(", ")})`, ...after];
  }, "render");
  return sqlTableShapes(dialect, tables, tablePrefix).flatMap(render);
}, "createTableStatements");
var retentionOrder = /* @__PURE__ */ __name((table) => {
  const { column } = table.retention;
  for (const index of table.indexes) {
    const columns = [...index.eq, ...indexOrderColumns(table, index)];
    if (!index.unique && !isMultiIndex(table, index) && columns[0] === column) return {
      columns,
      indexed: true
    };
  }
  if (table.key[0] === column) return {
    columns: table.key,
    indexed: true
  };
  return {
    columns: [column, ...table.key.filter((field) => field !== column)],
    indexed: false
  };
}, "retentionOrder");
var pruneStatements = /* @__PURE__ */ __name((dialect, table, tablePrefix, limit) => {
  const quote = /* @__PURE__ */ __name((name2) => quoteSql(dialect, name2), "quote");
  const name = quote(`${tablePrefix}${table.name}`);
  const at = quote(table.retention.column);
  const order = retentionOrder(table).columns.map(quote);
  const list = /* @__PURE__ */ __name((alias, direction = "") => order.map((column) => `${alias}.${column}${direction}`).join(", "), "list");
  const oldest = /* @__PURE__ */ __name((before) => `SELECT ${list("i")} FROM ${name} i WHERE i.${at} <= ${before()} ORDER BY ${list("i", " ASC")} LIMIT ${limit}`, "oldest");
  const doomed = /* @__PURE__ */ __name((alias, before) => `${alias}.${at} <= ${before()} AND (${list(alias)}) <= (SELECT ${list("b")} FROM (${oldest(before)}) b ORDER BY ${list("b", " DESC")} LIMIT 1)`, "doomed");
  const entries = table.indexes.filter((index) => isMultiIndex(table, index)).map((index) => quote(`${tablePrefix}${table.name}__${index.name}`));
  const keyOf = /* @__PURE__ */ __name((left, right) => table.key.map((column) => `${left}.${quote(column)} = ${right}.${quote(column)}`).join(" AND "), "keyOf");
  if (dialect === "mysql") return [...entries.map((index) => (before) => `DELETE e FROM ${index} e JOIN (${oldest(before)}) d ON ${keyOf("e", "d")}`), (before) => `DELETE FROM ${name} WHERE ${at} <= ${before()} ORDER BY ${order.join(", ")} LIMIT ${limit}`];
  return [...entries.map((index) => (before) => `DELETE FROM ${index} WHERE EXISTS (SELECT * FROM ${name} b WHERE ${keyOf("b", index)} AND ${doomed("b", before)})`), (before) => `DELETE FROM ${name} WHERE ${doomed(name, before)}`];
}, "pruneStatements");

// ../plugin-core/dist/engine/core/schema.mjs
var CHANNEL_ID = {
  type: "string",
  maxLength: 1408,
  ascii: true
};
var HOT_UPDATER_SCHEMA_VERSION = "1.0.0";
var coreSchema = {
  bundles: defineTable({
    id: {
      type: "string",
      maxLength: 36
    },
    platform: {
      type: "string",
      maxLength: 16
    },
    git_commit_hash: {
      type: "string",
      maxLength: 255,
      required: false
    },
    metadata: { type: "json" },
    manifest_storage_uri: { type: "string" },
    manifest_file_hash: { type: "string" },
    asset_base_storage_uri: { type: "string" }
  }, {
    key: ["id"],
    indexes: {
      byPlatform: {
        eq: ["platform"],
        sort: ["id"]
      },
      all: {
        eq: [],
        sort: ["id"]
      }
    }
  }),
  bundle_patches: defineTable({
    id: {
      type: "string",
      maxLength: 255
    },
    bundle_id: {
      type: "string",
      maxLength: 36,
      references: {
        model: "bundles",
        onDelete: "cascade"
      }
    },
    base_bundle_id: {
      type: "string",
      maxLength: 36,
      references: {
        model: "bundles",
        onDelete: "cascade"
      }
    },
    base_file_hash: { type: "string" },
    patch_file_hash: { type: "string" },
    patch_storage_uri: { type: "string" },
    byte_size: { type: "integer" },
    order_index: { type: "integer" }
  }, {
    key: ["id"],
    indexes: {
      pair: {
        eq: ["bundle_id", "base_bundle_id"],
        sort: [],
        unique: true
      },
      byBundle: {
        eq: ["bundle_id"],
        sort: ["order_index"],
        root: { model: "bundles" }
      },
      byBase: {
        eq: ["base_bundle_id"],
        sort: ["bundle_id"]
      }
    }
  }),
  releases: defineTable({
    id: {
      type: "string",
      maxLength: 36
    },
    revision: { type: "integer" },
    scope_key: {
      type: "string",
      maxLength: 2048,
      ascii: true
    },
    channel_id: {
      ...CHANNEL_ID,
      references: {
        model: "channels",
        onDelete: "restrict"
      }
    },
    platform: {
      type: "string",
      maxLength: 16
    },
    kind: {
      type: "string",
      maxLength: 16
    },
    bundle_id: {
      type: "string",
      maxLength: 36,
      required: false,
      references: {
        model: "bundles",
        onDelete: "restrict"
      }
    },
    strategy: {
      type: "string",
      maxLength: 16
    },
    target_app_version: {
      type: "string",
      required: false
    },
    fingerprint_hash: {
      type: "string",
      maxLength: 255,
      required: false
    },
    enabled: { type: "boolean" },
    should_force_update: { type: "boolean" },
    message: {
      type: "string",
      required: false
    },
    rollout_cohort_count: { type: "integer" },
    target_cohorts: { type: "json" },
    operation: {
      type: "string",
      maxLength: 16
    },
    source_release_id: {
      type: "string",
      maxLength: 36,
      required: false,
      references: {
        model: "releases",
        onDelete: "none"
      }
    },
    created_at_ms: { type: "integer" },
    updated_at_ms: { type: "integer" }
  }, {
    key: ["id"],
    indexes: {
      byScope: {
        eq: ["scope_key"],
        sort: ["id"],
        root: { model: "release_catalogs" }
      },
      byScopeEnabled: {
        eq: ["scope_key", "enabled"],
        sort: ["id"],
        root: { model: "release_catalogs" }
      },
      byChannelPlatform: {
        eq: ["channel_id", "platform"],
        sort: ["id"]
      },
      byChannelPlatformEnabled: {
        eq: [
          "channel_id",
          "platform",
          "enabled"
        ],
        sort: ["id"]
      },
      byBundle: {
        eq: ["bundle_id"],
        sort: ["id"]
      },
      all: {
        eq: [],
        sort: ["id"]
      }
    }
  }),
  release_catalogs: defineTable({
    scope_key: {
      type: "string",
      maxLength: 2048,
      ascii: true
    },
    catalog_id: {
      type: "string",
      maxLength: 255
    },
    strategy: {
      type: "string",
      maxLength: 16
    },
    channel_id: {
      ...CHANNEL_ID,
      references: {
        model: "channels",
        onDelete: "none"
      }
    },
    channel_key: {
      type: "string",
      maxLength: 1400,
      ascii: true
    },
    platform: {
      type: "string",
      maxLength: 16
    },
    fingerprint_hash: {
      type: "string",
      maxLength: 255,
      required: false
    },
    generation: { type: "integer" },
    payload: { type: "string" },
    catalog_hash: {
      type: "string",
      maxLength: 71
    },
    byte_size: { type: "integer" },
    is_tombstone: { type: "boolean" },
    updated_at_ms: { type: "integer" }
  }, {
    key: ["scope_key"],
    indexes: { all: {
      eq: [],
      sort: ["scope_key"]
    } }
  }),
  channels: defineTable({
    id: CHANNEL_ID,
    name: {
      type: "string",
      maxLength: 255,
      unique: true
    }
  }, {
    key: ["id"],
    indexes: { all: {
      eq: [],
      sort: ["name"]
    } }
  }),
  bundle_totals: defineAggregate({ platform_key: {
    type: "string",
    maxLength: 16
  } }, {
    key: ["platform_key"],
    counters: ["bundles"],
    indexes: { byPlatform: {
      eq: ["platform_key"],
      sort: []
    } }
  })
};
var coreModule = {
  id: "core",
  schema: coreSchema
};

// ../plugin-core/dist/engine/db/fixedMigratorShared.mjs
var getEmptyMigrationResult = /* @__PURE__ */ __name(() => ({
  operations: [],
  execute: /* @__PURE__ */ __name(async () => {
  }, "execute"),
  getSQL: /* @__PURE__ */ __name(() => "", "getSQL")
}), "getEmptyMigrationResult");

// ../plugin-core/dist/engine/db/settingsMigrator.mjs
var storedSchemaVersion = /* @__PURE__ */ __name((stored2) => {
  const version2 = stored2?.get("schema.core") ?? stored2?.get("version");
  return typeof version2 === "string" ? version2 : void 0;
}, "storedSchemaVersion");
var refuseV0Database = /* @__PURE__ */ __name((adapterName, stored2) => {
  const version2 = stored2.get("version");
  if (typeof version2 !== "string" || stored2.has("schema.engine")) return;
  throw new HotUpdaterSchemaMigrationRequiredError(adapterName, version2);
}, "refuseV0Database");

// ../plugin-core/dist/engine/database/cursor.mjs
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var toBase64Url = /* @__PURE__ */ __name((text) => {
  let binary = "";
  for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "toBase64Url");
var fromBase64Url = /* @__PURE__ */ __name((value) => {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return decoder.decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}, "fromBase64Url");
var fnv1a = /* @__PURE__ */ __name((text) => {
  let hash2 = 2166136261;
  for (const byte of encoder.encode(text)) hash2 = Math.imul(hash2 ^ byte, 16777619) >>> 0;
  return hash2;
}, "fnv1a");
var cursorScope = /* @__PURE__ */ __name((parts) => fnv1a(JSON.stringify(parts)).toString(36), "cursorScope");
var encodeCursor = /* @__PURE__ */ __name((scope, after) => toBase64Url(JSON.stringify([scope, after])), "encodeCursor");
var decodeCursor = /* @__PURE__ */ __name((scope, cursor) => {
  let decoded;
  try {
    decoded = JSON.parse(fromBase64Url(cursor));
  } catch {
    decoded = void 0;
  }
  const [from, after] = Array.isArray(decoded) ? decoded : [];
  if (typeof from !== "string" || !Array.isArray(after) || !after.every(isKeyValue)) throw new DatabaseCursorError("The cursor is malformed.");
  if (from !== scope) throw new DatabaseCursorError("The cursor belongs to a read with another model, index, filter, order, or range.");
  return after;
}, "decodeCursor");

// ../plugin-core/dist/engine/database/engineAggregates.mjs
var definitionOf = /* @__PURE__ */ __name((model) => model.definition, "definitionOf");
var shardOf = /* @__PURE__ */ __name((value, shards) => fnv1a(value) % shards, "shardOf");
var recordAggregate = /* @__PURE__ */ __name((changes, model, identity, values, shardBy) => {
  const { key: fields, counters: counters2, gauges, distinct, shards } = definitionOf(model);
  const fail4 = /* @__PURE__ */ __name((message) => new DatabaseTransactionError(`${model.table.name}: ${message}`), "fail");
  if (Object.keys(identity).length !== fields.length || !fields.every((name) => isKeyValue(identity[name]))) throw fail4(`aggregate takes exactly its identity fields: ${fields.join(", ")}.`);
  if (shardBy === void 0 && shards > 1 && gauges.some((gauge) => gauge in values)) throw fail4("gauges of a sharded aggregate need shardBy.");
  const shard = shardBy === void 0 ? Math.floor(Math.random() * shards) : shardOf(shardBy, shards);
  const key = [...fields.map((name) => identity[name]), shard];
  const id = JSON.stringify([model.table.name, key]);
  const change = changes.get(id) ?? {
    model,
    key,
    deltas: {},
    sketches: {}
  };
  changes.set(id, change);
  for (const [metric, value] of Object.entries(values)) if (distinct.includes(metric) && typeof value === "string") change.sketches[metric] = mergeDistinct([change.sketches[metric], value]);
  else if ((counters2.includes(metric) || gauges.includes(metric)) && Number.isSafeInteger(value)) change.deltas[metric] = (change.deltas[metric] ?? 0) + Number(value);
  else throw fail4(`${metric} is not a counter, gauge, or sketch of this aggregate.`);
}, "recordAggregate");
var blank = /* @__PURE__ */ __name((model, key) => {
  const { counters: counters2, gauges, distinct } = definitionOf(model);
  return Object.fromEntries([
    ...model.table.key.map((column, position) => [column, key[position]]),
    ...[...counters2, ...gauges].map((name) => [name, 0]),
    ...distinct.map((name) => [name, null]),
    ["_v", 0]
  ]);
}, "blank");
var NegativeGaugeError = class extends DatabaseTransactionError {
  static {
    __name(this, "NegativeGaugeError");
  }
};
var rewrite = /* @__PURE__ */ __name(({ model, key, deltas, sketches: sketches2 }, current) => {
  const { table } = model;
  const { counters: counters2, gauges, distinct } = definitionOf(model);
  const base = current ?? blank(model, key);
  const set = {};
  for (const [metric, delta] of Object.entries(deltas)) set[metric] = Number(base[metric] ?? 0) + delta;
  for (const [metric, sketch] of Object.entries(sketches2)) set[metric] = mergeDistinct([base[metric], sketch]);
  if (current && Object.entries(set).every(([metric, value]) => current[metric] === value)) return;
  const row = {
    ...base,
    ...set
  };
  if (gauges.some((gauge) => Number(row[gauge]) < 0)) {
    if (current === null && table.retention) return void 0;
    throw new NegativeGaugeError(`${table.name}: a gauge went below 0.`);
  }
  const zero = distinct.length === 0 && [...counters2, ...gauges].every((metric) => Number(row[metric]) === 0);
  if (current === null) return zero ? void 0 : {
    type: "insert",
    table,
    row
  };
  const guard = { v: Number(current["_v"]) };
  return zero ? {
    type: "delete",
    table,
    key,
    guard,
    previous: current
  } : {
    type: "patch",
    table,
    key,
    set,
    guard,
    previous: current
  };
}, "rewrite");
var compileAggregates = /* @__PURE__ */ __name(async (adapter, changes) => {
  const ops = [];
  const merged = /* @__PURE__ */ new Map();
  for (const change of changes) {
    const { model, key, deltas, sketches: sketches2 } = change;
    if (Object.keys(sketches2).length > 0 || definitionOf(model).gauges.some((gauge) => (deltas[gauge] ?? 0) !== 0)) merged.set(model, [...merged.get(model) ?? [], change]);
    else if (Object.values(deltas).some((delta) => delta !== 0)) {
      const { table } = model;
      const init = blank(model, key);
      ops.push({
        type: "increment",
        table,
        key,
        by: deltas,
        init
      });
    }
  }
  const groups = [...merged.values()];
  const current = await Promise.all(groups.map((group) => adapter.get(group[0].model.table, group.map(({ key }) => key))));
  groups.forEach((group, index) => group.forEach((change, position) => {
    const op = rewrite(change, current[index][position] ?? null);
    if (op !== void 0) ops.push(op);
  }));
  return ops;
}, "compileAggregates");

// ../plugin-core/dist/engine/database/aggregateBatching.mjs
var LOG_TABLES = [
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7
].map((at) => `aggregate_log_${at}`);
var LEASE_TABLE = "aggregate_lease";
var LEASE = { id: "compaction" };
var LEASE_MS = 3e4;
var WINDOW_MS = {
  log: 6e4,
  memory: 15e3
};
var LOG_PAGE = 200;
var GROUPS = {
  commit: 1,
  read: 8,
  flush: 256
};
var ATTEMPTS = 5;
var MAX_BUFFERED = 1e4;
var log = defineTable({
  id: {
    type: "string",
    maxLength: 32
  },
  /** One committed transaction's changes, one entry per aggregate row. */
  changes: { type: "string" }
}, {
  key: ["id"],
  indexes: { oldest: {
    eq: [],
    sort: ["id"]
  } }
});
var lease = defineTable({
  id: {
    type: "string",
    maxLength: 16
  },
  holder: {
    type: "string",
    maxLength: 32
  },
  until: { type: "integer" },
  next: { type: "integer" },
  applied: { type: "string" }
}, { key: ["id"] });
var aggregateBatchingModule = {
  id: "aggregateBatching",
  schema: {
    ...Object.fromEntries(LOG_TABLES.map((table) => [table, log])),
    [LEASE_TABLE]: lease
  }
};
var shapeOf = /* @__PURE__ */ __name((model) => model.definition, "shapeOf");
var isBatched = /* @__PURE__ */ __name((model) => model?.definition.kind === "aggregate" && shapeOf(model).batched === true, "isBatched");
var valuesOf = /* @__PURE__ */ __name(({ deltas, sketches: sketches2 }) => ({
  ...deltas,
  ...sketches2
}), "valuesOf");
var merge = /* @__PURE__ */ __name((into, model, key, values) => recordAggregate(into, model, Object.fromEntries(shapeOf(model).key.map((field, at) => [field, key[at]])), values, ""), "merge");
var mergeAll = /* @__PURE__ */ __name((into, changes) => {
  for (const change of changes) merge(into, change.model, change.key, valuesOf(change));
  return into;
}, "mergeAll");
var metricsOf = /* @__PURE__ */ __name((model, row) => {
  const { counters: counters2, gauges, distinct } = shapeOf(model);
  return Object.fromEntries([...[...counters2, ...gauges].map((name) => [name, Number(row[name] ?? 0)]), ...distinct.flatMap((name) => row[name] === null || row[name] === void 0 ? [] : [[name, row[name]]])]);
}, "metricsOf");
var blank2 = /* @__PURE__ */ __name((model, key) => {
  const { counters: counters2, gauges, distinct } = shapeOf(model);
  return Object.fromEntries([
    ...model.table.key.map((column, at) => [column, key[at]]),
    ...[...counters2, ...gauges].map((name) => [name, 0]),
    ...distinct.map((name) => [name, null]),
    ["_v", 0]
  ]);
}, "blank");
var rewrites = /* @__PURE__ */ __name(({ model, deltas, sketches: sketches2 }) => Object.keys(sketches2).length > 0 || shapeOf(model).gauges.some((gauge) => (deltas[gauge] ?? 0) !== 0), "rewrites");
var increment = /* @__PURE__ */ __name(({ model, deltas }, key) => Object.values(deltas).some((delta) => delta !== 0) ? {
  type: "increment",
  table: model.table,
  key,
  by: deltas,
  init: blank2(model, key)
} : void 0, "increment");
var rewrite2 = /* @__PURE__ */ __name((change, key, current) => {
  const { model } = change;
  const { table } = model;
  const { counters: counters2, gauges, distinct } = shapeOf(model);
  const base = current ?? blank2(model, key);
  const sum = mergeAll(/* @__PURE__ */ new Map(), [change]);
  merge(sum, model, key, metricsOf(model, base));
  const set = valuesOf([...sum.values()][0]);
  if (current && Object.keys(set).every((name) => current[name] === set[name])) return void 0;
  const row = {
    ...base,
    ...set
  };
  const zero = distinct.length === 0 && [...counters2, ...gauges].every((name) => Number(row[name]) === 0);
  if (current === null) return zero ? void 0 : {
    type: "insert",
    table,
    row
  };
  const guard = { v: Number(current["_v"]) };
  return zero ? {
    type: "delete",
    table,
    key,
    guard,
    previous: current
  } : {
    type: "patch",
    table,
    key,
    set,
    guard,
    previous: current
  };
}, "rewrite");
var compile = /* @__PURE__ */ __name(async (adapter, changes, shard) => {
  const keys = changes.map(({ model, key }) => [...key.slice(0, -1), shard(model)]);
  const reads = /* @__PURE__ */ new Map();
  changes.forEach((change, at) => {
    if (rewrites(change)) reads.set(change.model, [...reads.get(change.model) ?? [], at]);
  });
  const current = /* @__PURE__ */ new Map();
  await Promise.all([...reads].map(async ([model, positions]) => {
    const rows = await adapter.get(model.table, positions.map((at) => keys[at]));
    positions.forEach((at, index) => current.set(at, rows[index] ?? null));
  }));
  return changes.map((change, at) => current.has(at) ? rewrite2(change, keys[at], current.get(at)) : increment(change, keys[at]));
}, "compile");
var isOp = /* @__PURE__ */ __name((op) => op !== void 0, "isOp");
var sleep = /* @__PURE__ */ __name((attempt) => new Promise((resolve) => setTimeout(resolve, Math.min(250, 5 * 2 ** attempt) * Math.random())), "sleep");
var pack = /* @__PURE__ */ __name((text) => {
  const runs = (text.match(/(.)\1*/gsu) ?? []).flatMap((run3) => [run3[0], run3.length]);
  return JSON.stringify(runs).length < JSON.stringify(text).length ? runs : text;
}, "pack");
var unpack = /* @__PURE__ */ __name((value) => Array.isArray(value) ? value.map((item, at) => at % 2 ? "" : item.repeat(value[at + 1])).join("") : value, "unpack");
var deflate = /* @__PURE__ */ __name(async (text) => {
  if (typeof CompressionStream === "undefined") return void 0;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  let binary = "";
  for (const byte of new Uint8Array(await new Response(stream).arrayBuffer())) binary += String.fromCharCode(byte);
  return btoa(binary);
}, "deflate");
var inflate = /* @__PURE__ */ __name((base64) => new Response(new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text(), "inflate");
var encode2 = /* @__PURE__ */ __name(async (changes) => {
  const json4 = JSON.stringify({
    v: 1,
    c: [...changes].map(({ model, key, deltas, sketches: sketches2 }) => {
      const packed = Object.entries(sketches2).map(([name, sketch]) => [name, pack(sketch)]);
      const values = {
        ...deltas,
        ...Object.fromEntries(packed)
      };
      return [
        model.table.name,
        key.slice(0, -1),
        values
      ];
    })
  });
  const zipped = await deflate(json4);
  return zipped !== void 0 && zipped.length < json4.length ? `z${zipped}` : json4;
}, "encode");
var createAggregateBatches = /* @__PURE__ */ __name(({ engine, adapter, schema, batching: { mode = "log", windowMs = WINDOW_MS[mode] }, now }) => {
  if (!schema.models.has(LEASE_TABLE)) throw new DatabaseTransactionError("An engine that batches aggregates needs aggregateBatchingModule in its schema.");
  const holder = crypto.randomUUID().replaceAll("-", "");
  const table = /* @__PURE__ */ __name((name) => schema.models.get(name).table, "table");
  const warned = /* @__PURE__ */ new Set();
  const warn = /* @__PURE__ */ __name((what) => (error) => {
    if (warned.has(what)) return;
    warned.add(what);
    console.warn(`[hot-updater] Aggregate ${what} failed.`, error);
  }, "warn");
  const decode2 = /* @__PURE__ */ __name(async (text) => {
    const changes = /* @__PURE__ */ new Map();
    try {
      const json4 = text.startsWith("z") ? await inflate(text.slice(1)) : text;
      const { c } = JSON.parse(json4);
      for (const [name, identity, values] of c) {
        const model = schema.models.get(name);
        if (!isBatched(model)) return void 0;
        const unpacked = Object.entries(values).map(([metric, value]) => [metric, unpack(value)]);
        merge(changes, model, [...identity, 0], Object.fromEntries(unpacked));
      }
    } catch (error) {
      warn("log decoding")(error);
      return;
    }
    return changes;
  }, "decode");
  const apply = /* @__PURE__ */ __name(async (changes, shard) => {
    let rest = changes;
    let ops = [];
    let read = true;
    for (let failures = 0; rest.length > 0 && failures < ATTEMPTS; ) try {
      if (read) ops = await compile(adapter, rest, shard);
      let size = rest.length;
      const chunk = /* @__PURE__ */ __name(() => ops.slice(0, size).filter(isOp), "chunk");
      while (size > 1 && !adapter.fits(chunk())) size = Math.ceil(size / 2);
      let result = { ok: true };
      if (chunk().length > 0) result = await adapter.write(chunk()).catch((error) => {
        warn("flush")(error);
        return { ok: true };
      });
      read = !result.ok && !("retry" in result);
      if (result.ok) {
        rest = rest.slice(size);
        ops = ops.slice(size);
        failures = 0;
      } else {
        failures += 1;
        if (!read) await sleep(failures);
      }
    } catch (error) {
      warn("flush")(error);
      return rest;
    }
    return rest;
  }, "apply");
  let buffer = /* @__PURE__ */ new Map();
  let timer;
  let flushing;
  const shards = /* @__PURE__ */ new Map();
  const processShard = /* @__PURE__ */ __name((model) => {
    if (!shards.has(model)) shards.set(model, Math.floor(Math.random() * shapeOf(model).shards));
    return shards.get(model);
  }, "processShard");
  const schedule = /* @__PURE__ */ __name(() => {
    if (timer !== void 0 || buffer.size === 0) return;
    timer = setTimeout(() => {
      timer = void 0;
      flushBuffer();
    }, windowMs);
    timer.unref?.();
  }, "schedule");
  const flushBuffer = /* @__PURE__ */ __name(() => flushing ??= (async () => {
    clearTimeout(timer);
    timer = void 0;
    const pending = [...buffer.values()];
    buffer = /* @__PURE__ */ new Map();
    mergeAll(buffer, await apply(pending, processShard));
  })().catch(warn("flush")).finally(() => {
    flushing = void 0;
    schedule();
  }), "flushBuffer");
  let nextDue = 0;
  let compacting;
  const known = /* @__PURE__ */ new Map();
  const idOf2 = /* @__PURE__ */ __name((shard, id) => JSON.stringify([shard, id]), "idOf");
  const leaseOp = /* @__PURE__ */ __name((held, set) => {
    const next = {
      ...held,
      ...set,
      _v: Number(held._v) + 1
    };
    return {
      op: {
        type: "patch",
        table: table(LEASE_TABLE),
        key: [LEASE.id],
        set,
        guard: { v: Number(held._v) },
        previous: held
      },
      next
    };
  }, "leaseOp");
  const takeLease = /* @__PURE__ */ __name((force) => engine.transaction(async (tx) => {
    const at = now();
    const held = await tx.findOne(LEASE_TABLE, LEASE);
    const fields = {
      holder,
      until: at + LEASE_MS
    };
    if (held === null) {
      const row = {
        ...LEASE,
        ...fields,
        next: 0,
        applied: "[]"
      };
      tx.create(LEASE_TABLE, row);
      return {
        ...row,
        _v: 0
      };
    }
    nextDue = Number(held.next);
    if (held.holder !== holder && Number(held.until) > at || !force && nextDue > at) return void 0;
    tx.update(LEASE_TABLE, held, fields);
    return {
      ...held,
      ...fields,
      _v: Number(held._v) + 1
    };
  }), "takeLease");
  const commit = /* @__PURE__ */ __name(async (ops) => {
    for (let failures = 0; failures < ATTEMPTS; failures += 1) {
      const result = await adapter.write(ops);
      if (result.ok) return true;
      if (!("retry" in result)) return false;
      await sleep(failures);
    }
    return false;
  }, "commit");
  const deleteApplied = /* @__PURE__ */ __name(async (held) => {
    const applied = JSON.parse(String(held.applied));
    await Promise.all(LOG_TABLES.map(async (name, shard) => {
      const ids = applied.flatMap(([at, id]) => at === shard && !known.has(idOf2(at, id)) ? [id] : []);
      if (ids.length === 0) return;
      const rows2 = await adapter.get(table(name), ids.map((id) => [id]));
      for (const row of rows2) if (row) known.set(idOf2(shard, row.id), row);
    }));
    const rows = applied.flatMap(([shard, id]) => {
      const row = known.get(idOf2(shard, id));
      return row === void 0 ? [] : [{
        shard,
        row
      }];
    });
    if (adapter.deleteConsumed && await Promise.all(LOG_TABLES.map((name, at) => {
      const own = rows.flatMap(({ shard, row }) => shard === at ? [row] : []);
      return own.length > 0 && adapter.deleteConsumed(table(name), own);
    })).then(() => true, (error) => (warn("log cleanup")(error), false))) {
      for (const [shard, id] of applied) known.delete(idOf2(shard, id));
      return true;
    }
    const deletes = rows.map(({ shard, row }) => {
      const guard = { v: Number(row["_v"]) };
      return {
        type: "delete",
        table: table(LOG_TABLES[shard]),
        key: [String(row.id)],
        guard,
        previous: row
      };
    });
    let size = deletes.length;
    while (size > 1 && !adapter.fits(deletes.slice(0, size))) size = Math.ceil(size / 2);
    const chunks = [];
    for (let at = 0; at < deletes.length; at += size) chunks.push(deletes.slice(at, at + size));
    if ((await Promise.all(chunks.map(commit))).includes(false)) return false;
    for (const [shard, id] of applied) known.delete(idOf2(shard, id));
    return true;
  }, "deleteApplied");
  const readLogs = /* @__PURE__ */ __name(async () => {
    let more = false;
    return {
      logs: (await Promise.all(LOG_TABLES.map(async (name, shard) => {
        const page2 = await engine.reads.findMany(name, {
          index: "oldest",
          limit: LOG_PAGE
        });
        more ||= page2.next !== void 0;
        return (await Promise.all(page2.rows.map(async (row) => ({
          shard,
          row,
          changes: await decode2(String(row.changes))
        })))).flatMap(({ changes, ...entry }) => changes === void 0 ? [] : [{
          ...entry,
          changes
        }]);
      }))).flat().sort((left, right) => compareUtf8(String(left.row.id), String(right.row.id))),
      more
    };
  }, "readLogs");
  const rowsFor = /* @__PURE__ */ __name(async (changes) => (await compile(adapter, changes, () => 0)).filter(isOp), "rowsFor");
  const applyGroup = /* @__PURE__ */ __name(async (held, logs) => {
    for (let count = logs.length; count > 0; count = Math.floor(count / 2)) {
      const batch = logs.slice(0, count);
      const changes2 = mergeAll(/* @__PURE__ */ new Map(), batch.flatMap((entry) => [...entry.changes.values()]));
      const applied = batch.map(({ shard: shard2, row: row2 }) => [shard2, row2.id]);
      const lease2 = leaseOp(held, { applied: JSON.stringify(applied) });
      const ops = [...await rowsFor([...changes2.values()]), lease2.op];
      if (!adapter.fits(ops)) continue;
      for (const { shard: shard2, row: row2 } of batch) known.set(idOf2(shard2, row2.id), row2);
      return await commit(ops) ? {
        held: lease2.next,
        count
      } : void 0;
    }
    const [{ shard, row, changes }] = logs;
    const name = LOG_TABLES[shard];
    const entries = [...changes.values()];
    for (let take = entries.length - 1; take > 0; take = Math.floor(take / 2)) {
      const kept = {
        type: "patch",
        table: table(name),
        key: [String(row.id)],
        set: { changes: await encode2(entries.slice(take)) },
        guard: { v: Number(row["_v"]) },
        previous: row
      };
      const lease2 = leaseOp(held, {});
      const ops = [
        ...await rowsFor(entries.slice(0, take)),
        kept,
        lease2.op
      ];
      if (adapter.fits(ops)) return await commit(ops) ? {
        held: lease2.next,
        count: 0
      } : void 0;
    }
    throw new DatabaseTransactionError(`${name}: one aggregate change does not fit in one write.`);
  }, "applyGroup");
  const run3 = /* @__PURE__ */ __name(async (force, groups) => {
    let held = await takeLease(force);
    if (held === void 0) return;
    let pending = true;
    let clear = false;
    try {
      for (let group = 0; ; group += 1) {
        clear = await deleteApplied(held);
        if (!clear || !pending || group === groups) break;
        const { logs, more } = await readLogs();
        if (logs.length === 0) {
          pending = false;
          break;
        }
        const applied = await applyGroup(held, logs);
        if (applied === void 0) break;
        [held, clear] = [applied.held, false];
        pending = more || applied.count < logs.length;
      }
    } finally {
      nextDue = now() + (pending ? 0 : windowMs);
      const set = {
        until: 0,
        next: nextDue,
        ...clear ? { applied: "[]" } : {}
      };
      await commit([leaseOp(held, set).op]);
      known.clear();
    }
  }, "run");
  const compact = /* @__PURE__ */ __name((force, groups) => compacting ??= run3(force, groups).catch(warn("compaction")).finally(() => {
    compacting = void 0;
  }), "compact");
  let checking;
  const hasPending = /* @__PURE__ */ __name(() => checking ??= Promise.all(LOG_TABLES.map((name) => engine.reads.findMany(name, {
    index: "oldest",
    limit: 1
  }))).then((pages) => pages.some((page2) => page2.rows.length > 0)).finally(() => {
    checking = void 0;
  }), "hasPending");
  const committed = /* @__PURE__ */ __name(async (changes) => {
    if (mode === "log") {
      if (now() >= nextDue) await compact(false, GROUPS.commit);
      return;
    }
    mergeAll(buffer, changes.values());
    schedule();
    if (buffer.size >= MAX_BUFFERED) await flushBuffer();
  }, "committed");
  const flush = /* @__PURE__ */ __name(async () => {
    await flushBuffer();
    if (mode === "log" && await hasPending()) await compact(true, GROUPS.flush);
  }, "flush");
  return {
    async transaction(fn) {
      let changes = /* @__PURE__ */ new Map();
      const result = await engine.transaction(async (tx) => {
        const attempt = /* @__PURE__ */ new Map();
        changes = attempt;
        let open = true;
        let failure;
        const aggregate = /* @__PURE__ */ __name((name, identity, values, options) => {
          const model = schema.models.get(name);
          if (!isBatched(model)) return tx.aggregate(name, identity, values, options);
          try {
            if (!open) throw new DatabaseTransactionError("The transaction has ended.");
            recordAggregate(attempt, model, identity, values, options?.shardBy);
          } catch (error) {
            failure ??= { error };
            throw error;
          }
        }, "aggregate");
        try {
          const value = await fn({
            ...tx,
            aggregate
          });
          if (failure) throw failure.error;
          if (mode === "log" && attempt.size > 0) {
            const id = `${now().toString(36).padStart(9, "0")}${holder.slice(0, 8)}${crypto.randomUUID().slice(0, 8)}`;
            const shard = Math.floor(Math.random() * LOG_TABLES.length);
            const merged = mergeAll(/* @__PURE__ */ new Map(), attempt.values());
            tx.create(LOG_TABLES[shard], {
              id,
              changes: await encode2(merged.values())
            });
          }
          return value;
        } finally {
          open = false;
        }
      });
      if (changes.size > 0) await committed(changes);
      return result;
    },
    async beforeRead(name) {
      if (!isBatched(schema.models.get(name))) return;
      if (buffer.size > 0 || flushing !== void 0) await flushBuffer();
      if (mode === "log") {
        if (await hasPending().catch((error) => {
          warn("read")(error);
          return false;
        })) await compact(true, GROUPS.read);
      }
    },
    flush,
    async dispose() {
      clearTimeout(timer);
      timer = void 0;
      await flush();
    }
  };
}, "createAggregateBatches");

// ../plugin-core/dist/engine/database/retention.mjs
var MINUTE_MS = 6e4;
var HOUR_MS = 60 * MINUTE_MS;
var DAY_MS = 24 * HOUR_MS;
var physicalRetention = /* @__PURE__ */ __name(({ retention }) => retention === void 0 ? {} : { retention: {
  column: retention.field,
  ms: retention.days * DAY_MS
} }, "physicalRetention");
var linkedModels = /* @__PURE__ */ __name((schema) => Object.entries(schema).flatMap(([name, { fields, indexes }]) => [...Object.values(fields).map(({ references }) => references), ...Object.values(indexes).map(({ root }) => root)].flatMap((link) => link ? [name, link.model] : [])), "linkedModels");
var retentionProblems = /* @__PURE__ */ __name((schema, model) => {
  const definition = schema[model];
  if (definition.retention === void 0) return [];
  const { field, days } = definition.retention;
  const declared = definition.fields[field] ?? (definition.kind === "table" ? definition.derived[field] : void 0);
  return [
    ...declared?.type !== "integer" || "multi" in declared && declared.multi === true ? [`retention field "${field}" is not an integer field`] : [],
    ...Number.isSafeInteger(days) && days >= 1 ? [] : ["retention days must be a whole number of at least 1"],
    ...linkedModels(schema).includes(model) ? ["a model with retention is in no reference or rooted index"] : []
  ];
}, "retentionProblems");
var PASS_LIMIT = 500;
var LEASE_KEY = "retention.nextPassAt";
var pruneDuringWrites = /* @__PURE__ */ __name((adapter, tables, { leaseTable: table, now }) => {
  const expiring = tables.filter(({ retention }) => retention !== void 0);
  if (adapter.prune === void 0 || expiring.length === 0) return adapter;
  const key = [LEASE_KEY];
  let checkAt = 0;
  const lease2 = /* @__PURE__ */ __name(async (row, due) => {
    const value = String(due);
    const guard = { v: row === null ? -1 : Number(row._v) };
    const next = {
      key: LEASE_KEY,
      value,
      _v: guard.v + 1
    };
    const op = row === null ? {
      type: "insert",
      table,
      row: next
    } : {
      type: "patch",
      table,
      key,
      set: { value },
      guard,
      previous: row
    };
    return (await adapter.write([op])).ok ? next : null;
  }, "lease");
  const pass = /* @__PURE__ */ __name(async () => {
    const at = now();
    if (at < checkAt) return;
    checkAt = at + MINUTE_MS;
    const [row = null] = await adapter.get(table, [key]);
    checkAt = row === null ? at : Number(row.value);
    if (checkAt > at) return;
    const held = await lease2(row, at + HOUR_MS);
    if (held === null) return;
    checkAt = at + HOUR_MS;
    const deleted = [];
    try {
      for (const t of expiring) deleted.push(await adapter.prune(t, at - t.retention.ms, PASS_LIMIT));
    } catch (error) {
      checkAt = at + MINUTE_MS;
      await lease2(held, at).catch(() => null);
      throw error;
    }
    if (deleted.includes(PASS_LIMIT) && await lease2(held, at + MINUTE_MS) !== null) checkAt = at + MINUTE_MS;
  }, "pass");
  const warn = /* @__PURE__ */ __name((error) => console.warn("[hot-updater] Pruning expired rows failed.", error), "warn");
  return Object.assign(Object.create(adapter), { async write(ops) {
    await pass().catch(warn);
    return adapter.write(ops);
  } });
}, "pruneDuringWrites");

// ../plugin-core/dist/engine/database/resolveSchema.mjs
var SHARD_COLUMN = "_shard";
var NAME = /^[a-z][a-z0-9_]*$/u;
var INDEX_NAME = /^[A-Za-z][A-Za-z0-9_]*$/u;
var tableName = /* @__PURE__ */ __name((module, model) => module.namespace ? `${module.namespace}_${model}` : model, "tableName");
var integer = /* @__PURE__ */ __name((name, defaulted = false) => ({
  name,
  type: "integer",
  nullable: false,
  ...defaulted ? { default: 0 } : {}
}), "integer");
var fieldType = /* @__PURE__ */ __name((model, name) => {
  const field = model.fields[name] ?? (model.kind === "table" ? model.derived[name] : void 0);
  return field && {
    type: field.type,
    multi: "multi" in field && !!field.multi
  };
}, "fieldType");
var metricsOf2 = /* @__PURE__ */ __name((model) => [
  ...model.counters,
  ...model.gauges,
  ...model.distinct
], "metricsOf");
var fieldProblems = /* @__PURE__ */ __name((definition, add) => {
  const names = [...Object.keys(definition.fields), ...definition.kind === "table" ? Object.keys(definition.derived) : metricsOf2(definition)];
  for (const name of new Set(names)) {
    if (!NAME.test(name)) add(`field "${name}" must match ${NAME.source}`);
    if (names.indexOf(name) !== names.lastIndexOf(name)) add(`field "${name}" is declared twice`);
  }
  const { key } = definition;
  if (key.length === 0) add("key is empty");
  if (new Set(key).size !== key.length) add("key repeats a field");
  for (const name of key) {
    const field = definition.fields[name];
    if (field === void 0) add(`key field "${name}" is not a declared field`);
    else if (field.required === false) add(`key field "${name}" is nullable`);
    else if (field.type === "json") add(`key field "${name}" is json`);
  }
  for (const [name, { type, maxLength, ascii }] of Object.entries(definition.fields)) {
    if (maxLength !== void 0 && (type !== "string" || !Number.isSafeInteger(maxLength) || maxLength < 1)) add(`field "${name}" has an invalid maxLength`);
    if (ascii && type !== "string") add(`field "${name}" is ascii but not a string`);
  }
}, "fieldProblems");
var tableProblems = /* @__PURE__ */ __name((definition, add, table) => {
  for (const [name, derived] of Object.entries(definition.derived)) {
    if (typeof derived.compute !== "function") add(`derived field "${name}" has no compute function`);
    if (derived.multi && derived.type === "json") add(`derived field "${name}" cannot be multi-valued json`);
  }
  for (const [name, { type, references }] of Object.entries(definition.fields)) {
    if (references === void 0) continue;
    const target = table(references.model);
    const targetKey = target?.key.length === 1 ? target.fields[target.key[0]] : void 0;
    if (targetKey === void 0) add(`field "${name}" references "${references.model}", which is not a single-key table of this module`);
    else if (targetKey.type !== type) add(`field "${name}" and the key of "${references.model}" differ in type`);
    if (references.onDelete === "cascade" && !Object.values(definition.indexes).some(({ eq }) => eq.length === 1 && eq[0] === name)) add(`cascade on "${name}" needs an index whose eq is exactly [${name}]`);
  }
}, "tableProblems");
var aggregateProblems = /* @__PURE__ */ __name((definition, add) => {
  const identity = Object.keys(definition.fields);
  if (definition.key.join("\0") !== identity.join("\0")) add(`key must list the identity fields in declaration order: ${identity.join(", ")}`);
  if (metricsOf2(definition).length === 0) add("aggregate has no metrics");
  if (definition.distinct.length > 0 && definition.counters.length + definition.gauges.length > 0) add("distinct sketches need an aggregate of their own");
  const { shards } = definition;
  if (!Number.isSafeInteger(shards) || shards < 1 || shards > 64) add(`shards must be 1\u201364`);
}, "aggregateProblems");
var problemsOf = /* @__PURE__ */ __name((module, model, definition) => {
  const problems = [];
  const add = /* @__PURE__ */ __name((message) => problems.push(`${module.id}.${model}: ${message}`), "add");
  const table = /* @__PURE__ */ __name((name) => {
    const target = module.schema[name];
    return target?.kind === "table" ? target : void 0;
  }, "table");
  if (!NAME.test(model)) add("model names use lowercase letters, digits, and _");
  fieldProblems(definition, add);
  for (const [name, index] of Object.entries(definition.indexes)) {
    const columns = [...index.eq, ...index.sort];
    if (!INDEX_NAME.test(name)) add(`index "${name}" must match ${INDEX_NAME.source}`);
    if (columns.length === 0) add(`index "${name}" has no fields`);
    if (index.unique && index.sort.length > 0) add(`unique index "${name}" cannot sort`);
    if (columns.filter((column) => {
      const type = fieldType(definition, column);
      if (type === void 0) add(`index "${name}" names undeclared field "${column}"`);
      else if (type.type === "json") add(`index "${name}" names json field "${column}"`);
      else if (type.multi && index.sort.includes(column)) add(`index "${name}" sorts by multi-valued field "${column}"`);
      return type?.type !== "json" && type?.multi;
    }).length > 1) add(`index "${name}" has more than one multi-valued field`);
    if (index.root === void 0) continue;
    const root = table(index.root.model);
    if (root === void 0) add(`index "${name}" is rooted at unknown table "${index.root.model}"`);
    else if (root.key.length > index.eq.length || root.key.some((field, position) => fieldType(definition, index.eq[position])?.type !== root.fields[field].type)) add(`index "${name}" eq must start with the key of "${index.root.model}"`);
  }
  if (definition.kind === "table") tableProblems(definition, add, table);
  else aggregateProblems(definition, add);
  for (const problem of retentionProblems(module.schema, model)) add(problem);
  return problems;
}, "problemsOf");
var validateSchema = /* @__PURE__ */ __name((modules) => {
  const problems = [];
  const owners = /* @__PURE__ */ new Map();
  for (const module of modules) for (const [model, definition] of Object.entries(module.schema)) {
    const name = tableName(module, model);
    const owner = owners.get(name);
    if (owner !== void 0) problems.push(`${module.id}.${model}: table "${name}" is also declared by ${owner}`);
    owners.set(name, `${module.id}.${model}`);
    problems.push(...problemsOf(module, model, definition));
  }
  if (problems.length > 0) throw new DatabaseSchemaError(`Invalid database schema:
- ${problems.join("\n- ")}`);
}, "validateSchema");
var indexesOf = /* @__PURE__ */ __name((definition) => [...Object.entries(definition.indexes).map(([name, index]) => ({
  name,
  eq: [...index.eq],
  sort: [...index.sort],
  ...index.unique ? { unique: true } : {}
})), ...Object.entries(definition.fields).flatMap(([name, field]) => field.unique ? [{
  name,
  eq: [name],
  sort: [],
  unique: true
}] : [])], "indexesOf");
var resolveSchema = /* @__PURE__ */ __name((modules) => {
  validateSchema(modules);
  const references = [];
  for (const module of modules) for (const [model, definition] of Object.entries(module.schema)) {
    if (definition.kind !== "table") continue;
    const table = tableName(module, model);
    for (const [field, { references: to }] of Object.entries(definition.fields)) {
      if (to === void 0) continue;
      const { onDelete } = to;
      const target = tableName(module, to.model);
      const counter = onDelete === "none" ? {} : { counter: `_refs_${table}_${field}` };
      references.push({
        table,
        field,
        target,
        onDelete,
        ...counter
      });
    }
  }
  const models = /* @__PURE__ */ new Map();
  for (const module of modules) for (const [model, definition] of Object.entries(module.schema)) {
    const name = tableName(module, model);
    const referencedBy = references.filter(({ target }) => target === name);
    const columns = Object.entries(definition.fields).map(([field, { type, required, maxLength, ascii }]) => ({
      name: field,
      type,
      nullable: required === false,
      ...maxLength === void 0 ? {} : { maxLength },
      ...ascii ? { ascii } : {}
    }));
    if (definition.kind === "table") for (const [field, { type, multi }] of Object.entries(definition.derived)) columns.push({
      name: field,
      type,
      nullable: true,
      ...multi ? { multi } : {}
    });
    else columns.push(integer(SHARD_COLUMN), ...[...definition.counters, ...definition.gauges].map((metric) => integer(metric)), ...definition.distinct.map((metric) => ({
      name: metric,
      type: "string",
      nullable: true
    })));
    for (const { counter } of referencedBy) if (counter !== void 0) columns.push(integer(counter, true));
    columns.push(integer("_v", true));
    models.set(name, {
      module: module.id,
      model,
      definition,
      table: {
        name,
        columns,
        key: definition.kind === "aggregate" ? [...definition.key, SHARD_COLUMN] : [...definition.key],
        indexes: indexesOf(definition),
        ...physicalRetention(definition)
      },
      references: references.filter(({ table }) => table === name),
      referencedBy,
      roots: new Map(Object.entries(definition.indexes).flatMap(([index, { root }]) => root === void 0 ? [] : [[index, tableName(module, root.model)]]))
    });
  }
  return {
    models,
    tables: [...models.values()].map(({ table }) => table)
  };
}, "resolveSchema");

// ../plugin-core/dist/engine/db/engineMigrator.mjs
var createEngineMigrator = /* @__PURE__ */ __name((options) => {
  const getVersion = /* @__PURE__ */ __name(async () => storedSchemaVersion(await options.readSettings()), "getVersion");
  const makeResult = /* @__PURE__ */ __name(async (migrate = {}) => {
    const stored2 = await options.readSettings();
    refuseV0Database(options.adapterName, stored2);
    if (Object.entries(options.settings).every(([key, value]) => stored2.get(key) === value)) return getEmptyMigrationResult();
    return {
      operations: [...options.schema.tables.map((table) => ({
        type: "create-table",
        value: {
          ormName: table.name,
          columns: Object.fromEntries(table.columns.map((column) => [column.name, {
            ormName: column.name,
            type: column.type
          }]))
        }
      })), ...migrate.updateSettings === false ? [] : [{
        type: "custom",
        description: `Write the schema settings: ${Object.keys(options.settings).join(", ")}`
      }]],
      execute: /* @__PURE__ */ __name(() => migrateSchema(options.adapter, options.adapterName, options.schema.tables, options.settings), "execute")
    };
  }, "makeResult");
  return {
    getVersion,
    getNameVariants: /* @__PURE__ */ __name(async () => void 0, "getNameVariants"),
    next: /* @__PURE__ */ __name(async () => await getVersion() === "1.0.0" ? void 0 : { version: HOT_UPDATER_SCHEMA_VERSION }, "next"),
    previous: /* @__PURE__ */ __name(async () => void 0, "previous"),
    up: makeResult,
    down: /* @__PURE__ */ __name(async () => {
      throw new Error("No previous schema to migrate to.");
    }, "down"),
    migrateTo: /* @__PURE__ */ __name(async (version2, migrate) => {
      if (version2 !== "1.0.0") throw new Error(`Invalid version ${version2}`);
      return makeResult(migrate);
    }, "migrateTo"),
    migrateToLatest: makeResult
  };
}, "createEngineMigrator");

// ../plugin-core/dist/engine/db/coreDatabase.mjs
var coreSchema2 = resolveSchema([coreModule]);
var coreSettings = {
  [ENGINE_SCHEMA_KEY]: "1",
  "schema.core": HOT_UPDATER_SCHEMA_VERSION
};
var coreTarget = {
  schema: coreSchema2,
  settings: coreSettings
};
var aggregateBatchingTables = resolveSchema([aggregateBatchingModule]).tables;
var pluginSettings = /* @__PURE__ */ __name((plugins) => Object.fromEntries(plugins.map(({ id, schemaVersion }) => [`schema.${id}`, schemaVersion])), "pluginSettings");
var pluginModule = /* @__PURE__ */ __name(({ id, schema, namespace }) => ({
  id,
  schema,
  ...namespace === false ? {} : { namespace: id }
}), "pluginModule");
var createEngineDatabase = /* @__PURE__ */ __name(({ name, adapter, onCachedRoutesChange, aggregateBatching, retry, readSettings: readStored }) => {
  const fenced = withSchemaFence(adapter, name, coreSettings);
  const createMigrator = /* @__PURE__ */ __name(({ schema, settings } = coreTarget) => createEngineMigrator({
    adapterName: name,
    adapter,
    schema,
    settings,
    readSettings: readStored ?? (async () => {
      const rows = await readSettings(adapter, Object.keys(settings)).catch((error) => {
        if (isMissingSchemaError(error)) return [];
        throw error;
      });
      return new Map(rows.flatMap((row) => row === null ? [] : [[String(row.key), row.value]]));
    })
  }), "createMigrator");
  return {
    name,
    adapter: fenced,
    ...onCachedRoutesChange === void 0 ? {} : { onCachedRoutesChange },
    ...aggregateBatching ? { aggregateBatching } : {},
    ...retry === void 0 ? {} : { retry },
    ...adapter.dispose === void 0 ? {} : { dispose: /* @__PURE__ */ __name(() => adapter.dispose(), "dispose") },
    ...adapter.migrations === void 0 ? {} : { createMigrator }
  };
}, "createEngineDatabase");

// ../plugin-core/dist/engine/database/engineTransaction.mjs
var StaleReadError = class extends Error {
  static {
    __name(this, "StaleReadError");
  }
};
var idOf = /* @__PURE__ */ __name((table, key) => JSON.stringify([table, key]), "idOf");
var versionOf = /* @__PURE__ */ __name((row) => Number(row["_v"]), "versionOf");
var isKeyed = /* @__PURE__ */ __name((value) => value !== null && value !== void 0, "isKeyed");
var misuse = /* @__PURE__ */ __name((table, message) => new DatabaseTransactionError(`${table}: ${message}`), "misuse");
var once = /* @__PURE__ */ __name((table) => misuse(table, "a transaction writes one key once."), "once");
var hooks = globalThis.process?.getBuiltinModule?.("node:async_hooks");
var transactionScope = hooks && new hooks.AsyncLocalStorage();
var assertOutsideTransaction = /* @__PURE__ */ __name(() => {
  if (transactionScope?.getStore() !== void 0) throw new DatabaseTransactionError("Inside transaction(), read and write through its handle; db and core are not part of it.");
}, "assertOutsideTransaction");
var createTransactions = /* @__PURE__ */ __name(({ adapter, schema, reads, retry = {} }) => {
  const { attempts = 8, baseDelayMs = 5, maxDelayMs = 250, onRetry } = retry;
  const { modelOf } = reads;
  const complete = /* @__PURE__ */ __name(async ({ table }, rows) => {
    const copies = rows.filter((row) => !("_v" in row));
    if (copies.length === 0) return [...rows];
    const current = await adapter.get(table, copies.map((copy) => rowKey(table, copy)));
    return rows.map((row) => {
      const at = copies.indexOf(row);
      if (at < 0) return row;
      const whole = current[at];
      if (!whole || Object.keys(row).some((column) => canonicalJson(row[column]) !== canonicalJson(whole[column]))) throw new StaleReadError();
      return whole;
    });
  }, "complete");
  const attempt = /* @__PURE__ */ __name(async (fn) => {
    const read = /* @__PURE__ */ new Map();
    const ranged = /* @__PURE__ */ new Map();
    const writes = /* @__PURE__ */ new Map();
    const deleted = [];
    const aggregates = /* @__PURE__ */ new Map();
    let open = true;
    let failure;
    const step = /* @__PURE__ */ __name((method) => (...args) => {
      if (!open) throw new DatabaseTransactionError("The transaction has ended.");
      const fail4 = /* @__PURE__ */ __name((error) => {
        failure ??= { error };
        throw error;
      }, "fail");
      try {
        const result = method(...args);
        return result instanceof Promise ? result.catch(fail4) : result;
      } catch (error) {
        return fail4(error);
      }
    }, "step");
    const remember = /* @__PURE__ */ __name((model, key, row) => {
      const id = idOf(model.table.name, key);
      const known = read.get(id);
      if (known !== void 0 && (known && row ? versionOf(known) !== versionOf(row) : known !== row)) throw new StaleReadError();
      read.set(id, row);
      return row;
    }, "remember");
    const readRow = /* @__PURE__ */ __name(({ table }, row) => {
      const id = idOf(table.name, rowKey(table, row));
      const known = read.get(id) ?? ranged.get(id);
      if (known && versionOf(known) === versionOf(row)) return known;
      throw misuse(table.name, "update and delete take a row this transaction read.");
    }, "readRow");
    const checkFields = /* @__PURE__ */ __name(({ table, definition: { fields } }, values, creating) => {
      for (const field of Object.keys(values)) if (!(field in fields) || !creating && table.key.includes(field)) throw misuse(table.name, `${field} cannot be ${creating ? "set" : "changed"}.`);
      for (const [field, { required }] of Object.entries(fields)) if (required !== false && (creating || field in values) && !isKeyed(values[field])) throw misuse(table.name, `${field} is required.`);
    }, "checkFields");
    const bump = /* @__PURE__ */ __name((model, key, by) => {
      const id = idOf(model.table.name, key);
      const pending = writes.get(id);
      if (pending === void 0) writes.set(id, {
        model,
        key,
        type: "increment",
        row: { ...by }
      });
      else if (pending.type !== "delete") for (const [column, delta] of Object.entries(by)) pending.row[column] = Number(pending.row[column] ?? pending.read?.[column] ?? 0) + delta;
      else if (Object.values(by).some((delta) => delta > 0)) throw new DatabaseConstraintError("not_found", model.table.name);
    }, "bump");
    const touchParents = /* @__PURE__ */ __name((model, before, after) => {
      for (const { field, counter, target } of model.references) {
        const [from, to] = [before?.[field], after?.[field]];
        if (counter === void 0 || from === to) continue;
        if (isKeyed(from)) bump(modelOf(target), [from], { [counter]: -1 });
        if (isKeyed(to)) bump(modelOf(target), [to], { [counter]: 1 });
      }
      for (const [index, root] of model.roots) {
        const parent = modelOf(root);
        const { eq } = model.table.indexes.find(({ name }) => name === index);
        for (const row of [before, after]) {
          const key = eq.slice(0, parent.table.key.length).map((field) => row?.[field]);
          if (row && key.every(isKeyed)) bump(parent, key, {});
        }
      }
    }, "touchParents");
    const derive = /* @__PURE__ */ __name(({ definition }, row) => {
      if (definition.kind === "table") for (const [name, derived] of Object.entries(definition.derived)) row[name] = derived.compute(row);
      return row;
    }, "derive");
    const remove = /* @__PURE__ */ __name(async (model, known) => {
      const { table } = model;
      const key = rowKey(table, known);
      const id = idOf(table.name, key);
      const pending = writes.get(id);
      if (pending?.type === "delete") return;
      if (pending && pending.type !== "increment") throw once(table.name);
      writes.set(id, {
        model,
        key,
        type: "delete",
        row: {},
        read: known
      });
      touchParents(model, known, null);
      for (const reference of model.referencedBy) {
        const { counter, field, onDelete, table: name } = reference;
        if (counter === void 0) continue;
        const stored2 = Number(known[counter] ?? 0);
        const added = Number(pending?.row[counter] ?? 0);
        if (added > 0) throw new DatabaseConstraintError("referenced", table.name);
        if (stored2 + added <= 0) continue;
        if (onDelete === "restrict") {
          const [current] = await adapter.get(table, [key]);
          if (current && versionOf(current) === versionOf(known)) throw new DatabaseConstraintError("referenced", table.name);
          throw new StaleReadError();
        }
        const child = modelOf(name);
        const index = child.table.indexes.find(({ eq }) => eq.length === 1 && eq[0] === field);
        let cursor;
        let seen = 0;
        do {
          const page2 = await reads.findMany(name, {
            index: index.name,
            where: { [field]: key[0] },
            limit: Math.min(stored2 - seen, reads.maxPageSize),
            ...cursor === void 0 ? {} : { cursor }
          });
          for (const row of await complete(child, page2.rows)) {
            remember(child, rowKey(child.table, row), row);
            await remove(child, row);
          }
          seen += page2.rows.length;
          cursor = page2.next;
        } while (cursor !== void 0 && seen < stored2);
      }
      deleted.push(id);
    }, "remove");
    const tx = {
      findOne: step(async (name, lookup) => {
        const model = modelOf(name);
        const { table } = model;
        const found = await reads.findOne(name, lookup);
        if (found === null && !table.key.every((field) => field in lookup)) return null;
        const [row = null] = found ? await complete(model, [found]) : [];
        const key = row ? rowKey(table, row) : table.key.map((field) => lookup[field]);
        return remember(model, key, row);
      }),
      findMany: step(async (name, input) => {
        const model = modelOf(name);
        const root = model.roots.get(input.index);
        if (root === void 0) throw new DatabaseQueryError(`${name}.${input.index} is not rooted; a transaction reads a range only under a guarded parent.`);
        const parent = modelOf(root);
        const { eq } = model.table.indexes.find(({ name: index }) => index === input.index);
        const where = input.where ?? {};
        const lookup = Object.fromEntries(parent.table.key.map((field, at) => [field, where[eq[at]]]));
        remember(parent, Object.values(lookup), await reads.findOne(root, lookup));
        const found = await reads.findMany(name, input);
        const rows = await complete(model, found.rows);
        for (const row of rows) ranged.set(idOf(name, rowKey(model.table, row)), row);
        return {
          ...found,
          rows
        };
      }),
      create: step((name, values) => {
        const model = modelOf(name);
        checkFields(model, values, true);
        const defaults = model.table.columns.flatMap((column) => column.nullable || column.default !== void 0 ? [[column.name, column.default ?? null]] : []);
        const row = derive(model, {
          ...Object.fromEntries(defaults),
          ...values
        });
        const key = rowKey(model.table, row);
        const id = idOf(name, key);
        const pending = writes.get(id);
        if (pending && pending.type !== "increment") throw once(name);
        for (const [column, delta] of Object.entries(pending?.row ?? {})) row[column] = Number(row[column]) + Number(delta);
        writes.set(id, {
          model,
          key,
          type: "insert",
          row
        });
        touchParents(model, null, row);
      }),
      update: step((name, row, set) => {
        const model = modelOf(name);
        const known = readRow(model, row);
        checkFields(model, set, false);
        const key = rowKey(model.table, known);
        const id = idOf(name, key);
        const pending = writes.get(id);
        if (pending?.type === "insert" || pending?.type === "delete") throw once(name);
        const before = pending?.type === "patch" ? {
          ...known,
          ...pending.row
        } : known;
        const next = derive(model, {
          ...before,
          ...set
        });
        const changed = Object.entries(next).filter(([column, value]) => column !== "_v" && JSON.stringify(value) !== JSON.stringify(known[column]));
        const patch = Object.fromEntries(changed);
        writes.set(id, {
          model,
          key,
          type: "patch",
          row: patch,
          read: known
        });
        if (pending?.type === "increment") bump(model, key, pending.row);
        touchParents(model, before, next);
      }),
      delete: step(async (name, row) => {
        const model = modelOf(name);
        await remove(model, readRow(model, row));
      }),
      aggregate: step((name, identity, values, options) => {
        const model = modelOf(name, "aggregate");
        recordAggregate(aggregates, model, identity, values, options?.shardBy);
      })
    };
    try {
      const result = await (transactionScope ? transactionScope.run(tx, () => fn(tx)) : fn(tx));
      if (failure) throw failure.error;
      return {
        result,
        read,
        ops: compile2(writes, read, deleted),
        aggregates: [...aggregates.values()]
      };
    } catch (error) {
      throw failure?.error instanceof StaleReadError ? failure.error : error;
    } finally {
      open = false;
    }
  }, "attempt");
  const compile2 = /* @__PURE__ */ __name((writes, read, deleted) => {
    const toOp = /* @__PURE__ */ __name((id) => {
      const { model, key, type, row, read: previous } = writes.get(id);
      const { table } = model;
      if (type === "insert") return {
        type,
        table,
        row
      };
      if (type === "increment") {
        const known = read.get(id);
        const by = row;
        return known ? {
          type,
          table,
          key,
          by,
          guard: { v: versionOf(known) }
        } : {
          type,
          table,
          key,
          by
        };
      }
      const guard = { v: versionOf(previous) };
      return type === "patch" ? {
        type,
        table,
        key,
        set: row,
        guard,
        previous
      } : {
        type,
        table,
        key,
        guard,
        previous
      };
    }, "toOp");
    const checks = [...read].flatMap(([id, row]) => {
      if (row === null || writes.has(id)) return [];
      const { table } = schema.models.get(JSON.parse(id)[0]);
      const guard = { v: versionOf(row) };
      return [{
        type: "check",
        table,
        key: rowKey(table, row),
        guard
      }];
    });
    const ofType = /* @__PURE__ */ __name((...types) => [...writes.keys()].filter((id) => types.includes(writes.get(id).type)), "ofType");
    return [
      ...[...ofType("insert"), ...ofType("patch", "increment")].map(toOp),
      ...checks,
      ...deleted.map(toOp)
    ];
  }, "compile");
  const classify = /* @__PURE__ */ __name(async (op, read) => {
    if (op.type === "check" || op.type === "delete") return void 0;
    if (op.type === "increment" && op.guard) return void 0;
    const { table } = op;
    const key = op.type === "insert" ? rowKey(table, op.row) : op.key;
    const [current] = await adapter.get(table, [key]);
    if (op.type === "increment") return current ? void 0 : "not_found";
    if (op.type === "insert" && current) {
      const known = read.get(idOf(table.name, key));
      return known === null || known !== void 0 && versionOf(known) !== versionOf(current) ? void 0 : "exists";
    }
    if (op.type === "patch" && current?.["_v"] !== op.guard.v) return;
    const row = op.type === "insert" ? op.row : {
      ...current,
      ...op.set
    };
    for (const index of table.indexes) {
      if (!index.unique) continue;
      for (const eq of indexEntries(table, index, row)) if ((await adapter.query(table, {
        index: index.name,
        eq,
        order: "asc",
        limit: 2
      })).some((other) => compareTuples(rowKey(table, other), key))) return "unique";
    }
  }, "classify");
  return { async transaction(fn) {
    assertOutsideTransaction();
    let run3;
    let negative;
    for (let round = 0; round < attempts; round += 1) {
      const delay = round && Math.min(maxDelayMs, baseDelayMs * 2 ** (round - 1));
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay / 2 + Math.random() * (delay / 2)));
      run3 ??= await attempt(fn).catch((error) => {
        if (error instanceof StaleReadError) return void 0;
        throw error;
      });
      if (run3 === void 0) {
        onRetry?.("rerun", round + 1);
        continue;
      }
      let aggregates;
      try {
        aggregates = await compileAggregates(adapter, run3.aggregates);
      } catch (error) {
        if (!(error instanceof NegativeGaugeError)) throw error;
        negative = error;
        onRetry?.("rerun", round + 1);
        run3 = void 0;
        continue;
      }
      const ops = [...run3.ops, ...aggregates];
      if (ops.length <= 1 && ops.every(({ type }) => type === "check")) return run3.result;
      if (!adapter.fits(ops)) throw new DatabaseConstraintError("too_large", ops[0].table.name);
      let outcome;
      try {
        outcome = await adapter.write(ops);
      } catch (cause) {
        throw new DatabaseAmbiguousCommitError("The commit outcome is unknown.", { cause });
      }
      if (outcome.ok) return run3.result;
      const failed2 = "failedOp" in outcome ? outcome.failedOp : void 0;
      if (failed2 === void 0 || failed2 >= run3.ops.length) {
        onRetry?.("resend", round + 1);
        continue;
      }
      const reason = await classify(ops[failed2], run3.read);
      if (reason) throw new DatabaseConstraintError(reason, ops[failed2].table.name);
      onRetry?.("rerun", round + 1);
      run3 = void 0;
    }
    throw negative ?? new DatabaseConflictError(`The transaction conflicted ${attempts} times.`);
  } };
}, "createTransactions");

// ../plugin-core/dist/engine/database/engineReads.mjs
var sameFields = /* @__PURE__ */ __name((left, right) => left.length === right.length && left.every((field) => right.includes(field)), "sameFields");
var keyValue = /* @__PURE__ */ __name((value, field) => {
  if (isKeyValue(value)) return value;
  throw new DatabaseQueryError(`${field} needs a string, number, or boolean.`);
}, "keyValue");
var bound = /* @__PURE__ */ __name((exclusive, inclusive, columns) => {
  if (exclusive !== void 0 && inclusive !== void 0) throw new DatabaseQueryError(`range on ${columns[0]} sets both bounds of one side.`);
  const value = exclusive ?? inclusive;
  if (value === void 0) return void 0;
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > columns.length) throw new DatabaseQueryError(`range on ${columns[0]} takes 1\u2013${columns.length} values of ${columns.join(", ")}.`);
  return {
    values: values.map((item, position) => keyValue(item, columns[position])),
    inclusive: inclusive !== void 0
  };
}, "bound");
var createEngineReads = /* @__PURE__ */ __name(({ adapter, schema, maxPageSize: requested = 500 }) => {
  const maxPageSize = Math.min(requested, 500);
  let count = {
    calls: 0,
    rows: 0
  };
  const returned = /* @__PURE__ */ __name((rows) => {
    const size = Array.isArray(rows) ? rows.length : rows === null ? 0 : 1;
    count = {
      calls: count.calls + 1,
      rows: count.rows + size
    };
    return rows;
  }, "returned");
  const modelOf = /* @__PURE__ */ __name((name, kind = "table") => {
    const model = schema.models.get(name);
    if (model?.definition.kind === kind) return model;
    throw new DatabaseQueryError(model === void 0 ? `Unknown model ${name}.` : kind === "table" ? `${name} is an aggregate; read it with findAggregates and change it with aggregate.` : `${name} is a table; read it with findMany and change it with create, update, or delete.`);
  }, "modelOf");
  const plan = /* @__PURE__ */ __name(({ table }, input) => {
    const index = table.indexes.find(({ name }) => name === input.index);
    if (index === void 0) throw new DatabaseQueryError(`${table.name} has no index ${input.index}.`);
    const where = input.where ?? {};
    if (!sameFields(Object.keys(where), index.eq)) throw new DatabaseQueryError(`${table.name}.${index.name} reads need where on exactly: ${index.eq.join(", ") || "(none)"}.`);
    const { limit, order = "asc", range } = input;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxPageSize) throw new DatabaseQueryError(`limit must be 1\u2013${maxPageSize}.`);
    const columns = indexOrderColumns(table, index);
    const eq = index.eq.map((field) => keyValue(where[field], `${table.name}.${field}`));
    const scope = cursorScope([
      table.name,
      index.name,
      eq,
      order,
      range
    ]);
    let lower = bound(range?.gt, range?.gte, columns);
    let upper = bound(range?.lt, range?.lte, columns);
    if (input.cursor !== void 0) {
      const values = decodeCursor(scope, input.cursor);
      if (order === "asc") lower = {
        values,
        inclusive: false
      };
      else upper = {
        values,
        inclusive: false
      };
    }
    return {
      request: {
        index: index.name,
        eq,
        order,
        limit,
        ...lower === void 0 ? {} : { lower },
        ...upper === void 0 ? {} : { upper }
      },
      index,
      scope
    };
  }, "plan");
  const findByKeys = /* @__PURE__ */ __name(async (name, lookups) => {
    const { table } = modelOf(name, "table");
    const keys = lookups.map((lookup) => {
      if (!sameFields(Object.keys(lookup), table.key)) throw new DatabaseQueryError(`findByKeys on ${name} takes its key: ${table.key.join(", ")}.`);
      return table.key.map((field) => keyValue(lookup[field], `${name}.${field}`));
    });
    const rows = keys.length === 0 ? [] : await adapter.get(table, keys);
    returned(rows.filter((row) => row !== null));
    return rows.map((row) => row ?? null);
  }, "findByKeys");
  return {
    maxPageSize,
    modelOf,
    reads: {
      total: /* @__PURE__ */ __name(() => count, "total"),
      reset: /* @__PURE__ */ __name(() => {
        count = {
          calls: 0,
          rows: 0
        };
      }, "reset")
    },
    findByKeys,
    /** Reads one row by its key or by the eq fields of a unique index. */
    async findOne(name, lookup) {
      const { table } = modelOf(name, "table");
      const fields = Object.keys(lookup);
      if (sameFields(fields, table.key)) return (await findByKeys(name, [lookup]))[0];
      const index = table.indexes.find(({ unique, eq }) => unique && sameFields(fields, eq));
      if (index === void 0) throw new DatabaseQueryError(`findOne on ${name} needs its key or a unique field, not ${fields.join(", ")}.`);
      const [row] = await adapter.query(table, {
        index: index.name,
        eq: index.eq.map((field) => keyValue(lookup[field], `${name}.${field}`)),
        order: "asc",
        limit: 1
      });
      return returned(row ?? null);
    },
    /** Reads one page of an index range; `next` resumes right after it. */
    async findMany(name, input) {
      const model = modelOf(name, "table");
      const { request, index, scope } = plan(model, input);
      const rows = returned(await adapter.query(model.table, request));
      const last = rows.at(-1);
      return rows.length === input.limit && last !== void 0 ? {
        rows,
        next: encodeCursor(scope, indexOrderTuple(model.table, index, last))
      } : { rows };
    },
    /**
    * Reads one page of logical aggregate rows, summing counters and gauges
    * and merging sketches across each row's shards. A row cut off by the
    * limit is completed by reading only its remaining shards.
    */
    async findAggregates(name, input) {
      const model = modelOf(name, "aggregate");
      const { table, definition } = model;
      if (definition.kind !== "aggregate") throw new DatabaseQueryError(name);
      const { request, index, scope } = plan(model, input);
      const rows = await adapter.query(table, request);
      const logicalKey = /* @__PURE__ */ __name((row) => definition.key.map((column) => keyValue(row[column], column)), "logicalKey");
      const groups = /* @__PURE__ */ new Map();
      for (const row of rows) {
        const key = JSON.stringify(logicalKey(row));
        groups.set(key, [...groups.get(key) ?? [], row]);
      }
      const full = rows.length === input.limit;
      const last = [...groups.values()].at(-1);
      if (full && last !== void 0) {
        const seen = new Set(last.map((row) => row[SHARD_COLUMN]));
        const missing = Array.from({ length: definition.shards }, (_, shard) => shard).filter((shard) => !seen.has(shard));
        if (missing.length > 0) {
          const key = logicalKey(last[0]);
          const rest = await adapter.get(table, missing.map((shard) => [...key, shard]));
          last.push(...rest.filter((row) => row !== null));
        }
      }
      const merged = [...groups.values()].map((shards) => {
        const row = Object.fromEntries(definition.key.map((field) => [field, shards[0][field]]));
        for (const metric of [...definition.counters, ...definition.gauges]) row[metric] = shards.reduce((sum, shard) => sum + Number(shard[metric] ?? 0), 0);
        for (const metric of definition.distinct) row[metric] = mergeDistinct(shards.map((shard) => shard[metric]));
        return row;
      });
      returned(merged);
      if (!full || last === void 0) return { rows: merged };
      const tuple = indexOrderTuple(table, index, last[0]);
      return {
        rows: merged,
        next: encodeCursor(scope, tuple.slice(0, -1))
      };
    }
  };
}, "createEngineReads");

// ../plugin-core/dist/engine/database/engine.mjs
var createStorageEngine = /* @__PURE__ */ __name(({ adapter: given, schema, maxPageSize, verify, retry }) => {
  const verified = verify ? verifyAdapter(given) : void 0;
  const adapter = verified ?? given;
  const reads = createEngineReads({
    adapter,
    schema,
    maxPageSize
  });
  const { transaction } = createTransactions({
    adapter,
    schema,
    reads,
    retry
  });
  return {
    reads,
    transaction,
    /** Runs `read` and reports what it read at both boundaries (verify mode only). */
    async measureReads(read) {
      if (verified === void 0) throw new Error("measureReads needs an engine created with verify: true.");
      verified.reads.reset();
      reads.reads.reset();
      return {
        result: await read(),
        adapter: verified.reads.total(),
        engine: reads.reads.total()
      };
    }
  };
}, "createStorageEngine");

// ../plugin-core/dist/engine/database/database.mjs
var createDatabaseEngine = /* @__PURE__ */ __name(({ batching, now = Date.now, meter, ...options }) => {
  const adapter = meter ? meter.wrap(options.adapter) : options.adapter;
  const engine = createStorageEngine({
    ...options,
    adapter
  });
  const { reads } = engine;
  meter?.attach(reads.reads);
  const batches = batching && createAggregateBatches({
    engine,
    adapter,
    schema: options.schema,
    batching,
    now
  });
  const transaction = batches?.transaction ?? engine.transaction;
  const outside = /* @__PURE__ */ __name((read) => (...args) => {
    assertOutsideTransaction();
    return read(...args);
  }, "outside");
  const bare = /* @__PURE__ */ __name((row) => row && Object.fromEntries(Object.entries(row).filter(([column]) => column !== "_v")), "bare");
  const barePage = /* @__PURE__ */ __name(async (page2) => {
    const { rows, next } = await page2;
    return {
      rows: rows.map(bare),
      ...next === void 0 ? {} : { next }
    };
  }, "barePage");
  return {
    ...engine,
    /** Applies batched aggregate changes still pending: this process's buffer and the log. */
    flush: /* @__PURE__ */ __name(async () => {
      await batches?.flush();
    }, "flush"),
    dispose: /* @__PURE__ */ __name(async () => {
      await batches?.dispose();
    }, "dispose"),
    database(module) {
      const name = /* @__PURE__ */ __name((model) => module.namespace ? `${module.namespace}_${model}` : model, "name");
      return {
        findOne: outside(async (model, lookup) => bare(await reads.findOne(name(model), lookup))),
        findByKeys: outside(async (model, keys) => (await reads.findByKeys(name(model), keys)).map(bare)),
        findMany: outside((model, input) => barePage(reads.findMany(name(model), input))),
        findAggregates: outside(async (model, input) => {
          await batches?.beforeRead(name(model));
          return await barePage(reads.findAggregates(name(model), input));
        }),
        transaction: /* @__PURE__ */ __name((fn) => transaction((tx) => fn({
          findOne: /* @__PURE__ */ __name((model, lookup) => tx.findOne(name(model), lookup), "findOne"),
          findMany: /* @__PURE__ */ __name((model, input) => tx.findMany(name(model), input), "findMany"),
          create: /* @__PURE__ */ __name((model, row) => tx.create(name(model), row), "create"),
          update: /* @__PURE__ */ __name((model, row, set) => tx.update(name(model), row, set), "update"),
          delete: /* @__PURE__ */ __name((model, row) => tx.delete(name(model), row), "delete"),
          aggregate: /* @__PURE__ */ __name((model, identity, changes, options2) => tx.aggregate(name(model), identity, changes, options2), "aggregate")
        })), "transaction")
      };
    }
  };
}, "createDatabaseEngine");

// ../plugin-core/dist/engine/createEngine.mjs
var pluginTablesFix = /* @__PURE__ */ __name((database) => {
  const { createMigrator, generateSchema } = database;
  const managed = "A managed server runs only its provider's plugins, and rerunning `hot-updater init --provider <provider>` applies the provider's migrations.";
  const serverProject = "Run `hot-updater db` commands in the server's project: they load the server file named on the command line, or src/hotUpdater.* or src/db.*, and don't read hot-updater.config.ts.";
  return createMigrator !== void 0 ? `Run \`hot-updater db migrate\`. ${managed} ${serverProject}` : generateSchema !== void 0 ? `Run \`hot-updater db generate\` and apply the file it writes. ${managed} ${serverProject}` : managed;
}, "pluginTablesFix");
var createEngine = /* @__PURE__ */ __name((database, { plugins = [], now = Date.now } = {}) => {
  const modules = /* @__PURE__ */ new Map();
  for (const plugin of plugins) {
    if (plugin.id === coreModule.id) throw new HotUpdaterConfigError(`Plugin id "${plugin.id}" is core's own.`);
    if (modules.has(plugin.id)) throw new HotUpdaterConfigError(`Plugin "${plugin.id}" is registered twice.`);
    modules.set(plugin.id, pluginModule(plugin));
  }
  if (modules.size > 0) validateSchema([coreModule, ...modules.values()]);
  const name = fencedName(database.adapter);
  const fenced = name === void 0 || plugins.length === 0 ? database.adapter : withSchemaFence(database.adapter, name, pluginSettings(plugins), pluginTablesFix(database));
  const batching = database.aggregateBatching;
  const schema = resolveSchema([
    coreModule,
    ...modules.values(),
    ...batching === void 0 ? [] : [aggregateBatchingModule]
  ]);
  const meter = readMeterOf(database);
  const engine = createDatabaseEngine({
    adapter: pruneDuringWrites(fenced, schema.tables, {
      leaseTable: SETTINGS_TABLE,
      now
    }),
    schema,
    ...database.retry === void 0 ? {} : { retry: database.retry },
    ...batching === void 0 ? {} : {
      batching,
      now
    },
    ...meter === void 0 ? {} : { meter }
  });
  return {
    core: engine.database(coreModule),
    database: /* @__PURE__ */ __name((plugin) => {
      const module = modules.get(plugin.id);
      if (module === void 0) throw new HotUpdaterConfigError(`Plugin "${plugin.id}" is not one of this engine's plugins.`);
      return engine.database(module);
    }, "database"),
    flush: /* @__PURE__ */ __name(() => engine.flush(), "flush"),
    dispose: /* @__PURE__ */ __name(() => engine.dispose(), "dispose")
  };
}, "createEngine");

// ../plugin-core/dist/engine/database/sql/sqlAdapter.mjs
var WRITE_GUARD_TABLE = {
  name: "_hu_write",
  columns: [{
    name: "id",
    type: "string",
    nullable: false,
    maxLength: 36
  }, {
    name: "failed_op",
    type: "integer",
    nullable: true
  }],
  key: ["id"],
  indexes: []
};
var codes = /* @__PURE__ */ __name((values) => new Set(values.split(" ")), "codes");
var UNIQUE = codes("23505 1062 23503 1451 1452 SQLITE_CONSTRAINT_UNIQUE SQLITE_CONSTRAINT_PRIMARYKEY SQLITE_CONSTRAINT_FOREIGNKEY SQLITE:2067 SQLITE:1555 SQLITE:787");
var RETRY = codes("40001 40P01 1213 1205 SQLITE_BUSY SQLITE_BUSY_SNAPSHOT SQLITE_LOCKED SQLITE:5 SQLITE:517 SQLITE:6");
var codesOf = /* @__PURE__ */ __name((error, depth = 0) => {
  if (typeof error !== "object" || error === null || depth > 3) return [];
  const record = error;
  const named = [
    "code",
    "errno",
    "sqlState",
    "extendedCode"
  ].flatMap((field) => record[field] === void 0 ? [] : [String(record[field])]);
  const sqlite = ["errcode", "rawCode"].flatMap((field) => typeof record[field] === "number" ? [`SQLITE:${record[field]}`] : []);
  return [
    ...named,
    ...sqlite,
    ...codesOf(record.cause, depth + 1)
  ];
}, "codesOf");
var classifySqlError = /* @__PURE__ */ __name((error) => {
  const found = codesOf(error);
  if (found.some((code) => UNIQUE.has(code))) return "constraint";
  return found.some((code) => RETRY.has(code)) ? "retry" : void 0;
}, "classifySqlError");
var upserts = /* @__PURE__ */ __name((op) => op.type === "increment" && op.init !== void 0 && op.guard === void 0, "upserts");
var FailedOp = class {
  static {
    __name(this, "FailedOp");
  }
  index;
  constructor(index) {
    this.index = index;
  }
};
var createSqlAdapter = /* @__PURE__ */ __name(({ executor, tablePrefix = "", maxOps = 1e3, maxParams = Number.POSITIVE_INFINITY }) => {
  const { dialect } = executor;
  const postgres = dialect === "postgresql";
  const sqlite = dialect === "sqlite";
  const lock = sqlite ? "" : " FOR UPDATE";
  const quote = /* @__PURE__ */ __name((name) => quoteSql(dialect, name), "quote");
  const tableOf = /* @__PURE__ */ __name((table, index) => quote(`${tablePrefix}${table.name}${index ? `__${index.name}` : ""}`), "tableOf");
  const version2 = quote("_v");
  const sql = /* @__PURE__ */ __name((build) => {
    const params = [];
    const bind = /* @__PURE__ */ __name((value, column) => {
      const json4 = column?.multi || column?.type === "json";
      params.push(value === null || value === void 0 ? null : json4 ? JSON.stringify(value) : typeof value === "boolean" && !postgres ? Number(value) : value);
      return postgres ? `$${params.length}${json4 ? "::jsonb" : ""}` : "?";
    }, "bind");
    return {
      sql: build(bind),
      params
    };
  }, "sql");
  const keyMatch = /* @__PURE__ */ __name((bind, table, key) => table.key.map((column, position) => `${quote(column)} = ${bind(key[position])}`).join(" AND "), "keyMatch");
  const compare2 = /* @__PURE__ */ __name((bind, columns, bound2, op) => {
    const cols = columns.slice(0, bound2.values.length).map((column) => `i.${quote(column)}`);
    const last = `${op}${bound2.inclusive ? "=" : ""}`;
    if (cols.length === 1) return `${cols[0]} ${last} ${bind(bound2.values[0])}`;
    if (dialect !== "mysql") {
      const values = bound2.values.map((value) => bind(value));
      return `(${cols.join(", ")}) ${last} (${values.join(", ")})`;
    }
    return `(${cols.map((column, position) => [...cols.slice(0, position).map((prefix, at) => `${prefix} = ${bind(bound2.values[at])}`), `${column} ${position === cols.length - 1 ? last : op} ${bind(bound2.values[position])}`].join(" AND ")).map((term) => `(${term})`).join(" OR ")})`;
  }, "compare");
  const compile2 = /* @__PURE__ */ __name((op, when) => {
    const { table } = op;
    const name = tableOf(table);
    const where = /* @__PURE__ */ __name((bind, key, v) => `${keyMatch(bind, table, key)}${v === void 0 ? "" : ` AND ${version2} = ${bind(v)}`}${when ? ` AND ${when(bind)}` : ""}`, "where");
    const insert = /* @__PURE__ */ __name((bind, into, columns, values) => `INSERT INTO ${into} (${columns.map(quote).join(", ")}) ${when ? `SELECT ${values.join(", ")} WHERE ${when(bind)}` : `VALUES (${values.join(", ")})`}`, "insert");
    const insertRow = /* @__PURE__ */ __name((bind, row) => insert(bind, name, table.columns.map((column) => column.name), table.columns.map((column) => bind(row[column.name], column))), "insertRow");
    const entries = /* @__PURE__ */ __name((key, row, changed) => table.indexes.flatMap((index) => {
      const columns = [...index.eq, ...indexOrderColumns(table, index)];
      if (!isMultiIndex(table, index) || changed && !columns.some((column) => changed.includes(column))) return [];
      const into = tableOf(table, index);
      const found = row ? indexEntries(table, index, row) : [];
      const order = found.length > 0 ? indexOrderTuple(table, index, row) : [];
      return [sql((bind) => `DELETE FROM ${into} WHERE ${where(bind, key)}`), ...found.map((eq) => sql((bind) => {
        const values = [...eq, ...order].map((value) => bind(value));
        return insert(bind, into, columns, values);
      }))];
    }), "entries");
    switch (op.type) {
      case "insert":
        return [sql((bind) => insertRow(bind, op.row)), ...entries(rowKey(table, op.row), op.row)];
      case "patch":
        return [sql((bind) => {
          const set = Object.entries(op.set).map(([column, value]) => `${quote(column)} = ${bind(value, findPhysicalColumn(table, column))}`);
          return `UPDATE ${name} SET ${[...set, `${version2} = ${version2} + 1`].join(", ")} WHERE ${where(bind, op.key, op.guard.v)}`;
        }), ...entries(op.key, {
          ...op.previous,
          ...op.set
        }, Object.keys(op.set))];
      case "delete":
        return [sql((bind) => `DELETE FROM ${name} WHERE ${where(bind, op.key, op.guard.v)}`), ...entries(op.key)];
      case "increment": {
        const deltas = [...Object.entries(op.by), ["_v", 1]];
        const bump = /* @__PURE__ */ __name((bind, qualify = "") => deltas.map(([column, delta]) => `${quote(column)} = ${qualify}${quote(column)} + ${bind(delta)}`).join(", "), "bump");
        if (!upserts(op)) return [sql((bind) => `UPDATE ${name} SET ${bump(bind)} WHERE ${where(bind, op.key, op.guard?.v)}`)];
        const row = { ...op.init };
        for (const [column, delta] of deltas) row[column] = Number(row[column] ?? 0) + delta;
        const conflict = dialect === "mysql" ? "ON DUPLICATE KEY UPDATE" : `ON CONFLICT (${table.key.map(quote).join(", ")}) DO UPDATE SET`;
        return [sql((bind) => `${insertRow(bind, row)} ${conflict} ${bump(bind, `${name}.`)}`)];
      }
      case "check":
        if (when) return [];
        return [sql((bind) => `SELECT ${version2} FROM ${name} WHERE ${where(bind, op.key)}${lock}`)];
    }
  }, "compile");
  const failure = /* @__PURE__ */ __name((bind, op, released) => {
    const { table } = op;
    const from = `SELECT 1 FROM ${tableOf(table)} WHERE`;
    const exists = /* @__PURE__ */ __name((key, v) => `EXISTS (${from} ${keyMatch(bind, table, key)}${v === void 0 ? "" : ` AND ${version2} = ${bind(v)}`}${lock})`, "exists");
    const clashes = /* @__PURE__ */ __name((row, own, changed) => table.indexes.filter((index) => index.unique && !isMultiIndex(table, index) && index.eq.every((column) => (row[column] ?? null) !== null) && (!changed || index.eq.some((column) => changed.includes(column)))).map((index) => {
      const match2 = index.eq.map((column) => `${quote(column)} = ${bind(row[column], findPhysicalColumn(table, column))}`);
      const others = [...own ? [own] : [], ...released].map((key) => ` AND NOT (${keyMatch(bind, table, key)})`);
      return `EXISTS (${from} ${match2.join(" AND ")}${others.join("")})`;
    }), "clashes");
    switch (op.type) {
      case "insert":
        return [exists(rowKey(table, op.row)), ...clashes(op.row)].join(" OR ");
      case "patch":
        return [`NOT ${exists(op.key, op.guard.v)}`, ...clashes({
          ...op.previous,
          ...op.set
        }, op.key, Object.keys(op.set))].join(" OR ");
      default:
        return `NOT ${exists(op.key, op.guard?.v)}`;
    }
  }, "failure");
  const batchWrite = /* @__PURE__ */ __name((ops, id) => {
    const guard = tableOf(WRITE_GUARD_TABLE);
    const [idColumn, failed2] = ["id", "failed_op"].map(quote);
    const byId = /* @__PURE__ */ __name((bind) => `${idColumn} = ${bind(id)}`, "byId");
    const released = /* @__PURE__ */ __name((table) => ops.flatMap((op) => (op.type === "delete" || op.type === "patch") && op.table.name === table ? [op.key] : []), "released");
    const when = /* @__PURE__ */ __name((bind) => `(SELECT ${failed2} FROM ${guard} WHERE ${byId(bind)}) IS NULL`, "when");
    return [
      sql((bind) => `INSERT INTO ${guard} (${idColumn}, ${failed2}) VALUES (${bind(id)}, NULL)`),
      ...ops.flatMap((op, position) => upserts(op) ? [] : [sql((bind) => `UPDATE ${guard} SET ${failed2} = ${position} WHERE ${failed2} IS NULL AND (${failure(bind, op, released(op.table.name))}) AND ${byId(bind)}`)]),
      ...ops.flatMap((op) => compile2(op, when)),
      sql((bind) => `SELECT ${failed2} FROM ${guard} WHERE ${byId(bind)}`),
      sql((bind) => `DELETE FROM ${guard} WHERE ${byId(bind)}`)
    ];
  }, "batchWrite");
  const read = /* @__PURE__ */ __name(async (table, statement) => {
    const { rows } = await executor.execute(statement);
    return rows.map((row) => normalizeStoredRow(table, row, { jsonText: sqlite }));
  }, "read");
  return {
    id: `sql:${dialect}`,
    fits: /* @__PURE__ */ __name((ops) => ops.length <= maxOps, "fits"),
    async get(table, keys) {
      const size = Math.max(1, Math.floor(maxParams / table.key.length));
      const found = /* @__PURE__ */ new Map();
      for (let start = 0; start < keys.length; start += size) {
        const chunk = keys.slice(start, start + size);
        const statement = sql((bind) => {
          const where = chunk.map((key) => `(${keyMatch(bind, table, key)})`);
          return `SELECT * FROM ${tableOf(table)} WHERE ${where.join(" OR ")}`;
        });
        for (const row of await read(table, statement)) found.set(JSON.stringify(rowKey(table, row)), row);
      }
      return keys.map((key) => found.get(JSON.stringify(key)) ?? null);
    },
    async query(table, request) {
      const index = findPhysicalIndex(table, request.index);
      if (!Number.isSafeInteger(request.limit) || request.limit < 1) throw new RangeError("query limit must be a positive integer.");
      const order = indexOrderColumns(table, index);
      const multi = isMultiIndex(table, index);
      const source = multi ? `${tableOf(table, index)} i JOIN ${tableOf(table)} b ON ${table.key.map((column) => `b.${quote(column)} = i.${quote(column)}`).join(" AND ")}` : `${tableOf(table)} i`;
      const direction = request.order === "asc" ? "ASC" : "DESC";
      const statement = sql((bind) => {
        const conditions = [
          ...index.eq.map((column, position) => `i.${quote(column)} = ${bind(request.eq[position])}`),
          ...request.lower ? [compare2(bind, order, request.lower, ">")] : [],
          ...request.upper ? [compare2(bind, order, request.upper, "<")] : []
        ];
        return `SELECT ${multi ? "b" : "i"}.* FROM ${source}${conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY ${order.map((column) => `i.${quote(column)} ${direction}`).join(", ")} LIMIT ${request.limit}`;
      });
      return read(table, statement);
    },
    async write(ops) {
      try {
        if (executor.batch) {
          const statements = batchWrite(ops, crypto.randomUUID());
          const failed2 = (await executor.batch(statements)).at(-2)?.rows[0]?.failed_op ?? null;
          return failed2 === null ? { ok: true } : {
            ok: false,
            failedOp: Number(failed2)
          };
        }
        await executor.transaction(async (connection) => {
          for (const [position, op] of ops.entries()) {
            const [first, ...rest] = compile2(op);
            let result;
            try {
              result = await connection.execute(first);
            } catch (error) {
              if (classifySqlError(error) === "constraint") throw new FailedOp(position);
              throw error;
            }
            if (!(op.type === "check" ? result.rows.length === 1 && Number(result.rows[0]["_v"]) === op.guard.v : op.type === "insert" || upserts(op) || result.changes === 1)) throw new FailedOp(position);
            for (const statement of rest) await connection.execute(statement);
          }
        });
        return { ok: true };
      } catch (error) {
        if (error instanceof FailedOp) return {
          ok: false,
          failedOp: error.index
        };
        const kind = classifySqlError(error);
        if (kind === "retry") return {
          ok: false,
          retry: true
        };
        if (kind === "constraint" && executor.batch) return {
          ok: false,
          failedOp: 0
        };
        throw error;
      }
    },
    async prune(table, before, limit) {
      const statements = pruneStatements(dialect, table, tablePrefix, limit).map((render) => sql((bind) => render(() => bind(before))));
      return (executor.batch ? await executor.batch(statements) : await executor.transaction(async (connection) => {
        const done = [];
        for (const statement of statements) done.push(await connection.execute(statement));
        return done;
      })).at(-1)?.changes ?? 0;
    },
    migrations: { async apply(tables) {
      const created = executor.batch && !tables.includes(WRITE_GUARD_TABLE) ? [...tables, WRITE_GUARD_TABLE] : tables;
      const statements = createTableStatements(dialect, created, tablePrefix);
      for (const text of statements) await executor.execute({
        sql: text,
        params: []
      });
    } }
  };
}, "createSqlAdapter");

// ../../packages/server/dist/package.mjs
var version = "1.1.0";

// ../../packages/server/dist/version.mjs
var HOT_UPDATER_SERVER_VERSION = version;

// ../../packages/server/dist/handlerVersionRoutes.mjs
var createVersionRouteHandlers = /* @__PURE__ */ __name((plugins = []) => {
  const version2 = {
    adminProtocol: 2,
    infrastructureGeneration: 1,
    version: HOT_UPDATER_SERVER_VERSION
  };
  const adminVersion = {
    ...version2,
    plugins: [...plugins].sort()
  };
  return {
    version: /* @__PURE__ */ __name(async () => Response.json(version2), "version"),
    adminVersion: /* @__PURE__ */ __name(async () => Response.json(adminVersion), "adminVersion")
  };
}, "createVersionRouteHandlers");

// ../../packages/server/dist/plugins/official.mjs
var OFFICIAL = /* @__PURE__ */ Symbol.for("@hot-updater/server/official-plugin");
var OFFICIAL_IDS = /* @__PURE__ */ new Set([
  "insights",
  "apiKeys",
  "remoteConfig"
]);
var isOfficialPlugin = /* @__PURE__ */ __name((plugin) => typeof plugin === "object" && plugin !== null && Reflect.get(plugin, OFFICIAL) === true, "isOfficialPlugin");
var checkReservedId = /* @__PURE__ */ __name((plugin, at) => {
  const id = typeof plugin === "object" && plugin !== null ? Reflect.get(plugin, "id") : void 0;
  if (typeof id === "string" && OFFICIAL_IDS.has(id) && !isOfficialPlugin(plugin)) throw new HotUpdaterConfigError(`${at} takes the id "${id}", which is reserved for Hot Updater's ${id}() plugin; give this plugin another id.`);
}, "checkReservedId");

// ../../packages/server/dist/assembly/clientPlugins.mjs
var EXPORT_NAME = /^[A-Za-z_$][\w$]*$/u;
var UNAVAILABLE_NAMES = /* @__PURE__ */ new Set([
  "App",
  "HotUpdater",
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield"
]);
var isRecord = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null && !Array.isArray(value), "isRecord");
var clientPluginsOf = /* @__PURE__ */ __name((plugins) => {
  if (!Array.isArray(plugins)) throw new HotUpdaterConfigError("plugins must be an array of plugins.");
  const found = [];
  plugins.forEach((plugin, position) => checkReservedId(plugin, `plugins[${position}]`));
  for (const plugin of plugins) {
    if (!isRecord(plugin) || !isRecord(plugin.cli)) continue;
    const value = plugin.cli.clientPlugin;
    if (value === void 0) continue;
    const id = String(plugin.id);
    if (!isRecord(value) || typeof value.module !== "string" || value.module === "" || typeof value.name !== "string" || !EXPORT_NAME.test(value.name) || UNAVAILABLE_NAMES.has(value.name)) throw new HotUpdaterConfigError(`Plugin "${id}" cli.clientPlugin needs a module and an export name the app can import: an identifier other than a reserved word, App, or HotUpdater.`);
    const { module, name } = value;
    const named = found.find((entry) => entry.name === name);
    if (named === void 0) found.push({
      module,
      name
    });
    else if (named.module !== module) throw new HotUpdaterConfigError(`Plugin "${id}" names the client plugin "${name}" from ${module}, but another plugin names it from ${named.module}.`);
  }
  return found;
}, "clientPluginsOf");

// ../../packages/server/dist/db/releaseCatalog.mjs
var parseCompiledCatalog = /* @__PURE__ */ __name((payload, strategy) => {
  const parsed = JSON.parse(payload);
  if (typeof parsed !== "object" || parsed === null || Reflect.get(parsed, "schemaVersion") !== RELEASE_CATALOG_SCHEMA_VERSION || Reflect.get(parsed, "strategy") !== strategy || Reflect.get(parsed, "fallbackPolicy") !== RELEASE_CATALOG_FALLBACK_POLICY || !Array.isArray(Reflect.get(parsed, "releaseDescriptors"))) throw new Error("Stored Release catalog payload is invalid");
  if (strategy === "APP_VERSION" && !Array.isArray(Reflect.get(parsed, "segments"))) throw new Error("Stored app-version Release catalog is invalid");
  if (strategy === "FINGERPRINT" && !Array.isArray(Reflect.get(parsed, "releaseIndexes"))) throw new Error("Stored fingerprint Release catalog is invalid");
  return parsed;
}, "parseCompiledCatalog");
var releaseCatalogScopeKeyOf = /* @__PURE__ */ __name((input) => input.strategy === "APP_VERSION" ? createReleaseCatalogScopeKey({
  channelKey: input.channelKey,
  platform: input.platform,
  strategy: "APP_VERSION"
}) : createReleaseCatalogScopeKey({
  channelKey: input.channelKey,
  fingerprintHash: input.fingerprintHash,
  platform: input.platform,
  strategy: "FINGERPRINT"
}), "releaseCatalogScopeKeyOf");
var projectReleaseCatalogRow = /* @__PURE__ */ __name((row, input, scopeKey = releaseCatalogScopeKeyOf(input)) => {
  if (row === null || row.platform !== input.platform || row.strategy !== input.strategy || row.channel_key !== input.channelKey || row.scope_key !== scopeKey || row.fingerprint_hash !== (input.strategy === "FINGERPRINT" ? input.fingerprintHash : null)) return null;
  const compiled = parseCompiledCatalog(row.payload, input.strategy);
  const appVersion = input.strategy === "APP_VERSION" ? input.appVersion : void 0;
  return {
    catalogId: row.catalog_id,
    catalogHash: row.catalog_hash,
    fallbackPolicy: RELEASE_CATALOG_FALLBACK_POLICY,
    generation: row.generation,
    releases: projectCompiledCatalog(compiled, appVersion),
    rollbackReleases: projectCompiledRollbackCatalog(compiled, appVersion),
    schemaVersion: RELEASE_CATALOG_SCHEMA_VERSION,
    scopeKey
  };
}, "projectReleaseCatalogRow");

// ../../packages/server/dist/db/updateArtifacts.mjs
var HBC_ASSET_PATH_RE = /\.bundle$/;
var asByteSize = /* @__PURE__ */ __name((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null, "asByteSize");
var resolveUniqueHbcAssetPath = /* @__PURE__ */ __name((manifest) => {
  const candidates = Object.keys(manifest.assets).sort((left, right) => left.localeCompare(right)).filter((candidate) => HBC_ASSET_PATH_RE.test(candidate));
  return candidates.length === 1 ? candidates[0] : null;
}, "resolveUniqueHbcAssetPath");
var isBundleManifest = /* @__PURE__ */ __name((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value;
  if (typeof manifest.bundleId !== "string") return false;
  if (!manifest.assets || typeof manifest.assets !== "object") return false;
  return Object.values(manifest.assets).every((asset) => {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) return false;
    const manifestAsset = asset;
    return typeof manifestAsset.fileHash === "string" && (manifestAsset.signature === void 0 || typeof manifestAsset.signature === "string");
  });
}, "isBundleManifest");
async function fetchBundleManifest(storageUri, readStorageText) {
  const storageText = await readStorageText(storageUri);
  if (storageText === null) return null;
  let payload;
  try {
    payload = JSON.parse(storageText);
  } catch {
    return null;
  }
  if (!isBundleManifest(payload)) return null;
  return payload;
}
__name(fetchBundleManifest, "fetchBundleManifest");
function resolveHbcPatchPlan({ currentBundle, targetBundle, targetManifest }) {
  const matchingPatch = currentBundle ? getBundlePatch(targetBundle, currentBundle.id) : null;
  const patchAssetPath = resolveUniqueHbcAssetPath(targetManifest);
  if (!currentBundle || !matchingPatch || !patchAssetPath || !matchingPatch.patchStorageUri || !matchingPatch.patchFileHash || !matchingPatch.baseFileHash) return null;
  return {
    assetPath: patchAssetPath,
    patch: {
      baseBundleId: matchingPatch.baseBundleId,
      baseFileHash: matchingPatch.baseFileHash,
      byteSize: asByteSize(matchingPatch.byteSize),
      patchFileHash: matchingPatch.patchFileHash,
      storageUri: matchingPatch.patchStorageUri
    }
  };
}
__name(resolveHbcPatchPlan, "resolveHbcPatchPlan");
function createManifestArtifactPlan({ assetBaseStorageUri, currentBundle, targetBundle, targetManifest }) {
  const patchCandidate = resolveHbcPatchPlan({
    currentBundle,
    targetBundle,
    targetManifest
  });
  return { assets: Object.entries(targetManifest.assets).map(([assetPath, asset]) => {
    const downloadByteSize = asByteSize(asset.downloadByteSize);
    const downloadPath = getManifestAssetDownloadPath(assetPath);
    const isTransformedDownload = downloadPath !== assetPath;
    const hasValidDownloadFileHash = isContentAddressedAssetFileHash(asset.downloadFileHash);
    const file = {
      byteSize: downloadByteSize !== null && (hasValidDownloadFileHash || !isTransformedDownload && asset.downloadFileHash === void 0) ? downloadByteSize : null,
      storageUri: resolveManifestAssetStorageUri({
        assetBaseStorageUri,
        assetPath: downloadPath,
        downloadFileHash: asset.downloadFileHash,
        fileHash: asset.fileHash
      })
    };
    if (isTransformedDownload) file.compression = "br";
    const patch = patchCandidate?.assetPath === assetPath ? patchCandidate.patch : null;
    return {
      assetPath,
      file,
      fileHash: asset.fileHash,
      patch
    };
  }) };
}
__name(createManifestArtifactPlan, "createManifestArtifactPlan");
async function resolveAssets(plan, resolveFileUrl) {
  const patchAsset = plan.assets.find((asset) => asset.patch !== null);
  let resolvedPatch = null;
  if (patchAsset?.patch) {
    const patchUrl = await resolveFileUrl(patchAsset.patch.storageUri);
    if (patchUrl) resolvedPatch = {
      assetPath: patchAsset.assetPath,
      patch: {
        algorithm: "bsdiff",
        baseBundleId: patchAsset.patch.baseBundleId,
        baseFileHash: patchAsset.patch.baseFileHash,
        patchFileHash: patchAsset.patch.patchFileHash,
        patchUrl,
        ...patchAsset.patch.byteSize === null ? {} : { byteSize: patchAsset.patch.byteSize }
      }
    };
  }
  const entries = await Promise.all(plan.assets.map(async (asset) => {
    let patch = resolvedPatch?.assetPath === asset.assetPath ? resolvedPatch.patch : null;
    let fileUrl = null;
    try {
      fileUrl = await resolveFileUrl(asset.file.storageUri);
    } catch (error) {
      if (!patch) throw error;
    }
    if (fileUrl && patch && asset.file.byteSize !== null && asset.patch !== null && asset.patch.byteSize !== null && asset.patch.byteSize >= asset.file.byteSize) patch = null;
    if (!fileUrl) return null;
    const changedAsset = {
      file: { url: fileUrl },
      fileHash: asset.fileHash
    };
    if (asset.file.compression) changedAsset.file.compression = asset.file.compression;
    if (patch) changedAsset.patch = patch;
    return { asset: [asset.assetPath, changedAsset] };
  }));
  if (entries.some((entry) => entry === null)) return null;
  const resolvedEntries = entries.filter((entry) => entry !== null);
  return { assets: Object.fromEntries(resolvedEntries.map((entry) => entry.asset)) };
}
__name(resolveAssets, "resolveAssets");
async function resolveManifestArtifacts({ currentBundle, resolveFileUrl, readStorageText, targetBundle }) {
  const manifestStorageUri = targetBundle ? getManifestStorageUri(targetBundle) : null;
  const manifestFileHash = targetBundle ? getManifestFileHash(targetBundle) : null;
  const assetBaseStorageUri = targetBundle ? getAssetBaseStorageUri(targetBundle) : null;
  if (!targetBundle || !manifestStorageUri || !manifestFileHash || !assetBaseStorageUri) return null;
  const targetManifest = await fetchBundleManifest(manifestStorageUri, readStorageText);
  if (!targetManifest) return null;
  const plan = createManifestArtifactPlan({
    assetBaseStorageUri,
    currentBundle,
    targetBundle,
    targetManifest
  });
  const manifestUrl = await resolveFileUrl(manifestStorageUri);
  if (!manifestUrl) return null;
  const resolved = await resolveAssets(plan, resolveFileUrl);
  if (!resolved) return null;
  let archiveUrl = null;
  const archive = targetManifest.archive;
  if (archive && isContentAddressedAssetFileHash(archive.downloadFileHash) && (asByteSize(archive.downloadByteSize) ?? 0) > 0 && (asByteSize(archive.tarByteSize) ?? 0) > 0) try {
    archiveUrl = await resolveFileUrl(getBundleArchiveStorageUri({
      manifestStorageUri,
      bundleId: targetBundle.id
    }));
  } catch {
  }
  return {
    artifactProtocolVersion: ARTIFACT_PROTOCOL_VERSION,
    assets: resolved.assets,
    manifestFileHash,
    manifestUrl,
    ...archiveUrl ? { archiveUrl } : {}
  };
}
__name(resolveManifestArtifacts, "resolveManifestArtifacts");
async function loadTargetPlan({ currentBundle, readStorageText, targetBundle }) {
  const manifestStorageUri = getManifestStorageUri(targetBundle);
  const manifestFileHash = getManifestFileHash(targetBundle);
  const assetBaseStorageUri = getAssetBaseStorageUri(targetBundle);
  if (!manifestStorageUri || !manifestFileHash || !assetBaseStorageUri) return null;
  const targetManifest = await fetchBundleManifest(manifestStorageUri, readStorageText);
  if (!targetManifest) return null;
  return {
    manifestFileHash,
    manifestStorageUri,
    plan: createManifestArtifactPlan({
      assetBaseStorageUri,
      currentBundle,
      targetBundle,
      targetManifest
    }),
    targetManifest
  };
}
__name(loadTargetPlan, "loadTargetPlan");
async function resolveManifestArtifactsV2({ currentBundle, resolveFileUrl, readStorageText, targetBundle }) {
  const target = await loadTargetPlan({
    currentBundle,
    readStorageText,
    targetBundle
  });
  if (!target) return null;
  const manifestUrl = await resolveFileUrl(target.manifestStorageUri);
  if (!manifestUrl) return null;
  const patched = target.plan.assets.find((asset) => asset.patch !== null);
  let patch;
  if (patched?.patch && !(patched.file.byteSize !== null && patched.patch.byteSize !== null && patched.patch.byteSize >= patched.file.byteSize)) try {
    const patchUrl = await resolveFileUrl(patched.patch.storageUri);
    if (patchUrl) patch = {
      algorithm: "bsdiff",
      assetPath: patched.assetPath,
      baseBundleId: patched.patch.baseBundleId,
      baseFileHash: patched.patch.baseFileHash,
      patchFileHash: patched.patch.patchFileHash,
      patchUrl,
      ...patched.patch.byteSize === null ? {} : { byteSize: patched.patch.byteSize }
    };
  } catch {
  }
  let archiveUrl = null;
  const archive = target.targetManifest.archive;
  if (archive && isContentAddressedAssetFileHash(archive.downloadFileHash) && (asByteSize(archive.downloadByteSize) ?? 0) > 0 && (asByteSize(archive.tarByteSize) ?? 0) > 0) try {
    archiveUrl = await resolveFileUrl(getBundleArchiveStorageUri({
      manifestStorageUri: target.manifestStorageUri,
      bundleId: targetBundle.id
    }));
  } catch {
  }
  return {
    artifactProtocolVersion: ARTIFACT_FILES_PROTOCOL_VERSION,
    manifestFileHash: target.manifestFileHash,
    manifestUrl,
    ...archiveUrl ? { archiveUrl } : {},
    ...patch ? { patch } : {}
  };
}
__name(resolveManifestArtifactsV2, "resolveManifestArtifactsV2");
async function resolveManifestArtifactFiles({ paths, resolveFileUrl, readStorageText, targetBundle }) {
  if (paths.length === 0 || paths.length > ARTIFACT_FILES_REQUEST_LIMIT || new Set(paths).size !== paths.length) return null;
  const target = await loadTargetPlan({
    currentBundle: null,
    readStorageText,
    targetBundle
  });
  if (!target) return null;
  const planned = new Map(target.plan.assets.map((asset) => [asset.assetPath, asset]));
  const requested = paths.map((path) => planned.get(path));
  if (requested.some((asset) => asset === void 0)) return null;
  const files = await Promise.all(requested.map(async (asset) => {
    const url = await resolveFileUrl(asset.file.storageUri);
    if (!url) return null;
    const file = { url };
    if (asset.file.compression) file.compression = asset.file.compression;
    return [asset.assetPath, file];
  }));
  if (files.some((file) => file === null)) return null;
  return { files: Object.fromEntries(files.filter((file) => file !== null)) };
}
__name(resolveManifestArtifactFiles, "resolveManifestArtifactFiles");

// ../../node_modules/.pnpm/verkit@0.4.0/node_modules/verkit/dist/comparison-DenM3wCn.js
var LETTER_DASH_NUMBER3 = "[a-zA-Z0-9-]";
var NUMERIC_IDENTIFIER3 = String.raw`0|[1-9]\d*`;
var NUMERIC_IDENTIFIER_LOOSE3 = String.raw`\d+`;
var NON_NUMERIC_IDENTIFIER3 = String.raw`\d*[a-zA-Z-]${LETTER_DASH_NUMBER3}*`;
var MAIN_VERSION3 = String.raw`(${NUMERIC_IDENTIFIER3})\.(${NUMERIC_IDENTIFIER3})\.(${NUMERIC_IDENTIFIER3})`;
var MAIN_VERSION_LOOSE3 = String.raw`(${NUMERIC_IDENTIFIER_LOOSE3})\.(${NUMERIC_IDENTIFIER_LOOSE3})\.(${NUMERIC_IDENTIFIER_LOOSE3})`;
var PRERELEASE_IDENTIFIER3 = `(?:${NON_NUMERIC_IDENTIFIER3}|${NUMERIC_IDENTIFIER3})`;
var PRERELEASE_IDENTIFIER_LOOSE3 = `(?:${NON_NUMERIC_IDENTIFIER3}|${NUMERIC_IDENTIFIER_LOOSE3})`;
var PRERELEASE3 = String.raw`(?:-(${PRERELEASE_IDENTIFIER3}(?:\.${PRERELEASE_IDENTIFIER3})*))`;
var PRERELEASE_LOOSE3 = String.raw`(?:-?(${PRERELEASE_IDENTIFIER_LOOSE3}(?:\.${PRERELEASE_IDENTIFIER_LOOSE3})*))`;
var BUILD_IDENTIFIER3 = `${LETTER_DASH_NUMBER3}+`;
var BUILD3 = String.raw`(?:\+(${BUILD_IDENTIFIER3}(?:\.${BUILD_IDENTIFIER3})*))`;
var FULL_PLAIN3 = `v?${MAIN_VERSION3}${PRERELEASE3}?${BUILD3}?`;
var LOOSE_PLAIN3 = String.raw`[v=\s]*${MAIN_VERSION_LOOSE3}${PRERELEASE_LOOSE3}?${BUILD3}?`;
var GREATER_LESS_THAN2 = "((?:<|>)?=?)";
var XRANGE_IDENTIFIER3 = String.raw`${NUMERIC_IDENTIFIER3}|x|X|\*`;
var XRANGE_IDENTIFIER_LOOSE3 = String.raw`${NUMERIC_IDENTIFIER_LOOSE3}|x|X|\*`;
var XRANGE_PLAIN2 = String.raw`[v=\s]*(${XRANGE_IDENTIFIER3})(?:\.(${XRANGE_IDENTIFIER3})(?:\.(${XRANGE_IDENTIFIER3})(?:${PRERELEASE3})?${BUILD3}?)?)?`;
var XRANGE_PLAIN_LOOSE2 = String.raw`[v=\s]*(${XRANGE_IDENTIFIER_LOOSE3})(?:\.(${XRANGE_IDENTIFIER_LOOSE3})(?:\.(${XRANGE_IDENTIFIER_LOOSE3})(?:${PRERELEASE_LOOSE3})?${BUILD3}?)?)?`;
var LONE_TILDE2 = "(?:~>?)";
var LONE_CARET2 = String.raw`(?:\^)`;
var COERCE_PLAIN3 = String.raw`(^|[^\d])(\d{1,${16}})(?:\.(\d{1,${16}}))?(?:\.(\d{1,${16}}))?`;
var COERCE3 = String.raw`${COERCE_PLAIN3}(?:$|[^\d])`;
var COERCE_FULL3 = String.raw`${COERCE_PLAIN3}(?:${PRERELEASE3})?(?:${BUILD3})?(?:$|[^\d])`;
function makeSafeRegexSource3(source) {
  const replacements = [
    [String.raw`\s`, 1],
    [String.raw`\d`, 256],
    [LETTER_DASH_NUMBER3, 250]
  ];
  for (const [token, maximum] of replacements) source = source.split(`${token}*`).join(`${token}{0,${maximum}}`).split(`${token}+`).join(`${token}{1,${maximum}}`);
  return source;
}
__name(makeSafeRegexSource3, "makeSafeRegexSource");
function safeRegex3(source, flags) {
  return new RegExp(makeSafeRegexSource3(source), flags);
}
__name(safeRegex3, "safeRegex");
var FULL3 = safeRegex3(`^${FULL_PLAIN3}$`);
var LOOSE3 = safeRegex3(`^${LOOSE_PLAIN3}$`);
var NUMERIC$13 = /^\d+$/;
function formatComparableVersion3(version2) {
  const base = `${version2.major}.${version2.minor}.${version2.patch}`;
  return version2.prerelease?.length ? `${base}-${version2.prerelease.join(".")}` : base;
}
__name(formatComparableVersion3, "formatComparableVersion");
function parse3(version2, options = {}) {
  if (typeof version2 !== "string") return version2;
  if (version2.length > 256) throw new TypeError(`Version exceeds the maximum length of 256 characters`);
  const match2 = version2.trim().match(options.loose ? LOOSE3 : FULL3);
  if (!match2) throw new TypeError(`Invalid version syntax: ${version2}`);
  const major = Number(match2[1]);
  const minor = Number(match2[2]);
  const patch = Number(match2[3]);
  if (major > Number.MAX_SAFE_INTEGER || major < 0) throw new TypeError(`Invalid major version: ${match2[1]}`);
  if (minor > Number.MAX_SAFE_INTEGER || minor < 0) throw new TypeError(`Invalid minor version: ${match2[2]}`);
  if (patch > Number.MAX_SAFE_INTEGER || patch < 0) throw new TypeError(`Invalid patch version: ${match2[3]}`);
  const prerelease = match2[4] ? match2[4].split(".").map((identifier) => {
    if (NUMERIC$13.test(identifier)) {
      const numeric = Number(identifier);
      if (numeric >= 0 && numeric < Number.MAX_SAFE_INTEGER) return numeric;
    }
    return identifier;
  }) : void 0;
  return {
    build: match2[5]?.split("."),
    major,
    minor,
    patch,
    prerelease
  };
}
__name(parse3, "parse");
var NUMERIC2 = /^\d+$/;
function compareIdentifiers2(left, right) {
  if (typeof left === "number" && typeof right === "number") return left === right ? 0 : left < right ? -1 : 1;
  const leftNumeric = NUMERIC2.test(String(left));
  const rightNumeric = NUMERIC2.test(String(right));
  const normalizedLeft = leftNumeric ? Number(left) : left;
  const normalizedRight = rightNumeric ? Number(right) : right;
  return normalizedLeft === normalizedRight ? 0 : leftNumeric && !rightNumeric ? -1 : rightNumeric && !leftNumeric ? 1 : normalizedLeft < normalizedRight ? -1 : 1;
}
__name(compareIdentifiers2, "compareIdentifiers");
function compareMainParsed2(left, right) {
  return left.major === right.major ? left.minor === right.minor ? left.patch === right.patch ? 0 : left.patch < right.patch ? -1 : 1 : left.minor < right.minor ? -1 : 1 : left.major < right.major ? -1 : 1;
}
__name(compareMainParsed2, "compareMainParsed");
function comparePrereleaseParsed2(left, right) {
  const leftPrerelease = left.prerelease;
  const rightPrerelease = right.prerelease;
  if (leftPrerelease?.length && !rightPrerelease?.length) return -1;
  if (!leftPrerelease?.length && rightPrerelease?.length) return 1;
  if (!leftPrerelease?.length && !rightPrerelease?.length) return 0;
  for (let index = 0; ; index++) {
    const leftIdentifier = leftPrerelease?.[index];
    const rightIdentifier = rightPrerelease?.[index];
    if (leftIdentifier === void 0 && rightIdentifier === void 0) return 0;
    if (rightIdentifier === void 0) return 1;
    if (leftIdentifier === void 0) return -1;
    if (leftIdentifier !== rightIdentifier) return compareIdentifiers2(leftIdentifier, rightIdentifier);
  }
}
__name(comparePrereleaseParsed2, "comparePrereleaseParsed");
function compareParsed2(left, right) {
  return compareMainParsed2(left, right) || comparePrereleaseParsed2(left, right);
}
__name(compareParsed2, "compareParsed");

// ../../node_modules/.pnpm/verkit@0.4.0/node_modules/verkit/dist/set-CC5YeoYX.js
var STRICT_COMPARATOR2 = safeRegex3(String.raw`^${GREATER_LESS_THAN2}\s*(${FULL_PLAIN3})$|^$`);
var LOOSE_COMPARATOR3 = safeRegex3(String.raw`^${GREATER_LESS_THAN2}\s*(${LOOSE_PLAIN3})$|^$`);
function formatComparator2(comparator) {
  return comparator.version ? `${comparator.operator}${formatComparableVersion3(comparator.version)}` : "";
}
__name(formatComparator2, "formatComparator");
function parseComparator2(comparator, options = {}) {
  if (typeof comparator !== "string") return comparator;
  const normalized = comparator.trim().replaceAll(/\s+/g, " ");
  const match2 = normalized.match(options.loose ? LOOSE_COMPARATOR3 : STRICT_COMPARATOR2);
  if (!match2) throw new TypeError(`Invalid comparator: ${normalized}`);
  const operator = match2[1] === "=" ? "" : match2[1] || "";
  const version2 = match2[2] ? parse3(match2[2], options) : null;
  return {
    operator,
    options,
    value: version2 ? `${operator}${formatComparableVersion3(version2)}` : "",
    version: version2
  };
}
__name(parseComparator2, "parseComparator");
function testParsedComparator2(comparator, version2) {
  if (!comparator.version) return true;
  const comparison = compareParsed2(version2, comparator.version);
  switch (comparator.operator) {
    case "":
      return comparison === 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
  }
}
__name(testParsedComparator2, "testParsedComparator");
function comparatorAllowsPrerelease2(comparator, version2) {
  const allowed = comparator.version;
  return allowed !== null && !!allowed.prerelease?.length && allowed.major === version2.major && allowed.minor === version2.minor && allowed.patch === version2.patch;
}
__name(comparatorAllowsPrerelease2, "comparatorAllowsPrerelease");
function testComparatorSet2(set, version2, options) {
  if (set.some((comparator) => !testParsedComparator2(comparator, version2))) return false;
  return !version2.prerelease?.length || !!options.includePrerelease || set.some((comparator) => comparatorAllowsPrerelease2(comparator, version2));
}
__name(testComparatorSet2, "testComparatorSet");
function parsedComparatorsIntersect(left, right, options = {}) {
  if (!left.version || !right.version) return true;
  if (left.operator === "") return testComparatorSet2([right], left.version, options);
  if (right.operator === "") return testComparatorSet2([left], right.version, options);
  const leftValue = formatComparator2(left);
  const rightValue = formatComparator2(right);
  if (options.includePrerelease && (leftValue === "<0.0.0-0" || rightValue === "<0.0.0-0")) return false;
  if (!options.includePrerelease && (leftValue.startsWith("<0.0.0") || rightValue.startsWith("<0.0.0"))) return false;
  if (left.operator.startsWith(">") && right.operator.startsWith(">")) return true;
  if (left.operator.startsWith("<") && right.operator.startsWith("<")) return true;
  const comparison = compareParsed2(left.version, right.version);
  if (comparison === 0 && left.operator.includes("=") && right.operator.includes("=")) return true;
  if (comparison < 0 && left.operator.startsWith(">") && right.operator.startsWith("<")) return true;
  return comparison > 0 && left.operator.startsWith("<") && right.operator.startsWith(">");
}
__name(parsedComparatorsIntersect, "parsedComparatorsIntersect");

// ../../node_modules/.pnpm/verkit@0.4.0/node_modules/verkit/dist/range-DvX-Y6iv.js
var BUILD_STRIP2 = new RegExp(BUILD3, "g");
var BUILD_SAFE2 = safeRegex3(BUILD3);
var STRICT_HYPHEN2 = safeRegex3(String.raw`^\s*(${XRANGE_PLAIN2})\s+-\s+(${XRANGE_PLAIN2})\s*$`);
var LOOSE_HYPHEN2 = safeRegex3(String.raw`^\s*(${XRANGE_PLAIN_LOOSE2})\s+-\s+(${XRANGE_PLAIN_LOOSE2})\s*$`);
var COMPARATOR_TRIM2 = safeRegex3(String.raw`(\s*)${GREATER_LESS_THAN2}\s*(${LOOSE_PLAIN3}|${XRANGE_PLAIN2})`, "g");
var TILDE_TRIM2 = safeRegex3(String.raw`(\s*)${LONE_TILDE2}\s+`, "g");
var CARET_TRIM2 = safeRegex3(String.raw`(\s*)${LONE_CARET2}\s+`, "g");
var STRICT_TILDE2 = safeRegex3(`^${LONE_TILDE2}${XRANGE_PLAIN2}$`);
var LOOSE_TILDE2 = safeRegex3(`^${LONE_TILDE2}${XRANGE_PLAIN_LOOSE2}$`);
var STRICT_CARET2 = safeRegex3(`^${LONE_CARET2}${XRANGE_PLAIN2}$`);
var LOOSE_CARET2 = safeRegex3(`^${LONE_CARET2}${XRANGE_PLAIN_LOOSE2}$`);
var STRICT_XRANGE2 = safeRegex3(String.raw`^${GREATER_LESS_THAN2}\s*${XRANGE_PLAIN2}$`);
var LOOSE_XRANGE2 = safeRegex3(String.raw`^${GREATER_LESS_THAN2}\s*${XRANGE_PLAIN_LOOSE2}$`);
var STAR2 = safeRegex3(String.raw`(<|>)?=?\s*\*`);
var GTE_ZERO2 = /^\s*>=\s*0\.0\.0\s*$/;
var GTE_ZERO_PRERELEASE2 = /^\s*>=\s*0\.0\.0-0\s*$/;
var LOOSE_COMPARATOR4 = safeRegex3(String.raw`^${GREATER_LESS_THAN2}\s*(${LOOSE_PLAIN3})$|^$`);
function isWildcard2(value) {
  return !value || String(value).toLowerCase() === "x" || String(value) === "*";
}
__name(isWildcard2, "isWildcard");
function hasInvalidWildcardOrder2(major, minor, patch) {
  return isWildcard2(major) && !isWildcard2(minor) || isWildcard2(minor) && Boolean(patch) && !isWildcard2(patch);
}
__name(hasInvalidWildcardOrder2, "hasInvalidWildcardOrder");
function replaceTilde2(comparator, options) {
  const expression = options.loose ? LOOSE_TILDE2 : STRICT_TILDE2;
  const lowerPrerelease = options.includePrerelease ? "-0" : "";
  return comparator.replace(expression, (_match, major, minor, patch, prerelease) => {
    if (isWildcard2(major)) return "";
    if (isWildcard2(minor)) return `>=${major}.0.0${lowerPrerelease} <${Number(major) + 1}.0.0-0`;
    if (isWildcard2(patch)) return `>=${major}.${minor}.0${lowerPrerelease} <${major}.${Number(minor) + 1}.0-0`;
    return prerelease ? `>=${major}.${minor}.${patch}-${prerelease} <${major}.${Number(minor) + 1}.0-0` : `>=${major}.${minor}.${patch} <${major}.${Number(minor) + 1}.0-0`;
  });
}
__name(replaceTilde2, "replaceTilde");
function replaceTildes2(comparator, options) {
  return comparator.trim().split(/\s+/).map((part) => replaceTilde2(part, options)).join(" ");
}
__name(replaceTildes2, "replaceTildes");
function replaceCaret2(comparator, options) {
  const expression = options.loose ? LOOSE_CARET2 : STRICT_CARET2;
  const lowerPrerelease = options.includePrerelease ? "-0" : "";
  return comparator.replace(expression, (_match, major, minor, patch, prerelease) => {
    if (isWildcard2(major)) return "";
    if (isWildcard2(minor)) return `>=${major}.0.0${lowerPrerelease} <${Number(major) + 1}.0.0-0`;
    if (isWildcard2(patch)) return major === "0" ? `>=${major}.${minor}.0${lowerPrerelease} <${major}.${Number(minor) + 1}.0-0` : `>=${major}.${minor}.0${lowerPrerelease} <${Number(major) + 1}.0.0-0`;
    if (prerelease) return major === "0" ? minor === "0" ? `>=${major}.${minor}.${patch}-${prerelease} <${major}.${minor}.${Number(patch) + 1}-0` : `>=${major}.${minor}.${patch}-${prerelease} <${major}.${Number(minor) + 1}.0-0` : `>=${major}.${minor}.${patch}-${prerelease} <${Number(major) + 1}.0.0-0`;
    return major === "0" ? minor === "0" ? `>=${major}.${minor}.${patch} <${major}.${minor}.${Number(patch) + 1}-0` : `>=${major}.${minor}.${patch} <${major}.${Number(minor) + 1}.0-0` : `>=${major}.${minor}.${patch} <${Number(major) + 1}.0.0-0`;
  });
}
__name(replaceCaret2, "replaceCaret");
function replaceCarets2(comparator, options) {
  return comparator.trim().split(/\s+/).map((part) => replaceCaret2(part, options)).join(" ");
}
__name(replaceCarets2, "replaceCarets");
function replaceXRange2(comparator, options) {
  const expression = options.loose ? LOOSE_XRANGE2 : STRICT_XRANGE2;
  return comparator.trim().replace(expression, (match2, rawOperator, rawMajor, rawMinor, rawPatch) => {
    let operator = rawOperator;
    let major = rawMajor;
    let minor = rawMinor;
    let patch = rawPatch;
    if (hasInvalidWildcardOrder2(String(major), minor === void 0 ? void 0 : String(minor), patch === void 0 ? void 0 : String(patch))) return comparator;
    const wildcardMajor = isWildcard2(major);
    const wildcardMinor = wildcardMajor || isWildcard2(minor);
    const wildcardPatch = wildcardMinor || isWildcard2(patch);
    if (operator === "=" && wildcardPatch) operator = "";
    if (wildcardMajor) return operator === ">" || operator === "<" ? "<0.0.0-0" : "*";
    let prerelease = options.includePrerelease ? "-0" : "";
    if (operator && wildcardPatch) {
      if (wildcardMinor) minor = 0;
      patch = 0;
      if (operator === ">") {
        operator = ">=";
        if (wildcardMinor) {
          major = Number(major) + 1;
          minor = 0;
        } else minor = Number(minor) + 1;
      } else if (operator === "<=") {
        operator = "<";
        if (wildcardMinor) major = Number(major) + 1;
        else minor = Number(minor) + 1;
      }
      if (operator === "<") prerelease = "-0";
      return `${operator}${major}.${minor}.${patch}${prerelease}`;
    }
    if (wildcardMinor) return `>=${major}.0.0${prerelease} <${Number(major) + 1}.0.0-0`;
    if (wildcardPatch) return `>=${major}.${minor}.0${prerelease} <${major}.${Number(minor) + 1}.0-0`;
    return match2;
  });
}
__name(replaceXRange2, "replaceXRange");
function replaceXRanges2(comparator, options) {
  return comparator.split(/\s+/).map((part) => replaceXRange2(part, options)).join(" ");
}
__name(replaceXRanges2, "replaceXRanges");
function replaceHyphenRange2(range, options) {
  const expression = options.loose ? LOOSE_HYPHEN2 : STRICT_HYPHEN2;
  return range.replace(expression, (_match, rawFrom, fromMajor, fromMinor, fromPatch, fromPrerelease, _fromBuild, rawTo, toMajor, toMinor, toPatch, toPrerelease) => {
    let from = rawFrom;
    let to = rawTo;
    if (isWildcard2(fromMajor)) from = "";
    else if (isWildcard2(fromMinor)) from = `>=${fromMajor}.0.0${options.includePrerelease ? "-0" : ""}`;
    else if (isWildcard2(fromPatch)) from = `>=${fromMajor}.${fromMinor}.0${options.includePrerelease ? "-0" : ""}`;
    else if (fromPrerelease) from = `>=${from}`;
    else from = `>=${from}${options.includePrerelease ? "-0" : ""}`;
    if (isWildcard2(toMajor)) to = "";
    else if (isWildcard2(toMinor)) to = `<${Number(toMajor) + 1}.0.0-0`;
    else if (isWildcard2(toPatch)) to = `<${toMajor}.${Number(toMinor) + 1}.0-0`;
    else if (toPrerelease) to = `<=${toMajor}.${toMinor}.${toPatch}-${toPrerelease}`;
    else if (options.includePrerelease) to = `<${toMajor}.${toMinor}.${Number(toPatch) + 1}-0`;
    else to = `<=${to}`;
    return `${from} ${to}`.trim();
  });
}
__name(replaceHyphenRange2, "replaceHyphenRange");
function expandComparator2(comparator, options) {
  return replaceXRanges2(replaceTildes2(replaceCarets2(comparator.replace(BUILD_SAFE2, ""), options), options), options).trim().replace(STAR2, "");
}
__name(expandComparator2, "expandComparator");
function parseSimpleRange2(input, options) {
  let parts = replaceHyphenRange2(input.replace(BUILD_STRIP2, ""), options).replace(COMPARATOR_TRIM2, "$1$2$3").replace(TILDE_TRIM2, "$1~").replace(CARET_TRIM2, "$1^").split(" ").map((part) => expandComparator2(part, options)).join(" ").split(/\s+/).map((part) => part.trim().replace(options.includePrerelease ? GTE_ZERO_PRERELEASE2 : GTE_ZERO2, ""));
  if (options.loose) parts = parts.filter((part) => LOOSE_COMPARATOR4.test(part));
  const unique = /* @__PURE__ */ new Map();
  for (const comparator of parts.map((part) => parseComparator2(part, options))) {
    if (comparator.value === "<0.0.0-0") return [comparator];
    unique.set(comparator.value, comparator);
  }
  if (unique.size > 1) unique.delete("");
  return [...unique.values()];
}
__name(parseSimpleRange2, "parseSimpleRange");
function parseRange2(range, options = {}) {
  if (typeof range !== "string") return range;
  const parsedOptions = { ...options };
  const normalizedRange = range.trim().replaceAll(/\s+/g, " ");
  let sets = normalizedRange.split("||").map((part) => parseSimpleRange2(part.trim(), parsedOptions)).filter((set) => set.length);
  if (!sets.length) throw new TypeError(`Range contains no valid comparator sets: ${normalizedRange}`);
  if (sets.length > 1) {
    const first = sets[0];
    sets = sets.filter((set) => set[0]?.value !== "<0.0.0-0");
    if (!sets.length) sets = [first];
    else if (sets.length > 1) {
      const any = sets.find((set) => set.length === 1 && set[0]?.value === "");
      if (any) sets = [any];
    }
  }
  return {
    options: parsedOptions,
    sets
  };
}
__name(parseRange2, "parseRange");
function tryParseRange2(range, options = {}) {
  try {
    return parseRange2(range, options);
  } catch {
    return null;
  }
}
__name(tryParseRange2, "tryParseRange");
function exactVersion(set) {
  for (const comparator of set) if (comparator.operator === "" && comparator.version) return comparator.version;
  return null;
}
__name(exactVersion, "exactVersion");
function isSatisfiable(comparators, options) {
  const exact = exactVersion(comparators);
  if (exact) return testComparatorSet2(comparators, exact, options);
  const remaining = [...comparators];
  let current = remaining.pop();
  while (current && remaining.length) {
    if (remaining.some((other) => !parsedComparatorsIntersect(current, other, options))) return false;
    current = remaining.pop();
  }
  return true;
}
__name(isSatisfiable, "isSatisfiable");
function setsIntersect(left, right, options) {
  const leftExact = exactVersion(left);
  if (leftExact) return testComparatorSet2(right, leftExact, options);
  const rightExact = exactVersion(right);
  if (rightExact) return testComparatorSet2(left, rightExact, options);
  return left.every((leftComparator) => right.every((rightComparator) => parsedComparatorsIntersect(leftComparator, rightComparator, options)));
}
__name(setsIntersect, "setsIntersect");
function parsedRangesIntersect(left, right, options = {}) {
  return left.sets.some((leftSet) => isSatisfiable(leftSet, options) && right.sets.some((rightSet) => isSatisfiable(rightSet, options) && setsIntersect(leftSet, rightSet, options)));
}
__name(parsedRangesIntersect, "parsedRangesIntersect");
function isValidRange(range, options = {}) {
  return tryParseRange2(range, options) !== null;
}
__name(isValidRange, "isValidRange");
function rangesIntersect(left, right, options = {}) {
  const parsedLeft = parseRange2(left, options);
  const parsedRight = parseRange2(right, options);
  return parsedRangesIntersect(parsedLeft, parsedRight, {
    ...parsedLeft.options,
    ...parsedRight.options,
    ...options
  });
}
__name(rangesIntersect, "rangesIntersect");

// ../../packages/server/dist/core/baseCandidates.mjs
var segmentRange = /* @__PURE__ */ __name(({ lower, upper }) => lower?.inclusive && upper?.inclusive && lower.version === upper.version ? lower.version : [lower === null ? "" : `${lower.inclusive ? ">=" : ">"}${lower.version}`, upper === null ? "" : `${upper.inclusive ? "<=" : "<"}${upper.version}`].join(" ").trim() || "*", "segmentRange");
var baseBundleIdsOf = /* @__PURE__ */ __name((row, range, bundleId, limit) => {
  const catalog = parseCompiledCatalog(row.payload, row.strategy);
  const serving = new Set(catalog.strategy === "FINGERPRINT" ? catalog.rollbackReleaseIndexes : catalog.segments.flatMap((segment) => range !== null && rangesIntersect(range, segmentRange(segment)) ? segment.rollbackReleaseIndexes : []));
  const newestFirst = catalog.releaseDescriptors.map((descriptor, index) => ({
    descriptor,
    index
  })).sort((left, right) => left.descriptor.releaseId < right.descriptor.releaseId ? 1 : -1);
  const ids = [];
  for (const { descriptor, index } of newestFirst) {
    if (ids.length >= limit) break;
    const id = descriptor.bundleId;
    if (serving.has(index) && id !== null && id < bundleId && !ids.includes(id)) ids.push(id);
  }
  return ids;
}, "baseBundleIdsOf");

// ../../packages/server/dist/core/reads.mjs
var PAGE = 500;
var pick = /* @__PURE__ */ __name((fields) => (row) => Object.fromEntries(fields.map((field) => [field, row[field]])), "pick");
var toBundleRow = pick([
  "id",
  "platform",
  "git_commit_hash",
  "metadata",
  "manifest_storage_uri",
  "manifest_file_hash",
  "asset_base_storage_uri"
]);
var toPatchRow = pick([
  "id",
  "bundle_id",
  "base_bundle_id",
  "base_file_hash",
  "patch_file_hash",
  "patch_storage_uri",
  "byte_size",
  "order_index"
]);
var toReleaseRow = pick([
  "id",
  "revision",
  "scope_key",
  "channel_id",
  "platform",
  "kind",
  "bundle_id",
  "strategy",
  "target_app_version",
  "fingerprint_hash",
  "enabled",
  "should_force_update",
  "message",
  "rollout_cohort_count",
  "target_cohorts",
  "operation",
  "source_release_id",
  "created_at_ms",
  "updated_at_ms"
]);
var toCatalogRow = pick([
  "scope_key",
  "catalog_id",
  "strategy",
  "channel_id",
  "channel_key",
  "platform",
  "fingerprint_hash",
  "generation",
  "payload",
  "catalog_hash",
  "byte_size",
  "is_tombstone",
  "updated_at_ms"
]);
var toChannelRow = pick(["id", "name"]);
var drain = /* @__PURE__ */ __name(async (read) => {
  const rows = [];
  let cursor;
  do {
    const page2 = await read(cursor === void 0 ? {} : { cursor });
    rows.push(...page2.rows);
    cursor = page2.next;
  } while (cursor !== void 0);
  return rows;
}, "drain");
var createCoreReads = /* @__PURE__ */ __name((db, storage) => {
  const detail = /* @__PURE__ */ __name(async (row) => {
    const count = row._refs_bundle_patches_bundle_id ?? 0;
    const patches = [];
    let cursor;
    while (patches.length < count) {
      const page2 = await db.findMany("bundle_patches", {
        index: "byBundle",
        where: { bundle_id: row.id },
        limit: Math.min(count - patches.length, PAGE),
        ...cursor === void 0 ? {} : { cursor }
      });
      patches.push(...page2.rows.map(toPatchRow));
      if (page2.next === void 0) break;
      cursor = page2.next;
    }
    return {
      bundle: toBundleRow(row),
      patches,
      childCount: row._refs_bundle_patches_base_bundle_id ?? 0
    };
  }, "detail");
  const after = /* @__PURE__ */ __name((input) => input.after === void 0 ? {} : { range: (input.order ?? "asc") === "asc" ? { gt: input.after } : { lt: input.after } }, "after");
  return {
    /** The update check: one point read of its scope's catalog. */
    async getReleaseCatalog(input) {
      const scopeKey = releaseCatalogScopeKeyOf(input);
      const row = await db.findOne("release_catalogs", { scope_key: scopeKey });
      return projectReleaseCatalogRow(row === null ? null : toCatalogRow(row), input, scopeKey);
    },
    /** Artifact resolution: one batch read of both bundles and one unique read of their patch. */
    getArtifactInfo: /* @__PURE__ */ __name((async (targetBundleId, currentBundleId, artifactProtocolVersion) => {
      const { readStorageText } = storage;
      if (artifactProtocolVersion !== ARTIFACT_PROTOCOL_VERSION && artifactProtocolVersion !== ARTIFACT_FILES_PROTOCOL_VERSION || readStorageText === void 0) return null;
      const withCurrent = currentBundleId !== NIL_UUID;
      const [[target, current], patch] = await Promise.all([db.findByKeys("bundles", withCurrent ? [{ id: targetBundleId }, { id: currentBundleId }] : [{ id: targetBundleId }]), withCurrent ? db.findOne("bundle_patches", {
        bundle_id: targetBundleId,
        base_bundle_id: currentBundleId
      }) : null]);
      if (target === null || target === void 0) return null;
      const input = {
        currentBundle: current ? rowToBundle(toBundleRow(current)) : null,
        readStorageText,
        resolveFileUrl: storage.resolveFileUrl,
        targetBundle: rowToBundle(toBundleRow(target), patch === null ? [] : [toPatchRow(patch)])
      };
      return artifactProtocolVersion === ARTIFACT_FILES_PROTOCOL_VERSION ? resolveManifestArtifactsV2(input) : resolveManifestArtifacts(input);
    }), "getArtifactInfo"),
    /** A Bundle's file URLs: one point read of the bundle and its manifest. */
    async getArtifactFiles(bundleId, paths) {
      const { readStorageText } = storage;
      if (readStorageText === void 0) return null;
      const row = await db.findOne("bundles", { id: bundleId });
      if (row === null) return null;
      return resolveManifestArtifactFiles({
        paths,
        readStorageText,
        resolveFileUrl: storage.resolveFileUrl,
        targetBundle: rowToBundle(toBundleRow(row))
      });
    },
    /** A bundle, its patches, and how many patches start from it. */
    async getBundle(id) {
      const row = await db.findOne("bundles", { id });
      return row === null ? null : detail(row);
    },
    /** One page of the patches that start from a bundle, by target bundle id. */
    /** Each base bundle's reference counter: one batch read of the bundle rows, and no patches. */
    async countBundleChildren(baseBundleIds) {
      const ids = [...new Set(baseBundleIds)];
      if (ids.length === 0) return {};
      const rows = await db.findByKeys("bundles", ids.map((id) => ({ id })));
      return Object.fromEntries(ids.map((id, position) => [id, rows[position]?._refs_bundle_patches_base_bundle_id ?? 0]));
    },
    async listPatchesFromBase(baseBundleId, input) {
      return (await db.findMany("bundle_patches", {
        index: "byBase",
        where: { base_bundle_id: baseBundleId },
        order: input.order ?? "asc",
        limit: input.limit,
        ...after(input)
      })).rows.map(toPatchRow);
    },
    /** One page of bundles with their patches, oldest or newest first, optionally for one platform. */
    async listBundles(input) {
      const page2 = input.platform === void 0 ? await db.findMany("bundles", {
        index: "all",
        where: {},
        order: input.order ?? "asc",
        limit: input.limit,
        ...after(input)
      }) : await db.findMany("bundles", {
        index: "byPlatform",
        where: { platform: input.platform },
        order: input.order ?? "asc",
        limit: input.limit,
        ...after(input)
      });
      return Promise.all(page2.rows.map(detail));
    },
    /** Bundles in total or for one platform: one counter row. */
    async countBundles(platform) {
      const { rows } = await db.findAggregates("bundle_totals", {
        index: "byPlatform",
        where: { platform_key: platform ?? "*" },
        limit: 1
      });
      return rows[0]?.bundles ?? 0;
    },
    /** Auto-patch bases for a new bundle: one point read of its scope's catalog. */
    async findBaseBundleIds(candidateKey, bundleId, limit) {
      const query2 = parseBaseCandidateKey(candidateKey);
      if (query2 === null) return [];
      const row = await db.findOne("release_catalogs", { scope_key: query2.scopeKey });
      return row === null ? [] : baseBundleIdsOf(toCatalogRow(row), query2.range, bundleId, limit);
    },
    async getRelease(id) {
      const row = await db.findOne("releases", { id });
      return row === null ? null : toReleaseRow(row);
    },
    /** One page of releases through the index its filter names. */
    async listReleases(input) {
      const { filter } = input;
      const options = {
        order: input.order ?? "asc",
        limit: input.limit,
        ...after(input)
      };
      return (filter.kind === "all" ? await db.findMany("releases", {
        index: "all",
        where: {},
        ...options
      }) : filter.kind === "bundle" ? await db.findMany("releases", {
        index: "byBundle",
        where: { bundle_id: filter.bundleId },
        ...options
      }) : filter.kind === "scope" ? filter.enabled === void 0 ? await db.findMany("releases", {
        index: "byScope",
        where: { scope_key: filter.scopeKey },
        ...options
      }) : await db.findMany("releases", {
        index: "byScopeEnabled",
        where: {
          scope_key: filter.scopeKey,
          enabled: filter.enabled
        },
        ...options
      }) : filter.enabled === void 0 ? await db.findMany("releases", {
        index: "byChannelPlatform",
        where: {
          channel_id: filter.channelId,
          platform: filter.platform
        },
        ...options
      }) : await db.findMany("releases", {
        index: "byChannelPlatformEnabled",
        where: {
          channel_id: filter.channelId,
          platform: filter.platform,
          enabled: filter.enabled
        },
        ...options
      })).rows.map(toReleaseRow);
    },
    /** A scope's newest release id: `byScope` descending, limit 1. */
    async latestReleaseId(scopeKey) {
      const { rows } = await db.findMany("releases", {
        index: "byScope",
        where: { scope_key: scopeKey },
        order: "desc",
        limit: 1
      });
      return rows[0]?.id ?? null;
    },
    async getReleaseCatalogRow(scopeKey) {
      const row = await db.findOne("release_catalogs", { scope_key: scopeKey });
      return row === null ? null : toCatalogRow(row);
    },
    async listReleaseCatalogs(input) {
      return (await db.findMany("release_catalogs", {
        index: "all",
        where: {},
        order: input.order ?? "asc",
        limit: input.limit,
        ...after(input)
      })).rows.map(toCatalogRow);
    },
    /** Every channel, by name. */
    async listChannels() {
      return (await drain((page2) => db.findMany("channels", {
        index: "all",
        where: {},
        limit: PAGE,
        ...page2
      }))).map(toChannelRow);
    },
    async findChannelByName(name) {
      const row = await db.findOne("channels", { name });
      return row === null ? null : toChannelRow(row);
    }
  };
}, "createCoreReads");

// ../../packages/server/dist/core/writes.mjs
var PAGE2 = 500;
var countBundle = /* @__PURE__ */ __name((tx, platform, delta) => {
  for (const key of [platform, "*"]) tx.aggregate("bundle_totals", { platform_key: key }, { bundles: delta });
}, "countBundle");
var insertBundle = /* @__PURE__ */ __name((tx, row) => {
  tx.create("bundles", row);
  countBundle(tx, row.platform, 1);
}, "insertBundle");
var updateBundle = /* @__PURE__ */ __name((tx, current, set) => {
  tx.update("bundles", current, set);
  if (set.platform !== void 0 && set.platform !== current.platform) {
    countBundle(tx, current.platform, -1);
    countBundle(tx, set.platform, 1);
  }
}, "updateBundle");
var deleteBundle = /* @__PURE__ */ __name(async (tx, current) => {
  await tx.delete("bundles", current);
  countBundle(tx, current.platform, -1);
}, "deleteBundle");
var replaceBundlePatches = /* @__PURE__ */ __name(async (tx, bundle, rows) => {
  const wanted = new Map(rows.map((row) => [row.id, row]));
  const count = bundle._refs_bundle_patches_bundle_id ?? 0;
  let cursor;
  for (let seen = 0; seen < count; ) {
    const page2 = await tx.findMany("bundle_patches", {
      index: "byBundle",
      where: { bundle_id: bundle.id },
      limit: Math.min(count - seen, PAGE2),
      ...cursor === void 0 ? {} : { cursor }
    });
    for (const stored2 of page2.rows) {
      const next = wanted.get(stored2.id);
      wanted.delete(stored2.id);
      if (next === void 0) {
        await tx.delete("bundle_patches", stored2);
        continue;
      }
      const set = Object.fromEntries(Object.entries(next).filter(([field, value]) => field !== "id" && stored2[field] !== value));
      if (Object.keys(set).length > 0) tx.update("bundle_patches", stored2, set);
    }
    seen += page2.rows.length;
    if (page2.next === void 0) break;
    cursor = page2.next;
  }
  for (const row of wanted.values()) tx.create("bundle_patches", row);
}, "replaceBundlePatches");
var insertChannel = /* @__PURE__ */ __name(async (db, row) => {
  for (let attempt = 1; ; attempt += 1) try {
    return await db.transaction(async (tx) => {
      const existing = await tx.findOne("channels", { name: row.name });
      if (existing !== null) return {
        row: toChannelRow(existing),
        inserted: false
      };
      tx.create("channels", row);
      return {
        row,
        inserted: true
      };
    });
  } catch (error) {
    if (attempt < 3 && error instanceof DatabaseConstraintError && (error.reason === "unique" || error.reason === "exists")) continue;
    throw error;
  }
}, "insertChannel");
var deleteChannel = /* @__PURE__ */ __name((db, id) => db.transaction(async (tx) => {
  const row = await tx.findOne("channels", { id });
  if (row === null) return {
    deleted: false,
    reason: "not_found"
  };
  if ((row._refs_releases_channel_id ?? 0) > 0) return {
    deleted: false,
    reason: "not_empty"
  };
  await tx.delete("channels", row);
  return { deleted: true };
}), "deleteChannel");

// ../../packages/server/dist/core/releases.mjs
var PAGE3 = 500;
var fail2 = /* @__PURE__ */ __name((code, message) => {
  throw new ReleaseCatalogMutationError(code, message);
}, "fail");
var checkScope = /* @__PURE__ */ __name((scope) => {
  const channelKey = encodeChannelKey(scope.channelName);
  const expected = scope.strategy === "APP_VERSION" ? createReleaseCatalogScopeKey({
    channelKey,
    platform: scope.platform,
    strategy: "APP_VERSION"
  }) : createReleaseCatalogScopeKey({
    channelKey,
    fingerprintHash: scope.fingerprintHash ?? "",
    platform: scope.platform,
    strategy: "FINGERPRINT"
  });
  if (scope.strategy === "FINGERPRINT" !== (scope.fingerprintHash !== null) || scope.scopeKey !== expected) fail2("INVALID_SCOPE", "Release catalog scope metadata is inconsistent");
}, "checkScope");
var enabledReleases = /* @__PURE__ */ __name(async (tx, scopeKey) => {
  const rows = [];
  let cursor;
  do {
    const page2 = await tx.findMany("releases", {
      index: "byScopeEnabled",
      where: {
        scope_key: scopeKey,
        enabled: true
      },
      limit: PAGE3,
      ...cursor === void 0 ? {} : { cursor }
    });
    rows.push(...page2.rows.map(toReleaseRow));
    cursor = page2.next;
  } while (cursor !== void 0);
  return rows;
}, "enabledReleases");
var latestReleaseId = /* @__PURE__ */ __name(async (tx, scopeKey) => {
  const { rows } = await tx.findMany("releases", {
    index: "byScope",
    where: { scope_key: scopeKey },
    order: "desc",
    limit: 1
  });
  return rows[0]?.id ?? null;
}, "latestReleaseId");
var writeCatalog = /* @__PURE__ */ __name(async (tx, scope, stored2, enabled, updatedAtMs) => {
  const compilation = await compileReleaseCatalog({
    strategy: scope.strategy,
    releases: enabled.map(releaseRowToRelease)
  });
  const generation = (stored2.generation ?? 0) + 1;
  if (!Number.isSafeInteger(generation)) fail2("CATALOG_GENERATION_EXHAUSTED", `Catalog "${scope.scopeKey}" exhausted its generation counter`);
  const catalog = {
    scope_key: scope.scopeKey,
    catalog_id: stored2.catalog?.catalog_id ?? createUUIDv7(),
    strategy: scope.strategy,
    channel_id: scope.channelId,
    channel_key: encodeChannelKey(scope.channelName),
    platform: scope.platform,
    fingerprint_hash: scope.fingerprintHash,
    generation,
    payload: compilation.canonicalPayload,
    catalog_hash: compilation.catalogHash,
    byte_size: compilation.byteSize,
    is_tombstone: compilation.payload.releaseDescriptors.length === 0,
    updated_at_ms: updatedAtMs
  };
  const { scope_key: _scopeKey, ...set } = catalog;
  if (stored2.row === null) tx.create("release_catalogs", catalog);
  else tx.update("release_catalogs", stored2.row, set);
  return {
    catalog,
    compilation
  };
}, "writeCatalog");
var readCatalog = /* @__PURE__ */ __name(async (tx, scopeKey) => {
  const row = await tx.findOne("release_catalogs", { scope_key: scopeKey });
  return {
    row,
    generation: row?.generation ?? null,
    catalog: row === null ? null : toCatalogRow(row)
  };
}, "readCatalog");
var assertHistory = /* @__PURE__ */ __name((stored2, hasReleases) => {
  if (stored2.catalog === null && hasReleases) fail2("CATALOG_IDENTITY_MISSING", "Catalog history is missing. Restore its catalog row from backup before rebuilding or deploying.");
}, "assertHistory");
var changeRelease = /* @__PURE__ */ __name(async (tx, { scope, change, bundle, updatedAtMs }) => {
  checkScope(scope);
  const stored2 = await readCatalog(tx, scope.scopeKey);
  const enabled = await enabledReleases(tx, scope.scopeKey);
  if (bundle !== void 0) {
    insertBundle(tx, bundle.row);
    for (const patch of bundle.patches) tx.create("bundle_patches", patch);
  }
  let before = null;
  let release;
  if (change.operation === "insert") {
    const latest = await latestReleaseId(tx, scope.scopeKey);
    assertHistory(stored2, latest !== null);
    const floor = [latest, bundle && isUUIDv7(bundle.row.id) ? bundle.row.id : null].filter((id2) => id2 !== null).sort().at(-1);
    const id = change.row.id ?? createUUIDv7After(floor ?? null);
    if (latest !== null && id <= latest) fail2("NON_MONOTONIC_RELEASE_ID", `Release "${id}" must sort after "${latest}"`);
    release = {
      ...change.row,
      id
    };
    if (release.scope_key !== scope.scopeKey || release.channel_id !== scope.channelId || release.platform !== scope.platform || release.strategy !== scope.strategy || release.fingerprint_hash !== scope.fingerprintHash || release.revision !== 1) fail2("INVALID_SCOPE", "Inserted Release does not match its catalog scope");
    tx.create("releases", release);
  } else {
    const row = await tx.findOne("releases", { id: change.id });
    if (row === null || row.scope_key !== scope.scopeKey) return fail2("RELEASE_NOT_FOUND", `Release "${change.id}" was not found in scope "${scope.scopeKey}"`);
    assertHistory(stored2, true);
    before = toReleaseRow(row);
    if (change.operation === "delete") {
      await tx.delete("releases", row);
      release = null;
    } else {
      const set = {
        ...change.update,
        revision: before.revision + 1
      };
      tx.update("releases", row, set);
      release = {
        ...before,
        ...set
      };
    }
  }
  const changedId = before?.id ?? release?.id;
  const next = [...enabled.filter(({ id }) => id !== changedId), ...release?.enabled ? [release] : []].sort((left, right) => left.id < right.id ? -1 : 1);
  const { catalog, compilation } = await writeCatalog(tx, scope, stored2, next, updatedAtMs);
  return {
    catalog,
    release,
    diagnostics: compilation.diagnostics
  };
}, "changeRelease");
var changeReleases = /* @__PURE__ */ __name((db, inputs) => {
  if (new Set(inputs.map(({ scope }) => scope.scopeKey)).size !== inputs.length) fail2("INVALID_SCOPE", "A batch cannot change one catalog scope twice");
  return db.transaction(async (tx) => {
    const results = [];
    for (const input of inputs) results.push(await changeRelease(tx, input));
    return results;
  });
}, "changeReleases");
var rebuildScope = /* @__PURE__ */ __name(async (tx, scope, updatedAtMs) => {
  checkScope(scope);
  const stored2 = await readCatalog(tx, scope.scopeKey);
  assertHistory(stored2, await latestReleaseId(tx, scope.scopeKey) !== null);
  const enabled = await enabledReleases(tx, scope.scopeKey);
  const compilation = await compileReleaseCatalog({
    strategy: scope.strategy,
    releases: enabled.map(releaseRowToRelease)
  });
  const current = stored2.catalog;
  if (current !== null && current.strategy === scope.strategy && current.channel_id === scope.channelId && current.channel_key === encodeChannelKey(scope.channelName) && current.platform === scope.platform && current.fingerprint_hash === scope.fingerprintHash && current.catalog_hash === compilation.catalogHash) return {
    catalog: current,
    current,
    changed: false,
    diagnostics: compilation.diagnostics
  };
  const written = await writeCatalog(tx, scope, stored2, enabled, updatedAtMs);
  return {
    catalog: written.catalog,
    current,
    changed: true,
    diagnostics: written.compilation.diagnostics
  };
}, "rebuildScope");

// ../../packages/server/dist/core/operations.mjs
var Preflight = class extends Error {
  static {
    __name(this, "Preflight");
  }
  result;
  constructor(result) {
    super("preflight");
    this.result = result;
  }
};
var dryRun = /* @__PURE__ */ __name(async (db, read) => {
  try {
    await db.transaction(async (tx) => {
      throw new Preflight(await read(tx));
    });
  } catch (error) {
    if (error instanceof Preflight) return error.result;
    throw error;
  }
  throw new Error("A preflight transaction returned without its result.");
}, "dryRun");
var scopeOf = /* @__PURE__ */ __name((channel, platform, fingerprintHash) => {
  const channelKey = encodeChannelKey(channel.name);
  return fingerprintHash === null ? {
    channelId: channel.id,
    channelName: channel.name,
    fingerprintHash,
    platform,
    scopeKey: createReleaseCatalogScopeKey({
      channelKey,
      platform,
      strategy: "APP_VERSION"
    }),
    strategy: "APP_VERSION"
  } : {
    channelId: channel.id,
    channelName: channel.name,
    fingerprintHash,
    platform,
    scopeKey: createReleaseCatalogScopeKey({
      channelKey,
      fingerprintHash,
      platform,
      strategy: "FINGERPRINT"
    }),
    strategy: "FINGERPRINT"
  };
}, "scopeOf");
var loadTarget = /* @__PURE__ */ __name(async (tx, { releaseId, expectedRevision }) => {
  const row = await tx.findOne("releases", { id: releaseId });
  if (row === null) throw new ReleaseManagementError("RELEASE_NOT_FOUND", `Release "${releaseId}" was not found.`);
  const release = toReleaseRow(row);
  if (expectedRevision !== void 0 && expectedRevision !== release.revision) throw new ReleaseManagementError("VERSION_CONFLICT", `Release "${release.id}" is revision ${release.revision}; expected ${expectedRevision}.`);
  const catalog = await tx.findOne("release_catalogs", { scope_key: release.scope_key });
  if (catalog === null) throw new ReleaseCatalogMutationError("INVALID_SCOPE", `Release "${release.id}" has no catalog projection.`);
  return {
    release,
    scope: {
      channelId: release.channel_id,
      channelName: decodeChannelKey(catalog.channel_key),
      fingerprintHash: release.fingerprint_hash,
      platform: release.platform,
      scopeKey: release.scope_key,
      strategy: release.strategy
    }
  };
}, "loadTarget");
var policyUpdate = /* @__PURE__ */ __name((release, patch, updatedAtMs) => {
  if (patch.fingerprintHash !== void 0 && patch.fingerprintHash !== release.fingerprint_hash) throw new ReleaseManagementError("SCOPE_MOVE_UNSUPPORTED", "Changing a fingerprint target requires an atomic Release scope move.");
  return {
    ...patch.enabled === void 0 ? {} : { enabled: patch.enabled },
    ...patch.message === void 0 ? {} : { message: patch.message },
    ...patch.rolloutCohortCount === void 0 ? {} : { rollout_cohort_count: patch.rolloutCohortCount },
    ...patch.shouldForceUpdate === void 0 ? {} : { should_force_update: patch.shouldForceUpdate },
    ...patch.targetAppVersion === void 0 ? {} : { target_app_version: patch.targetAppVersion },
    ...patch.targetCohorts === void 0 ? {} : { target_cohorts: [...patch.targetCohorts] },
    updated_at_ms: updatedAtMs
  };
}, "policyUpdate");
var mutationResult = /* @__PURE__ */ __name(({ catalog, release }) => ({
  attempts: 1,
  catalog,
  release
}), "mutationResult");
var catalogScope = /* @__PURE__ */ __name(async (tx, scopeKey) => {
  const row = await tx.findOne("release_catalogs", { scope_key: scopeKey });
  if (row === null) throw new Error(`Release catalog "${scopeKey}" was not found.`);
  return {
    channelId: row.channel_id,
    channelName: decodeChannelKey(row.channel_key),
    fingerprintHash: row.fingerprint_hash,
    platform: row.platform,
    scopeKey: row.scope_key,
    strategy: row.strategy
  };
}, "catalogScope");
var createCoreOperations = /* @__PURE__ */ __name((db, { now = Date.now } = {}) => {
  const ensureChannel = /* @__PURE__ */ __name(async (name) => (await insertChannel(db, {
    id: `channel:${encodeChannelKey(name)}`,
    name
  })).row, "ensureChannel");
  const withChannels = /* @__PURE__ */ __name(async (write) => {
    for (let attempt = 1; ; attempt += 1) try {
      return await write();
    } catch (error) {
      if (attempt < 3 && error instanceof DatabaseConstraintError && error.reason === "not_found" && error.model === "channels") continue;
      throw error;
    }
  }, "withChannels");
  const deployOnce = /* @__PURE__ */ __name(async (deployments) => {
    const channels = /* @__PURE__ */ new Map();
    for (const { release } of deployments) if (!channels.has(release.channel)) channels.set(release.channel, await ensureChannel(release.channel));
    const platforms = /* @__PURE__ */ new Map();
    for (const deployment of deployments) {
      if (!("bundleId" in deployment) || platforms.has(deployment.bundleId)) continue;
      const row = await db.findOne("bundles", { id: deployment.bundleId });
      if (row === null) throw new DatabaseBundleNotFoundError(deployment.bundleId);
      platforms.set(deployment.bundleId, toBundleRow(row).platform);
    }
    const updatedAtMs = now();
    return (await changeReleases(db, deployments.map((deployment) => {
      const { release: policy } = deployment;
      const stored2 = "bundleId" in deployment;
      const bundleId = stored2 ? deployment.bundleId : deployment.bundle.id;
      const platform = stored2 ? platforms.get(deployment.bundleId) : deployment.bundle.platform;
      const scope = scopeOf(channels.get(policy.channel), platform, policy.fingerprintHash);
      return {
        scope,
        ...stored2 ? {} : { bundle: {
          row: bundleToRow(deployment.bundle),
          patches: bundleToPatchRows(deployment.bundle)
        } },
        change: {
          operation: "insert",
          row: {
            bundle_id: bundleId,
            channel_id: scope.channelId,
            created_at_ms: updatedAtMs,
            enabled: policy.enabled,
            fingerprint_hash: policy.fingerprintHash,
            kind: "BUNDLE",
            message: policy.message,
            operation: "DEPLOY",
            platform,
            revision: 1,
            rollout_cohort_count: policy.rolloutCohortCount ?? 1e3,
            scope_key: scope.scopeKey,
            should_force_update: policy.shouldForceUpdate,
            source_release_id: null,
            strategy: scope.strategy,
            target_app_version: policy.targetAppVersion,
            target_cohorts: policy.targetCohorts ?? [],
            updated_at_ms: updatedAtMs
          }
        },
        updatedAtMs
      };
    }))).map(mutationResult);
  }, "deployOnce");
  return {
    deploy: /* @__PURE__ */ __name((deployments) => withChannels(() => deployOnce(deployments)), "deploy"),
    updateReleasePolicy: /* @__PURE__ */ __name((input) => {
      const updatedAtMs = now();
      return db.transaction(async (tx) => {
        const { release, scope } = await loadTarget(tx, input);
        return mutationResult(await changeRelease(tx, {
          scope,
          change: {
            operation: "update",
            id: release.id,
            update: policyUpdate(release, input.patch, updatedAtMs)
          },
          updatedAtMs
        }));
      });
    }, "updateReleasePolicy"),
    preflightReleasePolicy: /* @__PURE__ */ __name((input) => {
      const updatedAtMs = now();
      return dryRun(db, async (tx) => {
        const { release, scope } = await loadTarget(tx, input);
        const stored2 = await readCatalog(tx, scope.scopeKey);
        const changed = await changeRelease(tx, {
          scope,
          change: {
            operation: "update",
            id: release.id,
            update: policyUpdate(release, input.patch, updatedAtMs)
          },
          updatedAtMs
        });
        return {
          catalog: changed.catalog,
          currentCatalog: stored2.catalog,
          diagnostics: changed.diagnostics,
          expectedReleaseRevision: release.revision,
          release: changed.release
        };
      });
    }, "preflightReleasePolicy"),
    deleteRelease: /* @__PURE__ */ __name((input) => db.transaction(async (tx) => {
      const { release, scope } = await loadTarget(tx, input);
      if (release.enabled) throw new ReleaseManagementError("ENABLED_RELEASE", `Disable Release "${release.id}" before hard deletion.`);
      const bundle = release.bundle_id === null ? null : await tx.findOne("bundles", { id: release.bundle_id });
      const result = mutationResult(await changeRelease(tx, {
        scope,
        change: {
          operation: "delete",
          id: release.id
        },
        updatedAtMs: now()
      }));
      if (bundle !== null && (bundle._refs_releases_bundle_id ?? 0) <= 1) await deleteBundle(tx, bundle);
      return result;
    }), "deleteRelease"),
    promoteRelease: /* @__PURE__ */ __name((input) => withChannels(async () => {
      const checkSource = /* @__PURE__ */ __name((source) => {
        if (source.bundle_id === null) throw new ReleaseManagementError("TARGET_RELEASE_INVALID", "Only a Bundle Release can be promoted.");
      }, "checkSource");
      checkSource((await db.transaction((tx) => loadTarget(tx, input))).release);
      const targetChannel = input.targetChannel.trim();
      if (targetChannel.length === 0) throw new ReleaseManagementError("TARGET_RELEASE_INVALID", "Promotion requires a target channel.");
      const channel = await ensureChannel(targetChannel);
      const updatedAtMs = now();
      return db.transaction(async (tx) => {
        const { release: source, scope: sourceScope } = await loadTarget(tx, input);
        checkSource(source);
        const targetScope = scopeOf(channel, source.platform, source.fingerprint_hash);
        if (targetScope.scopeKey === sourceScope.scopeKey) throw new ReleaseManagementError("TARGET_RELEASE_INVALID", "Source and target Release scopes are the same.");
        const { rows } = await tx.findMany("releases", {
          index: "byScope",
          where: { scope_key: targetScope.scopeKey },
          order: "desc",
          limit: 1
        });
        const floor = [
          rows[0]?.id ?? null,
          source.id,
          source.bundle_id
        ].filter((id) => id !== null && isUUIDv7(id)).sort().at(-1);
        const moved = input.action === "move" ? await changeRelease(tx, {
          scope: sourceScope,
          change: {
            operation: "update",
            id: source.id,
            update: {
              enabled: false,
              updated_at_ms: updatedAtMs
            }
          },
          updatedAtMs
        }) : null;
        const target = await changeRelease(tx, {
          scope: targetScope,
          change: {
            operation: "insert",
            row: {
              ...source,
              id: createUUIDv7After(floor ?? null, updatedAtMs),
              revision: 1,
              scope_key: targetScope.scopeKey,
              channel_id: targetScope.channelId,
              enabled: true,
              rollout_cohort_count: 1e3,
              target_cohorts: [],
              operation: "PROMOTE",
              source_release_id: source.id,
              created_at_ms: updatedAtMs,
              updated_at_ms: updatedAtMs
            }
          },
          updatedAtMs
        });
        return {
          source: moved === null ? null : mutationResult(moved),
          target: mutationResult(target)
        };
      });
    }), "promoteRelease"),
    rebuildReleaseCatalog: /* @__PURE__ */ __name((scopeKey) => {
      const updatedAtMs = now();
      return db.transaction(async (tx) => {
        const { current: _current, ...rebuilt } = await rebuildScope(tx, await catalogScope(tx, scopeKey), updatedAtMs);
        return {
          attempts: 1,
          ...rebuilt
        };
      });
    }, "rebuildReleaseCatalog"),
    preflightReleaseCatalogRebuild: /* @__PURE__ */ __name((scopeKey) => {
      const updatedAtMs = now();
      return dryRun(db, async (tx) => {
        const rebuilt = await rebuildScope(tx, await catalogScope(tx, scopeKey), updatedAtMs);
        return {
          changed: rebuilt.changed,
          currentCatalog: rebuilt.current,
          diagnostics: rebuilt.diagnostics,
          projectedCatalog: rebuilt.catalog
        };
      });
    }, "preflightReleaseCatalogRebuild"),
    ensureChannel,
    deleteChannel: /* @__PURE__ */ __name((id) => deleteChannel(db, id), "deleteChannel"),
    updateBundle: /* @__PURE__ */ __name((id, update) => db.transaction(async (tx) => {
      const current = await tx.findOne("bundles", { id });
      if (current === null) throw new DatabaseBundleNotFoundError(id);
      const { patches, ...fields } = update;
      const next = {
        ...rowToBundle(toBundleRow(current)),
        ...fields,
        id
      };
      const { id: _id, ...set } = bundleToRow(next);
      updateBundle(tx, current, set);
      if (patches !== void 0) await replaceBundlePatches(tx, current, bundleToPatchRows({
        ...next,
        patches
      }));
    }), "updateBundle"),
    deleteBundles: /* @__PURE__ */ __name(async (ids) => {
      try {
        await db.transaction(async (tx) => {
          for (const id of new Set(ids)) {
            const current = await tx.findOne("bundles", { id });
            if (current !== null) await deleteBundle(tx, current);
          }
        });
      } catch (error) {
        if (error instanceof DatabaseConstraintError && error.reason === "referenced") throw new DatabaseRowReferencedError();
        throw error;
      }
    }, "deleteBundles")
  };
}, "createCoreOperations");

// ../../packages/server/dist/core/api.mjs
var purgingCachedRoutes = /* @__PURE__ */ __name((db, onCachedRoutesChange) => {
  if (onCachedRoutesChange === void 0) return db;
  return {
    ...db,
    async transaction(fn) {
      let changed = false;
      const result = await db.transaction((tx) => {
        changed = false;
        return fn({
          ...tx,
          create: /* @__PURE__ */ __name((model, row) => {
            changed ||= model === "release_catalogs";
            tx.create(model, row);
          }, "create"),
          update: /* @__PURE__ */ __name((model, row, set) => {
            changed ||= model === "release_catalogs";
            tx.update(model, row, set);
          }, "update"),
          delete: /* @__PURE__ */ __name((model, row) => {
            changed ||= model === "release_catalogs";
            return tx.delete(model, row);
          }, "delete")
        });
      });
      if (changed) await onCachedRoutesChange();
      return result;
    }
  };
}, "purgingCachedRoutes");
var createCoreApi = /* @__PURE__ */ __name((db, storage, options = {}) => {
  const reads = createCoreReads(db, storage);
  return {
    ...reads,
    ...createCoreOperations(purgingCachedRoutes(db, options.onCachedRoutesChange), options),
    /** One read, which checks the schema settings first. */
    ready: /* @__PURE__ */ __name(async () => {
      await reads.listReleaseCatalogs({ limit: 1 });
    }, "ready")
  };
}, "createCoreApi");

// ../../packages/server/dist/assembly/assemblePlugins.mjs
var PLUGIN_KEYS = /* @__PURE__ */ new Set([
  "id",
  "provides",
  "schemaVersion",
  "schema",
  "namespace",
  "init",
  "cli"
]);
var CLI_KEYS = /* @__PURE__ */ new Set(["clientCredential", "clientPlugin"]);
var INSTANCE_KEYS = /* @__PURE__ */ new Set([
  "api",
  "endpoints",
  "clientAuth"
]);
var METHODS = /* @__PURE__ */ new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE"
]);
var PREFIX_ID = /^[a-z][a-z0-9_]*$/u;
var UNPREFIXED_ID = /^[a-z][A-Za-z0-9_]*$/u;
var PATH = /^(\/(:?[A-Za-z0-9_.~-]+))+$/u;
var fail3 = /* @__PURE__ */ __name((message) => {
  throw new HotUpdaterConfigError(message);
}, "fail");
var isRecord2 = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null && !Array.isArray(value), "isRecord");
var checkPlugin = /* @__PURE__ */ __name((value, at) => {
  if (!isRecord2(value)) return fail3(`${at} is not a plugin.`);
  const unknown = Object.keys(value).find((key) => !PLUGIN_KEYS.has(key));
  if (unknown !== void 0) fail3(`${at} has an unknown key "${unknown}".`);
  const plugin = value;
  if (plugin.namespace !== void 0 && plugin.namespace !== false) fail3(`${at} may only set namespace: false.`);
  const pattern = plugin.namespace === false ? UNPREFIXED_ID : PREFIX_ID;
  if (typeof plugin.id !== "string" || !pattern.test(plugin.id)) fail3(`${at} needs an id matching ${pattern.source}.`);
  if (plugin.id === "core") fail3(`${at} uses the id "core", which is core's own.`);
  checkReservedId(value, at);
  if (typeof plugin.schemaVersion !== "string" || !isRecord2(plugin.schema) || typeof plugin.init !== "function") fail3(`Plugin "${plugin.id}" needs a schemaVersion, a schema, and init.`);
  const provides = plugin.provides;
  if (provides !== void 0 && (!isRecord2(provides) || Object.entries(provides).some(([key, flag]) => key !== "clientAuth" || flag !== true))) fail3(`Plugin "${plugin.id}" may only declare provides: { clientAuth: true }.`);
  const cli = value.cli;
  if (cli !== void 0) {
    if (!isRecord2(cli) || Object.keys(cli).some((key) => !CLI_KEYS.has(key))) fail3(`Plugin "${plugin.id}" cli may only hold clientCredential and clientPlugin.`);
    if (cli.clientCredential !== void 0 && plugin.provides?.clientAuth !== true) fail3(`Plugin "${plugin.id}" adds cli.clientCredential without declaring provides: { clientAuth: true }.`);
  }
  return plugin;
}, "checkPlugin");
var checkEndpoint = /* @__PURE__ */ __name((id, value) => {
  const endpoint = isRecord2(value) ? value : {};
  if (!METHODS.has(endpoint.method) || typeof endpoint.path !== "string" || !PATH.test(endpoint.path) || endpoint.access !== "client" && endpoint.access !== "admin" || typeof endpoint.handler !== "function") fail3(`Plugin "${id}" has an endpoint that needs a method, a path like /name/:param, access "client" or "admin", and a handler.`);
  return {
    ...endpoint,
    plugin: id
  };
}, "checkEndpoint");
var checkInstance = /* @__PURE__ */ __name((plugin, instance) => {
  const { id } = plugin;
  if (!isRecord2(instance)) return fail3(`Plugin "${id}" init returned no instance.`);
  if (typeof instance.then === "function") fail3(`Plugin "${id}" init returned a promise; init must be synchronous.`);
  const unknown = Object.keys(instance).find((key) => !INSTANCE_KEYS.has(key));
  if (unknown !== void 0 || !("api" in instance)) fail3(`Plugin "${id}" init must return { api, endpoints?, clientAuth? }${unknown === void 0 ? "" : `, not "${unknown}"`}.`);
  const declared = plugin.provides?.clientAuth === true;
  const clientAuth = instance.clientAuth;
  if (declared !== (clientAuth !== void 0)) fail3(declared ? `Plugin "${id}" declares provides: { clientAuth: true } but its instance has no clientAuth.` : `Plugin "${id}" returns clientAuth without declaring provides: { clientAuth: true }.`);
  if (clientAuth !== void 0 && (typeof clientAuth.authenticate !== "function" || !Array.isArray(clientAuth.varyHeaders) || !clientAuth.varyHeaders.every((header) => typeof header === "string"))) fail3(`Plugin "${id}" clientAuth needs varyHeaders and authenticate.`);
  const endpoints = instance.endpoints ?? [];
  if (!Array.isArray(endpoints)) fail3(`Plugin "${id}" endpoints must be an array.`);
  return {
    api: instance.api,
    clientAuth,
    endpoints: endpoints.map((endpoint) => checkEndpoint(id, endpoint))
  };
}, "checkInstance");
var assemblePlugins = /* @__PURE__ */ __name((value, database, { now = Date.now, storage = { resolveFileUrl: /* @__PURE__ */ __name(async () => null, "resolveFileUrl") } } = {}) => {
  if (!Array.isArray(value)) return fail3("plugins must be an array of plugins.");
  const plugins = value.map((plugin, position) => checkPlugin(plugin, `plugins[${position}]`));
  const ids = /* @__PURE__ */ new Set();
  for (const { id } of plugins) {
    if (ids.has(id)) fail3(`Plugin "${id}" is registered twice.`);
    ids.add(id);
  }
  clientPluginsOf(plugins);
  const engine = createEngine(database, {
    plugins,
    now
  });
  const { onCachedRoutesChange } = database;
  const core = createCoreApi(engine.core, storage, {
    now,
    ...onCachedRoutesChange === void 0 ? {} : { onCachedRoutesChange: /* @__PURE__ */ __name(() => onCachedRoutesChange.call(database), "onCachedRoutesChange") }
  });
  const reads = createCoreReads(engine.core, storage);
  const api = {};
  const endpoints = [];
  let clientAuth;
  for (const plugin of plugins) {
    const instance = checkInstance(plugin, plugin.init({
      db: engine.database(plugin),
      core: reads,
      now
    }));
    if (instance.clientAuth !== void 0) {
      if (clientAuth !== void 0) fail3(`Plugins "${clientAuth.plugin}" and "${plugin.id}" both provide clientAuth; keep one.`);
      const provided = instance.clientAuth;
      clientAuth = {
        plugin: plugin.id,
        varyHeaders: provided.varyHeaders,
        authenticate: /* @__PURE__ */ __name((headers) => provided.authenticate(headers), "authenticate")
      };
    }
    endpoints.push(...instance.endpoints);
    api[plugin.id] = instance.api;
  }
  return {
    core,
    api,
    endpoints,
    ...clientAuth === void 0 ? {} : { clientAuth },
    flush: engine.flush
  };
}, "assemblePlugins");

// ../../packages/server/dist/handlerErrors.mjs
var HandlerBadRequestError = class extends Error {
  static {
    __name(this, "HandlerBadRequestError");
  }
  name = "HandlerBadRequestError";
  constructor(message) {
    super(message);
  }
};

// ../../packages/server/dist/handlerParameters.mjs
var decodeMaybe = /* @__PURE__ */ __name((value) => {
  if (value === void 0) return void 0;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}, "decodeMaybe");
var isPlatform = /* @__PURE__ */ __name((value) => value === "ios" || value === "android", "isPlatform");
var requireRouteParam = /* @__PURE__ */ __name((params, key) => {
  const value = params[key];
  if (!value) throw new HandlerBadRequestError(`Missing route parameter: ${key}`);
  return value;
}, "requireRouteParam");
var requirePlatformParam = /* @__PURE__ */ __name((params) => {
  const platform = requireRouteParam(params, "platform");
  if (!isPlatform(platform)) throw new HandlerBadRequestError(`Invalid platform: ${platform}. Expected 'ios' or 'android'.`);
  return platform;
}, "requirePlatformParam");
var parseBooleanSearchParam = /* @__PURE__ */ __name((url, key) => {
  const value = url.searchParams.get(key);
  if (value === null) return void 0;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HandlerBadRequestError(`The '${key}' query parameter must be 'true' or 'false'.`);
}, "parseBooleanSearchParam");

// ../../packages/server/dist/handlerAdminRoutes.mjs
var json = /* @__PURE__ */ __name((body2, status = 200) => Response.json(body2, { status }), "json");
var notFound = /* @__PURE__ */ __name(() => json({ error: "Not found" }, 404), "notFound");
var noContent = /* @__PURE__ */ __name(() => new Response(null, { status: 204 }), "noContent");
var onCore = /* @__PURE__ */ __name((route) => async (params, request, api) => answer(() => route(api.core, request, params)), "onCore");
var answer = /* @__PURE__ */ __name(async (operation) => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ReleaseManagementError || error instanceof ReleaseCatalogMutationError) {
      const status = error.code === "RELEASE_NOT_FOUND" ? 404 : error.code === "VERSION_CONFLICT" ? 409 : 400;
      return json({
        code: error.code,
        error: error.message
      }, status);
    }
    if (error instanceof DatabaseBundleNotFoundError) return json({
      code: "BUNDLE_NOT_FOUND",
      error: error.message
    }, 404);
    if (error instanceof DatabaseRowReferencedError) return json({
      code: "REFERENCED",
      error: error.message
    }, 409);
    throw error;
  }
}, "answer");
var LIMITS = {
  defaultValue: 50,
  maxValue: 500
};
var keyset = /* @__PURE__ */ __name((url, maxValue = LIMITS.maxValue) => {
  const order = url.searchParams.get("order") ?? "desc";
  if (order !== "asc" && order !== "desc") throw new HandlerBadRequestError("order must be 'asc' or 'desc'.");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam === null ? Math.min(LIMITS.defaultValue, maxValue) : Number(limitParam);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxValue) throw new HandlerBadRequestError(`limit must be between 1 and ${maxValue}.`);
  const cursor = url.searchParams.get("cursor");
  return {
    order,
    limit,
    ...cursor === null ? {} : { after: cursor }
  };
}, "keyset");
var page = /* @__PURE__ */ __name((rows, { limit }, keyOf, extra = {}) => json({
  data: rows,
  ...rows.length === limit && rows.length > 0 ? { next: keyOf(rows.at(-1)) } : {},
  ...extra
}), "page");
var platformOf = /* @__PURE__ */ __name((url) => {
  const platform = url.searchParams.get("platform");
  if (platform === null) return void 0;
  if (!isPlatform(platform)) throw new HandlerBadRequestError(`Invalid platform: ${platform}. Expected 'ios' or 'android'.`);
  return platform;
}, "platformOf");
var releaseFilter = /* @__PURE__ */ __name((url) => {
  const params = url.searchParams;
  const named = [
    "channelId",
    "platform",
    "bundleId",
    "scopeKey"
  ].filter((name) => params.has(name));
  const enabled = parseBooleanSearchParam(url, "enabled");
  const withEnabled = enabled === void 0 ? {} : { enabled };
  const set = named.join(",");
  if (set === "" && enabled === void 0) return { kind: "all" };
  if (set === "channelId,platform") {
    const platform = platformOf(url);
    return {
      kind: "channelPlatform",
      channelId: params.get("channelId"),
      platform,
      ...withEnabled
    };
  }
  if (set === "bundleId" && enabled === void 0) return {
    kind: "bundle",
    bundleId: params.get("bundleId")
  };
  if (set === "scopeKey") return {
    kind: "scope",
    scopeKey: params.get("scopeKey"),
    ...withEnabled
  };
  throw new HandlerBadRequestError("Releases filter by none, channelId and platform (with enabled), bundleId, or scopeKey (with enabled).");
}, "releaseFilter");
var isRecord3 = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null && !Array.isArray(value), "isRecord");
var body = /* @__PURE__ */ __name(async (request) => {
  const value = await request.json();
  if (!isRecord3(value)) throw new HandlerBadRequestError("Invalid body");
  return value;
}, "body");
var isText = /* @__PURE__ */ __name((value) => typeof value === "string" && value.length > 0, "isText");
var isTextOrNull = /* @__PURE__ */ __name((value) => value === null || isText(value), "isTextOrNull");
var isBundle = /* @__PURE__ */ __name((bundle) => isRecord3(bundle) && isText(bundle.id) && typeof bundle.platform === "string" && isPlatform(bundle.platform) && isTextOrNull(bundle.gitCommitHash) && isText(bundle.manifestStorageUri) && isText(bundle.manifestFileHash) && isText(bundle.assetBaseStorageUri) && (bundle.metadata === void 0 || isRecord3(bundle.metadata)) && (bundle.patches === void 0 || bundle.patches === null || Array.isArray(bundle.patches)), "isBundle");
var isReleasePolicy = /* @__PURE__ */ __name((release) => isRecord3(release) && isText(release.channel) && typeof release.enabled === "boolean" && typeof release.shouldForceUpdate === "boolean" && isTextOrNull(release.fingerprintHash) && isTextOrNull(release.targetAppVersion) && (release.message === null || typeof release.message === "string") && (release.rolloutCohortCount === void 0 || Number.isSafeInteger(release.rolloutCohortCount) && release.rolloutCohortCount >= 0 && release.rolloutCohortCount <= 1e3) && (release.targetCohorts === void 0 || Array.isArray(release.targetCohorts) && release.targetCohorts.every(isText)), "isReleasePolicy");
var isDeployment = /* @__PURE__ */ __name((value) => isRecord3(value) && isReleasePolicy(value.release) && ("bundleId" in value ? isText(value.bundleId) && !("bundle" in value) : isBundle(value.bundle)), "isDeployment");
var revisionOf = /* @__PURE__ */ __name((value) => {
  if (value === void 0 || value === null || value === "") return void 0;
  const revision = typeof value === "string" ? Number(value) : value;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) throw new HandlerBadRequestError("Invalid expected Release revision");
  return revision;
}, "revisionOf");
var policyInput = /* @__PURE__ */ __name(async (request) => {
  const input = await body(request);
  if (!isRecord3(input.patch)) throw new HandlerBadRequestError("Invalid Release policy mutation");
  const expectedRevision = revisionOf(input.expectedRevision);
  return {
    patch: input.patch,
    ...expectedRevision === void 0 ? {} : { expectedRevision }
  };
}, "policyInput");
var bundleUpdateOf = /* @__PURE__ */ __name((value, bundleId) => {
  if (!isRecord3(value)) throw new HandlerBadRequestError("Invalid bundle payload");
  const { id, ...update } = value;
  if (id !== void 0 && id !== bundleId) throw new HandlerBadRequestError("Bundle id mismatch");
  return update;
}, "bundleUpdateOf");
var scopeKeyOf = /* @__PURE__ */ __name((params) => decodeMaybe(requireRouteParam(params, "scopeKey")) ?? "", "scopeKeyOf");
var createAdminRouteHandlers = /* @__PURE__ */ __name(() => ({
  listBundles: onCore(async (core, request) => {
    const url = new URL(request.url);
    const input = keyset(url, 100);
    const platform = platformOf(url);
    const withTotal = parseBooleanSearchParam(url, "total") === true;
    const [rows, total] = await Promise.all([core.listBundles({
      ...input,
      ...platform ? { platform } : {}
    }), withTotal ? core.countBundles(platform) : void 0]);
    return page(rows, input, (row) => row.bundle.id, total === void 0 ? {} : { total });
  }),
  getBundle: onCore(async (core, _request, params) => {
    const detail = await core.getBundle(requireRouteParam(params, "id"));
    return detail === null ? notFound() : json({ data: detail });
  }),
  listReleases: onCore(async (core, request) => {
    const url = new URL(request.url);
    const input = keyset(url);
    const rows = await core.listReleases({
      ...input,
      filter: releaseFilter(url)
    });
    return page(rows, input, (row) => row.id);
  }),
  listReleaseCatalogs: onCore(async (core, request) => {
    const input = keyset(new URL(request.url));
    const rows = await core.listReleaseCatalogs(input);
    return page(rows, input, (row) => row.scope_key);
  }),
  /** With `name`, the one channel of that name: 1 read. */
  getChannels: onCore(async (core, request) => {
    const name = new URL(request.url).searchParams.get("name");
    if (name === null) return json({ data: await core.listChannels() });
    const channel = await core.findChannelByName(name);
    return channel === null ? notFound() : json({ data: channel });
  }),
  /** The channel named in the body, created when missing. */
  createChannel: onCore(async (core, request) => {
    const { name } = await body(request);
    if (typeof name !== "string" || name.trim().length === 0) throw new HandlerBadRequestError("Invalid channel name");
    return json({ data: await core.ensureChannel(name) });
  }),
  /** 204 when deleted; 404 or 409 with the reason otherwise. */
  deleteChannel: onCore(async (core, _request, params) => {
    const result = await core.deleteChannel(decodeMaybe(requireRouteParam(params, "id")) ?? "");
    if (result.deleted) return noContent();
    return json({ data: result }, result.reason === "not_found" ? 404 : 409);
  }),
  getRelease: onCore(async (core, _request, params) => {
    const row = await core.getRelease(requireRouteParam(params, "id"));
    return row === null ? notFound() : json({ data: row });
  }),
  updateRelease: onCore(async (core, request, params) => json({ data: await core.updateReleasePolicy({
    ...await policyInput(request),
    releaseId: requireRouteParam(params, "id")
  }) })),
  preflightRelease: onCore(async (core, request, params) => json({ data: await core.preflightReleasePolicy({
    ...await policyInput(request),
    releaseId: requireRouteParam(params, "id")
  }) })),
  /** Hard deletion names the release twice: in the path and as `confirm`. */
  deleteRelease: onCore(async (core, request, params) => {
    const releaseId = requireRouteParam(params, "id");
    const url = new URL(request.url);
    if (url.searchParams.get("confirm") !== releaseId) throw new HandlerBadRequestError("Release hard deletion requires confirm=<release-id>");
    const expectedRevision = revisionOf(url.searchParams.get("expectedRevision"));
    return json({ data: await core.deleteRelease({
      releaseId,
      ...expectedRevision === void 0 ? {} : { expectedRevision }
    }) });
  }),
  getReleaseCatalogRow: onCore(async (core, _request, params) => {
    const row = await core.getReleaseCatalogRow(scopeKeyOf(params));
    return row === null ? notFound() : json({ data: row });
  }),
  rebuildReleaseCatalog: onCore(async (core, _request, params) => json({ data: await core.rebuildReleaseCatalog(scopeKeyOf(params)) })),
  updateBundle: onCore(async (core, request, params) => {
    const bundleId = requireRouteParam(params, "id");
    await core.updateBundle(bundleId, bundleUpdateOf(await request.json(), bundleId));
    return noContent();
  }),
  countBundles: onCore(async (core, request) => json({ data: await core.countBundles(platformOf(new URL(request.url))) })),
  countBundleChildren: onCore(async (core, request) => {
    const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter((id) => id.length > 0);
    if (ids.length === 0 || ids.length > 100) throw new HandlerBadRequestError("Bundle child counts take ids=<bundle id>,... with 1 to 100 ids.");
    return json({ data: await core.countBundleChildren(ids) });
  }),
  listBundleChildren: onCore(async (core, request, params) => {
    const input = keyset(new URL(request.url));
    const rows = await core.listPatchesFromBase(requireRouteParam(params, "id"), input);
    return page(rows, input, (row) => row.bundle_id);
  }),
  findBaseCandidates: onCore(async (core, request, params) => {
    const url = new URL(request.url);
    const before = url.searchParams.get("before");
    const limit = Number(url.searchParams.get("limit") ?? "3");
    if (before === null || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new HandlerBadRequestError("Base candidates need before=<bundle id> and a limit between 1 and 100.");
    return json({ data: await core.findBaseBundleIds(decodeMaybe(requireRouteParam(params, "candidateKey")) ?? "", before, limit) });
  }),
  deployReleases: onCore(async (core, request) => {
    const { deployments } = await body(request);
    if (!Array.isArray(deployments) || deployments.length === 0 || !deployments.every(isDeployment)) throw new HandlerBadRequestError("Deploy needs deployments, each a bundle and its release policy.");
    return json({ data: await core.deploy(deployments) }, 201);
  }),
  promoteRelease: onCore(async (core, request, params) => {
    const input = await body(request);
    if (typeof input.targetChannel !== "string" || input.action !== void 0 && input.action !== "copy" && input.action !== "move") throw new HandlerBadRequestError("Invalid Release promotion");
    const expectedRevision = revisionOf(input.expectedRevision);
    return json({ data: await core.promoteRelease({
      releaseId: requireRouteParam(params, "id"),
      targetChannel: input.targetChannel,
      ...input.action === void 0 ? {} : { action: input.action },
      ...expectedRevision === void 0 ? {} : { expectedRevision }
    }) });
  }),
  preflightReleaseCatalogRebuild: onCore(async (core, _request, params) => json({ data: await core.preflightReleaseCatalogRebuild(scopeKeyOf(params)) })),
  deleteBundles: onCore(async (core, request) => {
    const { ids } = await body(request);
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && id.length > 0)) throw new HandlerBadRequestError("Bundle deletion needs ids");
    await core.deleteBundles(ids);
    return noContent();
  })
}), "createAdminRouteHandlers");
var ADMIN_ROUTES = [
  {
    method: "POST",
    path: "/releases",
    handler: "deployReleases"
  },
  {
    method: "POST",
    path: "/releases/:id/promote",
    handler: "promoteRelease"
  },
  {
    method: "GET",
    path: "/releases/:id",
    handler: "getRelease"
  },
  {
    method: "GET",
    path: "/releases",
    handler: "listReleases"
  },
  {
    method: "PATCH",
    path: "/releases/:id",
    handler: "updateRelease"
  },
  {
    method: "POST",
    path: "/releases/:id/preflight",
    handler: "preflightRelease"
  },
  {
    method: "DELETE",
    path: "/releases/:id",
    handler: "deleteRelease"
  },
  {
    method: "GET",
    path: "/release-catalogs/:scopeKey",
    handler: "getReleaseCatalogRow"
  },
  {
    method: "GET",
    path: "/release-catalogs",
    handler: "listReleaseCatalogs"
  },
  {
    method: "POST",
    path: "/release-catalogs/:scopeKey/rebuild",
    handler: "rebuildReleaseCatalog"
  },
  {
    method: "POST",
    path: "/release-catalogs/:scopeKey/preflight",
    handler: "preflightReleaseCatalogRebuild"
  },
  {
    method: "GET",
    path: "/channels",
    handler: "getChannels"
  },
  {
    method: "POST",
    path: "/channels",
    handler: "createChannel"
  },
  {
    method: "DELETE",
    path: "/channels/:id",
    handler: "deleteChannel"
  },
  {
    method: "GET",
    path: "/bundles/count",
    handler: "countBundles"
  },
  {
    method: "GET",
    path: "/bundles/child-counts",
    handler: "countBundleChildren"
  },
  {
    method: "GET",
    path: "/bundles/:id",
    handler: "getBundle"
  },
  {
    method: "GET",
    path: "/bundles",
    handler: "listBundles"
  },
  {
    method: "PATCH",
    path: "/bundles/:id",
    handler: "updateBundle"
  },
  {
    method: "POST",
    path: "/bundles/delete",
    handler: "deleteBundles"
  },
  {
    method: "GET",
    path: "/bundles/:id/children",
    handler: "listBundleChildren"
  },
  {
    method: "GET",
    path: "/base-candidates/:candidateKey",
    handler: "findBaseCandidates"
  }
];

// ../../packages/server/dist/handlerReleaseCatalogRoutes.mjs
var CATALOG_CONTENT_TYPE = "application/vnd.hot-updater.release-catalog+json; version=1";
var ARTIFACT_CONTENT_TYPE = "application/vnd.hot-updater.artifact+json; version=1";
var ARTIFACT_V2_CONTENT_TYPE = "application/vnd.hot-updater.artifact+json; version=2";
var ORIGIN_CACHE_TTL_MS = 5e3;
var ORIGIN_CACHE_MAX_ENTRIES = 128;
var NO_CATALOG_HEADER = "x-hot-updater-catalog";
var CATALOG_CACHE_CONTROL = "public, max-age=0, s-maxage=5";
var CATALOG_CDN_CACHE_CONTROL = "public, max-age=5, stale-while-revalidate=5, stale-if-error=0";
var readArtifactFilePaths = /* @__PURE__ */ __name(async (request) => {
  let body2;
  try {
    body2 = await request.json();
  } catch {
    return null;
  }
  const paths = body2?.paths;
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > ARTIFACT_FILES_REQUEST_LIMIT || !paths.every((path) => typeof path === "string" && path.length > 0) || new Set(paths).size !== paths.length) return null;
  return paths;
}, "readArtifactFilePaths");
var privateNotFound = /* @__PURE__ */ __name(() => Response.json({ error: "Not found" }, {
  status: 404,
  headers: { "cache-control": "private, no-store" }
}), "privateNotFound");
var badRequest = /* @__PURE__ */ __name((error) => Response.json({ error }, {
  status: 400,
  headers: { "cache-control": "private, no-store" }
}), "badRequest");
var invalidScope = /* @__PURE__ */ __name((input) => {
  try {
    createReleaseCatalogScopeKey(input);
    return null;
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid Release Catalog scope");
  }
}, "invalidScope");
var missingCatalog = /* @__PURE__ */ __name(() => Response.json({ error: "Not found" }, {
  status: 404,
  headers: {
    "cache-control": CATALOG_CACHE_CONTROL,
    "cdn-cache-control": CATALOG_CDN_CACHE_CONTROL,
    vary: "Accept-Encoding",
    [NO_CATALOG_HEADER]: "none"
  }
}), "missingCatalog");
var responseHash = /* @__PURE__ */ __name(async (body2) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body2));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}, "responseHash");
var catalogResponse = /* @__PURE__ */ __name(async (catalog, request) => {
  if (catalog === null) return missingCatalog();
  const body2 = JSON.stringify(catalog);
  const etag = `"sha256:${await responseHash(body2)}"`;
  const headers = {
    "cache-control": CATALOG_CACHE_CONTROL,
    "cdn-cache-control": CATALOG_CDN_CACHE_CONTROL,
    "content-type": CATALOG_CONTENT_TYPE,
    etag,
    vary: "Accept-Encoding"
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, {
    headers,
    status: 304
  });
  return new Response(body2, {
    headers,
    status: 200
  });
}, "catalogResponse");
var createReleaseCatalogRouteHandlers = /* @__PURE__ */ __name(() => {
  const cache = /* @__PURE__ */ new Map();
  const inFlight = /* @__PURE__ */ new Map();
  const loadCatalog = /* @__PURE__ */ __name(async (key, load) => {
    const cached = cache.get(key);
    if (cached !== void 0 && cached.expiresAt > Date.now()) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.catalog;
    }
    if (cached !== void 0) cache.delete(key);
    const pending = inFlight.get(key);
    if (pending !== void 0) return pending;
    const next = load().then((catalog) => {
      if (catalog !== null) {
        cache.set(key, {
          catalog,
          expiresAt: Date.now() + ORIGIN_CACHE_TTL_MS
        });
        while (cache.size > ORIGIN_CACHE_MAX_ENTRIES) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey === void 0) break;
          cache.delete(oldestKey);
        }
      }
      return catalog;
    });
    inFlight.set(key, next);
    try {
      return await next;
    } finally {
      inFlight.delete(key);
    }
  }, "loadCatalog");
  return {
    appVersionReleaseCatalog: /* @__PURE__ */ __name(async (params, request, { core }) => {
      const rawAppVersion = requireRouteParam(params, "appVersion");
      const appVersion = canonicalizeAppVersion(rawAppVersion);
      if (appVersion === null || appVersion !== rawAppVersion) return badRequest("Invalid app version");
      const input = {
        appVersion,
        channelKey: requireRouteParam(params, "channelKey"),
        platform: requirePlatformParam(params),
        strategy: "APP_VERSION"
      };
      const invalid = invalidScope(input);
      if (invalid) return invalid;
      return catalogResponse(await loadCatalog(`app-version:${JSON.stringify(input)}`, () => core.getReleaseCatalog(input)), request);
    }, "appVersionReleaseCatalog"),
    fingerprintReleaseCatalog: /* @__PURE__ */ __name(async (params, request, { core }) => {
      const input = {
        channelKey: requireRouteParam(params, "channelKey"),
        fingerprintHash: requireRouteParam(params, "fingerprintHash"),
        platform: requirePlatformParam(params),
        strategy: "FINGERPRINT"
      };
      const invalid = invalidScope(input);
      if (invalid) return invalid;
      return catalogResponse(await loadCatalog(`fingerprint:${JSON.stringify(input)}`, () => core.getReleaseCatalog(input)), request);
    }, "fingerprintReleaseCatalog"),
    artifactV2: /* @__PURE__ */ __name(async (params, _request, { core }) => {
      const info = await core.getArtifactInfo(requireRouteParam(params, "targetBundleId"), requireRouteParam(params, "currentBundleId"), 2);
      if (info === null) return privateNotFound();
      return new Response(JSON.stringify(info), {
        status: 200,
        headers: {
          "cache-control": "private, no-store",
          "content-type": ARTIFACT_V2_CONTENT_TYPE
        }
      });
    }, "artifactV2"),
    artifactFilesV2: /* @__PURE__ */ __name(async (params, request, { core }) => {
      const paths = await readArtifactFilePaths(request);
      if (paths === null) return badRequest(`paths must be 1 to ${ARTIFACT_FILES_REQUEST_LIMIT} unique strings`);
      const files = await core.getArtifactFiles(requireRouteParam(params, "targetBundleId"), paths);
      if (files === null) return privateNotFound();
      return new Response(JSON.stringify(files), {
        status: 200,
        headers: {
          "cache-control": "private, no-store",
          "content-type": ARTIFACT_V2_CONTENT_TYPE
        }
      });
    }, "artifactFilesV2"),
    artifactV1: /* @__PURE__ */ __name(async (params, _request, { core }) => {
      const info = await core.getArtifactInfo(requireRouteParam(params, "targetBundleId"), requireRouteParam(params, "currentBundleId"), 1);
      if (info === null) return privateNotFound();
      return new Response(JSON.stringify(info), {
        status: 200,
        headers: {
          "cache-control": "private, no-store",
          "content-type": ARTIFACT_CONTENT_TYPE
        }
      });
    }, "artifactV1")
  };
}, "createReleaseCatalogRouteHandlers");

// ../../packages/server/dist/internalRouter.mjs
var normalizePath = /* @__PURE__ */ __name((path) => {
  if (!path) return "/";
  if (path === "/") return path;
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}, "normalizePath");
var toSegments = /* @__PURE__ */ __name((path) => {
  const normalized = normalizePath(path);
  return normalized === "/" ? [] : normalized.slice(1).split("/");
}, "toSegments");
function createRouter() {
  return { routes: [] };
}
__name(createRouter, "createRouter");
function addRoute(router, method, path, data) {
  const segments = toSegments(path);
  const paramNames = segments.filter((segment) => segment.startsWith(":")).map((segment) => segment.slice(1));
  router.routes.push({
    data,
    method: method.toUpperCase(),
    paramNames,
    segments
  });
}
__name(addRoute, "addRoute");
function findRoute(router, method, path) {
  const normalizedMethod = method.toUpperCase();
  const pathSegments = toSegments(path);
  for (const route of router.routes) {
    if (route.method !== normalizedMethod) continue;
    if (route.segments.length !== pathSegments.length) continue;
    const params = {};
    let matched = true;
    for (let index = 0; index < route.segments.length; index += 1) {
      const routeSegment = route.segments[index];
      const pathSegment = pathSegments[index];
      if (routeSegment.startsWith(":")) {
        params[routeSegment.slice(1)] = pathSegment;
        continue;
      }
      if (routeSegment !== pathSegment) {
        matched = false;
        break;
      }
    }
    if (matched) return {
      data: route.data,
      params
    };
  }
}
__name(findRoute, "findRoute");

// ../../packages/server/dist/handler.mjs
var withPrivateNoStore = /* @__PURE__ */ __name((response) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}, "withPrivateNoStore");
var errorResponse = /* @__PURE__ */ __name((error, status) => Response.json({ error }, {
  headers: { "cache-control": "private, no-store" },
  status
}), "errorResponse");
var PUBLIC_CLIENT_ROUTES = /* @__PURE__ */ new Set(["version"]);
var routesOf = /* @__PURE__ */ Symbol.for("@hot-updater/server/routes");
var withVary = /* @__PURE__ */ __name((response, varyHeaders) => {
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (varyHeaders.length === 0 || cacheControl === "" || /private|no-store/u.test(cacheControl)) return response;
  const headers = new Headers(response.headers);
  headers.set("vary", [response.headers.get("vary"), ...varyHeaders].filter(Boolean).join(", "));
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}, "withVary");
var createRequestHandler = /* @__PURE__ */ __name(({ api, clientPolicy, privateResponses = false, routeHandlers, router }) => async (request) => {
  try {
    const match2 = findRoute(router, request.method, new URL(request.url).pathname);
    if (!match2) return errorResponse("Not found", 404);
    const guarded = clientPolicy !== void 0 && !PUBLIC_CLIENT_ROUTES.has(match2.data);
    if (guarded) {
      let authenticated;
      try {
        authenticated = await clientPolicy.authenticate(request);
      } catch {
        return errorResponse("Service unavailable", 503);
      }
      if (!authenticated) return errorResponse("Unauthorized", 401);
    }
    const handler = routeHandlers[match2.data];
    if (!handler) return errorResponse("Handler not found", 500);
    const response = await handler(match2.params, request, api);
    if (privateResponses) return withPrivateNoStore(response);
    return guarded ? withVary(response, clientPolicy.varyHeaders) : response;
  } catch (error) {
    if (error instanceof HandlerBadRequestError) return errorResponse(error.message, 400);
    if (error instanceof HotUpdaterSchemaMigrationRequiredError) {
      console.error(error.message);
      return errorResponse("Service unavailable", 503);
    }
    console.error("Hot Updater handler error:", error);
    return Response.json({ error: "Internal server error" }, {
      headers: { "cache-control": "private, no-store" },
      status: 500
    });
  }
}, "createRequestHandler");
function createHotUpdaterHandlers({ api, clientPolicy, endpoints = [], plugins = [] }) {
  const routeHandlers = {
    ...createVersionRouteHandlers(plugins),
    ...createReleaseCatalogRouteHandlers(),
    ...createAdminRouteHandlers()
  };
  const routes = [];
  const shapes = /* @__PURE__ */ new Map();
  const mount = /* @__PURE__ */ __name((router, admin) => (method, path, handler) => {
    const shape = `${admin ? "admin" : "client"} ${method} ${path.replaceAll(/:[^/]+/gu, ":")}`;
    const taken = shapes.get(shape);
    if (taken !== void 0) throw new HotUpdaterConfigError(`${handler} (${method} ${path}) collides with ${taken} on handlers.${admin ? "admin" : "client"}.`);
    shapes.set(shape, handler);
    addRoute(router, method, path, handler);
    routes.push({
      method,
      path,
      access: admin ? "admin" : PUBLIC_CLIENT_ROUTES.has(handler) ? "public" : "client"
    });
  }, "mount");
  const clientRouter = createRouter();
  const addClientRoute = mount(clientRouter, false);
  addClientRoute("GET", "/version", "version");
  addClientRoute("GET", "/release-catalogs/app-version/:platform/:channelKey/:appVersion", "appVersionReleaseCatalog");
  addClientRoute("GET", "/release-catalogs/fingerprint/:platform/:channelKey/:fingerprintHash", "fingerprintReleaseCatalog");
  addClientRoute("GET", "/artifacts/v1/:targetBundleId/from/:currentBundleId", "artifactV1");
  addClientRoute("GET", "/artifacts/v2/:targetBundleId/from/:currentBundleId", "artifactV2");
  addClientRoute("POST", "/artifacts/v2/:targetBundleId/files", "artifactFilesV2");
  const adminRouter = createRouter();
  const addAdminRoute = mount(adminRouter, true);
  addAdminRoute("GET", "/version", "adminVersion");
  for (const route of ADMIN_ROUTES) addAdminRoute(route.method, route.path, route.handler);
  for (const endpoint of endpoints) {
    const name = `plugin ${endpoint.plugin}: ${endpoint.method} ${endpoint.path}`;
    routeHandlers[name] = (params, request) => endpoint.handler(request, params);
    (endpoint.access === "admin" ? addAdminRoute : addClientRoute)(endpoint.method, endpoint.path, name);
  }
  const handlers = {
    client: createRequestHandler({
      api,
      ...clientPolicy === void 0 ? {} : { clientPolicy },
      routeHandlers,
      router: clientRouter
    }),
    admin: createRequestHandler({
      api,
      privateResponses: true,
      routeHandlers,
      router: adminRouter
    })
  };
  Object.defineProperty(handlers, routesOf, { value: Object.freeze(routes) });
  return Object.freeze(handlers);
}
__name(createHotUpdaterHandlers, "createHotUpdaterHandlers");

// ../../packages/server/dist/storageAccess.mjs
var assertRemoteUrl = /* @__PURE__ */ __name((value) => {
  let protocol;
  try {
    protocol = new URL(value).protocol;
  } catch {
  }
  if (protocol !== "http:" && protocol !== "https:") throw new Error("Storage getDownloadUrl must resolve to an absolute HTTP(S) URL.");
  return value;
}, "assertRemoteUrl");
var getStorageProtocol = /* @__PURE__ */ __name((storageUri) => new URL(storageUri).protocol.replace(":", ""), "getStorageProtocol");
var isRemoteUrlProtocol = /* @__PURE__ */ __name((protocol) => protocol === "http" || protocol === "https", "isRemoteUrlProtocol");
var createStorageAccess = /* @__PURE__ */ __name((storageAdapter) => {
  const findStorage = /* @__PURE__ */ __name((protocol) => storageAdapter.protocol === protocol ? storageAdapter : void 0, "findStorage");
  const readStorageResponse = /* @__PURE__ */ __name(async (storageUri) => {
    const protocol = getStorageProtocol(storageUri);
    const storage = findStorage(protocol);
    if (storage) {
      if (!storage.get) return null;
      return (await storage.get({ storageUri })).response;
    }
    if (isRemoteUrlProtocol(protocol)) {
      const response = await fetch(storageUri);
      return response.ok ? response : null;
    }
    throw new Error(`No storage adapter for protocol: ${protocol}`);
  }, "readStorageResponse");
  const resolveFileUrl = /* @__PURE__ */ __name(async (storageUri) => {
    if (!storageUri) return null;
    const protocol = getStorageProtocol(storageUri);
    const storage = findStorage(protocol);
    if (!storage) {
      if (isRemoteUrlProtocol(protocol)) return storageUri;
      throw new Error(`No storage adapter for protocol: ${protocol}`);
    }
    if (!storage.getDownloadUrl) return null;
    const { url: downloadUrl } = await storage.getDownloadUrl({ storageUri });
    return assertRemoteUrl(downloadUrl);
  }, "resolveFileUrl");
  const readStorageText = /* @__PURE__ */ __name(async (storageUri) => {
    return (await readStorageResponse(storageUri))?.text() ?? null;
  }, "readStorageText");
  return {
    readStorageText,
    resolveFileUrl
  };
}, "createStorageAccess");

// ../../packages/server/dist/createHotUpdaterCore.mjs
var isRecord4 = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null, "isRecord");
var isAdapter = /* @__PURE__ */ __name((value) => isRecord4(value) && [
  "fits",
  "get",
  "query",
  "write"
].every((method) => typeof value[method] === "function"), "isAdapter");
var databaseOf = /* @__PURE__ */ __name((value) => {
  if (isRecord4(value) && typeof value.name === "string") {
    if (isAdapter(value.adapter)) return value;
    if ("core" in value && "fetchAdmin" in value) throw new HotUpdaterConfigError("standaloneRepository reaches a server's admin API from the CLI and console. createHotUpdater needs the server's own database, such as kyselyAdapter(...).");
  }
  throw new HotUpdaterConfigError("database must be a Hot Updater database adapter, such as kyselyAdapter(...) or postgres(...).");
}, "databaseOf");
var storageOf = /* @__PURE__ */ __name((value) => {
  if (isRecord4(value) && typeof value.name === "string" && typeof value.protocol === "string") return value;
  throw new HotUpdaterConfigError("storage must be a storage adapter, such as s3Storage(...): the one hot-updater.config.ts uploads with.");
}, "storageOf");
var isPublic = /* @__PURE__ */ __name((value) => {
  if (value === void 0) return false;
  if (value === "public") return true;
  throw new HotUpdaterConfigError('clientAccess must be "public"; to protect client routes, add a plugin that provides clientAuth to plugins.');
}, "isPublic");
function createHotUpdater(options) {
  const database = databaseOf(options.database);
  const storage = storageOf(options.storage);
  const { readStorageText, resolveFileUrl } = createStorageAccess(storage);
  const publicClients = isPublic(options.clientAccess);
  const configured = Object.freeze([...options.plugins ?? []]);
  const plugins = assemblePlugins(configured, database, { storage: {
    readStorageText,
    resolveFileUrl
  } });
  const clientPlugins = Object.freeze(clientPluginsOf(configured));
  const clientAuth = plugins.clientAuth;
  if (clientAuth !== void 0 && publicClients) throw new HotUpdaterConfigError(`Plugin "${clientAuth.plugin}" provides clientAuth, so remove clientAccess.`);
  if (clientAuth === void 0 && !publicClients) throw new HotUpdaterConfigError('Set clientAccess to "public", or add a plugin that provides clientAuth.');
  const varyHeaders = Object.freeze((clientAuth?.varyHeaders ?? []).map((header) => header.toLowerCase()));
  const clientPolicy = clientAuth === void 0 ? void 0 : {
    varyHeaders,
    authenticate: /* @__PURE__ */ __name((request) => clientAuth.authenticate(request.headers), "authenticate")
  };
  const handlers = createHotUpdaterHandlers({
    api: { core: plugins.core },
    ...clientPolicy === void 0 ? {} : { clientPolicy },
    endpoints: plugins.endpoints,
    plugins: Object.keys(plugins.api)
  });
  let serving = false;
  return {
    adapterName: database.name,
    get handlers() {
      if (!serving) {
        assertStorageOperations(storage, ["get", "getDownloadUrl"]);
        serving = true;
      }
      return handlers;
    },
    core: plugins.core,
    api: plugins.api,
    flush: plugins.flush,
    database,
    storage,
    plugins: configured,
    clientPlugins,
    clientEndpoints: Object.freeze(plugins.endpoints.filter((endpoint) => endpoint.access === "client").map(({ plugin, method, path }) => Object.freeze({
      plugin,
      method,
      path
    }))),
    ...clientAuth === void 0 ? {} : { clientAuth: Object.freeze({
      plugin: clientAuth.plugin,
      varyHeaders
    }) }
  };
}
__name(createHotUpdater, "createHotUpdater");

// ../api-keys/dist/server/apiKeys.mjs
var API_KEY_HEADER_NAME = "x-api-key";
var BASE64URL_32_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
var bytesToBase64Url = /* @__PURE__ */ __name((bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "bytesToBase64Url");
var isApiKey = /* @__PURE__ */ __name((value) => {
  if (!BASE64URL_32_PATTERN.test(value)) return false;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(`${base64}=`);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return bytes.byteLength === 32 && bytesToBase64Url(bytes) === value;
  } catch {
    return false;
  }
}, "isApiKey");
var normalizeApiKeyHeaderName = /* @__PURE__ */ __name((value = API_KEY_HEADER_NAME) => {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("apiKeys({ headerName }) must name a valid header.");
  try {
    const headers = new Headers();
    headers.set(value, "");
    return headers.keys().next().value;
  } catch {
    throw new TypeError("apiKeys({ headerName }) must name a valid header.");
  }
}, "normalizeApiKeyHeaderName");
var hashApiKey = /* @__PURE__ */ __name(async (apiKey) => {
  if (!isApiKey(apiKey)) throw new TypeError("API key must be a canonical 32-byte base64url value.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
  return bytesToBase64Url(new Uint8Array(digest));
}, "hashApiKey");
var apiKeyId = /* @__PURE__ */ __name(() => {
  const bytes = /* @__PURE__ */ new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `api-${bytesToBase64Url(bytes)}`;
}, "apiKeyId");
var normalizeApiKeyName = /* @__PURE__ */ __name((name) => {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 64 || /[\p{Cc}\p{Cf}]/u.test(normalized)) throw new TypeError("API key names must contain 1-64 visible characters.");
  return normalized;
}, "normalizeApiKeyName");
var toApiKeyMetadata = /* @__PURE__ */ __name(({ hash: _hash, ...metadata }) => Object.freeze(metadata), "toApiKeyMetadata");
var registerApiKey = /* @__PURE__ */ __name(async (input) => {
  const hash2 = await hashApiKey(input.apiKey);
  const createdAtMs = input.createdAtMs ?? Date.now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) throw new TypeError("API key creation time must be non-negative.");
  const record = Object.freeze({
    created_at_ms: createdAtMs,
    hash: hash2,
    id: apiKeyId(),
    name: normalizeApiKeyName(input.name),
    prefix: input.apiKey.slice(0, 6),
    revoked_at_ms: null,
    role: "client"
  });
  if (await input.apiKeys.create(record) === "existing") {
    const existing = await input.apiKeys.findByHash(hash2);
    if (existing === null || existing.revoked_at_ms !== null) throw new Error("The API key has been revoked.");
    return Object.freeze({
      apiKey: input.apiKey,
      record: toApiKeyMetadata(existing)
    });
  }
  return Object.freeze({
    apiKey: input.apiKey,
    record: toApiKeyMetadata(record)
  });
}, "registerApiKey");
var createApiKey = /* @__PURE__ */ __name((input) => {
  const bytes = /* @__PURE__ */ new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return registerApiKey({
    apiKey: bytesToBase64Url(bytes),
    apiKeys: input.apiKeys,
    name: input.name
  });
}, "createApiKey");
var provisionApiKey = /* @__PURE__ */ __name((input) => {
  const existingApiKey = input.existingApiKey?.trim();
  return existingApiKey ? registerApiKey({
    apiKey: existingApiKey,
    apiKeys: input.apiKeys,
    name: input.name
  }) : createApiKey({
    apiKeys: input.apiKeys,
    name: input.name
  });
}, "provisionApiKey");
var authenticateApiKey = /* @__PURE__ */ __name(async (input) => {
  const apiKey = input.request.headers.get(normalizeApiKeyHeaderName(input.headerName));
  if (apiKey === null || !isApiKey(apiKey)) return false;
  const hash2 = await hashApiKey(apiKey);
  const record = await input.apiKeys.findByHash(hash2);
  return record !== null && record.hash === hash2 && record.role === "client" && record.revoked_at_ms === null;
}, "authenticateApiKey");
var createApiKeyManagement = /* @__PURE__ */ __name((input) => Object.freeze({
  async create({ name }) {
    const created = await createApiKey({
      apiKeys: input.apiKeys,
      name
    });
    return Object.freeze({
      apiKey: created.apiKey,
      record: created.record
    });
  },
  async list() {
    return Object.freeze((await input.apiKeys.list()).map(toApiKeyMetadata));
  },
  async revoke({ id }) {
    const record = await input.apiKeys.revoke({
      id,
      revokedAtMs: Date.now()
    });
    return record === null ? null : toApiKeyMetadata(record);
  }
}), "createApiKeyManagement");

// ../api-keys/dist/server/cli.mjs
var API_KEY_ENV = "HOT_UPDATER_API_KEY";
var generateApiKey = /* @__PURE__ */ __name(() => {
  const bytes = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "generateApiKey");
var apiKeysCli = /* @__PURE__ */ __name((headerName) => ({ clientCredential: {
  label: "API key",
  header: headerName,
  env: API_KEY_ENV,
  generate: generateApiKey,
  provision: /* @__PURE__ */ __name(async (api, { existing, name }) => (await api.provision({
    ...existing === void 0 ? {} : { existingApiKey: existing },
    name
  })).apiKey, "provision")
} }), "apiKeysCli");

// ../api-keys/dist/server/model.mjs
var toRow = /* @__PURE__ */ __name((row) => ({
  id: row.id,
  hash: row.hash,
  name: row.name,
  prefix: row.prefix,
  role: row.role,
  created_at_ms: row.created_at_ms,
  revoked_at_ms: row.revoked_at_ms
}), "toRow");
var createApiKeyModel = /* @__PURE__ */ __name((db) => ({
  async create(row) {
    try {
      return await db.transaction(async (tx) => {
        if (await tx.findOne("api_keys", { hash: row.hash }) !== null) return "existing";
        tx.create("api_keys", row);
        return "created";
      });
    } catch (error) {
      if (error instanceof DatabaseConstraintError && error.reason === "unique") return "existing";
      throw error;
    }
  },
  async findByHash(hash2) {
    const row = await db.findOne("api_keys", { hash: hash2 });
    return row === null ? null : toRow(row);
  },
  /** Every key, newest first, then by id; the whole list is the result. */
  async list() {
    const rows = [];
    let cursor;
    do {
      const page2 = await db.findMany("api_keys", {
        index: "byCreated",
        where: {},
        order: "desc",
        limit: 500,
        ...cursor === void 0 ? {} : { cursor }
      });
      rows.push(...page2.rows.map(toRow));
      cursor = page2.next;
    } while (cursor !== void 0);
    return rows.sort((left, right) => right.created_at_ms - left.created_at_ms || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  },
  revoke: /* @__PURE__ */ __name(({ id, revokedAtMs }) => db.transaction(async (tx) => {
    const row = await tx.findOne("api_keys", { id });
    if (row === null) return null;
    tx.update("api_keys", row, { revoked_at_ms: revokedAtMs });
    return toRow({
      ...row,
      revoked_at_ms: revokedAtMs
    });
  }), "revoke")
}), "createApiKeyModel");

// ../api-keys/dist/server/official.mjs
var OFFICIAL2 = /* @__PURE__ */ Symbol.for("@hot-updater/server/official-plugin");
var markOfficial = /* @__PURE__ */ __name((plugin) => Object.defineProperty(plugin, OFFICIAL2, { value: true }), "markOfficial");

// ../api-keys/dist/server/schema.mjs
var apiKeysSchema = { api_keys: defineTable({
  id: {
    type: "string",
    maxLength: 255
  },
  hash: {
    type: "string",
    maxLength: 64,
    unique: true
  },
  name: {
    type: "string",
    maxLength: 64
  },
  prefix: {
    type: "string",
    maxLength: 16
  },
  role: {
    type: "string",
    maxLength: 16
  },
  created_at_ms: { type: "integer" },
  revoked_at_ms: {
    type: "integer",
    required: false
  }
}, {
  key: ["id"],
  indexes: { byCreated: {
    eq: [],
    sort: ["created_at_ms"]
  } }
}) };

// ../api-keys/dist/server/index.mjs
var apiKeys = /* @__PURE__ */ __name((options = {}) => {
  const headerName = normalizeApiKeyHeaderName(options.headerName ?? "x-api-key");
  const plugin = definePlugin({
    id: "apiKeys",
    namespace: false,
    provides: { clientAuth: true },
    schemaVersion: "1.0.0",
    schema: apiKeysSchema,
    init: /* @__PURE__ */ __name(({ db }) => {
      const model = createApiKeyModel(db);
      return {
        api: {
          ...createApiKeyManagement({ apiKeys: model }),
          /** Registers a known plaintext key idempotently, for managed init. */
          register: /* @__PURE__ */ __name((input) => registerApiKey({
            ...input,
            apiKeys: model
          }), "register"),
          /** Reuses a saved key or creates one, for managed init. */
          provision: /* @__PURE__ */ __name((input) => provisionApiKey({
            ...input,
            apiKeys: model
          }), "provision")
        },
        clientAuth: {
          varyHeaders: [headerName],
          authenticate: /* @__PURE__ */ __name((headers) => authenticateApiKey({
            apiKeys: model,
            headerName,
            request: { headers }
          }), "authenticate")
        }
      };
    }, "init"),
    cli: apiKeysCli(headerName)
  });
  return markOfficial(plugin);
}, "apiKeys");

// ../insights/dist/server/schema.mjs
var HOUR_MS2 = 36e5;
var DAY_MS2 = 864e5;
var DEFAULT_INSIGHTS_RETENTION = {
  rawDays: 90,
  dailyDays: 400
};
var bucketRetention = /* @__PURE__ */ __name((days) => ({
  field: "bucket_start_ms",
  days
}), "bucketRetention");
var MOVEMENTS = /* @__PURE__ */ new Set([
  "UPDATE_DOWNLOADED",
  "UPDATE_APPLIED",
  "RECOVERED",
  "UPDATE_FAILED",
  "UNCHANGED"
]);
var isFailedCheck = /* @__PURE__ */ __name((row) => row.type === "UPDATE_FAILED" && row.metadata?.failure?.stage === "check", "isFailedCheck");
var metadataOf = /* @__PURE__ */ __name((row) => row.metadata ?? {}, "metadataOf");
var isLateEvent = /* @__PURE__ */ __name((row) => metadataOf(row).late === true, "isLateEvent");
var isLaunch = /* @__PURE__ */ __name((row) => {
  if (isLateEvent(row)) return false;
  if (row.type === "UPDATE_APPLIED") return true;
  if (row.type !== "UNCHANGED") return false;
  const kinds = metadataOf(row).change?.kinds ?? [];
  return kinds.includes("bundle") && !kinds.includes("first_seen") && row.to_release_id !== null;
}, "isLaunch");
var bundleRefsOf = /* @__PURE__ */ __name((row) => {
  if (isFailedCheck(row) || isLateEvent(row)) return [];
  if (row.type === "RECOVERED") return [`from:${row.from_bundle_id}`];
  if (row.type === "UNCHANGED") return isLaunch(row) ? [`on:${row.to_bundle_id}`] : [];
  return [`to:${row.to_bundle_id}`];
}, "bundleRefsOf");
var bundleRefOfFilter = /* @__PURE__ */ __name((filter) => filter.type === "RECOVERED" ? `from:${filter.fromBundleId}` : filter.type === "UNCHANGED" ? `on:${filter.toBundleId}` : `to:${filter.toBundleId}`, "bundleRefOfFilter");
var bundleEvents = /* @__PURE__ */ __name((days) => defineTable({
  id: {
    type: "string",
    maxLength: 36
  },
  type: {
    type: "string",
    maxLength: 32
  },
  install_id: {
    type: "string",
    maxLength: 255
  },
  user_id: {
    type: "string",
    maxLength: 255,
    required: false
  },
  from_release_id: {
    type: "string",
    maxLength: 36,
    required: false
  },
  from_bundle_id: {
    type: "string",
    maxLength: 36,
    required: false
  },
  to_release_id: {
    type: "string",
    maxLength: 36,
    required: false
  },
  to_bundle_id: {
    type: "string",
    maxLength: 36
  },
  platform: {
    type: "string",
    maxLength: 16
  },
  app_version: { type: "string" },
  channel: { type: "string" },
  metadata: { type: "json" },
  received_at_ms: { type: "integer" }
}, {
  key: ["id"],
  derived: {
    /** The UTC day the event was received in. */
    day: {
      type: "integer",
      compute: /* @__PURE__ */ __name((row) => row.received_at_ms - row.received_at_ms % DAY_MS2, "compute")
    },
    /** Every stored event belongs in installation history. */
    movement_install_id: {
      type: "string",
      compute: /* @__PURE__ */ __name((row) => MOVEMENTS.has(row.type) ? row.install_id : null, "compute")
    },
    /** The bundle a bundle filter matches (`bundleRefsOf`). */
    bundle_ref: {
      type: "string",
      multi: true,
      compute: /* @__PURE__ */ __name((row) => bundleRefsOf(row), "compute")
    }
  },
  indexes: {
    movementsByInstall: {
      eq: ["movement_install_id"],
      sort: ["received_at_ms"]
    },
    byBundle: {
      eq: [
        "platform",
        "channel",
        "type",
        "bundle_ref",
        "day"
      ],
      sort: ["received_at_ms"]
    },
    /** Events of every scope by day, for the console's unfiltered event list. */
    byDay: {
      eq: ["day"],
      sort: ["received_at_ms"]
    }
  },
  retention: {
    field: "day",
    days
  }
}), "bundleEvents");
var bundleEventHeads = /* @__PURE__ */ __name((days) => defineTable({
  install_id: {
    type: "string",
    maxLength: 255
  },
  id: {
    type: "string",
    maxLength: 36
  },
  type: {
    type: "string",
    maxLength: 32
  },
  user_id: {
    type: "string",
    maxLength: 255,
    required: false
  },
  from_release_id: {
    type: "string",
    maxLength: 36,
    required: false
  },
  from_bundle_id: {
    type: "string",
    maxLength: 36,
    required: false
  },
  to_release_id: {
    type: "string",
    maxLength: 36,
    required: false
  },
  to_bundle_id: {
    type: "string",
    maxLength: 36
  },
  platform: {
    type: "string",
    maxLength: 16
  },
  app_version: { type: "string" },
  channel: { type: "string" },
  metadata: { type: "json" },
  received_at_ms: { type: "integer" }
}, {
  key: ["install_id"],
  indexes: { byUser: {
    eq: ["user_id"],
    sort: ["install_id"]
  } },
  retention: {
    field: "received_at_ms",
    days
  }
}), "bundleEventHeads");
var COUNTER_SHARDS = 8;
var GAUGE_SHARDS = 32;
var SKETCH_SHARDS = 16;
var identityFields = {
  identity: {
    type: "string",
    maxLength: 32
  },
  bucket_start_ms: { type: "integer" }
};
var window = {
  eq: ["identity"],
  sort: ["bucket_start_ms"]
};
var WINDOW_COUNTERS = [
  "downloads",
  "failed_launches",
  "patch_downloads",
  "patch_fallbacks"
];
var counters = /* @__PURE__ */ __name((retention) => defineAggregate(identityFields, {
  key: ["identity", "bucket_start_ms"],
  counters: WINDOW_COUNTERS,
  shards: COUNTER_SHARDS,
  batched: true,
  indexes: { window },
  retention
}), "counters");
var lifetimeCounters = /* @__PURE__ */ __name(() => defineAggregate(identityFields, {
  key: ["identity", "bucket_start_ms"],
  counters: [
    ...WINDOW_COUNTERS,
    "applies",
    "failed_updates"
  ],
  shards: COUNTER_SHARDS,
  batched: true,
  indexes: { window }
}), "lifetimeCounters");
var sketches = /* @__PURE__ */ __name((retention) => defineAggregate(identityFields, {
  key: ["identity", "bucket_start_ms"],
  distinct: ["activity_users", "failed_users"],
  shards: SKETCH_SHARDS,
  batched: true,
  indexes: { window },
  retention
}), "sketches");
var lifetimeSketches = /* @__PURE__ */ __name(() => defineAggregate(identityFields, {
  key: ["identity", "bucket_start_ms"],
  distinct: ["failed_users"],
  shards: SKETCH_SHARDS,
  batched: true,
  indexes: { window }
}), "lifetimeSketches");
var insightsFailures = /* @__PURE__ */ __name((retention) => defineAggregate({
  platform: {
    type: "string",
    maxLength: 16
  },
  channel: { type: "string" },
  bucket_start_ms: { type: "integer" },
  release_id: {
    type: "string",
    maxLength: 36
  },
  stage: {
    type: "string",
    maxLength: 16
  },
  reason: {
    type: "string",
    maxLength: 64
  },
  detail: {
    type: "string",
    maxLength: 160
  }
}, {
  key: [
    "platform",
    "channel",
    "bucket_start_ms",
    "release_id",
    "stage",
    "reason",
    "detail"
  ],
  counters: ["events"],
  shards: COUNTER_SHARDS,
  batched: true,
  indexes: { byScope: {
    eq: ["platform", "channel"],
    sort: ["bucket_start_ms"]
  } },
  retention
}), "insightsFailures");
var insightsDistribution = /* @__PURE__ */ __name((retention) => defineAggregate({
  channel: { type: "string" },
  platform: {
    type: "string",
    maxLength: 16
  },
  app_version: { type: "string" },
  release_id: {
    type: "string",
    maxLength: 36
  },
  bucket_start_ms: { type: "integer" }
}, {
  key: [
    "channel",
    "platform",
    "app_version",
    "release_id",
    "bucket_start_ms"
  ],
  gauges: ["latest_installations"],
  shards: GAUGE_SHARDS,
  batched: true,
  indexes: {
    byScope: {
      eq: ["channel", "platform"],
      sort: ["bucket_start_ms"]
    },
    byVersion: {
      eq: [
        "channel",
        "platform",
        "app_version"
      ],
      sort: ["bucket_start_ms"]
    }
  },
  retention
}), "insightsDistribution");
var insightsBuiltinDistribution = /* @__PURE__ */ __name((retention) => defineAggregate({
  channel: { type: "string" },
  platform: {
    type: "string",
    maxLength: 16
  },
  app_version: { type: "string" },
  release_id: {
    type: "string",
    maxLength: 36
  },
  builtin_bundle_id: {
    type: "string",
    maxLength: 36
  },
  bucket_start_ms: { type: "integer" }
}, {
  key: [
    "channel",
    "platform",
    "app_version",
    "release_id",
    "builtin_bundle_id",
    "bucket_start_ms"
  ],
  gauges: ["latest_installations"],
  shards: GAUGE_SHARDS,
  batched: true,
  indexes: {
    byScope: {
      eq: ["channel", "platform"],
      sort: ["bucket_start_ms"]
    },
    byVersion: {
      eq: [
        "channel",
        "platform",
        "app_version"
      ],
      sort: ["bucket_start_ms"]
    }
  },
  retention
}), "insightsBuiltinDistribution");
var insightsLatestByBundle = /* @__PURE__ */ __name((retention) => defineAggregate({
  platform: {
    type: "string",
    maxLength: 16
  },
  channel: { type: "string" },
  bundle_field: {
    type: "string",
    maxLength: 16
  },
  bundle_id: {
    type: "string",
    maxLength: 36
  },
  type: {
    type: "string",
    maxLength: 32
  },
  bucket_start_ms: { type: "integer" }
}, {
  key: [
    "platform",
    "channel",
    "bundle_field",
    "bundle_id",
    "type",
    "bucket_start_ms"
  ],
  gauges: ["installations"],
  shards: GAUGE_SHARDS,
  batched: true,
  indexes: { byBundle: {
    eq: [
      "platform",
      "channel",
      "bundle_field",
      "bundle_id",
      "type"
    ],
    sort: ["bucket_start_ms"]
  } },
  retention
}), "insightsLatestByBundle");
var insightsOutcomes = /* @__PURE__ */ __name((retention) => defineAggregate({
  platform: {
    type: "string",
    maxLength: 16
  },
  channel: { type: "string" },
  type: {
    type: "string",
    maxLength: 32
  },
  bundle_ref: {
    type: "string",
    maxLength: 41
  },
  bucket_start_ms: { type: "integer" }
}, {
  key: [
    "platform",
    "channel",
    "type",
    "bundle_ref",
    "bucket_start_ms"
  ],
  counters: ["events"],
  shards: COUNTER_SHARDS,
  batched: true,
  indexes: { byRef: {
    eq: [
      "platform",
      "channel",
      "type",
      "bundle_ref"
    ],
    sort: ["bucket_start_ms"]
  } },
  retention
}), "insightsOutcomes");
var DAILY_EVENTS = {
  platform: "*",
  channel: "",
  type: "",
  bundle_ref: ""
};
var createInsightsSchema = /* @__PURE__ */ __name(({ rawDays, dailyDays } = DEFAULT_INSIGHTS_RETENTION) => {
  const hourly = bucketRetention(rawDays);
  const daily = bucketRetention(dailyDays);
  return {
    bundle_events: bundleEvents(rawDays),
    bundle_event_heads: bundleEventHeads(dailyDays),
    /** Hourly counters and sketches: the raw period. */
    insights_overview: counters(hourly),
    insights_sketches: sketches(hourly),
    /** Daily counters and sketches: the daily period. */
    insights_overview_daily: counters(daily),
    insights_sketches_daily: sketches(daily),
    /** A release's counters since its first event, and its failed installations: kept. */
    insights_overview_lifetime: lifetimeCounters(),
    insights_sketches_lifetime: lifetimeSketches(),
    insights_distribution: insightsDistribution(daily),
    insights_builtin_distribution: insightsBuiltinDistribution(daily),
    insights_latest_by_bundle: insightsLatestByBundle(daily),
    insights_outcomes: insightsOutcomes(hourly),
    insights_failures: insightsFailures(hourly)
  };
}, "createInsightsSchema");
var insightsSchema = createInsightsSchema();

// ../insights/dist/server/eventRow.mjs
var CHANGE_KINDS = /* @__PURE__ */ new Set([
  "first_seen",
  "bundle",
  "release",
  "app_version",
  "channel",
  "native_build"
]);
var isBundleEventChange = /* @__PURE__ */ __name((value) => isDatabaseJsonObject(value) && Array.isArray(value.kinds) && value.kinds.length > 0 && value.kinds.every((kind) => CHANGE_KINDS.has(kind)) && (value.previous === null || isDatabaseJsonObject(value.previous) && typeof value.previous.bundle_id === "string" && (value.previous.release_id === null || typeof value.previous.release_id === "string") && typeof value.previous.app_version === "string" && typeof value.previous.channel === "string" && isOptional(value.previous, "min_bundle_id", isString)), "isBundleEventChange");
var isOptional = /* @__PURE__ */ __name((value, key, valid) => !Object.hasOwn(value, key) || valid(value[key]), "isOptional");
var isString = /* @__PURE__ */ __name((value) => typeof value === "string", "isString");
var isDatabaseHttpResponse = /* @__PURE__ */ __name((value) => isDatabaseJsonObject(value) && (value.resource === "catalog" || value.resource === "artifact") && isString(value.path) && Number.isSafeInteger(value.status) && (value.body === null || isString(value.body)) && typeof value.body_truncated === "boolean" && Number.isSafeInteger(value.received_at_ms), "isDatabaseHttpResponse");
var isDatabaseBundleEventFailure = /* @__PURE__ */ __name((value) => isDatabaseJsonObject(value) && isString(value.stage) && isString(value.reason) && isOptional(value, "resource", isString) && isOptional(value, "http_status", (status) => Number.isSafeInteger(status)) && isOptional(value, "transport", isString) && isOptional(value, "origin_code", isString) && isOptional(value, "error_message", isString) && isOptional(value, "error_stack", isString), "isDatabaseBundleEventFailure");
var isDatabaseBundleEventMetadata = /* @__PURE__ */ __name((value) => isDatabaseJsonObject(value) && typeof value.cohort === "string" && (value.update_strategy === null || value.update_strategy === "fingerprint" || value.update_strategy === "appVersion") && (value.fingerprint_hash === null || typeof value.fingerprint_hash === "string") && (value.sdk_version === null || typeof value.sdk_version === "string") && isOptional(value, "min_bundle_id", isString) && isOptional(value, "failure", isDatabaseBundleEventFailure) && isOptional(value, "http_response", isDatabaseHttpResponse) && isOptional(value, "delivery", isString) && isOptional(value, "patch_fallback", (flag) => typeof flag === "boolean") && isOptional(value, "change", isBundleEventChange) && isOptional(value, "late", (flag) => flag === true) && isOptional(value, "implied_download", (flag) => flag === true), "isDatabaseBundleEventMetadata");
var isRecord5 = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null && !Array.isArray(value), "isRecord");
var runningBuiltinBundleId = /* @__PURE__ */ __name((row) => {
  const running = row.type === "UPDATE_DOWNLOADED" ? row.from_bundle_id : row.to_bundle_id;
  const builtin = isRecord5(row.metadata) ? row.metadata.min_bundle_id : null;
  return typeof builtin === "string" && running === builtin ? builtin : null;
}, "runningBuiltinBundleId");
var isIdentity = /* @__PURE__ */ __name((value) => typeof value === "string" && value.length > 0 && value.length <= 255, "isIdentity");
var isTextOrNull2 = /* @__PURE__ */ __name((value) => value === null || typeof value === "string", "isTextOrNull");
var BUNDLE_EVENT_FIELDS = {
  id: /* @__PURE__ */ __name((value) => typeof value === "string", "id"),
  type: /* @__PURE__ */ __name((value) => value === "UPDATE_DOWNLOADED" || value === "UPDATE_APPLIED" || value === "RECOVERED" || value === "UPDATE_FAILED" || value === "UNCHANGED", "type"),
  install_id: isIdentity,
  user_id: /* @__PURE__ */ __name((value) => value === null || isIdentity(value), "user_id"),
  from_bundle_id: isTextOrNull2,
  from_release_id: isTextOrNull2,
  to_release_id: isTextOrNull2,
  to_bundle_id: /* @__PURE__ */ __name((value) => typeof value === "string", "to_bundle_id"),
  platform: /* @__PURE__ */ __name((value) => value === "ios" || value === "android", "platform"),
  app_version: /* @__PURE__ */ __name((value) => typeof value === "string", "app_version"),
  channel: /* @__PURE__ */ __name((value) => typeof value === "string", "channel"),
  metadata: isDatabaseBundleEventMetadata,
  received_at_ms: /* @__PURE__ */ __name((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "received_at_ms")
};
var hasMetadata = /* @__PURE__ */ __name((row, key) => isRecord5(row.metadata) && Object.hasOwn(row.metadata, key), "hasMetadata");
var updateStrategyOf = /* @__PURE__ */ __name((row) => isRecord5(row.metadata) ? row.metadata.update_strategy : void 0, "updateStrategyOf");
var hasEventInvariants = /* @__PURE__ */ __name((row) => (row.type === "UPDATE_DOWNLOADED" || row.type === "UPDATE_APPLIED" || row.type === "RECOVERED" || row.type === "UPDATE_FAILED") && typeof row.from_bundle_id === "string" && (updateStrategyOf(row) === "fingerprint" || updateStrategyOf(row) === "appVersion") && (row.type !== "UPDATE_FAILED" || isRecord5(row.metadata) && isRecord5(row.metadata.failure)) && !hasMetadata(row, "change") && (!hasMetadata(row, "late") || row.type === "UPDATE_DOWNLOADED" || row.type === "UPDATE_APPLIED") && (!hasMetadata(row, "implied_download") || row.type === "UPDATE_APPLIED" || row.type === "RECOVERED") || row.type === "UNCHANGED" && !hasMetadata(row, "late") && row.from_bundle_id === null && updateStrategyOf(row) === null, "hasEventInvariants");
var validateBundleEventFields = /* @__PURE__ */ __name((row) => {
  if (!isRecord5(row)) throw new DatabaseAdapterInputError("invalid-data");
  for (const field of Object.keys(row)) if (!Object.hasOwn(BUNDLE_EVENT_FIELDS, field)) throw new DatabaseAdapterInputError("invalid-field");
  for (const [field, valid] of Object.entries(BUNDLE_EVENT_FIELDS)) if (!Object.hasOwn(row, field) || !valid(row[field])) throw new DatabaseAdapterInputError("invalid-data");
  if (!hasEventInvariants(row)) throw new DatabaseAdapterInputError("invalid-data");
}, "validateBundleEventFields");

// ../insights/dist/server/contract.mjs
var encoder2 = new TextEncoder();
var compareInsightsText = /* @__PURE__ */ __name((left, right) => {
  const a = encoder2.encode(left);
  const b = encoder2.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}, "compareInsightsText");
var isWellFormedText = /* @__PURE__ */ __name((value) => {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point >= 55296 && point <= 57343) return false;
  }
  return true;
}, "isWellFormedText");
var isIdentity2 = /* @__PURE__ */ __name((value) => typeof value === "string" && value.length > 0 && value.length <= 255 && isWellFormedText(value), "isIdentity");
var isText2 = /* @__PURE__ */ __name((value) => typeof value === "string" && value.length > 0 && isWellFormedText(value), "isText");
var isTimestamp = /* @__PURE__ */ __name((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "isTimestamp");
var isLimit = /* @__PURE__ */ __name((value) => isTimestamp(value) && value >= 1 && value <= 101, "isLimit");
var hasOnlyKeys = /* @__PURE__ */ __name((value, keys) => Object.keys(value).every((key) => keys.includes(key)), "hasOnlyKeys");
var hasScope = /* @__PURE__ */ __name((value) => (value.platform === "ios" || value.platform === "android") && isText2(value.channel), "hasScope");
var isBundleFilter = /* @__PURE__ */ __name((value, withKind = false) => {
  if (!isRecord5(value) || !hasScope(value)) return false;
  const keys = [
    "platform",
    "channel",
    "type",
    ...withKind ? ["kind"] : []
  ];
  return value.type === "RECOVERED" ? isText2(value.fromBundleId) && hasOnlyKeys(value, [...keys, "fromBundleId"]) : (value.type === "UPDATE_DOWNLOADED" || value.type === "UPDATE_APPLIED" || value.type === "UPDATE_FAILED" || value.type === "UNCHANGED") && isText2(value.toBundleId) && hasOnlyKeys(value, [...keys, "toBundleId"]);
}, "isBundleFilter");
var isEventFilter = /* @__PURE__ */ __name((value) => {
  if (!isRecord5(value)) return false;
  if (value.kind === "all") return hasOnlyKeys(value, ["kind"]);
  if (value.kind === "installationMovement") return isIdentity2(value.installId) && hasOnlyKeys(value, ["kind", "installId"]);
  return value.kind === "bundle" && isBundleFilter(value, true);
}, "isEventFilter");
var validateRow = /* @__PURE__ */ __name((model, row, result = false) => {
  try {
    validateBundleEventFields(row);
    if (!isRecord5(row) || typeof row.id !== "string" || !isUUIDv7(row.id) || [...Object.values(row), ...isRecord5(row.metadata) ? Object.values(row.metadata) : []].some((value) => typeof value === "string" && !isWellFormedText(value))) throw new DatabaseAdapterInputError("invalid-data");
  } catch (error) {
    if (result) throw new DatabaseAdapterInputError("invalid-result");
    throw error;
  }
}, "validateRow");
var assertBundleEventRow = /* @__PURE__ */ __name((row) => validateRow("bundle_events", row), "assertBundleEventRow");
var isInsightsMovementEvent = /* @__PURE__ */ __name((event) => event.type === "UPDATE_DOWNLOADED" || event.type === "UPDATE_APPLIED" || event.type === "RECOVERED" || event.type === "UPDATE_FAILED" || event.type === "UNCHANGED", "isInsightsMovementEvent");
var matchesInsightsEventFilter = /* @__PURE__ */ __name((event, filter) => {
  if (filter.kind === "all") return true;
  if (filter.kind === "installationMovement") return event.install_id === filter.installId && isInsightsMovementEvent(event);
  return event.type === filter.type && event.platform === filter.platform && event.channel === filter.channel && bundleRefsOf(event).includes(bundleRefOfFilter(filter));
}, "matchesInsightsEventFilter");
var invalidQuery = /* @__PURE__ */ __name(() => {
  throw new DatabaseAdapterInputError("invalid-query");
}, "invalidQuery");
var invalidResult = /* @__PURE__ */ __name(() => {
  throw new DatabaseAdapterInputError("invalid-result");
}, "invalidResult");
var validateCount = /* @__PURE__ */ __name((count) => isTimestamp(count) ? count : invalidResult(), "validateCount");
var isTimeRange = /* @__PURE__ */ __name((value) => isRecord5(value) && hasOnlyKeys(value, ["start", "end"]) && isTimestamp(value.start) && isTimestamp(value.end) && value.start < value.end, "isTimeRange");
var isReleaseReference = /* @__PURE__ */ __name((value) => isRecord5(value) && hasOnlyKeys(value, [
  "releaseId",
  "platform",
  "channel"
]) && isIdentity2(value.releaseId) && hasScope(value), "isReleaseReference");
var validateAggregateResult = /* @__PURE__ */ __name((value) => {
  const result = isRecord5(value) ? value : invalidResult();
  if (!isTimestamp(result.measuredAtMs)) invalidResult();
  const coverage = result.coverage;
  if (!isRecord5(coverage) || coverage.kind !== "complete" && coverage.kind !== "partial" || coverage.sinceMs !== null && !isTimestamp(coverage.sinceMs)) invalidResult();
}, "validateAggregateResult");
var createValidatedInsightsModel = /* @__PURE__ */ __name((model) => ({
  async recordEvent(input) {
    if (!isRecord5(input) || !hasOnlyKeys(input, ["event"])) throw new DatabaseAdapterInputError("invalid-data");
    validateRow("bundle_events", input.event);
    await model.recordEvent(input);
  },
  async listEvents(input) {
    if (!isRecord5(input) || !hasOnlyKeys(input, [
      "filter",
      "sinceMs",
      "beforeReceivedAtMs",
      "after",
      "limit"
    ]) || !isEventFilter(input.filter) || !isLimit(input.limit) || !isTimestamp(input.beforeReceivedAtMs) || input.sinceMs !== void 0 && !isTimestamp(input.sinceMs)) invalidQuery();
    const sinceMs = input.sinceMs ?? 0;
    if (sinceMs > input.beforeReceivedAtMs || input.after !== void 0 && (!isRecord5(input.after) || !hasOnlyKeys(input.after, ["receivedAtMs", "id"]) || !isTimestamp(input.after.receivedAtMs) || typeof input.after.id !== "string" || !isUUIDv7(input.after.id) || input.after.receivedAtMs < sinceMs || input.after.receivedAtMs >= input.beforeReceivedAtMs)) invalidQuery();
    const rows = await model.listEvents(input);
    if (!Array.isArray(rows) || rows.length > input.limit) invalidResult();
    let previous = input.after;
    for (const row of rows) {
      validateRow("bundle_events", row, true);
      if (row.received_at_ms < sinceMs || row.received_at_ms >= input.beforeReceivedAtMs || !matchesInsightsEventFilter(row, input.filter) || previous !== void 0 && (row.received_at_ms > previous.receivedAtMs || row.received_at_ms === previous.receivedAtMs && row.id >= previous.id)) invalidResult();
      previous = {
        receivedAtMs: row.received_at_ms,
        id: row.id
      };
    }
    return rows;
  },
  async findLatestEvents(input) {
    if (!isRecord5(input)) invalidQuery();
    if ("installId" in input) {
      if (!hasOnlyKeys(input, ["installId"]) || !isIdentity2(input.installId)) invalidQuery();
    } else if (!hasOnlyKeys(input, [
      "userId",
      "afterInstallId",
      "limit"
    ]) || !isIdentity2(input.userId) || !isLimit(input.limit) || input.afterInstallId !== void 0 && !isIdentity2(input.afterInstallId)) invalidQuery();
    const rows = await model.findLatestEvents(input);
    if (!Array.isArray(rows) || rows.length > ("installId" in input ? 1 : input.limit)) invalidResult();
    let previous = "installId" in input ? void 0 : input.afterInstallId;
    for (const row of rows) {
      validateRow("bundle_events", row, true);
      if ("installId" in input ? row.install_id !== input.installId : row.user_id !== input.userId || previous !== void 0 && compareInsightsText(row.install_id, previous) <= 0) invalidResult();
      previous = row.install_id;
    }
    return rows;
  },
  async countLatestEvents(input) {
    if (!isRecord5(input) || !hasOnlyKeys(input, [
      "platform",
      "channel",
      "sinceMs",
      "bundle"
    ]) || !hasScope(input) || !isTimestamp(input.sinceMs) || input.bundle !== void 0 && (!Array.isArray(input.bundle) || input.bundle.length < 1 || input.bundle.length > 2 || input.bundle.some((bundle) => !isRecord5(bundle) || !hasOnlyKeys(bundle, [
      "field",
      "value",
      "types"
    ]) || bundle.field !== "from_bundle_id" && bundle.field !== "to_bundle_id" || !isText2(bundle.value) || !Array.isArray(bundle.types) || bundle.types.length === 0 || bundle.types.some((type) => ![
      "UNCHANGED",
      "UPDATE_DOWNLOADED",
      "UPDATE_APPLIED",
      "RECOVERED"
    ].includes(type))))) invalidQuery();
    return validateCount(await model.countLatestEvents(input));
  },
  async countEvents(input) {
    if (!isRecord5(input) || !hasOnlyKeys(input, [
      "filter",
      "sinceMs",
      "beforeReceivedAtMs"
    ]) || !isBundleFilter(input.filter) || !isTimestamp(input.sinceMs) || !isTimestamp(input.beforeReceivedAtMs) || input.sinceMs > input.beforeReceivedAtMs) invalidQuery();
    return validateCount(await model.countEvents(input));
  },
  async countEventSeries(input) {
    if (!isRecord5(input) || !hasOnlyKeys(input, [
      "filter",
      "timeRange",
      "intervalMs"
    ]) || !isBundleFilter(input.filter) || !isTimeRange(input.timeRange) || !isTimestamp(input.intervalMs)) invalidQuery();
    const { start, end } = input.timeRange;
    const { intervalMs } = input;
    if (intervalMs === 0 || intervalMs % 36e5 !== 0 || start % 36e5 !== 0 || (end - start) % intervalMs !== 0 || end - start > 7776e6) invalidQuery();
    const points = await model.countEventSeries(input);
    if (!Array.isArray(points) || points.length !== (end - start) / intervalMs || points.some((point, index) => !isRecord5(point) || !hasOnlyKeys(point, ["startMs", "events"]) || point.startMs !== start + index * intervalMs || !isTimestamp(point.events))) invalidResult();
    return points;
  },
  async getReleaseActivity(input) {
    if (!isRecord5(input) || !hasOnlyKeys(input, ["releases"]) || !Array.isArray(input.releases) || input.releases.length < 1 || input.releases.length > 100 || !input.releases.every(isReleaseReference)) invalidQuery();
    const result = await model.getReleaseActivity(input);
    if (!isRecord5(result) || !isTimestamp(result.measuredAtMs) || !Array.isArray(result.data) || result.data.some((item) => !isRecord5(item) || !isReleaseReference(item.release) || !isRecord5(item.metrics) || !isTimestamp(item.metrics.downloads) || !isTimestamp(item.metrics.applies) || !isTimestamp(item.metrics.failedLaunches))) invalidResult();
    return result;
  },
  async getAppUsage(input) {
    if (!isRecord5(input) || !hasOnlyKeys(input, [
      "channel",
      "platform",
      "appVersion",
      "timeRange",
      "intervalMs"
    ]) || !isText2(input.channel) || ![
      "all",
      "ios",
      "android"
    ].includes(input.platform) || input.appVersion !== void 0 && !isText2(input.appVersion) || !isTimeRange(input.timeRange) || !isTimestamp(input.intervalMs) || input.intervalMs < 36e5) invalidQuery();
    const result = await model.getAppUsage(input);
    validateAggregateResult(result);
    if (!isTimestamp(result.activeInstallations) || !Array.isArray(result.points) || !Array.isArray(result.appVersions) || !Array.isArray(result.versions) || !Array.isArray(result.platforms) || !Array.isArray(result.bundleDistribution)) invalidResult();
    return result;
  }
}), "createValidatedInsightsModel");

// ../insights/dist/server/model.mjs
var createInsightsModel = /* @__PURE__ */ __name((api) => createValidatedInsightsModel({
  recordEvent: /* @__PURE__ */ __name(({ event }) => api.recordEvent(event), "recordEvent"),
  listEvents: api.listEvents,
  findLatestEvents: api.findLatestEvents,
  countLatestEvents: api.countLatestEvents,
  countEvents: api.countEvents,
  countEventSeries: api.countEventSeries,
  getReleaseActivity: api.getReleaseActivity,
  getAppUsage: api.getAppUsage
}), "createInsightsModel");

// ../insights/dist/server/official.mjs
var OFFICIAL3 = /* @__PURE__ */ Symbol.for("@hot-updater/server/official-plugin");
var markOfficial2 = /* @__PURE__ */ __name((plugin) => Object.defineProperty(plugin, OFFICIAL3, { value: true }), "markOfficial");

// ../insights/dist/server/errors.mjs
var InsightsBadRequestError = class extends Error {
  static {
    __name(this, "InsightsBadRequestError");
  }
  name = "InsightsBadRequestError";
};
var InsightsPayloadTooLargeError = class extends Error {
  static {
    __name(this, "InsightsPayloadTooLargeError");
  }
  maximumBytes;
  name = "InsightsPayloadTooLargeError";
  constructor(maximumBytes) {
    super(`Event payload exceeds ${maximumBytes} bytes`);
    this.maximumBytes = maximumBytes;
  }
};

// ../insights/dist/server/eventInput.mjs
var MAX_EVENT_STRING_LENGTH = 1024;
var MAX_IDENTITY_LENGTH = 255;
var EVENT_BODY_MAX_BYTES = 16384;
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isRecord6, "isRecord");
function requireStringField(payload, key) {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_EVENT_STRING_LENGTH || new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(value)) !== value) throw new InsightsBadRequestError(`Invalid event field: ${key}`);
  return value;
}
__name(requireStringField, "requireStringField");
function requireNullableStringField(payload, key) {
  if (payload[key] === null) return null;
  return requireStringField(payload, key);
}
__name(requireNullableStringField, "requireNullableStringField");
function requireIdentityField(payload, key) {
  const value = requireStringField(payload, key);
  if (value.length > MAX_IDENTITY_LENGTH) throw new InsightsBadRequestError(`Invalid event field: ${key}`);
  return value;
}
__name(requireIdentityField, "requireIdentityField");
function readEventId(payload) {
  const value = payload.eventId;
  if (value === void 0) return void 0;
  if (!isUUIDv7(value)) throw new InsightsBadRequestError("Invalid event field: eventId");
  return value;
}
__name(readEventId, "readEventId");
var readMinBundleId = /* @__PURE__ */ __name((value) => typeof value === "string" && value.length > 0 && value.length <= 36 ? value : null, "readMinBundleId");
var oneOf = /* @__PURE__ */ __name((values, value) => values.includes(value) ? value : "unknown", "oneOf");
var STAGES = [
  "check",
  "download",
  "install"
];
var REASONS = [
  "network",
  "http",
  "invalid_response",
  "hash_mismatch",
  "signature",
  "patch",
  "extract",
  "storage"
];
var RESOURCES = [
  "catalog",
  "artifact",
  "manifest",
  "file",
  "patch",
  "archive"
];
var TRANSPORTS = [
  "timeout",
  "dns",
  "tls",
  "connection",
  "offline",
  "cancelled"
];
var DELIVERIES = [
  "patch",
  "manifest",
  "archive"
];
var CODE = /^[A-Za-z0-9._-]{1,64}$/;
var readCode = /* @__PURE__ */ __name((value) => typeof value === "string" && CODE.test(value) ? value : void 0, "readCode");
var readMetadata = /* @__PURE__ */ __name((payload) => isRecord6(payload.metadata) ? payload.metadata : {}, "readMetadata");
function readFailure(value) {
  const failure = isRecord6(value) ? value : {};
  const httpStatus = failure.httpStatus;
  const originCode = readCode(failure.originCode);
  const errorMessage = typeof failure.errorMessage === "string" && failure.errorMessage.length <= 2048 ? failure.errorMessage : void 0;
  const errorStack = typeof failure.errorStack === "string" && failure.errorStack.length <= 4096 ? failure.errorStack : void 0;
  return {
    stage: oneOf(STAGES, failure.stage),
    reason: oneOf(REASONS, failure.reason),
    ...failure.resource == null ? {} : { resource: oneOf(RESOURCES, failure.resource) },
    ...Number.isSafeInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {},
    ...failure.transport == null ? {} : { transport: oneOf(TRANSPORTS, failure.transport) },
    ...originCode === void 0 ? {} : { originCode },
    ...errorMessage === void 0 ? {} : { errorMessage },
    ...errorStack === void 0 ? {} : { errorStack }
  };
}
__name(readFailure, "readFailure");
function readHttpResponse(value) {
  if (!isRecord6(value) || value.resource !== "catalog" && value.resource !== "artifact" || typeof value.path !== "string" || value.path.length > 1024 || !Number.isSafeInteger(value.status) || value.status < 100 || value.status > 599 || value.body !== null && (typeof value.body !== "string" || new TextEncoder().encode(JSON.stringify(value.body)).byteLength > 4096) || typeof value.bodyTruncated !== "boolean" || !Number.isSafeInteger(value.receivedAtMs) || value.receivedAtMs < 0) throw new InsightsBadRequestError("Invalid HTTP response details");
  return {
    resource: value.resource,
    path: value.path,
    status: value.status,
    body: value.body,
    bodyTruncated: value.bodyTruncated,
    receivedAtMs: value.receivedAtMs
  };
}
__name(readHttpResponse, "readHttpResponse");
async function readBoundedText(request) {
  const contentLength = request.headers.get("content-length");
  const declaredByteLength = Number(contentLength);
  if (contentLength !== null && Number.isSafeInteger(declaredByteLength) && declaredByteLength > 16384) throw new InsightsPayloadTooLargeError(EVENT_BODY_MAX_BYTES);
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const decoder2 = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    byteLength += result.value.byteLength;
    if (byteLength > 16384) {
      await reader.cancel();
      throw new InsightsPayloadTooLargeError(EVENT_BODY_MAX_BYTES);
    }
    text += decoder2.decode(result.value, { stream: true });
  }
  return text + decoder2.decode();
}
__name(readBoundedText, "readBoundedText");
async function parseJson(request) {
  const text = await readBoundedText(request);
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new InsightsBadRequestError("Invalid event payload");
    throw error;
  }
}
__name(parseJson, "parseJson");
function requireEvent(payload) {
  if (!isRecord6(payload)) throw new InsightsBadRequestError("Invalid event payload");
  const platform = requireStringField(payload, "platform");
  if (platform !== "ios" && platform !== "android") throw new InsightsBadRequestError("Invalid event field: platform");
  const eventId = readEventId(payload);
  const metadata = readMetadata(payload);
  const httpMetadata = metadata.httpResponse === void 0 ? {} : { httpResponse: readHttpResponse(metadata.httpResponse) };
  const base = {
    ...metadata.httpResponse === void 0 ? {} : { metadata: httpMetadata },
    ...eventId === void 0 ? {} : { eventId },
    installId: requireIdentityField(payload, "installId"),
    toBundleId: requireStringField(payload, "toBundleId"),
    ...payload.userId === void 0 ? {} : { userId: requireIdentityField(payload, "userId") },
    platform,
    appVersion: requireStringField(payload, "appVersion"),
    channel: requireStringField(payload, "channel"),
    cohort: requireStringField(payload, "cohort"),
    fingerprintHash: requireNullableStringField(payload, "fingerprintHash"),
    sdkVersion: payload.sdkVersion === void 0 ? null : requireNullableStringField(payload, "sdkVersion"),
    minBundleId: readMinBundleId(payload.minBundleId),
    fromReleaseId: requireNullableStringField(payload, "fromReleaseId"),
    toReleaseId: requireNullableStringField(payload, "toReleaseId")
  };
  const type = requireStringField(payload, "type");
  const movement = /* @__PURE__ */ __name(() => {
    const updateStrategy = requireStringField(payload, "updateStrategy");
    if (updateStrategy !== "fingerprint" && updateStrategy !== "appVersion") throw new InsightsBadRequestError("Invalid event field: updateStrategy");
    return {
      ...base,
      fromBundleId: requireStringField(payload, "fromBundleId"),
      updateStrategy
    };
  }, "movement");
  switch (type) {
    case "UPDATE_DOWNLOADED": {
      const delivery = metadata.delivery;
      const read = {
        ...httpMetadata,
        ...delivery == null ? {} : { delivery: oneOf(DELIVERIES, delivery) },
        ...metadata.patchFallback === true ? { patchFallback: true } : {}
      };
      return {
        ...movement(),
        type,
        ...Object.keys(read).length === 0 ? {} : { metadata: read }
      };
    }
    case "UPDATE_APPLIED":
    case "RECOVERED":
      return {
        ...movement(),
        type
      };
    case "UPDATE_FAILED":
      return {
        ...movement(),
        type,
        metadata: {
          ...httpMetadata,
          failure: readFailure(metadata.failure)
        }
      };
    case "UNCHANGED":
      if (payload.fromBundleId !== null || payload.updateStrategy !== null) throw new InsightsBadRequestError("Invalid unchanged event shape");
      return {
        ...base,
        type,
        fromBundleId: null,
        updateStrategy: null
      };
    default:
      throw new InsightsBadRequestError("Invalid event field: type");
  }
}
__name(requireEvent, "requireEvent");
async function parseBundleEventRequest(request) {
  return requireEvent(await parseJson(request));
}
__name(parseBundleEventRequest, "parseBundleEventRequest");
function createBundleEventRow(input) {
  input = requireEvent(input);
  const base = {
    app_version: input.appVersion,
    channel: input.channel,
    from_release_id: input.fromReleaseId,
    id: input.eventId ?? createUUIDv7(),
    install_id: input.installId,
    platform: input.platform,
    received_at_ms: Date.now(),
    to_bundle_id: input.toBundleId,
    to_release_id: input.toReleaseId,
    user_id: input.userId ?? null
  };
  const response = input.metadata?.httpResponse;
  const metadata = {
    ...response ? { http_response: {
      resource: response.resource,
      path: response.path,
      status: response.status,
      body: response.body,
      body_truncated: response.bodyTruncated,
      received_at_ms: response.receivedAtMs
    } } : {},
    cohort: input.cohort,
    fingerprint_hash: input.fingerprintHash,
    sdk_version: input.sdkVersion ?? null,
    ...input.minBundleId ? { min_bundle_id: input.minBundleId } : {},
    update_strategy: input.updateStrategy
  };
  switch (input.type) {
    case "UPDATE_DOWNLOADED": {
      const { delivery, patchFallback } = input.metadata ?? {};
      return {
        ...base,
        from_bundle_id: input.fromBundleId,
        type: input.type,
        metadata: {
          ...metadata,
          ...delivery === void 0 ? {} : { delivery },
          ...patchFallback ? { patch_fallback: true } : {}
        }
      };
    }
    case "UPDATE_APPLIED":
    case "RECOVERED":
      return {
        ...base,
        from_bundle_id: input.fromBundleId,
        type: input.type,
        metadata
      };
    case "UPDATE_FAILED": {
      const { failure } = input.metadata;
      return {
        ...base,
        from_bundle_id: input.fromBundleId,
        type: input.type,
        metadata: {
          ...metadata,
          failure: {
            stage: failure.stage,
            reason: failure.reason,
            ...failure.errorMessage === void 0 ? {} : { error_message: failure.errorMessage },
            ...failure.errorStack === void 0 ? {} : { error_stack: failure.errorStack },
            ...failure.resource === void 0 ? {} : { resource: failure.resource },
            ...failure.httpStatus === void 0 ? {} : { http_status: failure.httpStatus },
            ...failure.transport === void 0 ? {} : { transport: failure.transport },
            ...failure.originCode === void 0 ? {} : { origin_code: failure.originCode }
          }
        }
      };
    }
    case "UNCHANGED":
      return {
        ...base,
        from_bundle_id: null,
        type: input.type,
        metadata
      };
  }
}
__name(createBundleEventRow, "createBundleEventRow");

// ../insights/dist/server/provider.mjs
var DEFAULT_PAGE_LIMIT = 50;
var MAX_PAGE_LIMIT = 100;
var MAX_EVENT_ID_LENGTH = 1024;
var MAX_IDENTITY_LENGTH2 = 255;
var MAX_CURSOR_LENGTH = 8192;
var HOUR_MS3 = 36e5;
var DAY_MS3 = 24 * HOUR_MS3;
var WINDOW_MS2 = {
  "24h": 864e5,
  "7d": 6048e5,
  "30d": 2592e6
};
var EVENT_LIST_RANGE_MS = 2160 * HOUR_MS3;
var isRecord7 = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null && !Array.isArray(value), "isRecord");
var requireString = /* @__PURE__ */ __name((value, label, maximumLength) => {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(value)) !== value) throw new InsightsBadRequestError(`Invalid ${label}.`);
  return value;
}, "requireString");
var requireTimestamp = /* @__PURE__ */ __name((value, label) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new InsightsBadRequestError(`Invalid ${label}.`);
  return Number(value);
}, "requireTimestamp");
var readLimit = /* @__PURE__ */ __name((value) => {
  const limit = value ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) throw new InsightsBadRequestError("Invalid page limit.");
  return limit;
}, "readLimit");
var encodeBase64Url = /* @__PURE__ */ __name((value) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}, "encodeBase64Url");
var decodeBase64Url = /* @__PURE__ */ __name((value) => {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH) throw new InsightsBadRequestError("Invalid Insights cursor.");
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InsightsBadRequestError("Invalid Insights cursor.");
  }
}, "decodeBase64Url");
var encodeCursor2 = /* @__PURE__ */ __name((value) => encodeBase64Url(JSON.stringify(value)), "encodeCursor");
var decodeCursor2 = /* @__PURE__ */ __name((value) => {
  try {
    return JSON.parse(decodeBase64Url(value));
  } catch (error) {
    if (error instanceof InsightsBadRequestError) throw error;
    throw new InsightsBadRequestError("Invalid Insights cursor.");
  }
}, "decodeCursor");
var readScope = /* @__PURE__ */ __name((input) => {
  if (input.platform !== "ios" && input.platform !== "android") throw new InsightsBadRequestError("Invalid Insights platform.");
  return {
    platform: input.platform,
    channel: requireString(input.channel, "channel", MAX_EVENT_ID_LENGTH)
  };
}, "readScope");
var bundleFilter = /* @__PURE__ */ __name((input) => {
  const scope = readScope(input);
  const bundleId = requireString(input.bundleId, "bundle ID", MAX_EVENT_ID_LENGTH);
  switch (input.outcome) {
    case "downloaded":
      return {
        ...scope,
        type: "UPDATE_DOWNLOADED",
        toBundleId: bundleId
      };
    case "applied":
      return {
        ...scope,
        type: "UPDATE_APPLIED",
        toBundleId: bundleId
      };
    case "recovered":
      return {
        ...scope,
        type: "RECOVERED",
        fromBundleId: bundleId
      };
    case "failed":
      return {
        ...scope,
        type: "UPDATE_FAILED",
        toBundleId: bundleId
      };
    default:
      throw new InsightsBadRequestError("Invalid Insights outcome.");
  }
}, "bundleFilter");
var sameFilter = /* @__PURE__ */ __name((left, right) => {
  if (!isRecord7(left) || left.kind !== right.kind) return false;
  switch (right.kind) {
    case "all":
      return true;
    case "installationMovement":
      return left.installId === right.installId;
    case "bundle":
      return left.platform === right.platform && left.channel === right.channel && left.type === right.type && (right.type === "RECOVERED" ? left.fromBundleId === right.fromBundleId : left.toBundleId === right.toBundleId);
  }
}, "sameFilter");
var readEventCursor = /* @__PURE__ */ __name((value, filter) => {
  const cursor = decodeCursor2(value);
  if (!isRecord7(cursor) || cursor.version !== 2 || cursor.kind !== "events" || !isRecord7(cursor.filter) || !isRecord7(cursor.after)) throw new InsightsBadRequestError("Invalid Insights cursor.");
  if (!sameFilter(cursor.filter, filter)) throw new InsightsBadRequestError("Insights cursor does not match the requested events.");
  if (typeof cursor.after.id !== "string" || !isUUIDv7(cursor.after.id)) throw new InsightsBadRequestError("Invalid Insights event cursor ID.");
  return {
    after: {
      id: cursor.after.id,
      receivedAtMs: requireTimestamp(cursor.after.receivedAtMs, "event cursor")
    },
    beforeReceivedAtMs: requireTimestamp(cursor.beforeReceivedAtMs, "event cutoff"),
    kind: "events",
    sinceMs: requireTimestamp(cursor.sinceMs, "event start"),
    filter,
    version: 2
  };
}, "readEventCursor");
var readUserInstallationCursor = /* @__PURE__ */ __name((value, userId) => {
  const cursor = decodeCursor2(value);
  if (!isRecord7(cursor) || cursor.version !== 1 || cursor.kind !== "user-installations" || cursor.userId !== userId) throw new InsightsBadRequestError("Insights cursor does not match the requested user ID.");
  return {
    afterInstallId: requireString(cursor.afterInstallId, "installation cursor", MAX_IDENTITY_LENGTH2),
    kind: "user-installations",
    userId,
    version: 1
  };
}, "readUserInstallationCursor");
var compareEventNewest = /* @__PURE__ */ __name((left, right) => right.received_at_ms - left.received_at_ms || compareInsightsText(right.id, left.id), "compareEventNewest");
var isAfterEventCursor = /* @__PURE__ */ __name((row, after) => row.received_at_ms < after.receivedAtMs || row.received_at_ms === after.receivedAtMs && compareInsightsText(row.id, after.id) < 0, "isAfterEventCursor");
var assertEventRows = /* @__PURE__ */ __name((rows, input) => {
  if (rows.length > input.limit) throw new Error("Insights database returned too many event rows.");
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    if (!row || typeof row.id !== "string" || !isUUIDv7(row.id) || !Number.isSafeInteger(row.received_at_ms) || row.received_at_ms >= input.beforeReceivedAtMs || row.received_at_ms < input.sinceMs || previous !== void 0 && compareEventNewest(previous, row) >= 0 || input.after !== void 0 && !isAfterEventCursor(row, input.after) || input.filter.kind === "installationMovement" && (row.install_id !== input.filter.installId || !isInsightsMovementEvent(row)) || input.filter.kind === "bundle" && (row.platform !== input.filter.platform || row.channel !== input.filter.channel || row.type !== input.filter.type || (input.filter.type === "RECOVERED" ? row.from_bundle_id !== input.filter.fromBundleId : row.to_bundle_id !== input.filter.toBundleId))) throw new Error("Insights database returned invalid event rows.");
  }
}, "assertEventRows");
var toFailure = /* @__PURE__ */ __name((failure) => ({
  stage: failure.stage,
  reason: failure.reason,
  ...failure.error_message === void 0 ? {} : { errorMessage: failure.error_message },
  ...failure.error_stack === void 0 ? {} : { errorStack: failure.error_stack },
  ...failure.resource === void 0 ? {} : { resource: failure.resource },
  ...failure.http_status === void 0 ? {} : { httpStatus: failure.http_status },
  ...failure.transport === void 0 ? {} : { transport: failure.transport },
  ...failure.origin_code === void 0 ? {} : { originCode: failure.origin_code }
}), "toFailure");
var eventDetails = /* @__PURE__ */ __name(({ type, metadata }) => ({
  ...metadata.http_response !== void 0 ? { httpResponse: {
    resource: metadata.http_response.resource,
    path: metadata.http_response.path,
    status: metadata.http_response.status,
    body: metadata.http_response.body,
    bodyTruncated: metadata.http_response.body_truncated,
    receivedAtMs: metadata.http_response.received_at_ms
  } } : {},
  ...type === "UPDATE_FAILED" && metadata.failure !== void 0 ? { failure: toFailure(metadata.failure) } : {},
  ...type === "UPDATE_DOWNLOADED" && metadata.delivery !== void 0 ? { delivery: metadata.delivery } : {},
  ...type === "UPDATE_DOWNLOADED" && metadata.patch_fallback === true ? { patchFallback: true } : {},
  ...type === "UNCHANGED" && metadata.change !== void 0 ? { change: {
    kinds: metadata.change.kinds,
    ...metadata.change.previous === null ? {} : { previous: {
      bundleId: metadata.change.previous.bundle_id,
      releaseId: metadata.change.previous.release_id,
      appVersion: metadata.change.previous.app_version,
      channel: metadata.change.previous.channel,
      ...metadata.change.previous.min_bundle_id === void 0 ? {} : { minBundleId: metadata.change.previous.min_bundle_id }
    } }
  } } : {},
  ...metadata.late === true ? { late: true } : {},
  ...metadata.implied_download === true ? { impliedDownload: true } : {}
}), "eventDetails");
var toEventHistoryRow = /* @__PURE__ */ __name((row) => ({
  ...row.to_release_id == null ? {} : { toReleaseId: row.to_release_id },
  ...row.metadata.sdk_version == null ? {} : { sdkVersion: row.metadata.sdk_version },
  ...row.metadata.min_bundle_id === void 0 ? {} : { minBundleId: row.metadata.min_bundle_id },
  appVersion: row.app_version,
  channel: row.channel,
  cohort: row.metadata.cohort,
  fromBundleId: row.from_bundle_id,
  id: row.id,
  installId: row.install_id,
  platform: row.platform,
  receivedAtMs: row.received_at_ms,
  toBundleId: row.to_bundle_id,
  type: row.type,
  userId: row.user_id,
  ...eventDetails(row)
}), "toEventHistoryRow");
var toInstallationRow = /* @__PURE__ */ __name((row) => ({
  ...eventDetails(row).httpResponse ? { httpResponse: eventDetails(row).httpResponse } : {},
  ...row.metadata.min_bundle_id === void 0 ? {} : { minBundleId: row.metadata.min_bundle_id },
  appVersion: row.app_version,
  channel: row.channel,
  cohort: row.metadata.cohort,
  installId: row.install_id,
  lastKnownBundleId: row.type === "UPDATE_DOWNLOADED" ? row.from_bundle_id : row.to_bundle_id,
  pendingBundleId: row.type === "UPDATE_DOWNLOADED" ? row.to_bundle_id : null,
  pendingReleaseId: row.type === "UPDATE_DOWNLOADED" ? row.to_release_id : null,
  latestStatus: row.type,
  platform: row.platform,
  receivedAtMs: row.received_at_ms,
  userId: row.user_id
}), "toInstallationRow");
var defaultEventStart = /* @__PURE__ */ __name((filter, beforeReceivedAtMs) => filter.kind === "installationMovement" ? 0 : Math.max(0, beforeReceivedAtMs - EVENT_LIST_RANGE_MS), "defaultEventStart");
var isInsideBounds = /* @__PURE__ */ __name(({ after }, bounds) => after.receivedAtMs >= bounds.sinceMs && after.receivedAtMs < bounds.beforeReceivedAtMs, "isInsideBounds");
var readEventBounds = /* @__PURE__ */ __name((input, cursor, filter) => {
  const beforeReceivedAtMs = cursor?.beforeReceivedAtMs ?? (input.beforeReceivedAtMs === void 0 ? Date.now() : requireTimestamp(input.beforeReceivedAtMs, "event cutoff"));
  if (cursor !== void 0 && input.beforeReceivedAtMs !== void 0 && input.beforeReceivedAtMs !== beforeReceivedAtMs) throw new InsightsBadRequestError("Insights cursor does not match the requested event cutoff.");
  const sinceMs = cursor?.sinceMs ?? (input.sinceMs === void 0 ? defaultEventStart(filter, beforeReceivedAtMs) : requireTimestamp(input.sinceMs, "event start"));
  const bounds = {
    beforeReceivedAtMs,
    sinceMs
  };
  if (sinceMs > beforeReceivedAtMs || input.sinceMs !== void 0 && input.sinceMs !== sinceMs || cursor !== void 0 && !isInsideBounds(cursor, bounds)) throw new InsightsBadRequestError("Insights cursor or range does not match the requested event start.");
  if (filter.kind !== "installationMovement" && beforeReceivedAtMs - sinceMs > 7776e6) throw new InsightsBadRequestError("Insights event lists cover at most 90 days: send a sinceMs no more than 90 days before beforeReceivedAtMs.");
  return bounds;
}, "readEventBounds");
var pageEventRows = /* @__PURE__ */ __name(async (model, input, filter, map) => {
  const limit = readLimit(input.limit);
  const cursor = input.cursor === void 0 ? void 0 : readEventCursor(input.cursor, filter);
  const bounds = readEventBounds(input, cursor, filter);
  const query2 = {
    filter,
    ...bounds,
    ...cursor === void 0 ? {} : { after: cursor.after },
    limit
  };
  const rows = await model.listEvents(query2);
  assertEventRows(rows, query2);
  const last = rows.at(-1);
  return {
    beforeReceivedAtMs: bounds.beforeReceivedAtMs,
    data: rows.map(map),
    nextCursor: rows.length === limit && last ? encodeCursor2({
      after: {
        id: last.id,
        receivedAtMs: last.received_at_ms
      },
      ...bounds,
      kind: "events",
      filter,
      version: 2
    }) : null
  };
}, "pageEventRows");
var assertInstallationRows = /* @__PURE__ */ __name((rows, input) => {
  if (rows.length > input.limit) throw new Error("Insights database returned too many installation rows.");
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    if (!row || row.user_id !== input.userId || input.afterInstallId !== void 0 && compareInsightsText(row.install_id, input.afterInstallId) <= 0 || previous !== void 0 && compareInsightsText(previous.install_id, row.install_id) >= 0) throw new Error("Insights database returned invalid installation rows.");
  }
}, "assertInstallationRows");
var createInsightsProvider = /* @__PURE__ */ __name((model) => Object.freeze({
  async appendBundleEvent(input) {
    const event = createBundleEventRow(input);
    await model.recordEvent({ event });
  },
  listEvents(input) {
    const filter = input.bundle === void 0 ? { kind: "all" } : {
      kind: "bundle",
      ...bundleFilter(input.bundle)
    };
    return pageEventRows(model, input, filter, toEventHistoryRow);
  },
  async listInstallationEvents(input) {
    if ("bundle" in input && input.bundle !== void 0) throw new InsightsBadRequestError("Installation movement queries cannot include a bundle filter.");
    const installId = requireString(input.installId, "install ID", MAX_IDENTITY_LENGTH2);
    return pageEventRows(model, input, {
      kind: "installationMovement",
      installId
    }, (row) => toEventHistoryRow(row));
  },
  async getInstallation({ installId }) {
    const normalizedInstallId = requireString(installId, "install ID", MAX_IDENTITY_LENGTH2);
    const rows = await model.findLatestEvents({ installId: normalizedInstallId });
    const row = rows[0] ?? null;
    if (rows.length > 1 || row !== null && row.install_id !== normalizedInstallId) throw new Error("Insights database returned an invalid installation.");
    return row === null ? null : toInstallationRow(row);
  },
  async pageInstallationsByCurrentUserId(input) {
    const userId = requireString(input.userId, "user ID", MAX_IDENTITY_LENGTH2);
    const limit = readLimit(input.limit);
    const cursor = input.cursor === void 0 ? void 0 : readUserInstallationCursor(input.cursor, userId);
    const databaseInput = {
      userId,
      ...cursor === void 0 ? {} : { afterInstallId: cursor.afterInstallId },
      limit
    };
    const rows = await model.findLatestEvents(databaseInput);
    assertInstallationRows(rows, databaseInput);
    const last = rows.at(-1);
    return {
      data: rows.map(toInstallationRow),
      nextCursor: rows.length === limit && last ? encodeCursor2({
        afterInstallId: last.install_id,
        kind: "user-installations",
        userId,
        version: 1
      }) : null
    };
  },
  async getReportingOverview(input) {
    const scope = readScope(input);
    const { window: window2 } = input;
    if (!Object.hasOwn(WINDOW_MS2, window2)) throw new InsightsBadRequestError("Invalid reporting installation window.");
    const now = Date.now();
    const beforeReceivedAtMs = now - now % HOUR_MS3 + (now % HOUR_MS3 === 0 ? 0 : HOUR_MS3);
    const reach = Math.max(0, beforeReceivedAtMs - WINDOW_MS2[window2]);
    const sinceMs = reach - reach % DAY_MS3;
    const measure = /* @__PURE__ */ __name(async (count) => {
      const value = await count;
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Insights database returned an invalid count.");
      return {
        count: value,
        measuredAtMs: Date.now()
      };
    }, "measure");
    const bundleId = input.bundleId === void 0 ? void 0 : requireString(input.bundleId, "bundle ID", MAX_EVENT_ID_LENGTH);
    const reporting = measure(model.countLatestEvents({
      ...scope,
      sinceMs
    }));
    if (bundleId === void 0) return {
      ...scope,
      window: window2,
      sinceMs,
      beforeReceivedAtMs,
      reportingInstallations: await reporting
    };
    const countOutcome2 = /* @__PURE__ */ __name((outcome) => measure(model.countEvents({
      filter: bundleFilter({
        ...scope,
        bundleId,
        outcome
      }),
      sinceMs,
      beforeReceivedAtMs
    })), "countOutcome");
    const [reportingInstallations, bundleInstallations, downloadedReports, appliedReports, recoveredReports, failedReports] = await Promise.all([
      reporting,
      measure(model.countLatestEvents({
        ...scope,
        sinceMs,
        bundle: [{
          field: "from_bundle_id",
          value: bundleId,
          types: ["UPDATE_DOWNLOADED"]
        }, {
          field: "to_bundle_id",
          value: bundleId,
          types: [
            "UNCHANGED",
            "UPDATE_APPLIED",
            "RECOVERED"
          ]
        }]
      })),
      countOutcome2("downloaded"),
      countOutcome2("applied"),
      countOutcome2("recovered"),
      countOutcome2("failed")
    ]);
    return {
      ...scope,
      window: window2,
      sinceMs,
      beforeReceivedAtMs,
      reportingInstallations,
      bundle: {
        bundleId,
        reportingInstallations: bundleInstallations,
        downloadedReports,
        appliedReports,
        recoveredReports,
        failedReports
      }
    };
  }
}), "createInsightsProvider");

// ../insights/dist/server/overview.mjs
var encodeIdentity = /* @__PURE__ */ __name((identity) => [
  identity.scopeKind,
  identity.releaseKind,
  identity.releaseId,
  identity.channel,
  identity.platform,
  identity.appVersionKind,
  identity.appVersion,
  identity.periodKind,
  String(identity.bucketStartMs)
].map((value) => `${new TextEncoder().encode(value).length}:${value}`).join(""), "encodeIdentity");
var fnv = /* @__PURE__ */ __name((value, seed) => {
  let result = seed;
  for (const byte of new TextEncoder().encode(value)) {
    result ^= BigInt(byte);
    result = BigInt.asUintN(64, result * 1099511628211n);
  }
  return result.toString(16).padStart(16, "0");
}, "fnv");
var insightsKey = /* @__PURE__ */ __name((value) => `${fnv(value, 14695981039346656037n)}${fnv(value, 9521211207457086692n)}`, "insightsKey");
var insightsOverviewId = /* @__PURE__ */ __name((identity) => insightsKey(encodeIdentity(identity)), "insightsOverviewId");
var hour = /* @__PURE__ */ __name((value) => Math.floor(value / 36e5) * 36e5, "hour");
var insightsOverviewDeltas = /* @__PURE__ */ __name((event) => {
  const bucketStartMs = hour(event.received_at_ms);
  const counters2 = /* @__PURE__ */ new Map();
  const append = /* @__PURE__ */ __name((identity, values) => {
    const key = encodeIdentity(identity);
    const previous = counters2.get(key);
    counters2.set(key, {
      identity,
      downloads: (previous?.downloads ?? 0) + values.downloads,
      applies: (previous?.applies ?? 0) + values.applies,
      failedLaunches: (previous?.failedLaunches ?? 0) + values.failedLaunches,
      activityIdentity: previous?.activityIdentity ?? values.activityIdentity
    });
  }, "append");
  const metric = /* @__PURE__ */ __name((releaseId, values) => {
    const windowed = {
      ...values,
      applies: 0
    };
    if (releaseId !== null) for (const [periodKind, start] of [["lifetime", 0], ["hour", bucketStartMs]]) append({
      scopeKind: "release",
      releaseKind: "specific",
      releaseId,
      channel: event.channel,
      platform: event.platform,
      appVersionKind: "all",
      appVersion: "",
      periodKind,
      bucketStartMs: start
    }, periodKind === "lifetime" ? values : windowed);
    append({
      scopeKind: "channel",
      releaseKind: "all",
      releaseId: "",
      channel: event.channel,
      platform: event.platform,
      appVersionKind: "all",
      appVersion: "",
      periodKind: "hour",
      bucketStartMs
    }, windowed);
  }, "metric");
  const implied = event.metadata.implied_download === true ? 1 : 0;
  if (!isLateEvent(event) && event.type === "UPDATE_DOWNLOADED") metric(event.to_release_id, {
    downloads: 1,
    applies: 0,
    failedLaunches: 0
  });
  else if (!isLateEvent(event) && isLaunch(event)) metric(event.to_release_id, {
    downloads: implied,
    applies: 1,
    failedLaunches: 0
  });
  else if (!isLateEvent(event) && event.type === "RECOVERED") metric(event.from_release_id, {
    downloads: implied,
    applies: 0,
    failedLaunches: 1
  });
  for (const platform of [event.platform, "all"]) for (const appVersionKind of ["specific", "all"]) append({
    scopeKind: "usage",
    releaseKind: "all",
    releaseId: "",
    channel: event.channel,
    platform,
    appVersionKind,
    appVersion: appVersionKind === "specific" ? event.app_version : "",
    periodKind: "hour",
    bucketStartMs
  }, {
    downloads: 0,
    applies: 0,
    failedLaunches: 0,
    activityIdentity: event.install_id
  });
  return [...counters2.values()];
}, "insightsOverviewDeltas");

// ../insights/dist/server/recordEvent.mjs
var hourOf = /* @__PURE__ */ __name((ms) => ms - ms % HOUR_MS2, "hourOf");
var dayOf = /* @__PURE__ */ __name((ms) => ms - ms % DAY_MS2, "dayOf");
var insightsIdentity = /* @__PURE__ */ __name((identity) => insightsOverviewId({
  ...identity,
  scopeKind: identity.scopeKind,
  periodKind: identity.periodKind,
  bucketStartMs: 0
}), "insightsIdentity");
var gaugeSlot = /* @__PURE__ */ __name((head) => ({
  bucket: dayOf(head.received_at_ms),
  releaseId: head.type === "UPDATE_DOWNLOADED" ? head.from_release_id : head.to_release_id,
  builtinBundleId: runningBuiltinBundleId(head)
}), "gaugeSlot");
var PAIR_FIELD = "from_to";
var bundlePairKey = /* @__PURE__ */ __name((from, to) => insightsKey(`${from.length}:${from}${to.length}:${to}`), "bundlePairKey");
var countHead = /* @__PURE__ */ __name((tx, head, delta) => {
  const { bucket, releaseId, builtinBundleId } = gaugeSlot(head);
  const shardBy = head.install_id;
  tx.aggregate("insights_distribution", {
    channel: head.channel,
    platform: head.platform,
    app_version: head.app_version,
    release_id: releaseId ?? "",
    bucket_start_ms: bucket
  }, { latest_installations: delta }, { shardBy });
  if (builtinBundleId !== null) tx.aggregate("insights_builtin_distribution", {
    channel: head.channel,
    platform: head.platform,
    app_version: head.app_version,
    release_id: releaseId ?? "",
    builtin_bundle_id: builtinBundleId,
    bucket_start_ms: bucket
  }, { latest_installations: delta }, { shardBy });
  for (const field of ["from_bundle_id", "to_bundle_id"]) {
    const bundleId = head[field];
    if (bundleId === null) continue;
    tx.aggregate("insights_latest_by_bundle", {
      platform: head.platform,
      channel: head.channel,
      bundle_field: field,
      bundle_id: bundleId,
      type: head.type,
      bucket_start_ms: bucket
    }, { installations: delta }, { shardBy });
  }
  if (head.from_bundle_id !== null) tx.aggregate("insights_latest_by_bundle", {
    platform: head.platform,
    channel: head.channel,
    bundle_field: PAIR_FIELD,
    bundle_id: bundlePairKey(head.from_bundle_id, head.to_bundle_id),
    type: head.type,
    bucket_start_ms: bucket
  }, { installations: delta }, { shardBy });
}, "countHead");
var PERIOD_MODELS = {
  hour: {
    counters: "insights_overview",
    sketches: "insights_sketches"
  },
  day: {
    counters: "insights_overview_daily",
    sketches: "insights_sketches_daily"
  },
  lifetime: {
    counters: "insights_overview_lifetime",
    sketches: void 0
  }
};
var patchCounters = /* @__PURE__ */ __name((event) => event.type !== "UPDATE_DOWNLOADED" ? {} : {
  ...event.metadata.delivery === "patch" ? { patch_downloads: 1 } : {},
  ...event.metadata.patch_fallback === true ? { patch_fallbacks: 1 } : {}
}, "patchCounters");
var countEvent = /* @__PURE__ */ __name((tx, event) => {
  const shardBy = event.install_id;
  for (const delta of insightsOverviewDeltas(event)) {
    if (delta.identity.platform === "all") continue;
    const { bucketStartMs, ...parts } = delta.identity;
    const periods = parts.scopeKind === "channel" || parts.scopeKind === "usage" ? [["hour", bucketStartMs], ["day", dayOf(event.received_at_ms)]] : [[parts.periodKind, bucketStartMs]];
    for (const [periodKind, bucket] of periods) {
      const models = PERIOD_MODELS[periodKind];
      const key = {
        identity: insightsIdentity({
          ...parts,
          periodKind
        }),
        bucket_start_ms: bucket
      };
      const counters2 = {
        ...Object.fromEntries([
          ["downloads", delta.downloads],
          ["applies", delta.applies],
          ["failed_launches", delta.failedLaunches]
        ].filter(([, value]) => value !== 0)),
        ...delta.downloads === 0 ? {} : patchCounters(event)
      };
      if (Object.keys(counters2).length > 0) tx.aggregate(models.counters, key, counters2, { shardBy });
      if (models.sketches !== void 0 && delta.activityIdentity !== void 0) tx.aggregate(models.sketches, key, { activity_users: addDistinct(null, delta.activityIdentity) }, { shardBy });
    }
  }
}, "countEvent");
var countOutcome = /* @__PURE__ */ __name((tx, event) => {
  const shardBy = event.install_id;
  const hour2 = /* @__PURE__ */ __name((type, bundleRef) => tx.aggregate("insights_outcomes", {
    platform: event.platform,
    channel: event.channel,
    type,
    bundle_ref: bundleRef,
    bucket_start_ms: hourOf(event.received_at_ms)
  }, { events: 1 }, { shardBy }), "hour");
  for (const bundleRef of bundleRefsOf(event)) hour2(event.type, bundleRef);
  if (event.metadata.implied_download === true) hour2("UPDATE_DOWNLOADED", bundleRefOfFilter({
    type: "UPDATE_DOWNLOADED",
    toBundleId: event.type === "RECOVERED" ? event.from_bundle_id : event.to_bundle_id
  }));
  tx.aggregate("insights_outcomes", {
    ...DAILY_EVENTS,
    bucket_start_ms: dayOf(event.received_at_ms)
  }, { events: 1 }, { shardBy });
}, "countOutcome");
var UNKNOWN_FAILURE = {
  stage: "unknown",
  reason: "unknown"
};
var failureDetail = /* @__PURE__ */ __name((failure) => JSON.stringify([
  failure.resource ?? null,
  failure.http_status ?? null,
  failure.origin_code ?? null,
  failure.transport ?? null
]), "failureDetail");
var countFailure = /* @__PURE__ */ __name((tx, event) => {
  const shardBy = event.install_id;
  const failure = event.metadata.failure ?? UNKNOWN_FAILURE;
  const check = failure.stage === "check";
  const hour2 = hourOf(event.received_at_ms);
  const scope = {
    channel: event.channel,
    platform: event.platform,
    appVersionKind: "all",
    appVersion: ""
  };
  const channel = {
    ...scope,
    releaseKind: "all",
    releaseId: ""
  };
  const users = { failed_users: addDistinct(null, event.install_id) };
  for (const [periodKind, bucket] of [["hour", hour2], ["day", dayOf(event.received_at_ms)]]) {
    const identity = insightsIdentity({
      ...channel,
      scopeKind: check ? "check" : "failure",
      periodKind
    });
    tx.aggregate(PERIOD_MODELS[periodKind].sketches, {
      identity,
      bucket_start_ms: bucket
    }, users, { shardBy });
  }
  const releaseId = check ? null : event.to_release_id;
  if (releaseId !== null) {
    const release = {
      ...scope,
      releaseKind: "specific",
      releaseId
    };
    for (const [periodKind, bucket, sketches2] of [[
      "hour",
      hour2,
      "insights_sketches"
    ], [
      "lifetime",
      0,
      "insights_sketches_lifetime"
    ]]) {
      const key = /* @__PURE__ */ __name((scopeKind) => ({
        identity: insightsIdentity({
          ...release,
          scopeKind,
          periodKind
        }),
        bucket_start_ms: bucket
      }), "key");
      tx.aggregate(sketches2, key("failure"), users, { shardBy });
    }
    tx.aggregate("insights_overview_lifetime", {
      identity: insightsIdentity({
        ...release,
        scopeKind: "release",
        periodKind: "lifetime"
      }),
      bucket_start_ms: 0
    }, { failed_updates: 1 }, { shardBy });
  }
  tx.aggregate("insights_failures", {
    platform: event.platform,
    channel: event.channel,
    bucket_start_ms: hour2,
    release_id: releaseId ?? "",
    stage: failure.stage,
    reason: failure.reason,
    detail: failureDetail(failure)
  }, { events: 1 }, { shardBy });
}, "countFailure");
var isNewer = /* @__PURE__ */ __name((event, head) => event.received_at_ms !== head.received_at_ms ? event.received_at_ms > head.received_at_ms : compareUtf8(event.id, head.id) > 0, "isNewer");
var runningOf = /* @__PURE__ */ __name((head) => head.type === "UPDATE_DOWNLOADED" ? {
  bundle_id: head.from_bundle_id,
  release_id: head.from_release_id
} : {
  bundle_id: head.to_bundle_id,
  release_id: head.to_release_id
}, "runningOf");
var minBundleIdOf = /* @__PURE__ */ __name((row) => row.metadata?.min_bundle_id, "minBundleIdOf");
var madeAt = /* @__PURE__ */ __name((id) => isUUIDv7(id) ? extractTimestampFromUUIDv7(id) : null, "madeAt");
var isLate = /* @__PURE__ */ __name((event, head) => {
  if (head === null) return false;
  if (event.type === "UPDATE_DOWNLOADED" || event.type === "UPDATE_APPLIED") return event.to_bundle_id === runningOf(head).bundle_id || event.type === "UPDATE_DOWNLOADED" && head.type === "UPDATE_DOWNLOADED" && event.from_bundle_id === head.from_bundle_id && event.to_bundle_id === head.to_bundle_id;
  if (event.type === "UNCHANGED") {
    const made = madeAt(event.id);
    const latest = madeAt(head.id);
    return made !== null && latest !== null && made < latest;
  }
  return false;
}, "isLate");
var changeOf = /* @__PURE__ */ __name((event, head) => {
  if (event.type !== "UNCHANGED") return null;
  if (head === null) return {
    kinds: ["first_seen"],
    previous: null
  };
  if (!isNewer(event, head)) return null;
  const running = runningOf(head);
  const build = minBundleIdOf(event);
  const headBuild = minBundleIdOf(head);
  const kinds = [];
  if (event.to_bundle_id !== running.bundle_id) kinds.push("bundle");
  if (event.to_release_id !== running.release_id) kinds.push("release");
  if (event.app_version !== head.app_version) kinds.push("app_version");
  if (event.channel !== head.channel) kinds.push("channel");
  if (build !== void 0 && headBuild !== void 0 && build !== headBuild) kinds.push("native_build");
  return kinds.length === 0 ? null : {
    kinds,
    previous: {
      bundle_id: running.bundle_id,
      release_id: running.release_id,
      app_version: head.app_version,
      channel: head.channel,
      ...headBuild === void 0 ? {} : { min_bundle_id: headBuild }
    }
  };
}, "changeOf");
var impliesDownload = /* @__PURE__ */ __name((event, head) => {
  const target = event.type === "RECOVERED" ? {
    bundle: event.from_bundle_id,
    release: event.from_release_id
  } : isLaunch(event) ? {
    bundle: event.to_bundle_id,
    release: event.to_release_id
  } : null;
  if (target === null || target.release === null || target.bundle === minBundleIdOf(event)) return false;
  if (head === null) return false;
  if (head.type === "UPDATE_DOWNLOADED" && head.to_bundle_id === target.bundle) return false;
  return runningOf(head).bundle_id !== target.bundle;
}, "impliesDownload");
var recordedOf = /* @__PURE__ */ __name((event, head) => {
  const { change: _change, late: _late, implied_download: _implied, ...metadata } = event.metadata;
  const reported = {
    ...event,
    metadata
  };
  const late = isLate(reported, head);
  const change = late ? null : changeOf(reported, head);
  const withChange = change === null ? reported : {
    ...reported,
    metadata: {
      ...metadata,
      change
    }
  };
  return {
    recorded: late && reported.type !== "UNCHANGED" ? {
      ...reported,
      metadata: {
        ...metadata,
        late: true
      }
    } : !late && impliesDownload(withChange, head) ? {
      ...withChange,
      metadata: {
        ...withChange.metadata,
        implied_download: true
      }
    } : withChange,
    late
  };
}, "recordedOf");
var REPEATED_FIELDS = [
  "channel",
  "platform",
  "app_version",
  "to_bundle_id",
  "to_release_id",
  "user_id"
];
var repeatsHead = /* @__PURE__ */ __name((event, head) => event.type === "UNCHANGED" && head.type !== "UPDATE_DOWNLOADED" && dayOf(event.received_at_ms) === dayOf(head.received_at_ms) && REPEATED_FIELDS.every((field) => event[field] === head[field]), "repeatsHead");
var recordEvent = /* @__PURE__ */ __name((db, event) => {
  assertBundleEventRow(event);
  return db.transaction(async (tx) => {
    const [existing, previous] = await Promise.all([tx.findOne("bundle_events", { id: event.id }), tx.findOne("bundle_event_heads", { install_id: event.install_id })]);
    if (existing !== null || previous?.id === event.id) return;
    if (previous !== null && repeatsHead(event, previous)) return;
    const { recorded, late } = recordedOf(event, previous);
    if (recorded.type !== "UNCHANGED" || recorded.metadata.change !== void 0 && !late) {
      tx.create("bundle_events", recorded);
      countOutcome(tx, recorded);
    }
    if (recorded.type === "UPDATE_FAILED") {
      countFailure(tx, recorded);
      return;
    }
    countEvent(tx, recorded);
    if (previous !== null && (late || !isNewer(recorded, previous))) return;
    if (previous === null) tx.create("bundle_event_heads", recorded);
    else {
      const { install_id: _, ...fields } = recorded;
      countHead(tx, previous, -1);
      tx.update("bundle_event_heads", previous, fields);
    }
    countHead(tx, recorded, 1);
  });
}, "recordEvent");

// ../insights/dist/server/reads.mjs
var PAGE4 = 500;
var hourFloor = /* @__PURE__ */ __name((ms) => ms - ms % HOUR_MS2, "hourFloor");
var hourCeil = /* @__PURE__ */ __name((ms) => hourFloor(ms + HOUR_MS2 - 1), "hourCeil");
var dayFloor = /* @__PURE__ */ __name((ms) => ms - ms % DAY_MS2, "dayFloor");
var dayCeil = /* @__PURE__ */ __name((ms) => dayFloor(ms + DAY_MS2 - 1), "dayCeil");
var drain2 = /* @__PURE__ */ __name(async (read) => {
  const rows = [];
  let cursor;
  do {
    const page2 = await read(cursor === void 0 ? {} : { cursor });
    rows.push(...page2.rows);
    cursor = page2.next;
  } while (cursor !== void 0);
  return rows;
}, "drain");
var EVENT_FIELDS = [
  "id",
  "type",
  "install_id",
  "user_id",
  "from_release_id",
  "from_bundle_id",
  "to_release_id",
  "to_bundle_id",
  "platform",
  "app_version",
  "channel",
  "metadata",
  "received_at_ms"
];
var toEvent = /* @__PURE__ */ __name((row) => Object.fromEntries(EVENT_FIELDS.map((field) => [field, row[field]])), "toEvent");
var scopeOf2 = /* @__PURE__ */ __name((filter) => ({
  platform: filter.platform,
  channel: filter.channel,
  type: filter.type,
  bundle_ref: bundleRefOfFilter(filter)
}), "scopeOf");
var eventsOfDay = /* @__PURE__ */ __name((db, filter, day, range, limit) => filter.kind === "all" ? db.findMany("bundle_events", {
  index: "byDay",
  where: { day },
  range,
  order: "desc",
  limit
}) : db.findMany("bundle_events", {
  index: "byBundle",
  where: {
    ...scopeOf2(filter),
    day
  },
  range,
  order: "desc",
  limit
}), "eventsOfDay");
var newestDayBelow = /* @__PURE__ */ __name(async (db, filter, day, since) => {
  const counted = filter.kind === "all" ? {
    where: DAILY_EVENTS,
    from: dayFloor(since)
  } : {
    where: scopeOf2(filter),
    from: hourFloor(since)
  };
  const [newest] = (await db.findAggregates("insights_outcomes", {
    index: "byRef",
    where: counted.where,
    range: {
      gte: counted.from,
      lt: day
    },
    order: "desc",
    limit: 1
  })).rows;
  return newest === void 0 ? void 0 : dayFloor(newest.bucket_start_ms);
}, "newestDayBelow");
var listEvents = /* @__PURE__ */ __name(async (db, input) => {
  const since = input.sinceMs ?? 0;
  const range = {
    gte: since,
    lt: input.after === void 0 ? input.beforeReceivedAtMs : [input.after.receivedAtMs, input.after.id]
  };
  const { filter, limit } = input;
  if (filter.kind === "installationMovement") return (await db.findMany("bundle_events", {
    index: "movementsByInstall",
    where: { movement_install_id: filter.installId },
    range,
    order: "desc",
    limit
  })).rows.map(toEvent);
  if (input.beforeReceivedAtMs - since > 7776e6) throw new DatabaseAdapterInputError("invalid-query");
  const rows = [];
  const bottom = dayFloor(since);
  let day = dayFloor(input.after?.receivedAtMs ?? input.beforeReceivedAtMs - 1);
  while (day !== void 0 && day >= bottom && rows.length < limit) {
    const page2 = await eventsOfDay(db, filter, day, range, limit - rows.length);
    rows.push(...page2.rows.map(toEvent));
    day = page2.rows.length > 0 ? day - DAY_MS2 : day > bottom ? await newestDayBelow(db, filter, day, since) : void 0;
  }
  return rows;
}, "listEvents");
var findLatestEvents = /* @__PURE__ */ __name(async (db, input) => {
  if ("installId" in input) {
    const head = await db.findOne("bundle_event_heads", { install_id: input.installId });
    return head === null ? [] : [toEvent(head)];
  }
  return (await db.findMany("bundle_event_heads", {
    index: "byUser",
    where: { user_id: input.userId },
    ...input.afterInstallId === void 0 ? {} : { range: { gt: input.afterInstallId } },
    order: "asc",
    limit: input.limit
  })).rows.map(toEvent);
}, "findLatestEvents");
var countRaw = /* @__PURE__ */ __name(async (db, filter, from, to) => {
  let total = 0;
  for (let day = dayFloor(from); from < to && day < to; day += DAY_MS2) {
    const rows = await drain2((page2) => db.findMany("bundle_events", {
      index: "byBundle",
      where: {
        ...scopeOf2(filter),
        day
      },
      range: {
        gte: from,
        lt: to
      },
      limit: PAGE4,
      ...page2
    }));
    total += rows.length;
  }
  return total;
}, "countRaw");
var countEvents = /* @__PURE__ */ __name(async (db, input) => {
  const { filter, sinceMs, beforeReceivedAtMs } = input;
  const start = hourCeil(sinceMs);
  const end = hourFloor(beforeReceivedAtMs);
  if (start >= end) return countRaw(db, filter, sinceMs, beforeReceivedAtMs);
  const hours = await drain2((page2) => db.findAggregates("insights_outcomes", {
    index: "byRef",
    where: scopeOf2(filter),
    range: {
      gte: start,
      lt: end
    },
    limit: PAGE4,
    ...page2
  }));
  return await countRaw(db, filter, sinceMs, start) + hours.reduce((sum, row) => sum + row.events, 0) + await countRaw(db, filter, end, beforeReceivedAtMs);
}, "countEvents");
var countEventSeries = /* @__PURE__ */ __name(async (db, input) => {
  const { filter, intervalMs } = input;
  const { start, end } = input.timeRange;
  const events = Array.from({ length: (end - start) / intervalMs }, () => 0);
  const hours = await drain2((page2) => db.findAggregates("insights_outcomes", {
    index: "byRef",
    where: scopeOf2(filter),
    range: {
      gte: start,
      lt: end
    },
    limit: PAGE4,
    ...page2
  }));
  for (const row of hours) events[Math.floor((row.bucket_start_ms - start) / intervalMs)] += row.events;
  return events.map((count, index) => ({
    startMs: start + index * intervalMs,
    events: count
  }));
}, "countEventSeries");
var latestPredicates = /* @__PURE__ */ __name((bundle) => {
  if (bundle === void 0) return void 0;
  return [...new Map(bundle.flatMap(({ field, value, types }) => types.map((type) => [JSON.stringify([
    field,
    value,
    type
  ]), {
    field,
    value,
    type
  }]))).values()];
}, "latestPredicates");
var countLatestEvents = /* @__PURE__ */ __name(async (db, input) => {
  const { platform, channel, sinceMs: start } = input;
  if (start % 864e5 !== 0) throw new DatabaseAdapterInputError("invalid-query");
  const predicates = latestPredicates(input.bundle);
  let total = 0;
  if (predicates === void 0) {
    const rows = await drain2((page2) => db.findAggregates("insights_distribution", {
      index: "byScope",
      where: {
        channel,
        platform
      },
      range: { gte: start },
      limit: PAGE4,
      ...page2
    }));
    total += rows.reduce((sum, row) => sum + row.latest_installations, 0);
  } else {
    const gauge = /* @__PURE__ */ __name(async (bundleField, bundleId, type) => {
      return (await drain2((page2) => db.findAggregates("insights_latest_by_bundle", {
        index: "byBundle",
        where: {
          platform,
          channel,
          bundle_field: bundleField,
          bundle_id: bundleId,
          type
        },
        range: { gte: start },
        limit: PAGE4,
        ...page2
      }))).reduce((sum, row) => sum + row.installations, 0);
    }, "gauge");
    for (const { field, value, type } of predicates) total += await gauge(field, value, type);
    for (const from of predicates) {
      if (from.field !== "from_bundle_id") continue;
      for (const to of predicates) {
        if (to.field !== "to_bundle_id" || to.type !== from.type) continue;
        total -= await gauge(PAIR_FIELD, bundlePairKey(from.value, to.value), from.type);
      }
    }
  }
  return Math.max(0, total);
}, "countLatestEvents");
var retained = /* @__PURE__ */ __name((now, { rawDays, dailyDays }) => ({
  hour: hourCeil(now - rawDays * DAY_MS2),
  day: dayCeil(now - dailyDays * DAY_MS2)
}), "retained");
var coverageOf = /* @__PURE__ */ __name((start, oldest) => start >= oldest ? {
  kind: "complete",
  sinceMs: 0
} : {
  kind: "partial",
  sinceMs: oldest
}, "coverageOf");
var periodsOf = /* @__PURE__ */ __name((range, days, hour2) => {
  const start = days && range.start < hour2 ? dayFloor(range.start) : range.start;
  const end = days && range.end < hour2 ? dayCeil(range.end) : range.end;
  if (!days || end - start <= 1728e5 && start >= hour2) return [{
    periodKind: "hour",
    start,
    end
  }];
  const first = Math.min(end, dayCeil(start));
  const last = Math.max(first, dayFloor(end));
  return [
    {
      periodKind: "hour",
      start,
      end: first
    },
    {
      periodKind: "day",
      start: first,
      end: last
    },
    {
      periodKind: "hour",
      start: last,
      end
    }
  ].filter((period) => period.start < period.end);
}, "periodsOf");
var COUNTERS = {
  hour: "insights_overview",
  day: "insights_overview_daily"
};
var SKETCHES = {
  hour: "insights_sketches",
  day: "insights_sketches_daily"
};
var windowRows = /* @__PURE__ */ __name(async (db, models, parts, range, days, hour2) => {
  const rows = [];
  for (const period of periodsOf(range, days, hour2)) {
    const identity = insightsIdentity({
      ...parts,
      periodKind: period.periodKind
    });
    rows.push(...await drain2((page2) => db.findAggregates(models[period.periodKind], {
      index: "window",
      where: { identity },
      range: {
        gte: period.start,
        lt: period.end
      },
      limit: PAGE4,
      ...page2
    })));
  }
  return rows;
}, "windowRows");
var counterRows = /* @__PURE__ */ __name((...[db, ...args]) => windowRows(db, COUNTERS, ...args), "counterRows");
var sketchRows = /* @__PURE__ */ __name((...[db, ...args]) => windowRows(db, SKETCHES, ...args), "sketchRows");
var releaseParts = /* @__PURE__ */ __name((release) => ({
  scopeKind: "release",
  releaseKind: "specific",
  releaseId: release.releaseId,
  channel: release.channel,
  platform: release.platform,
  appVersionKind: "all",
  appVersion: ""
}), "releaseParts");
var lifetimeMetrics = /* @__PURE__ */ __name(async (db, release) => {
  const identity = insightsIdentity({
    ...releaseParts(release),
    periodKind: "lifetime"
  });
  const [lifetime] = (await db.findAggregates("insights_overview_lifetime", {
    index: "window",
    where: { identity },
    range: {
      gte: 0,
      lte: 0
    },
    limit: PAGE4
  })).rows;
  return {
    downloads: lifetime?.downloads ?? 0,
    applies: lifetime?.applies ?? 0,
    failedLaunches: lifetime?.failed_launches ?? 0
  };
}, "lifetimeMetrics");
var usageParts = /* @__PURE__ */ __name((channel, platform, appVersion) => ({
  scopeKind: "usage",
  releaseKind: "all",
  releaseId: "",
  channel,
  platform,
  appVersionKind: appVersion === void 0 ? "all" : "specific",
  appVersion: appVersion ?? ""
}), "usageParts");
var getReleaseActivity = /* @__PURE__ */ __name(async (db, input, now) => {
  const measuredAtMs = now();
  return {
    data: await Promise.all(input.releases.map(async (release) => ({
      release,
      metrics: await lifetimeMetrics(db, release)
    }))),
    measuredAtMs
  };
}, "getReleaseActivity");
var byInstallations = /* @__PURE__ */ __name((values) => [...values].flatMap(([name, installations]) => installations > 0 ? [{
  name,
  installations
}] : []).sort((left, right) => right.installations - left.installations || left.name.localeCompare(right.name, "en", { numeric: true })), "byInstallations");
var getAppUsage = /* @__PURE__ */ __name(async (db, input, now, retention) => {
  const { timeRange, intervalMs } = input;
  const at = now();
  const kept = retained(at, retention);
  const days = intervalMs % 864e5 === 0 && timeRange.start % 864e5 === 0;
  const reported = input.platform === "all" ? ["ios", "android"] : [input.platform];
  const usage = (await Promise.all(reported.map((platform) => sketchRows(db, usageParts(input.channel, platform, input.appVersion), timeRange, days, kept.hour)))).flat();
  const range = {
    gte: dayFloor(timeRange.start),
    lt: timeRange.end
  };
  const distribution = [];
  const builtinDistribution = [];
  for (const platform of reported) {
    distribution.push(...await drain2((page2) => input.appVersion === void 0 ? db.findAggregates("insights_distribution", {
      index: "byScope",
      where: {
        channel: input.channel,
        platform
      },
      range,
      limit: PAGE4,
      ...page2
    }) : db.findAggregates("insights_distribution", {
      index: "byVersion",
      where: {
        channel: input.channel,
        platform,
        app_version: input.appVersion
      },
      range,
      limit: PAGE4,
      ...page2
    })));
    builtinDistribution.push(...await drain2((page2) => input.appVersion === void 0 ? db.findAggregates("insights_builtin_distribution", {
      index: "byScope",
      where: {
        channel: input.channel,
        platform
      },
      range,
      limit: PAGE4,
      ...page2
    }) : db.findAggregates("insights_builtin_distribution", {
      index: "byVersion",
      where: {
        channel: input.channel,
        platform,
        app_version: input.appVersion
      },
      range,
      limit: PAGE4,
      ...page2
    })));
  }
  const points = [];
  for (let start = timeRange.start; start < timeRange.end; start += intervalMs) points.push({
    startMs: start,
    installations: countDistinct(mergeDistinct(usage.filter((row) => row.bucket_start_ms >= start && row.bucket_start_ms < start + intervalMs).map((row) => row.activity_users)))
  });
  const versions = /* @__PURE__ */ new Map();
  const platforms = /* @__PURE__ */ new Map();
  const bundles = /* @__PURE__ */ new Map();
  const countBundle2 = /* @__PURE__ */ __name((row, releaseId, builtinBundleId, count) => {
    const key = JSON.stringify([
      row.app_version,
      row.platform,
      releaseId,
      builtinBundleId
    ]);
    bundles.set(key, {
      appVersion: row.app_version,
      platform: row.platform,
      releaseId,
      builtinBundleId,
      installations: (bundles.get(key)?.installations ?? 0) + count
    });
  }, "countBundle");
  for (const row of distribution) {
    const count = row.latest_installations;
    versions.set(row.app_version, (versions.get(row.app_version) ?? 0) + count);
    platforms.set(row.platform, (platforms.get(row.platform) ?? 0) + count);
    countBundle2(row, row.release_id || null, null, count);
  }
  for (const row of builtinDistribution) {
    const releaseId = row.release_id || null;
    countBundle2(row, releaseId, null, -row.latest_installations);
    countBundle2(row, releaseId, row.builtin_bundle_id, row.latest_installations);
  }
  const sortedVersions = byInstallations(versions);
  return {
    coverage: coverageOf(timeRange.start, kept[days ? "day" : "hour"]),
    activeInstallations: countDistinct(mergeDistinct(usage.map((row) => row.activity_users))),
    points,
    appVersions: sortedVersions.map(({ name }) => name),
    versions: sortedVersions,
    platforms: byInstallations(platforms),
    bundleDistribution: [...bundles.values()].filter(({ installations }) => installations > 0),
    measuredAtMs: at
  };
}, "getAppUsage");
var UPDATE_FAILURES_RANGE_MS = 30 * DAY_MS2;
var isRange = /* @__PURE__ */ __name((range) => range === void 0 || Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start >= 0 && range.start < range.end && range.end - range.start <= UPDATE_FAILURES_RANGE_MS, "isRange");
var isText3 = /* @__PURE__ */ __name((value, maxLength) => typeof value === "string" && value.length > 0 && value.length <= maxLength, "isText");
var failed = /* @__PURE__ */ __name((...rows) => countDistinct(mergeDistinct(rows.flat().map((row) => row.failed_users))), "failed");
var mostFirst = /* @__PURE__ */ __name((counts) => [...counts].sort(([leftKey, left], [rightKey, right]) => right.events - left.events || compareUtf8(leftKey, rightKey)).map(([, entry]) => entry), "mostFirst");
var FAILURE_STAGES = /* @__PURE__ */ new Set([
  "check",
  "download",
  "install",
  "unknown"
]);
var breakdownOf = /* @__PURE__ */ __name((rows) => {
  const failures = /* @__PURE__ */ new Map();
  for (const { stage, reason, detail, events } of rows) {
    if (events <= 0) continue;
    const key = JSON.stringify([stage, reason]);
    const entry = failures.get(key) ?? {
      value: {
        stage,
        reason
      },
      events: 0,
      details: /* @__PURE__ */ new Map()
    };
    entry.events += events;
    const known = entry.details.get(detail) ?? {
      value: detail,
      events: 0
    };
    known.events += events;
    entry.details.set(detail, known);
    failures.set(key, entry);
  }
  return mostFirst(failures).map(({ value, events }) => {
    const { details } = failures.get(JSON.stringify([value.stage, value.reason]));
    return {
      ...value,
      events,
      details: mostFirst(details).map(({ value: detail, events: events2 }) => {
        const [resource, httpStatus, originCode, transport] = JSON.parse(detail);
        return {
          resource,
          httpStatus,
          originCode,
          transport,
          events: events2
        };
      })
    };
  });
}, "breakdownOf");
var getUpdateFailures = /* @__PURE__ */ __name(async (db, input, now, retention) => {
  const { platform, channel, releaseId, timeRange } = input;
  if (platform !== "ios" && platform !== "android" || !isText3(channel, 1024) || releaseId !== void 0 && !isText3(releaseId, 36) || !isRange(timeRange) || releaseId === void 0 && timeRange === void 0) throw new DatabaseAdapterInputError("invalid-query");
  const at = now();
  const kept = retained(at, retention);
  const channelParts = {
    ...usageParts(channel, platform),
    scopeKind: "channel"
  };
  const parts = releaseId === void 0 ? channelParts : releaseParts({
    releaseId,
    platform,
    channel
  });
  const failure = {
    ...parts,
    scopeKind: "failure"
  };
  if (timeRange === void 0) {
    const where = /* @__PURE__ */ __name((from) => ({ identity: insightsIdentity({
      ...from,
      periodKind: "lifetime"
    }) }), "where");
    const [counters3, sketches2] = await Promise.all([db.findAggregates("insights_overview_lifetime", {
      index: "window",
      where: where(parts),
      range: {
        gte: 0,
        lte: 0
      },
      limit: PAGE4
    }), db.findAggregates("insights_sketches_lifetime", {
      index: "window",
      where: where(failure),
      range: {
        gte: 0,
        lte: 0
      },
      limit: PAGE4
    })]);
    const lifetime = counters3.rows[0];
    return {
      coverage: {
        kind: "complete",
        sinceMs: 0
      },
      measuredAtMs: at,
      failedUpdates: lifetime?.failed_updates ?? 0,
      failedInstallations: countDistinct(mergeDistinct(sketches2.rows.map((row) => row.failed_users))),
      downloads: lifetime?.downloads ?? 0,
      patchDownloads: lifetime?.patch_downloads ?? 0,
      patchFallbacks: lifetime?.patch_fallbacks ?? 0
    };
  }
  const days = releaseId === void 0;
  const window2 = [
    timeRange,
    days,
    kept.hour
  ];
  const [counters2, failures, checks, active, rows] = await Promise.all([
    counterRows(db, parts, ...window2),
    sketchRows(db, failure, ...window2),
    days ? sketchRows(db, {
      ...channelParts,
      scopeKind: "check"
    }, ...window2) : [],
    days ? sketchRows(db, usageParts(channel, platform), ...window2) : [],
    drain2((page2) => db.findAggregates("insights_failures", {
      index: "byScope",
      where: {
        platform,
        channel
      },
      range: {
        gte: timeRange.start,
        lt: timeRange.end
      },
      limit: PAGE4,
      ...page2
    }))
  ]);
  const total = /* @__PURE__ */ __name((field) => counters2.reduce((sum, row) => sum + row[field], 0), "total");
  const scoped = rows.filter((row) => FAILURE_STAGES.has(row.stage) && (releaseId === void 0 || row.release_id === releaseId));
  const failuresAt = /* @__PURE__ */ __name((counted) => scoped.reduce((sum, row) => sum + (counted(row.stage) ? Math.max(0, row.events) : 0), 0), "failuresAt");
  return {
    coverage: coverageOf(timeRange.start, kept.hour),
    measuredAtMs: at,
    failedUpdates: failuresAt((stage) => stage !== "check"),
    failedInstallations: failed(failures),
    downloads: total("downloads"),
    patchDownloads: total("patch_downloads"),
    patchFallbacks: total("patch_fallbacks"),
    ...days ? { checks: {
      failures: failuresAt((stage) => stage === "check"),
      failedInstallations: failed(checks),
      activeInstallations: countDistinct(mergeDistinct(active.map((row) => row.activity_users)))
    } } : {},
    breakdown: breakdownOf(scoped)
  };
}, "getUpdateFailures");

// ../insights/dist/server/queryInput.mjs
var MAX_PAGE_LIMIT2 = 100;
var MAX_IDENTITY_LENGTH3 = 255;
var MAX_CURSOR_LENGTH2 = 8192;
var readSingle = /* @__PURE__ */ __name((url, key) => {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) throw new InsightsBadRequestError(`Duplicate '${key}' query parameter.`);
  return values[0];
}, "readSingle");
var readPageLimit = /* @__PURE__ */ __name((url) => {
  const value = readSingle(url, "limit");
  if (value === void 0) return void 0;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT2) throw new InsightsBadRequestError("Invalid 'limit' query parameter.");
  return limit;
}, "readPageLimit");
var readCursor = /* @__PURE__ */ __name((url) => {
  const cursor = readSingle(url, "cursor");
  if (cursor !== void 0 && (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH2)) throw new InsightsBadRequestError("Invalid 'cursor' query parameter.");
  return cursor;
}, "readCursor");
var readId = /* @__PURE__ */ __name((url, key, maximumLength = MAX_IDENTITY_LENGTH3) => {
  const value = readSingle(url, key);
  if (value === void 0 || value.length === 0 || value.length > maximumLength) throw new InsightsBadRequestError(`Invalid '${key}' query parameter.`);
  return value;
}, "readId");
var readTimestamp = /* @__PURE__ */ __name((url, key) => {
  const raw2 = readSingle(url, key);
  if (raw2 === void 0) return void 0;
  const value = Number(raw2);
  if (!raw2.length || !Number.isSafeInteger(value) || value < 0) throw new InsightsBadRequestError(`Invalid '${key}' query parameter.`);
  return value;
}, "readTimestamp");
var readScope2 = /* @__PURE__ */ __name((url) => {
  const platform = readSingle(url, "platform");
  if (platform !== "ios" && platform !== "android") throw new InsightsBadRequestError("Invalid 'platform' query parameter.");
  return {
    platform,
    channel: readId(url, "channel", 1024)
  };
}, "readScope");
var parseEventPageInput = /* @__PURE__ */ __name((request) => {
  const url = new URL(request.url);
  const bundleFields = [
    "bundleId",
    "outcome",
    "platform",
    "channel"
  ];
  let bundle;
  if (bundleFields.some((key) => url.searchParams.has(key))) {
    const outcome = readSingle(url, "outcome");
    if (outcome !== "downloaded" && outcome !== "applied" && outcome !== "recovered" && outcome !== "failed") throw new InsightsBadRequestError("Invalid 'outcome' query parameter.");
    bundle = {
      ...readScope2(url),
      bundleId: readId(url, "bundleId", 1024),
      outcome
    };
  }
  return {
    beforeReceivedAtMs: readTimestamp(url, "beforeReceivedAtMs"),
    sinceMs: readTimestamp(url, "sinceMs"),
    cursor: readCursor(url),
    limit: readPageLimit(url),
    ...bundle === void 0 ? {} : { bundle }
  };
}, "parseEventPageInput");
var parseUserInstallationPageInput = /* @__PURE__ */ __name((request) => {
  const url = new URL(request.url);
  const cursor = readCursor(url);
  const limit = readPageLimit(url);
  return {
    userId: readId(url, "userId"),
    ...cursor === void 0 ? {} : { cursor },
    ...limit === void 0 ? {} : { limit }
  };
}, "parseUserInstallationPageInput");
var parseReportingOverviewInput = /* @__PURE__ */ __name((request) => {
  const url = new URL(request.url);
  const window2 = readSingle(url, "window") ?? "30d";
  if (window2 !== "24h" && window2 !== "7d" && window2 !== "30d") throw new InsightsBadRequestError("Invalid 'window' query parameter.");
  const bundleId = readSingle(url, "bundleId");
  return {
    ...readScope2(url),
    window: window2,
    ...bundleId === void 0 ? {} : { bundleId: readId(url, "bundleId", 1024) }
  };
}, "parseReportingOverviewInput");

// ../insights/dist/server/routes.mjs
var RETRY_AFTER_SECONDS = 5;
var json2 = /* @__PURE__ */ __name((body2, status, headers = {}) => Response.json(body2, {
  headers: {
    "cache-control": "private, no-store",
    ...headers
  },
  status
}), "json");
var requireParam = /* @__PURE__ */ __name((params, key) => {
  const value = params[key];
  if (value === void 0 || value.length === 0) throw new InsightsBadRequestError(`Missing route parameter: ${key}`);
  try {
    return decodeURIComponent(value);
  } catch {
    throw new InsightsBadRequestError(`Invalid route parameter: ${key}`);
  }
}, "requireParam");
var run = /* @__PURE__ */ __name(async (operation) => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InsightsBadRequestError) return json2({ error: error.message }, 400);
    if (error instanceof InsightsPayloadTooLargeError) return json2({ error: error.message }, 413);
    if (isDatabaseBusyError(error)) {
      console.warn("[hot-updater] Insights answered 503: the database is busy.", error);
      return json2({ error: "Service unavailable" }, 503, { "retry-after": String(RETRY_AFTER_SECONDS) });
    }
    throw error;
  }
}, "run");
var query = /* @__PURE__ */ __name((operation) => run(async () => json2(await operation(), 200)), "query");
var INSIGHTS_ROUTES = [
  {
    access: "client",
    method: "POST",
    path: "/events",
    handler: "appendBundleEvent"
  },
  {
    access: "admin",
    method: "GET",
    path: "/events",
    handler: "listEvents"
  },
  {
    access: "admin",
    method: "GET",
    path: "/overview",
    handler: "getReportingOverview"
  },
  {
    access: "admin",
    method: "GET",
    path: "/installations",
    handler: "pageInstallationsByCurrentUserId"
  },
  {
    access: "admin",
    method: "GET",
    path: "/installations/:installId/events",
    handler: "listInstallationEvents"
  },
  {
    access: "admin",
    method: "GET",
    path: "/installations/:installId",
    handler: "getInstallation"
  }
];
var createInsightsRouteHandlers = /* @__PURE__ */ __name((provider) => ({
  appendBundleEvent: /* @__PURE__ */ __name(async (_params, request) => run(async () => {
    await provider.appendBundleEvent(await parseBundleEventRequest(request));
    return new Response(null, { status: 204 });
  }), "appendBundleEvent"),
  getReportingOverview: /* @__PURE__ */ __name((_params, request) => query(() => provider.getReportingOverview(parseReportingOverviewInput(request))), "getReportingOverview"),
  getInstallation: /* @__PURE__ */ __name((params) => run(async () => {
    const installation = await provider.getInstallation({ installId: requireParam(params, "installId") });
    return installation === null ? json2({ error: "Installation not found" }, 404) : json2(installation, 200);
  }), "getInstallation"),
  listEvents: /* @__PURE__ */ __name((_params, request) => query(() => provider.listEvents(parseEventPageInput(request))), "listEvents"),
  listInstallationEvents: /* @__PURE__ */ __name((params, request) => query(() => provider.listInstallationEvents({
    ...parseEventPageInput(request),
    installId: requireParam(params, "installId")
  })), "listInstallationEvents"),
  pageInstallationsByCurrentUserId: /* @__PURE__ */ __name((_params, request) => query(() => provider.pageInstallationsByCurrentUserId(parseUserInstallationPageInput(request))), "pageInstallationsByCurrentUserId")
}), "createInsightsRouteHandlers");

// ../insights/dist/server/index.mjs
var createInsightsApi = /* @__PURE__ */ __name((db, now, retention) => ({
  /** How long this plugin keeps its rows. */
  retention,
  /** Records one validated event row; a repeated id changes nothing. */
  recordEvent: /* @__PURE__ */ __name((event) => recordEvent(db, event), "recordEvent"),
  listEvents: /* @__PURE__ */ __name((input) => listEvents(db, input), "listEvents"),
  findLatestEvents: /* @__PURE__ */ __name((input) => findLatestEvents(db, input), "findLatestEvents"),
  countLatestEvents: /* @__PURE__ */ __name((input) => countLatestEvents(db, input), "countLatestEvents"),
  countEvents: /* @__PURE__ */ __name((input) => countEvents(db, input), "countEvents"),
  countEventSeries: /* @__PURE__ */ __name((input) => countEventSeries(db, input), "countEventSeries"),
  getReleaseActivity: /* @__PURE__ */ __name((input) => getReleaseActivity(db, input, now), "getReleaseActivity"),
  getAppUsage: /* @__PURE__ */ __name((input) => getAppUsage(db, input, now, retention), "getAppUsage"),
  /** A release's or a channel's update failures, and their breakdown over a time range. */
  getUpdateFailures: /* @__PURE__ */ __name((input) => getUpdateFailures(db, input, now, retention), "getUpdateFailures")
}), "createInsightsApi");
var readFailuresQuery = /* @__PURE__ */ __name((url) => {
  const query2 = url.searchParams;
  const time = /* @__PURE__ */ __name((name) => {
    const value = query2.get(name);
    return value === null ? void 0 : Number(value);
  }, "time");
  const [start, end] = [time("start"), time("end")];
  const platform = query2.get("platform");
  const releaseId = query2.get("releaseId");
  if (platform !== "ios" && platform !== "android" || start === void 0 !== (end === void 0)) throw new DatabaseAdapterInputError("invalid-query");
  return {
    platform,
    channel: query2.get("channel") ?? "",
    ...releaseId === null ? {} : { releaseId },
    ...start === void 0 ? {} : { timeRange: {
      start,
      end
    } }
  };
}, "readFailuresQuery");
var failuresEndpoint = /* @__PURE__ */ __name((api) => ({
  access: "admin",
  method: "GET",
  path: "/failures",
  handler: /* @__PURE__ */ __name(async (request) => {
    try {
      return Response.json(await api.getUpdateFailures(readFailuresQuery(new URL(request.url))), { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      if (error instanceof DatabaseAdapterInputError) return Response.json({ error: "Send platform and channel, and releaseId or start and end in epoch milliseconds, at most 30 days apart." }, { status: 400 });
      if (!isDatabaseBusyError(error)) throw error;
      return Response.json({ error: "Service unavailable" }, {
        status: 503,
        headers: { "retry-after": "5" }
      });
    }
  }, "handler")
}), "failuresEndpoint");
var retentionOf = /* @__PURE__ */ __name(({ retention }) => {
  const rawDays = retention?.rawDays ?? 90;
  const dailyDays = retention?.dailyDays ?? 400;
  const whole = /* @__PURE__ */ __name((days) => Number.isSafeInteger(days) && days >= 1, "whole");
  if (!whole(rawDays) || !whole(dailyDays) || dailyDays < rawDays) throw new HotUpdaterConfigError(`insights({ retention }) takes whole days of at least 1, with dailyDays at least rawDays; got rawDays ${rawDays} and dailyDays ${dailyDays}.`);
  return {
    rawDays,
    dailyDays
  };
}, "retentionOf");
var insights = /* @__PURE__ */ __name((options = {}) => {
  const retention = retentionOf(options);
  const plugin = definePlugin({
    id: "insights",
    namespace: false,
    schemaVersion: "1.0.0",
    schema: createInsightsSchema(retention),
    init: /* @__PURE__ */ __name(({ db, now }) => {
      const api = createInsightsApi(db, now, retention);
      const routes = createInsightsRouteHandlers(createInsightsProvider(createInsightsModel(api)));
      return {
        api,
        endpoints: [
          ...INSIGHTS_ROUTES.map(({ access, method, path, handler }) => ({
            access,
            method,
            path,
            handler: /* @__PURE__ */ __name((request, params) => routes[handler](params, request), "handler")
          })),
          failuresEndpoint(api),
          {
            access: "admin",
            method: "GET",
            path: "/retention",
            handler: /* @__PURE__ */ __name(async () => Response.json(retention), "handler")
          }
        ]
      };
    }, "init"),
    cli: { clientPlugin: {
      module: "@hot-updater/react-native",
      name: "insights"
    } }
  });
  return markOfficial2(plugin);
}, "insights");

// ../remote-config/dist/shared/ownEntry.mjs
var ownEntry = /* @__PURE__ */ __name((record, key) => record !== void 0 && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : void 0, "ownEntry");

// ../remote-config/dist/server/template.mjs
var EMPTY_REMOTE_CONFIG_TEMPLATE = Object.freeze({
  conditions: Object.freeze([]),
  parameters: Object.freeze({})
});
var REMOTE_CONFIG_MAX_TEMPLATE_LENGTH = 6e4;
var REMOTE_CONFIG_MAX_PARAMETERS = 2e3;
var MAX_RULE_VALUES = 100;
var MAX_DESCRIPTION_LENGTH = 256;
var MAX_CONDITION_NAME_LENGTH = 100;
var MAX_RULE_TEXT_LENGTH = 128;
var PARAMETER_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/u;
var SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
var DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u;
var VALUE_TYPES = /* @__PURE__ */ new Set([
  "STRING",
  "NUMBER",
  "BOOLEAN",
  "JSON"
]);
var PLATFORMS = /* @__PURE__ */ new Set(["ios", "android"]);
var RemoteConfigValidationError = class extends Error {
  static {
    __name(this, "RemoteConfigValidationError");
  }
  issues;
  name = "RemoteConfigValidationError";
  constructor(issues) {
    super(`The Remote Config template is invalid: ${issues.slice(0, 3).map(({ path, message }) => path ? `${path}: ${message}` : message).join("; ")}${issues.length > 3 ? ` (and ${issues.length - 3} more)` : ""}`);
    this.issues = issues;
  }
};
var isRecord8 = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null && !Array.isArray(value), "isRecord");
var visibleText = /* @__PURE__ */ __name((value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\p{Cc}]/u.test(value), "visibleText");
var checkValueText = /* @__PURE__ */ __name((valueType, text) => {
  switch (valueType) {
    case "NUMBER":
      return text.trim().length > 0 && Number.isFinite(Number(text)) ? null : "must be a number.";
    case "BOOLEAN":
      return text === "true" || text === "false" ? null : 'must be "true" or "false".';
    case "JSON":
      try {
        JSON.parse(text);
        return null;
      } catch {
        return "must be valid JSON.";
      }
    default:
      return null;
  }
}, "checkValueText");
var validateRemoteConfigTemplate = /* @__PURE__ */ __name((input) => {
  const issues = [];
  const issue = /* @__PURE__ */ __name((path, message) => {
    issues.push({
      path,
      message
    });
  }, "issue");
  const unknownKeys = /* @__PURE__ */ __name((value, allowed, path) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) issue(path ? `${path}.${key}` : key, "is not a template field.");
  }, "unknownKeys");
  if (!isRecord8(input)) throw new RemoteConfigValidationError([{
    path: "",
    message: "A template is an object."
  }]);
  unknownKeys(input, ["conditions", "parameters"], "");
  const conditions = [];
  const conditionNames = /* @__PURE__ */ new Set();
  const rawConditions = input.conditions ?? [];
  if (!Array.isArray(rawConditions)) issue("conditions", "must be a list.");
  else {
    if (rawConditions.length > 500) issue("conditions", `holds at most 500 conditions.`);
    rawConditions.forEach((raw2, index) => {
      const path = `conditions[${index}]`;
      if (!isRecord8(raw2)) {
        issue(path, "must be an object.");
        return;
      }
      unknownKeys(raw2, ["name", "rules"], path);
      const { name } = raw2;
      if (!visibleText(name, MAX_CONDITION_NAME_LENGTH)) issue(`${path}.name`, `must be 1-${MAX_CONDITION_NAME_LENGTH} visible characters.`);
      else if (conditionNames.has(name)) issue(`${path}.name`, `"${name}" names another condition too.`);
      else conditionNames.add(name);
      const rules = validateRules(raw2.rules, `${path}.rules`, issue);
      if (typeof name === "string") conditions.push({
        name,
        rules
      });
    });
  }
  const parameters = [];
  const rawParameters = input.parameters ?? {};
  if (!isRecord8(rawParameters)) issue("parameters", "must be an object keyed by parameter.");
  else {
    const keys = Object.keys(rawParameters);
    if (keys.length > 2e3) issue("parameters", `holds at most ${REMOTE_CONFIG_MAX_PARAMETERS} parameters.`);
    for (const key of keys) {
      const path = `parameters.${key}`;
      if (!PARAMETER_KEY_PATTERN.test(key)) issue(path, "Parameter keys start with a letter or _, and hold up to 256 letters, digits, and _.");
      const raw2 = rawParameters[key];
      if (!isRecord8(raw2)) {
        issue(path, "must be an object.");
        continue;
      }
      unknownKeys(raw2, [
        "valueType",
        "defaultValue",
        "conditionalValues",
        "description"
      ], path);
      const valueType = raw2.valueType;
      if (typeof valueType !== "string" || !VALUE_TYPES.has(valueType)) {
        issue(`${path}.valueType`, "must be STRING, NUMBER, BOOLEAN, or JSON.");
        continue;
      }
      const type = valueType;
      const readValue = /* @__PURE__ */ __name((value, valuePath) => {
        if (!isRecord8(value)) {
          issue(valuePath, "must be { value } or { useInAppDefault: true }.");
          return null;
        }
        if ("useInAppDefault" in value) {
          unknownKeys(value, ["useInAppDefault"], valuePath);
          if (value.useInAppDefault !== true) {
            issue(`${valuePath}.useInAppDefault`, "must be true.");
            return null;
          }
          return { useInAppDefault: true };
        }
        unknownKeys(value, ["value"], valuePath);
        if (typeof value.value !== "string") {
          issue(`${valuePath}.value`, "must be text.");
          return null;
        }
        const problem = checkValueText(type, value.value);
        if (problem !== null) {
          issue(`${valuePath}.value`, problem);
          return null;
        }
        return { value: value.value };
      }, "readValue");
      const defaultValue = readValue(raw2.defaultValue, `${path}.defaultValue`);
      const conditionalValues = [];
      if (raw2.conditionalValues !== void 0) {
        if (!isRecord8(raw2.conditionalValues)) issue(`${path}.conditionalValues`, "must be an object keyed by condition.");
        else for (const [conditionName, value] of Object.entries(raw2.conditionalValues)) {
          const valuePath = `${path}.conditionalValues.${conditionName}`;
          if (!conditionNames.has(conditionName)) {
            issue(valuePath, `No condition is named "${conditionName}".`);
            continue;
          }
          const read = readValue(value, valuePath);
          if (read !== null) conditionalValues.push([conditionName, read]);
        }
      }
      let description;
      if (raw2.description !== void 0) {
        const text = typeof raw2.description === "string" ? raw2.description.trim() : null;
        if (text === null || text.length > MAX_DESCRIPTION_LENGTH) issue(`${path}.description`, `must be text of up to ${MAX_DESCRIPTION_LENGTH} characters.`);
        else if (text.length > 0) description = text;
      }
      if (defaultValue !== null) parameters.push([key, {
        valueType: type,
        defaultValue,
        ...conditionalValues.length === 0 ? {} : { conditionalValues: Object.fromEntries(conditionalValues) },
        ...description === void 0 ? {} : { description }
      }]);
    }
  }
  if (issues.length > 0) throw new RemoteConfigValidationError(issues);
  const template = {
    conditions,
    parameters: Object.fromEntries(parameters)
  };
  const length = JSON.stringify(template).length;
  if (length > 6e4) throw new RemoteConfigValidationError([{
    path: "",
    message: `The template takes ${length.toLocaleString("en-US")} characters of JSON; the limit is ${REMOTE_CONFIG_MAX_TEMPLATE_LENGTH.toLocaleString("en-US")}.`
  }]);
  return template;
}, "validateRemoteConfigTemplate");
var textList = /* @__PURE__ */ __name((value, path, issue, check, describe) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RULE_VALUES) {
    issue(path, `must list 1-${MAX_RULE_VALUES} values.`);
    return [];
  }
  const list = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !check(entry)) issue(`${path}[${index}]`, describe);
    else if (!list.includes(entry)) list.push(entry);
  });
  return list;
}, "textList");
var RULE_FIELDS = {
  platform: ["type", "platforms"],
  channel: ["type", "channels"],
  appVersion: ["type", "range"],
  cohort: ["type", "cohorts"],
  percent: [
    "type",
    "seed",
    "from",
    "to"
  ],
  fingerprint: ["type", "hashes"],
  dateTime: [
    "type",
    "from",
    "to"
  ]
};
var validateRules = /* @__PURE__ */ __name((value, path, issue) => {
  if (!Array.isArray(value) || value.length === 0) {
    issue(path, "must list at least one rule.");
    return [];
  }
  const rules = [];
  value.forEach((raw2, index) => {
    const rulePath = `${path}[${index}]`;
    if (!isRecord8(raw2) || typeof raw2.type !== "string") {
      issue(rulePath, "must be a rule object with a type.");
      return;
    }
    const type = raw2.type;
    const fields = ownEntry(RULE_FIELDS, type);
    if (fields === void 0) {
      issue(`${rulePath}.type`, "must be platform, channel, appVersion, cohort, percent, fingerprint, or dateTime.");
      return;
    }
    for (const key of Object.keys(raw2)) if (!fields.includes(key)) issue(`${rulePath}.${key}`, `is not a field of a ${type} rule.`);
    switch (type) {
      case "platform": {
        const platforms = textList(raw2.platforms, `${rulePath}.platforms`, issue, (text) => PLATFORMS.has(text), 'must be "ios" or "android".');
        rules.push({
          type,
          platforms
        });
        return;
      }
      case "channel": {
        const channels = textList(raw2.channels, `${rulePath}.channels`, issue, (text) => visibleText(text, MAX_RULE_TEXT_LENGTH), `must be a channel name of 1-${MAX_RULE_TEXT_LENGTH} characters.`);
        rules.push({
          type,
          channels
        });
        return;
      }
      case "appVersion": {
        const range = raw2.range;
        if (!visibleText(range, MAX_RULE_TEXT_LENGTH) || !isValidRange(range.trim())) {
          issue(`${rulePath}.range`, "must be a semver range, such as >=1.4.0 or 2.x.");
          return;
        }
        rules.push({
          type,
          range: range.trim()
        });
        return;
      }
      case "cohort": {
        const cohorts = textList(raw2.cohorts, `${rulePath}.cohorts`, issue, isValidCohort, "must be a cohort from 1 to 1000, or a lowercase slug.").map(normalizeCohortValue);
        rules.push({
          type,
          cohorts: [...new Set(cohorts)]
        });
        return;
      }
      case "percent": {
        const { seed, from, to } = raw2;
        if (typeof seed !== "string" || !SEED_PATTERN.test(seed)) {
          issue(`${rulePath}.seed`, "must be 1-64 letters, digits, _, and -.");
          return;
        }
        const isPercent = /* @__PURE__ */ __name((value2) => typeof value2 === "number" && value2 >= 0 && value2 <= 100 && Math.abs(value2 * 10 - Math.round(value2 * 10)) < 1e-9, "isPercent");
        if (!isPercent(from) || !isPercent(to) || from >= to) {
          issue(rulePath, "takes from < to, each a percentage from 0 to 100 in steps of 0.1.");
          return;
        }
        rules.push({
          type,
          seed,
          from,
          to
        });
        return;
      }
      case "fingerprint": {
        const hashes = textList(raw2.hashes, `${rulePath}.hashes`, issue, (text) => visibleText(text, MAX_RULE_TEXT_LENGTH), `must be a fingerprint of 1-${MAX_RULE_TEXT_LENGTH} characters.`);
        rules.push({
          type,
          hashes
        });
        return;
      }
      case "dateTime": {
        const instant = /* @__PURE__ */ __name((field) => {
          const value2 = raw2[field];
          if (value2 === void 0) return void 0;
          const ms = typeof value2 === "string" ? Date.parse(value2) : NaN;
          if (typeof value2 !== "string" || !DATE_TIME_PATTERN.test(value2) || !Number.isFinite(ms)) {
            issue(`${rulePath}.${field}`, "must be an ISO 8601 date-time with a time zone, such as 2026-10-08T10:00:00Z.");
            return null;
          }
          return new Date(ms).toISOString();
        }, "instant");
        const from = instant("from");
        const to = instant("to");
        if (from === null || to === null) return;
        if (from === void 0 && to === void 0) {
          issue(rulePath, "takes from, to, or both.");
          return;
        }
        if (from !== void 0 && to !== void 0 && from >= to) {
          issue(rulePath, "takes a from before its to.");
          return;
        }
        rules.push({
          type,
          ...from === void 0 ? {} : { from },
          ...to === void 0 ? {} : { to }
        });
        return;
      }
    }
  });
  return rules;
}, "validateRules");
var matchesRemoteConfigRule = /* @__PURE__ */ __name((rule, context) => {
  switch (rule.type) {
    case "platform":
      return context.platform !== void 0 && context.platform !== null && rule.platforms.includes(context.platform);
    case "channel":
      return typeof context.channel === "string" && rule.channels.includes(context.channel);
    case "appVersion":
      return typeof context.appVersion === "string" && semverSatisfies(rule.range, context.appVersion);
    case "cohort":
      return typeof context.cohort === "string" && rule.cohorts.includes(normalizeCohortValue(context.cohort));
    case "percent": {
      if (typeof context.cohort !== "string") return false;
      const cohort = getNumericCohortValue(context.cohort);
      if (cohort === null) return false;
      const position = getNumericCohortRolloutPosition(rule.seed, cohort);
      return position >= Math.round(rule.from * 10) && position < Math.round(rule.to * 10);
    }
    case "fingerprint":
      return typeof context.fingerprintHash === "string" && rule.hashes.includes(context.fingerprintHash);
    case "dateTime":
      return typeof context.now === "number" && (rule.from === void 0 || context.now >= Date.parse(rule.from)) && (rule.to === void 0 || context.now < Date.parse(rule.to));
  }
}, "matchesRemoteConfigRule");
var matchesRemoteConfigCondition = /* @__PURE__ */ __name((condition, context) => condition.rules.every((rule) => matchesRemoteConfigRule(rule, context)), "matchesRemoteConfigCondition");
var evaluateRemoteConfig = /* @__PURE__ */ __name((template, context) => {
  const matched = template.conditions.filter((condition) => matchesRemoteConfigCondition(condition, context)).map(({ name }) => name);
  return Object.fromEntries(Object.entries(template.parameters).map(([key, parameter]) => {
    let condition = null;
    let chosen = parameter.defaultValue;
    for (const name of matched) {
      const value = ownEntry(parameter.conditionalValues, name);
      if (value !== void 0) {
        condition = name;
        chosen = value;
        break;
      }
    }
    return [key, {
      value: "value" in chosen ? chosen.value : null,
      condition
    }];
  }));
}, "evaluateRemoteConfig");
var resolveRemoteConfigValues = /* @__PURE__ */ __name((template, context) => {
  return Object.fromEntries(Object.entries(evaluateRemoteConfig(template, context)).flatMap(([key, { value }]) => value === null ? [] : [[key, value]]));
}, "resolveRemoteConfigValues");

// ../remote-config/dist/server/api.mjs
var ACTIVE_ID = "active";
var ACTIVE_CACHE_TTL_MS = 5e3;
var MAX_DESCRIPTION_LENGTH2 = 256;
var MAX_VERSIONS_PAGE = 100;
var RemoteConfigInputError = class extends TypeError {
  static {
    __name(this, "RemoteConfigInputError");
  }
  name = "RemoteConfigInputError";
};
var normalizeDescription = /* @__PURE__ */ __name((description) => {
  if (description === void 0 || description === null) return null;
  if (typeof description !== "string") throw new RemoteConfigInputError("A version description is text.");
  const trimmed = description.trim();
  if (trimmed.length > MAX_DESCRIPTION_LENGTH2) throw new RemoteConfigInputError(`A version description holds up to ${MAX_DESCRIPTION_LENGTH2} characters.`);
  return trimmed.length === 0 ? null : trimmed;
}, "normalizeDescription");
var requireVersionNumber = /* @__PURE__ */ __name((value, name) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new RemoteConfigInputError(`${name} must be a non-negative integer.`);
  return value;
}, "requireVersionNumber");
var toColumn = /* @__PURE__ */ __name((template) => template, "toColumn");
var fromColumn = /* @__PURE__ */ __name((value) => value, "fromColumn");
var toVersion = /* @__PURE__ */ __name((row) => Object.freeze({
  version: row.version,
  description: row.description,
  updateType: row.update_type === "ROLLBACK" ? "ROLLBACK" : "PUBLISH",
  rollbackSource: row.rollback_source,
  createdAtMs: row.created_at_ms
}), "toVersion");
var createRemoteConfigApi = /* @__PURE__ */ __name(({ db, now }) => {
  let cached = null;
  let loading = null;
  let generation = 0;
  const readActive = /* @__PURE__ */ __name(async () => {
    const row = await db.findOne("remote_config_active", { id: ACTIVE_ID });
    return row === null ? {
      version: 0,
      template: EMPTY_REMOTE_CONFIG_TEMPLATE,
      updatedAtMs: null
    } : {
      version: row.version,
      template: fromColumn(row.template),
      updatedAtMs: row.updated_at_ms
    };
  }, "readActive");
  const servedActive = /* @__PURE__ */ __name(() => {
    if (cached !== null && cached.expiresAt > now()) return Promise.resolve(cached.active);
    if (loading !== null) return loading;
    const started = generation;
    const read = readActive().then((active) => {
      if (generation === started) cached = {
        active,
        expiresAt: now() + ACTIVE_CACHE_TTL_MS
      };
      return active;
    }).finally(() => {
      if (loading === read) loading = null;
    });
    loading = read;
    return read;
  }, "servedActive");
  const commit = /* @__PURE__ */ __name(async (input) => {
    const attempt = /* @__PURE__ */ __name(() => db.transaction(async (tx) => {
      const active = await tx.findOne("remote_config_active", { id: ACTIVE_ID });
      const currentVersion = active?.version ?? 0;
      if (currentVersion !== input.baseVersion) return {
        status: "conflict",
        currentVersion
      };
      const version2 = currentVersion + 1;
      const at = now();
      const row = {
        version: version2,
        template: toColumn(input.template),
        description: input.description,
        update_type: input.rollbackSource === null ? "PUBLISH" : "ROLLBACK",
        rollback_source: input.rollbackSource,
        created_at_ms: at
      };
      tx.create("remote_config_versions", row);
      if (active === null) tx.create("remote_config_active", {
        id: ACTIVE_ID,
        version: version2,
        template: toColumn(input.template),
        updated_at_ms: at
      });
      else tx.update("remote_config_active", active, {
        version: version2,
        template: toColumn(input.template),
        updated_at_ms: at
      });
      return {
        status: "published",
        version: toVersion(row)
      };
    }), "attempt");
    try {
      const result = await attempt();
      if (result.status === "published") {
        generation += 1;
        cached = null;
        loading = null;
      }
      return result;
    } catch (error) {
      if (error instanceof DatabaseConstraintError && (error.reason === "exists" || error.reason === "unique")) return {
        status: "conflict",
        currentVersion: (await readActive()).version
      };
      throw error;
    }
  }, "commit");
  return Object.freeze({
    getActive: readActive,
    publish: /* @__PURE__ */ __name(async ({ template, baseVersion, description }) => commit({
      template: validateRemoteConfigTemplate(template),
      baseVersion: requireVersionNumber(baseVersion, "baseVersion"),
      description: normalizeDescription(description),
      rollbackSource: null
    }), "publish"),
    rollback: /* @__PURE__ */ __name(async ({ version: version2, baseVersion, description }) => {
      const source = await db.findOne("remote_config_versions", { version: requireVersionNumber(version2, "version") });
      if (source === null) return { status: "not_found" };
      return commit({
        template: fromColumn(source.template),
        baseVersion: requireVersionNumber(baseVersion, "baseVersion"),
        description: normalizeDescription(description) ?? `Rollback to version ${source.version}`,
        rollbackSource: source.version
      });
    }, "rollback"),
    listVersions: /* @__PURE__ */ __name(async ({ limit = 20, cursor } = {}) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_VERSIONS_PAGE) throw new RemoteConfigInputError(`limit must be an integer from 1 to ${MAX_VERSIONS_PAGE}.`);
      const page2 = await db.findMany("remote_config_versions", {
        index: "byVersion",
        where: {},
        order: "desc",
        limit,
        ...cursor === void 0 ? {} : { cursor }
      });
      return Object.freeze({
        versions: Object.freeze(page2.rows.map(toVersion)),
        ...page2.next === void 0 ? {} : { next: page2.next }
      });
    }, "listVersions"),
    getVersion: /* @__PURE__ */ __name(async (version2) => {
      const row = await db.findOne("remote_config_versions", { version: requireVersionNumber(version2, "version") });
      return row === null ? null : Object.freeze({
        ...toVersion(row),
        template: fromColumn(row.template)
      });
    }, "getVersion"),
    resolve: /* @__PURE__ */ __name(async (context) => {
      const active = await servedActive();
      return {
        version: active.version,
        values: resolveRemoteConfigValues(active.template, {
          ...context,
          now: context.now ?? now()
        })
      };
    }, "resolve")
  });
}, "createRemoteConfigApi");

// ../remote-config/dist/server/official.mjs
var OFFICIAL4 = /* @__PURE__ */ Symbol.for("@hot-updater/server/official-plugin");
var markOfficial3 = /* @__PURE__ */ __name((plugin) => Object.defineProperty(plugin, OFFICIAL4, { value: true }), "markOfficial");

// ../remote-config/dist/shared/wire.mjs
var REMOTE_CONFIG_PATH = "remote-config";
var REMOTE_CONFIG_QUERY = {
  platform: "platform",
  appVersion: "appVersion",
  channel: "channel",
  cohort: "cohort",
  fingerprintHash: "fingerprintHash"
};

// ../remote-config/dist/server/routes.mjs
var RETRY_AFTER_SECONDS2 = 5;
var FETCH_CACHE_CONTROL = "public, max-age=0, s-maxage=5";
var MAX_CONTEXT_LENGTH = 128;
var BadRequestError = class extends Error {
  static {
    __name(this, "BadRequestError");
  }
};
var json3 = /* @__PURE__ */ __name((body2, status, headers = {}) => Response.json(body2, {
  headers: {
    "cache-control": "private, no-store",
    ...headers
  },
  status
}), "json");
var run2 = /* @__PURE__ */ __name(async (operation) => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RemoteConfigValidationError) return json3({
      error: error.message,
      issues: error.issues
    }, 400);
    if (error instanceof BadRequestError || error instanceof RemoteConfigInputError || error instanceof DatabaseCursorError) return json3({ error: error.message }, 400);
    if (isDatabaseBusyError(error)) {
      console.warn("[hot-updater] Remote Config answered 503: the database is busy.", error);
      return json3({ error: "Service unavailable" }, 503, { "retry-after": String(RETRY_AFTER_SECONDS2) });
    }
    throw error;
  }
}, "run");
var readContext = /* @__PURE__ */ __name((request) => {
  const query2 = new URL(request.url).searchParams;
  const read = /* @__PURE__ */ __name((field) => {
    const value = query2.get(REMOTE_CONFIG_QUERY[field]);
    if (value === null || value.length === 0) return null;
    if (value.length > MAX_CONTEXT_LENGTH) throw new BadRequestError(`${field} is too long.`);
    return value;
  }, "read");
  const platform = read("platform");
  if (platform !== null && platform !== "ios" && platform !== "android") throw new BadRequestError('platform must be "ios" or "android".');
  return {
    platform,
    appVersion: read("appVersion"),
    channel: read("channel"),
    cohort: read("cohort"),
    fingerprintHash: read("fingerprintHash")
  };
}, "readContext");
var bodyHash = /* @__PURE__ */ __name(async (body2) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body2));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}, "bodyHash");
var readJsonBody = /* @__PURE__ */ __name(async (request) => {
  const body2 = await request.json().catch(() => null);
  if (typeof body2 !== "object" || body2 === null || Array.isArray(body2)) throw new BadRequestError("The request body must be a JSON object.");
  return body2;
}, "readJsonBody");
var versionParam = /* @__PURE__ */ __name((params) => {
  const text = params.version ?? "";
  if (!/^\d{1,15}$/u.test(text)) throw new BadRequestError("The version must be a positive integer.");
  return Number(text);
}, "versionParam");
var publishResponse = /* @__PURE__ */ __name((result) => result.status === "published" ? json3(result.version, 200) : json3({
  error: `Version ${result.currentVersion} was published since; reload the template and publish again.`,
  currentVersion: result.currentVersion
}, 409), "publishResponse");
var createRemoteConfigEndpoints = /* @__PURE__ */ __name((api) => [
  {
    method: "GET",
    path: `/${REMOTE_CONFIG_PATH}`,
    access: "client",
    handler: /* @__PURE__ */ __name((request) => run2(async () => {
      const body2 = JSON.stringify(await api.resolve(readContext(request)));
      const etag = `"sha256:${await bodyHash(body2)}"`;
      const headers = {
        "cache-control": FETCH_CACHE_CONTROL,
        "content-type": "application/json",
        etag,
        vary: "Accept-Encoding"
      };
      if (request.headers.get("if-none-match") === etag) return new Response(null, {
        headers,
        status: 304
      });
      return new Response(body2, {
        headers,
        status: 200
      });
    }), "handler")
  },
  {
    method: "GET",
    path: `/${REMOTE_CONFIG_PATH}/template`,
    access: "admin",
    handler: /* @__PURE__ */ __name(() => run2(async () => json3(await api.getActive(), 200)), "handler")
  },
  {
    method: "PUT",
    path: `/${REMOTE_CONFIG_PATH}/template`,
    access: "admin",
    handler: /* @__PURE__ */ __name((request) => run2(async () => {
      const body2 = await readJsonBody(request);
      return publishResponse(await api.publish({
        template: body2.template,
        baseVersion: body2.baseVersion,
        ...body2.description === void 0 ? {} : { description: body2.description }
      }));
    }), "handler")
  },
  {
    method: "GET",
    path: `/${REMOTE_CONFIG_PATH}/versions`,
    access: "admin",
    handler: /* @__PURE__ */ __name((request) => run2(async () => {
      const query2 = new URL(request.url).searchParams;
      const limit = query2.get("limit");
      const cursor = query2.get("cursor");
      return json3(await api.listVersions({
        ...limit === null ? {} : { limit: Number(limit) },
        ...cursor === null ? {} : { cursor }
      }), 200);
    }), "handler")
  },
  {
    method: "GET",
    path: `/${REMOTE_CONFIG_PATH}/versions/:version`,
    access: "admin",
    handler: /* @__PURE__ */ __name((_request, params) => run2(async () => {
      const version2 = await api.getVersion(versionParam(params));
      return version2 === null ? json3({ error: "Version not found" }, 404) : json3(version2, 200);
    }), "handler")
  },
  {
    method: "POST",
    path: `/${REMOTE_CONFIG_PATH}/versions/:version/rollback`,
    access: "admin",
    handler: /* @__PURE__ */ __name((request, params) => run2(async () => {
      const body2 = await readJsonBody(request);
      const result = await api.rollback({
        version: versionParam(params),
        baseVersion: body2.baseVersion,
        ...body2.description === void 0 ? {} : { description: body2.description }
      });
      return result.status === "not_found" ? json3({ error: "Version not found" }, 404) : publishResponse(result);
    }), "handler")
  }
], "createRemoteConfigEndpoints");

// ../remote-config/dist/server/schema.mjs
var remoteConfigSchema = {
  /** One row, `id` `"active"`: the template devices receive and its version. */
  remote_config_active: defineTable({
    id: {
      type: "string",
      maxLength: 16
    },
    version: { type: "integer" },
    template: { type: "json" },
    updated_at_ms: { type: "integer" }
  }, { key: ["id"] }),
  /** Each publish and rollback, kept so the Console can show and restore it. */
  remote_config_versions: defineTable({
    version: { type: "integer" },
    template: { type: "json" },
    description: {
      type: "string",
      maxLength: 256,
      required: false
    },
    /** `PUBLISH`, or `ROLLBACK` for a copy of `rollback_source`. */
    update_type: {
      type: "string",
      maxLength: 16
    },
    rollback_source: {
      type: "integer",
      required: false
    },
    created_at_ms: { type: "integer" }
  }, {
    key: ["version"],
    indexes: { byVersion: {
      eq: [],
      sort: ["version"]
    } }
  })
};

// ../remote-config/dist/server/index.mjs
var remoteConfig = /* @__PURE__ */ __name(() => {
  const plugin = definePlugin({
    id: "remoteConfig",
    namespace: false,
    schemaVersion: "1.0.0",
    schema: remoteConfigSchema,
    init: /* @__PURE__ */ __name(({ db, now }) => {
      const api = createRemoteConfigApi({
        db,
        now
      });
      return {
        api,
        endpoints: createRemoteConfigEndpoints(api)
      };
    }, "init")
  });
  return markOfficial3(plugin);
}, "remoteConfig");

// worker/src/index.ts
import { env } from "cloudflare:workers";

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/utils/buffer.js
var bufferToFormData = /* @__PURE__ */ __name((arrayBuffer, contentType) => {
  const response = new Response(arrayBuffer, {
    headers: {
      // Normalize the media type (case-insensitive) while keeping parameters like the boundary
      "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase())
    }
  });
  return response.formData();
}, "bufferToFormData");

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/utils/body.js
var isRawRequest = /* @__PURE__ */ __name((request) => "headers" in request, "isRawRequest");
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const contentType = headers.get("Content-Type");
  const mediaType = contentType?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) {
    return convertFormDataToBodyData(
      await request.bodyCache.formData,
      options
    );
  }
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) {
    request.bodyCache.formData = formDataPromise;
  }
  const formData = await formDataPromise;
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder2) => {
  try {
    return decoder2(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder2(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body2) => {
        if (anyCachedKey === "json") {
          body2 = JSON.stringify(body2);
        }
        return new Response(body2)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * `.bytes()` parses the request body as a `Uint8Array`.
   *
   * @see {@link https://hono.dev/docs/api/request#bytes}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.bytes()
   * })
   * ```
   */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body2, init) => new Response(body2, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  }, "text");
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS2 = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class _Hono {
  static {
    __name(this, "_Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS2, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env2, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env2, "GET")))();
    }
    const path = this.getPath(request, { env: env2 });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env: env2,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  }, "request");
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }), "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class _Node {
  static {
    __name(this, "_Node");
  }
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
__name(clearWildcardRegExpCache, "clearWildcardRegExpCache");
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
__name(buildMatcherFromPreprocessedRoutes, "buildMatcherFromPreprocessedRoutes");
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = /* @__PURE__ */ __name((children) => {
  for (const _ in children) {
    return true;
  }
  return false;
}, "hasChildren");
var Node2 = class _Node2 {
  static {
    __name(this, "_Node");
  }
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  node.#params,
                  params
                );
              }
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// ../../node_modules/.pnpm/hono@4.12.34/node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// src/d1Executor.ts
var D1ExecutionError = class extends Error {
  static {
    __name(this, "D1ExecutionError");
  }
  name = "D1ExecutionError";
  constructor() {
    super("D1 did not successfully execute every requested statement");
  }
};
var toSqlResult = /* @__PURE__ */ __name((result) => {
  if (result.success === false) throw new D1ExecutionError();
  return {
    rows: result.results ?? [],
    changes: result.meta?.changes ?? 0
  };
}, "toSqlResult");
var withSqliteCode = /* @__PURE__ */ __name((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = /UNIQUE constraint failed|constraint failed: .*PRIMARY/iu.test(
    message
  ) ? "SQLITE_CONSTRAINT_UNIQUE" : /SQLITE_BUSY|database is locked/iu.test(message) ? "SQLITE_BUSY" : void 0;
  return code === void 0 ? error : Object.assign(new Error(message, { cause: error }), { code });
}, "withSqliteCode");
var D1_MAX_OPS = 450;
var createD1Database = /* @__PURE__ */ __name((runner) => {
  const executor = {
    dialect: "sqlite",
    execute: /* @__PURE__ */ __name((statement) => runner.query(statement).catch((error) => {
      throw withSqliteCode(error);
    }), "execute"),
    batch: /* @__PURE__ */ __name((statements) => runner.batch(statements).catch((error) => {
      throw withSqliteCode(error);
    }), "batch"),
    transaction: /* @__PURE__ */ __name(() => {
      throw new Error(
        "D1 has no interactive transactions; writes are batches."
      );
    }, "transaction")
  };
  return createEngineDatabase({
    name: "d1Database",
    adapter: createSqlAdapter({ executor, maxOps: D1_MAX_OPS, maxParams: 100 })
  });
}, "createD1Database");

// src/worker/d1Database.ts
var d1Database = /* @__PURE__ */ __name((database) => createD1Database({
  query: /* @__PURE__ */ __name(async ({ sql, params }) => toSqlResult(
    await database.prepare(sql).bind(...params).all()
  ), "query"),
  async batch(statements) {
    const results = await database.batch(
      statements.map(
        ({ sql, params }) => database.prepare(sql).bind(...params)
      )
    );
    if (results.length !== statements.length) throw new D1ExecutionError();
    return results.map(toSqlResult);
  }
}), "d1Database");

// src/presignR2Url.ts
var encoder3 = new TextEncoder();
var hex = /* @__PURE__ */ __name((bytes) => Array.from(
  new Uint8Array(bytes),
  (byte) => byte.toString(16).padStart(2, "0")
).join(""), "hex");
var hmac = /* @__PURE__ */ __name(async (key, value) => crypto.subtle.sign(
  "HMAC",
  await crypto.subtle.importKey(
    "raw",
    key,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  ),
  encoder3.encode(value)
), "hmac");
var encodeRfc3986 = /* @__PURE__ */ __name((value) => encodeURIComponent(value).replace(
  /[!'()*]/g,
  (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
), "encodeRfc3986");
var presignR2GetUrl = /* @__PURE__ */ __name(async ({
  accountId,
  bucketName,
  credentials,
  expiresInSeconds,
  key,
  signingDate = /* @__PURE__ */ new Date()
}) => {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const path = `/${bucketName}/${key.split("/").map(encodeRfc3986).join("/")}`;
  const amzDate = signingDate.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const scope = `${amzDate.slice(0, 8)}/auto/s3/aws4_request`;
  const query2 = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD"],
    ["X-Amz-Credential", `${credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", "host"],
    ["x-id", "GetObject"]
  ];
  const queryString = /* @__PURE__ */ __name((entries) => entries.map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`).join("&"), "queryString");
  const canonicalRequest = [
    "GET",
    path,
    queryString(query2),
    `host:${host}
`,
    "host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    hex(
      await crypto.subtle.digest("SHA-256", encoder3.encode(canonicalRequest))
    )
  ].join("\n");
  let signingKey = encoder3.encode(
    `AWS4${credentials.secretAccessKey}`
  ).buffer;
  for (const part of [amzDate.slice(0, 8), "auto", "s3", "aws4_request"]) {
    signingKey = await hmac(signingKey, part);
  }
  const signature = hex(await hmac(signingKey, stringToSign));
  const signed = [
    ...query2.slice(0, 5),
    ["X-Amz-Signature", signature],
    ...query2.slice(5)
  ];
  return `https://${host}${path}?${queryString(signed)}`;
}, "presignR2GetUrl");

// src/r2WorkerStorage.ts
var PRESIGNED_URL_EXPIRES_IN_SECONDS = 3600;
function r2WorkerStorage(config) {
  const getStorageKey = createStorageKeyBuilder(config.basePath);
  const parseAndValidate = /* @__PURE__ */ __name((storageUri) => {
    const parsed = parseStorageUri(storageUri, "r2");
    if (parsed.bucket !== config.bucketName) {
      throw new Error(
        `Bucket name mismatch: expected "${config.bucketName}", but found "${parsed.bucket}".`
      );
    }
    return parsed;
  }, "parseAndValidate");
  return createStorageAdapter({
    name: "r2Storage",
    protocol: "r2",
    async put({ key, body: body2, contentLength, contentType }) {
      const storageKey = getStorageKey(key);
      const uploadOptions = {
        httpMetadata: {
          contentType,
          cacheControl: "max-age=31536000"
        }
      };
      if (contentLength === void 0) {
        const bufferedBody = new Uint8Array(
          await new Response(body2).arrayBuffer()
        );
        await config.bucket.put(storageKey, bufferedBody, uploadOptions);
      } else {
        const fixedLengthBody = new FixedLengthStream(contentLength);
        await Promise.all([
          body2.pipeTo(fixedLengthBody.writable),
          config.bucket.put(
            storageKey,
            fixedLengthBody.readable,
            uploadOptions
          )
        ]);
      }
      return {
        storageUri: createStorageUri({
          protocol: "r2",
          bucket: config.bucketName,
          key: storageKey
        })
      };
    },
    async get({ storageUri }) {
      const { key } = parseAndValidate(storageUri);
      const object = await config.bucket.get(key);
      if (!object) return { response: null };
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("content-length", String(object.size));
      return { response: new Response(object.body, { headers }) };
    },
    ...config.credentials === void 0 ? {} : {
      async getDownloadUrl({ storageUri }) {
        const { key } = parseAndValidate(storageUri);
        return {
          url: await presignR2GetUrl({
            accountId: config.accountId,
            bucketName: config.bucketName,
            credentials: config.credentials,
            expiresInSeconds: PRESIGNED_URL_EXPIRES_IN_SECONDS,
            key
          })
        };
      }
    },
    async exists({ storageUri }) {
      const { key } = parseAndValidate(storageUri);
      return { exists: await config.bucket.head(key) !== null };
    },
    async delete({ storageUri }) {
      const { key } = parseAndValidate(storageUri);
      await config.bucket.delete(key);
      return { deleted: true };
    }
  });
}
__name(r2WorkerStorage, "r2WorkerStorage");

// worker/src/index.ts
var HOT_UPDATER_BASE_PATH = "/";
var hotUpdater = createHotUpdater({
  database: d1Database(env.DB),
  plugins: [insights(), apiKeys(), remoteConfig()],
  storage: r2WorkerStorage({
    bucket: env.BUCKET,
    bucketName: env.BUCKET_NAME,
    // Presign download URLs, so devices download from R2.
    accountId: env.ACCOUNT_ID,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    }
  })
});
var app = new Hono2();
app.mount(
  HOT_UPDATER_BASE_PATH,
  (request) => hotUpdater.handlers.client(request)
);
var index_default = app;
export {
  HOT_UPDATER_BASE_PATH,
  index_default as default
};
//# sourceMappingURL=index.js.map
